"""Stage 2 - shot segmentation + release detection.

Pipeline per video:
  1. Build a 1-D *activity* signal (bow-hand height) and split it into the ~6 shot
     windows (raise -> aim -> release -> follow-through), ignoring the rest gaps.
  2. Within each window, find the *release*: the release-hand backward snap (a sharp
     peak in release-hand speed), cross-checked against audio onsets.
  3. The clicker/shot is a sharp audio transient. We accept the strongest onset near
     this archer's pose-confirmed release as t=0. Other archers' clicks don't align
     with *your* motion (and yours is loudest, being closest), so they're rejected.

Outputs:
  data/<stem>.shots.parquet  - one row per shot (windows + release frame/time/source)
  output/<stem>.segment.png  - diagnostic plot for eyeballing the detection
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import librosa
import numpy as np
import pandas as pd
from scipy.signal import butter, find_peaks, savgol_filter, sosfilt

from . import config as _config
from . import landmarks as L


# ---------------------------------------------------------------- helpers
def _load(stem, cfg):
    ddir = _config.data_dir(cfg)
    df = pd.read_parquet(ddir / f"{stem}.pose.parquet")
    meta = json.loads((ddir / f"{stem}.meta.json").read_text(encoding="utf-8"))
    return df, meta


def _interp_nan(a):
    a = np.asarray(a, dtype=float).copy()
    good = ~np.isnan(a)
    if good.sum() < 2:
        return np.nan_to_num(a)
    idx = np.arange(len(a))
    a[~good] = np.interp(idx[~good], idx[good], a[good])
    return a


def _smooth(a, win, poly=2):
    win = max(int(win), poly + 2)
    if win % 2 == 0:
        win += 1
    if win >= len(a):
        return a
    return savgol_filter(a, win, poly)


def _runs(active, eff_fps, min_gap_s, min_len_s):
    """Contiguous True regions, gaps < min_gap merged, runs < min_len dropped."""
    idx = np.flatnonzero(active)
    if len(idx) == 0:
        return []
    brk = np.flatnonzero(np.diff(idx) > 1)
    starts = [idx[0]] + [idx[b + 1] for b in brk]
    ends = [idx[b] for b in brk] + [idx[-1]]
    runs = list(zip(starts, ends))
    merged = [list(runs[0])]
    for s, e in runs[1:]:
        if (s - merged[-1][1]) < min_gap_s * eff_fps:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [(s, e) for s, e in merged if (e - s) >= min_len_s * eff_fps]


# ---------------------------------------------------------------- audio
def _ensure_wav(video_path, cfg):
    ddir = _config.data_dir(cfg)
    wav = ddir / f"{Path(video_path).stem}.wav"
    if not wav.exists():
        ff = shutil.which("ffmpeg")
        if ff is None:
            import imageio_ffmpeg
            ff = imageio_ffmpeg.get_ffmpeg_exe()
        subprocess.run([ff, "-v", "error", "-y", "-i", str(video_path),
                        "-ac", "1", "-ar", "44100", str(wav)], check=True)
    return wav


def _has_audio(video_path) -> bool:
    """Does the recording have an audio stream at all? (ffmpeg lists its streams on stderr.)"""
    ff = shutil.which("ffmpeg")
    if ff is None:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    r = subprocess.run([ff, "-hide_banner", "-i", str(video_path)], capture_output=True, text=True,
                       errors="replace")
    return "Audio:" in r.stderr


def _bow_motion_release(video, t_from, t_to, hold_end_t, roi):
    """Release time from the bow's own motion. While aiming the bow is still; on the loose it
    jumps forward and tips (the stabiliser makes this large and sudden). Mean absolute frame
    difference in a box just beyond the bow hand, at the full frame rate, frames picked by
    their own timestamps (variable-frame-rate safe). The loose = the first frame from 2s before
    the hold's end whose change reaches 40% of the biggest change in that stretch. Hand-checked
    on 8 silent indoor shots (two archers): -0.03s mean, 0.15s worst, vs +0.65s / 1.45s for the
    pose rule. None if there is no clear jump (bow hidden, no change)."""
    import cv2

    from .align import open_before
    x0, y0, x1, y1 = roi
    cap = open_before(video, t_from)
    prev, ts, ds = None, [], []
    try:
        while cap.grab():
            ft = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if ft < t_from:
                continue
            if ft > t_to:
                break
            ok, f = cap.retrieve()
            if not ok:
                break
            g = cv2.GaussianBlur(cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY), (5, 5), 0).astype(np.int16)
            if prev is not None:
                ts.append(ft)
                ds.append(float(np.mean(np.abs(g - prev))))
            prev = g
    finally:
        cap.release()
    ts, ds = np.array(ts), np.array(ds)
    if len(ts) < 5:
        return None
    still = ds[ts < hold_end_t - 1.0]
    # quiet level: the stillest quarter of the aim (the stretch also holds the draw, a neighbour...)
    base = max(float(np.percentile(still if len(still) else ds, 25)), 0.5)
    search = ts >= hold_end_t - 2.0
    if not search.any() or ds[search].max() < 2.5 * base:
        return None
    big = search & (ds >= 0.4 * ds[search].max())
    # The archer's own loose comes straight out of the still aim; a neighbour drawing or shooting
    # inside the box ramps up without that. So prefer a jump preceded by 0.5s of quiet.
    for i in np.flatnonzero(big):
        pre = ds[(ts >= ts[i] - 0.5) & (ts < ts[i])]
        if len(pre) and float(np.mean(pre)) <= 2.0 * base:
            return float(ts[i])
    j = np.flatnonzero(big)
    return float(ts[j[0]]) if len(j) else None


def _detect_onsets(wav_path, cfg):
    """Return (times[s], strengths) of sharp high-frequency transients (clicks/shots)."""
    y, sr = librosa.load(str(wav_path), sr=None, mono=True)
    hp_hz = float(cfg["segment"].get("onset_highpass_hz", 1500))
    sos = butter(4, hp_hz / (sr / 2), btype="high", output="sos")
    yhp = sosfilt(sos, y)
    hop = 256
    env = librosa.onset.onset_strength(y=yhp, sr=sr, hop_length=hop)
    times = librosa.times_like(env, sr=sr, hop_length=hop)
    thr = float(np.median(env) + 2.0 * np.std(env))
    peaks, props = find_peaks(env, height=thr, distance=int(0.15 * sr / hop))
    return times[peaks], env[peaks], (times, env)


# ---------------------------------------------------------------- core
def segment_video(stem, cfg, *, make_plot=True):
    df, meta = _load(stem, cfg)
    fps = meta["fps"]
    W, H = meta["width"], meta["height"]
    sg = cfg["segment"]
    sides = L.sides(cfg["archer"]["handedness"])

    t = df["t_ms"].to_numpy() / 1000.0
    # samples per second actually achieved (frame timestamps; the nominal rate can be wrong for
    # variable-frame-rate recordings)
    eff_fps = (len(t) - 1) / (t[-1] - t[0]) if len(t) > 1 and t[-1] > t[0] else fps / max(meta.get("stride", 1), 1)

    # --- activity signal: bow-hand height (1 - y, since image y grows downward) ---
    bw = sides["bow_wrist"]
    height = _smooth(1.0 - _interp_nan(df[f"y{bw}"]), int(round(eff_fps * 0.5)))
    lo, hi = np.percentile(height, 5), np.percentile(height, 95)
    act = np.clip((height - lo) / (hi - lo + 1e-9), 0, 1)
    # Long gaps with no tracked archer (stepped off the shooting spot) would otherwise be
    # bridged by interpolation and can fake a hold; treat them as bow-down. Short dropouts
    # (a few missed detections at full draw) stay interpolated so they don't split a hold.
    seen = ~np.isnan(df[f"y{bw}"].to_numpy())
    gap = _runs(~seen, eff_fps, min_gap_s=0.0, min_len_s=float(sg.get("max_gap_bridge_s", 2.0)))
    for g0, g1 in gap:
        act[g0:g1 + 1] = 0.0
    # A real shot is a *sustained* hold at full draw (a clicker archer raises, aims, then
    # looses). Wind let-downs raise the bow but never settle at the top, so requiring the
    # bow hand to stay above a high threshold for a minimum duration keeps the genuine
    # shots and discards the let-downs. (min_gap_s=0 -> no merging across dips.)
    # An archer who sets up high and draws down (bow hand dips during the draw, then settles)
    # would split one shot into two short holds - or lose it as a "raise". Join holds whose
    # dip between them is brief and shallow: between real shots the bow comes right down.
    low_thr = float(sg.get("draw_start_threshold", 0.25))
    join_s = float(sg.get("join_dip_s", 3.0))
    pieces = _runs(act > float(sg.get("activity_high_threshold", 0.8)), eff_fps, min_gap_s=0.0, min_len_s=0.0)
    joined = []
    for p in pieces:
        if joined and (p[0] - joined[-1][1]) < join_s * eff_fps and act[joined[-1][1]:p[0] + 1].min() > low_thr:
            joined[-1] = (joined[-1][0], p[1])
        else:
            joined.append(p)
    holds = [h for h in joined if (h[1] - h[0]) >= float(sg.get("min_hold_s", 1.5)) * eff_fps]
    # A shot already at full draw when the recording starts is incomplete (no raise or draw to
    # measure) and is often the previous archer's last arrow; leave it out.
    if holds and t[holds[0][0]] - t[0] < 0.5:
        print(f"  skipped a shot already under way when the recording started (release ~{t[holds[0][1]]:.1f}s)")
        holds = holds[1:]

    # --- release-hand speed (px/s) ---
    dw = sides["draw_wrist"]
    x = _interp_nan(df[f"x{dw}"]) * W
    y = _interp_nan(df[f"y{dw}"]) * H
    speed = _smooth(np.hypot(np.gradient(x), np.gradient(y)) * eff_fps, int(round(eff_fps * 0.1)))
    # torso length (px) for distance thresholds
    mhx = (_interp_nan(df["x23"]) + _interp_nan(df["x24"])) / 2 * W
    mhy = (_interp_nan(df["y23"]) + _interp_nan(df["y24"])) / 2 * H
    msx = (_interp_nan(df["x11"]) + _interp_nan(df["x12"])) / 2 * W
    msy = (_interp_nan(df["y11"]) + _interp_nan(df["y12"])) / 2 * H
    torso_px = float(np.nanmedian(np.hypot(msx - mhx, msy - mhy))) or 1.0

    # --- audio onsets ---
    onset_t, onset_s, env_full = (np.array([]), np.array([]), None)
    have_audio = False
    if sg.get("use_audio_clicker", True):
        if not _has_audio(meta["video"]):
            print("  no audio track in this recording; finding shots and releases from pose only")
        else:
            try:
                onset_t, onset_s, env_full = _detect_onsets(_ensure_wav(meta["video"], cfg), cfg)
                have_audio = True
            except Exception as e:  # noqa: BLE001
                print(f"  audio onset detection failed ({type(e).__name__}: {e}); using pose only")

    post = float(sg.get("release_post_s", 0.5))
    search = float(sg.get("release_search_window_s", 1.0))
    low = float(sg.get("draw_start_threshold", 0.25))
    rows = []
    prev_h1 = -1
    for i, (h0, h1) in enumerate(holds):
        # draw start = walk back from bow-up until the bow hand was low (the raise begins), but
        # never back into the previous shot (the bow may not drop that low between shots)
        ds = h0
        while ds > prev_h1 + 1 and act[ds] > low:
            ds -= 1
        prev_h1 = h1
        # full-draw anchor = the draw/bow hands' positions during the aim (median over the
        # plateau); draw_end = when the draw hand first reaches its anchor (end of the pull).
        ax, ay = float(np.nanmedian(x[h0:h1 + 1])), float(np.nanmedian(y[h0:h1 + 1]))
        dist = np.hypot(x - ax, y - ay)
        # Anchor the draw/release on the STATIC full-draw hold: the longest run where the draw
        # hand sits at its anchor. Its start = full draw reached (draw_end); its end = the loose
        # (the hand departs). Defining both off the hold's structure makes them consistent
        # shot-to-shot, rather than depending on a fragile per-shot velocity/threshold event.
        we = min(len(dist) - 1, int(h1 + 1.0 * eff_fps))
        atanchor = np.flatnonzero(dist[ds:we + 1] < 0.2 * torso_px)
        if len(atanchor):
            brk = np.flatnonzero(np.diff(atanchor) > 1)
            starts = np.r_[atanchor[0], atanchor[brk + 1]]
            ends = np.r_[atanchor[brk], atanchor[-1]]
            # the loose comes after the bow is up: ignore anchor runs that end before the hold
            span = np.where(ends >= h0 - ds, ends - starts, -1)
            b = int(np.argmax(span))
            de = ds + int(starts[b])
            rel_row = min(ds + int(ends[b]) + 1, we)      # first frame the hand departs = loose
        else:
            de, rel_row = ds, min(int(h1), we)
        rel_t = float(t[rel_row])
        t_peak = rel_t
        # The pose estimate above only finds the neighbourhood of the loose: seen from in front,
        # the draw hand's move off the anchor is small in the image and landmark jitter or
        # smoothing shifts it by up to ~0.9s. The string's crack is a sharp transient a fixed
        # time after the loose (0.12 +/- 0.04s on Pixel footage, hand-checked frame by frame), so
        # snap to the strongest onset just before (pose runs late) or right at the pose estimate.
        motion_t = None
        if not have_audio and sg.get("release_from_bow_motion", True):
            # no clicker to hear: watch the bow jump instead (see _bow_motion_release)
            pick = np.arange(h0, h1 + 1)
            bwx = float(np.nanmedian(df[f"x{sides['bow_wrist']}"].to_numpy()[pick])) * W
            bwy = float(np.nanmedian(df[f"y{sides['bow_wrist']}"].to_numpy()[pick])) * H
            bsx = float(np.nanmedian(df[f"x{sides['bow_shoulder']}"].to_numpy()[pick])) * W
            bsy = float(np.nanmedian(df[f"y{sides['bow_shoulder']}"].to_numpy()[pick])) * H
            if np.isfinite([bwx, bwy, bsx, bsy]).all() and (bwx, bwy) != (bsx, bsy):
                u = np.array([bwx - bsx, bwy - bsy]) / np.hypot(bwx - bsx, bwy - bsy)
                cx, cy = np.array([bwx, bwy]) + 0.3 * torso_px * u
                half = 0.7 * torso_px
                roi = (int(max(0, cx - half)), int(max(0, cy - half)), int(min(W, cx + half)), int(min(H, cy + half)))
                if roi[2] - roi[0] > 8 and roi[3] - roi[1] > 8:
                    try:
                        motion_t = _bow_motion_release(meta["video"], float(t[h0]) + 0.5,
                                                       float(t[h1]) + float(sg.get("release_motion_after_s", 2.0)), float(t[h1]), roi)
                    except Exception as e:  # noqa: BLE001
                        print(f"  bow-motion release failed ({type(e).__name__}: {e}); using pose")
            if motion_t is not None:
                rel_row = int(np.clip(np.searchsorted(t, motion_t), 0, len(t) - 1))
                rel_t = float(t[rel_row])
        if sg.get("release_snap_to_audio", True) and len(onset_t):
            win = ((onset_t >= rel_t - float(sg.get("release_snap_pre_s", 0.8)))
                   & (onset_t <= rel_t + float(sg.get("release_snap_post_s", 0.1))))
            if win.any():
                snap_t = float(onset_t[win][np.argmax(onset_s[win])]) - float(sg.get("audio_latency_s", 0.0))
                rel_row = int(np.clip(np.searchsorted(t, snap_t), 0, len(t) - 1))
                rel_t = float(t[rel_row])
        # bow lowered = end of follow-through: first time after release the bow hand drops
        # back past halfway (capped 3s after release, before the next shot).
        bl = rel_row
        cap = min(rel_row + int(3 * eff_fps), len(act) - 1)
        while bl < cap and act[bl] > 0.5:
            bl += 1
        # audio used only to confirm a real shot (a clicker/string transient near the loose)
        near = (onset_t >= rel_t - search) & (onset_t <= rel_t + 0.5)
        source = "audio" if bool(near.any()) else ("bow" if motion_t is not None else "pose")
        strength = float(np.max(onset_s[near])) if near.any() else float("nan")
        rows.append(dict(
            shot=i + 1,
            draw_start_frame=int(df["frame"].iloc[ds]), draw_start_t=float(t[ds]),
            draw_end_frame=int(df["frame"].iloc[de]), draw_end_t=float(t[de]),
            bow_low_frame=int(df["frame"].iloc[bl]), bow_low_t=float(t[bl]),
            hold_start_frame=int(df["frame"].iloc[h0]), hold_end_frame=int(df["frame"].iloc[h1]),
            hold_start_t=float(t[h0]), hold_end_t=float(t[h1]),
            release_frame=int(df["frame"].iloc[rel_row]), release_t=rel_t,
            release_source=source, speed_peak_t=float(t_peak),
            onset_strength=strength, n_onsets_in_window=int(near.sum()),
        ))
    shots = pd.DataFrame(rows, columns=None if rows else ["shot", "hold_start_t", "hold_end_t", "release_t",
                                                         "release_source", "onset_strength"])
    # Relative sanity checks within this end (several archers => clicks everywhere, so "an onset
    # within a second" no longer proves a shot). Judge each candidate against this archer's own
    # shots: a hold far shorter than their usual one is a raise/let-down, and a confirming click
    # far weaker than their usual one is someone else's (it then counts as no click).
    if len(shots) >= 3:
        hold = shots["hold_end_t"] - shots["hold_start_t"]
        short = hold < float(sg.get("relative_hold_min", 0.5)) * hold.median()
        if short.any():
            print(f"  dropped {int(short.sum())} hold(s) much shorter than this end's usual "
                  f"{hold.median():.1f}s (raises / let-downs)")
            shots = shots[~short].reset_index(drop=True)
        conf = shots["onset_strength"]
        weak = conf < float(sg.get("relative_onset_min", 0.4)) * conf.median()
        shots.loc[weak, "release_source"] = "pose"
    # require_audio can only mean something when there is audio: a silent recording (e.g. a
    # webcam app saving video only) would otherwise lose every shot.
    if sg.get("require_audio", False) and have_audio and len(shots):
        before = len(shots)
        shots = shots[shots["release_source"] == "audio"].reset_index(drop=True)
        if len(shots) < before:
            print(f"  require_audio: dropped {before - len(shots)} pose-only "
                  f"(no clicker/shot) detection(s) — likely let-downs")

    shots["shot"] = np.arange(1, len(shots) + 1)
    ddir = _config.data_dir(cfg)
    shots.to_parquet(ddir / f"{stem}.shots.parquet")
    if make_plot:
        _plot(stem, t, act, sg, holds, speed, shots, onset_t, onset_s, env_full, cfg)

    n = len(shots)
    exp = sg.get("expected_shots", 6)
    flag = "" if n == exp else f"  <-- expected {exp}!"
    n_audio = int((shots["release_source"] == "audio").sum()) if n else 0
    n_bow = int((shots["release_source"] == "bow").sum()) if n else 0
    print(f"{stem}: {n} shots{flag}  ({n_audio} release times from audio, {n_bow} from the bow's "
          f"motion, {n - n_audio - n_bow} pose-only)")
    return shots


def _plot(stem, t, act, sg, holds, speed, shots, onset_t, onset_s, env_full, cfg):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(3, 1, figsize=(14, 8), sharex=True)
    ax[0].plot(t, act, lw=0.8)
    ax[0].axhline(sg.get("activity_high_threshold", 0.8), color="grey", ls=":", lw=0.8)
    for h0, h1 in holds:
        ax[0].axvspan(t[h0], t[h1], color="tab:green", alpha=0.15)
    ax[0].set_ylabel("bow-hand\nheight (norm)")
    ax[0].set_title(f"{stem} — shot segmentation & release detection")

    ax[1].plot(t, speed, lw=0.8, color="tab:orange")
    ax[1].set_ylabel("release-hand\nspeed (px/s)")

    if env_full is not None:
        et, ev = env_full
        ax[2].plot(et, ev, lw=0.5, color="tab:blue", alpha=0.7)
        ax[2].scatter(onset_t, onset_s, s=8, color="navy", zorder=3, label="onsets")
    ax[2].set_ylabel("audio onset\nstrength")
    ax[2].set_xlabel("time (s)")

    for _, r in shots.iterrows():
        c = "tab:red" if r["release_source"] == "audio" else "tab:purple"
        for a in ax:
            a.axvline(r["release_t"], color=c, lw=1.2)
        ax[0].annotate(f"#{int(r['shot'])}", (r["release_t"], 1.0), color=c,
                       fontsize=8, ha="center", va="bottom")
    fig.tight_layout()
    out = _config.output_dir(cfg) / f"{stem}.segment.png"
    fig.savefig(out, dpi=110)
    plt.close(fig)


def run(videos, cfg):
    out = []
    for v in videos:
        out.append(segment_video(Path(v).stem, cfg))
    return out
