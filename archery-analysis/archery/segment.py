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
    eff_fps = fps / max(meta.get("stride", 1), 1)
    W, H = meta["width"], meta["height"]
    sg = cfg["segment"]
    sides = L.sides(cfg["archer"]["handedness"])

    t = df["t_ms"].to_numpy() / 1000.0

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
    holds = _runs(act > float(sg.get("activity_high_threshold", 0.8)), eff_fps,
                  min_gap_s=0.0, min_len_s=float(sg.get("min_hold_s", 1.5)))

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
    if sg.get("use_audio_clicker", True):
        try:
            onset_t, onset_s, env_full = _detect_onsets(_ensure_wav(meta["video"], cfg), cfg)
        except Exception as e:  # noqa: BLE001
            print(f"  audio onset detection failed ({type(e).__name__}: {e}); using pose only")

    post = float(sg.get("release_post_s", 0.5))
    search = float(sg.get("release_search_window_s", 1.0))
    low = float(sg.get("draw_start_threshold", 0.25))
    rows = []
    for i, (h0, h1) in enumerate(holds):
        # draw start = walk back from bow-up until the bow hand was low (the raise begins)
        ds = h0
        while ds > 0 and act[ds] > low:
            ds -= 1
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
            b = int(np.argmax(ends - starts))
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
        source = "audio" if bool(near.any()) else "pose"
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
    if sg.get("require_audio", False) and len(shots):
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
    print(f"{stem}: {n} shots{flag}  ({n_audio} release times from audio, {n - n_audio} pose-only)")
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
