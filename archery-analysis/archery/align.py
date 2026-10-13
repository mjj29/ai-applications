"""Shared helpers for body-aligned real-frame rendering (ghost + delta).

`aligned_frames` warps a shot's footage so the archer's (smoothed) mid-hip sits at a
fixed canvas point and the body is scaled to a common size — the same normalization the
pose analysis uses, applied to pixels. Used by both the ghost overlay and the 2-shot delta.
"""
from __future__ import annotations

import shutil
import subprocess

import cv2
import numpy as np

from . import config as _config
from . import landmarks as L


def _smooth_series(a, k=9):
    from scipy.ndimage import median_filter
    a = np.asarray(a, float).copy()
    good = ~np.isnan(a)
    if good.sum() >= 2:
        a[~good] = np.interp(np.flatnonzero(~good), np.flatnonzero(good), a[good])
    k = int(k) | 1
    if len(a) > k >= 3:
        a = median_filter(a, size=k, mode="nearest")
    return a


def ghost_canvas(cfg):
    g = cfg.get("ghost", {})
    Wc = int(g.get("width", 720)) & ~1
    Hc = int(g.get("height", 560)) & ~1
    return dict(Wc=Wc, Hc=Hc, T=float(g.get("target_torso", 150)),
                Cx=Wc / 2.0, Cy=float(g.get("hip_y_frac", 0.62)) * Hc)


def ghost_grid(cfg):
    g, nm = cfg.get("ghost", {}), cfg.get("normalize", {})
    gfps = float(g.get("fps", 20))
    grid = np.arange(-abs(float(nm.get("align_pre_s", 5.0))),
                     float(nm.get("align_post_s", 1.0)) + 1e-9, 1.0 / gfps)
    return grid, gfps


def ffmpeg_writer(path, Wc, Hc, fps):
    """A subprocess writing raw BGR frames to a broadly-playable H.264 mp4."""
    ff = shutil.which("ffmpeg") or __import__("imageio_ffmpeg").get_ffmpeg_exe()
    return subprocess.Popen(
        [ff, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s", f"{Wc}x{Hc}", "-r", f"{fps:g}", "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)],
        stdin=subprocess.PIPE)


def open_before(video, t_s: float):
    """A VideoCapture whose next frame is at or before `t_s` seconds (by the frames' own
    timestamps). OpenCV turns a time seek into a frame number at the nominal frame rate, which
    overshoots on variable-frame-rate files, so check where a seek lands and back off further
    until it is early enough (worst case: from the start)."""
    import cv2
    for back in (2.0, 10.0, 30.0, 90.0):
        start = max(0.0, t_s - back)
        if start == 0.0:
            break
        cap = cv2.VideoCapture(str(video))
        cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000.0)
        landed = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0 if cap.grab() else float("inf")
        cap.release()
        if landed <= t_s:
            cap = cv2.VideoCapture(str(video))
            cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000.0)
            return cap
    return cv2.VideoCapture(str(video))


def aligned_frames(stem, source_times, torso, canvas, cfg):
    """Body-aligned BGR frames sampled at the given source times (seconds).

    `source_times` lets the caller decide the temporal mapping (real release-aligned time,
    or the event-warped phase timeline). Uses ONE fixed transform per shot (median hip over
    the sampled frames) so the footage is steady and only real body motion shows.
    """
    pose_df, meta = _config.load_pose(stem, cfg)
    W, H, fps = meta["width"], meta["height"], meta["fps"]
    Wc, Hc, T, Cx, Cy = (canvas[k] for k in ("Wc", "Hc", "T", "Cx", "Cy"))
    pf = pose_df.set_index("frame")
    fi = pf.index.to_numpy()
    mhx_all = (pf["x23"].to_numpy() + pf["x24"].to_numpy()) / 2 * W
    mhy_all = (pf["y23"].to_numpy() + pf["y24"].to_numpy()) / 2 * H
    want_t = np.asarray(source_times, float)
    # Center on the PER-VIDEO median hip (same archer + fixed camera = same place all end),
    # not this shot's window -- so one shot's mis-detected hip can't shift it vertically and
    # every shot of an end centers identically.
    anchor_x, anchor_y = float(np.nanmedian(mhx_all)), float(np.nanmedian(mhy_all))
    scale = T / (torso if torso > 1 else 1.0)
    M = np.array([[scale, 0, Cx - scale * anchor_x], [0, scale, Cy - scale * anchor_y]], np.float32)

    # Pick frames by their own timestamps, not index * fps: some recorders (SparkoCam's WMV)
    # write a variable frame rate, where frame numbers and times drift apart. Seek to a little
    # before the first wanted time, then step forward taking, for each wanted time, the first
    # frame within half a frame of it (or past it).
    order = np.argsort(want_t)
    out = [None] * len(want_t)
    half = 0.5 / (fps or 30.0)
    cap = open_before(meta["video"], float(want_t.min()))
    k = 0
    while k < len(order) and cap.grab():
        ft = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if ft < want_t[order[k]] - half:
            continue
        ok, frame = cap.retrieve()
        if not ok:
            break
        warped = cv2.warpAffine(frame, M, (Wc, Hc), flags=cv2.INTER_LINEAR)
        while k < len(order) and want_t[order[k]] - half <= ft:
            out[order[k]] = warped
            k += 1
    cap.release()
    return out


# ---------------------------------------------------------------- event-aligned timeline
def timeline_params(cfg):
    tl, g = cfg.get("timeline", {}), cfg.get("ghost", {})
    fps = float(tl.get("fps", g.get("fps", 24)))
    return dict(mode=str(tl.get("mode", "phase")),
                draw_s=float(tl.get("draw_s", 1.5)),
                follow_s=float(tl.get("follow_s", 1.0)),
                max_hold_s=float(tl.get("max_hold_s", 3.0)),
                fps=fps,
                play_fps=fps / max(float(tl.get("slow_factor", 2.0)), 1e-6))


def common_hold_s(holds, cfg):
    """Common hold display length = the SHORTER shot's hold (capped by max_hold_s).

    The shorter shot then shows its whole hold in real time; longer shots get their static
    middle cut down to this length (see phase_source_times). So at most the longer shot(s)
    lose anything, and what they lose is the static aim, not the interesting bits.
    """
    p = timeline_params(cfg)
    hs = min([h for h in holds if h and h > 0], default=0.5)
    return float(min(max(hs, 0.2), p["max_hold_s"]))


def timeline_labels(cfg, hold_s):
    """Shared frame labels + the release frame index for a given common hold length."""
    p = timeline_params(cfg)
    fps = p["fps"]
    if p["mode"] == "release":
        grid = np.arange(-(p["draw_s"] + hold_s), p["follow_s"] + 1e-9, 1.0 / fps)
        return [f"t={x:+.2f}s" for x in grid], int(np.argmin(np.abs(grid)))
    n_draw = max(1, int(round(p["draw_s"] * fps)))
    n_hold = max(1, int(round(hold_s * fps)))
    n_follow = max(1, int(round(p["follow_s"] * fps)))
    labels = [f"draw {int(round(100 * i / max(n_draw - 1, 1)))}%" for i in range(n_draw)]
    half = hold_s / 2
    labels += ["hold" if k / fps < half else f"t={-(hold_s - k / fps):+.2f}s" for k in range(n_hold)]
    labels += [f"follow {int(round(100 * (i + 1) / n_follow))}%" for i in range(n_follow)]
    return labels, n_draw + n_hold


def phase_source_times(release_t, draw_end_t, draw_start_t, bow_low_t, hold_s, cfg):
    """Map the shared timeline to this shot's source times (seconds).

    phase mode, anchored on full-draw and release so everything lines up:
      1. draw   [draw_start .. draw_end]      -> warped to a common length
      2. hold   [draw_end .. release]         -> real-time head + real-time tail of length
                                                 hold_s, cutting the static MIDDLE. A shot
                                                 whose hold == hold_s plays fully (continuous);
                                                 a longer shot has its middle skipped.
      3. follow [release .. bow_lowered]      -> warped to a common length
    release mode: plain release-aligned real time. All shots share length, so frame i == same phase.
    """
    p = timeline_params(cfg)
    fps = p["fps"]
    if p["mode"] == "release":
        grid = np.arange(-(p["draw_s"] + hold_s), p["follow_s"] + 1e-9, 1.0 / fps)
        return release_t + grid
    n_draw = max(1, int(round(p["draw_s"] * fps)))
    n_hold = max(1, int(round(hold_s * fps)))
    n_follow = max(1, int(round(p["follow_s"] * fps)))
    ds = draw_start_t if (np.isfinite(draw_start_t) and draw_start_t < draw_end_t) else draw_end_t - 1.5
    de = max(min(draw_end_t, release_t - 1e-3), ds + 1e-3)
    bl = bow_low_t if (np.isfinite(bow_low_t) and bow_low_t > release_t) else release_t + 1.0
    draw_t = ds + (np.arange(n_draw) / n_draw) * (de - ds)
    tau = np.arange(n_hold) / fps                       # display time within the hold [0, hold_s)
    half = hold_s / 2
    hold_t = np.where(tau < half, de + tau, release_t - (hold_s - tau))
    follow_t = release_t + (np.arange(1, n_follow + 1) / n_follow) * (bl - release_t)
    return np.concatenate([draw_t, hold_t, follow_t])


# ---------------------------------------------------------------- pose sampling + DTW
_TRACKS = {}


def _track(stem, cfg):
    if stem not in _TRACKS:
        from . import normalize as _norm
        _TRACKS[stem] = _norm.normalized_track(stem, cfg)
    return _TRACKS[stem]


def aligned_pose(stem, source_times, cfg):
    """Body-normalized skeleton (T,33,2) and draw-hand (T,21,2) sampled at source_times."""
    from . import normalize as _norm
    tr = _track(stem, cfg)
    return (_norm._resample(source_times, tr["t"], tr["coords"]),
            _norm._resample(source_times, tr["t"], tr["dh"]))


def pose_signal(stem, cfg):
    """(t, draw-hand xy) used as the motion signal for DTW phase alignment."""
    tr = _track(stem, cfg)
    s = L.sides(cfg["archer"]["handedness"])
    return tr["t"], tr["coords"][:, s["draw_wrist"], :]


def _phase_interval(info, phase):
    rel, de, ds, bl, to = info
    if phase == "draw":
        a = ds if (np.isfinite(ds) and ds < de) else de - 1.5
        return a, max(de, a + 1e-3)
    b = bl if (np.isfinite(bl) and bl > rel) else rel + 1.0
    return rel, max(b, rel + 1e-3)


def _dtw_phase(shots, infos, n, phase, cfg):
    """Per-shot source-time maps (length n) that DTW-align each shot's motion in `phase`
    to the shortest-duration shot (which plays real time). Aligns the actual motion, so a
    pause or a faster pull lines up -- not just the phase endpoints."""
    from dtaidistance import dtw_ndim

    def sample(k):
        a, b = _phase_interval(infos[k], phase)
        tt, xy = pose_signal(shots[k][0], cfg)
        times = np.linspace(a, b, n)
        return times, np.ascontiguousarray(
            np.stack([np.interp(times, tt, xy[:, 0]), np.interp(times, tt, xy[:, 1])], axis=1), dtype=float)

    durs = [np.subtract(*_phase_interval(infos[k], phase)[::-1]) for k in range(len(shots))]
    ref = int(np.argmin(durs))
    _, ref_sig = sample(ref)
    maps = []
    for k in range(len(shots)):
        tk, sk = sample(k)
        if k == ref:
            maps.append(tk)
            continue
        try:
            path = dtw_ndim.warping_path(ref_sig, sk)
        except Exception:  # noqa: BLE001
            maps.append(tk)
            continue
        agg = {}
        for i, j in path:
            agg.setdefault(int(i), []).append(int(j))
        maps.append(np.array([tk[min(int(round(np.mean(agg.get(i, [i])))), n - 1)] for i in range(n)]))
    return maps


def build_timelines(shots, cfg):
    """shots: list of (stem, shot_no). Returns (list of source_times arrays, labels, rel_gi).

    Draw and follow are DTW-aligned to the shortest-phase shot; the hold is the shorter
    shot's (real-time) with longer shots' static middle cut. Used identically by the real-
    frame overlays (aligned_frames) and the wireframe overlays (aligned_pose)."""
    p = timeline_params(cfg)
    fps = p["fps"]
    infos = [shot_info(s, n, cfg) for (s, n) in shots]
    hold_s = common_hold_s([rel - de for (rel, de, ds, bl, to) in infos], cfg)
    labels, rel_gi = timeline_labels(cfg, hold_s)
    if p["mode"] == "release":
        return [phase_source_times(rel, de, ds, bl, hold_s, cfg) for (rel, de, ds, bl, to) in infos], labels, rel_gi
    n_hold = max(1, int(round(hold_s * fps)))
    draw_maps = _dtw_phase(shots, infos, max(1, int(round(p["draw_s"] * fps))), "draw", cfg)
    follow_maps = _dtw_phase(shots, infos, max(1, int(round(p["follow_s"] * fps))), "follow", cfg)
    tau = np.arange(n_hold) / fps
    half = hold_s / 2
    out = []
    for k, (rel, de, ds, bl, to) in enumerate(infos):
        ds0 = ds if (np.isfinite(ds) and ds < de) else de - 1.5
        de_c = max(min(de, rel - 1e-3), ds0 + 1e-3)
        hold_map = np.where(tau < half, de_c + tau, rel - (hold_s - tau))
        out.append(np.concatenate([draw_maps[k], hold_map, follow_maps[k]]))
    return out, labels, rel_gi


def shot_info(stem, shot_no, cfg):
    """(release_t, draw_end_t, draw_start_t, bow_low_t, torso_px) for a shot."""
    import pandas as pd
    shots = pd.read_parquet(_config.data_dir(cfg) / f"{stem}.shots.parquet")
    nz = np.load(_config.data_dir(cfg) / f"{stem}.normalized.npz", allow_pickle=True)
    r = shots[shots["shot"] == shot_no].iloc[0]
    idx = list(nz["shots"]).index(shot_no)
    de = float(r["draw_end_t"]) if "draw_end_t" in shots.columns else float(r["hold_start_t"])
    ds = float(r["draw_start_t"]) if "draw_start_t" in shots.columns else float("nan")
    bl = float(r["bow_low_t"]) if "bow_low_t" in shots.columns else float("nan")
    return float(r["release_t"]), de, ds, bl, float(nz["torso_px"][idx])


def shot_release_torso(stem, shot_no, cfg):
    """(release_t, torso_px) for a given shot of a video."""
    import pandas as pd
    shots = pd.read_parquet(_config.data_dir(cfg) / f"{stem}.shots.parquet")
    nz = np.load(_config.data_dir(cfg) / f"{stem}.normalized.npz", allow_pickle=True)
    rt = float(shots.loc[shots["shot"] == shot_no, "release_t"].iloc[0])
    idx = list(nz["shots"]).index(shot_no)
    return rt, float(nz["torso_px"][idx])
