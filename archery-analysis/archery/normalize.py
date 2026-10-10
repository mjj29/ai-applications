"""Stage 3 - spatial + temporal normalization.

Body-normalization (shared): landmarks -> aspect-correct pixels, centred on the mid-hip
each frame, scaled by the per-VIDEO torso length (a lean shortens the projected torso, so
a per-shot scale would wrongly resize leaning shots). Translation/scale/camera removed;
posture, lean and limb angles preserved.

`normalized_track` returns the per-frame body-normalized track; it is the shared basis for:
  - this stage's release-aligned grid (data/<stem>.normalized.npz), used by the analysis, and
  - the event-aligned phase timeline (align.aligned_pose) used by the overlays/deltas.
"""
from __future__ import annotations

import numpy as np

from . import config as _config
from . import landmarks as L

NH = 21


def _interp_nan(a):
    a = np.asarray(a, dtype=float).copy()
    good = ~np.isnan(a)
    if good.sum() < 2:
        return np.nan_to_num(a)
    idx = np.arange(len(a))
    a[~good] = np.interp(idx[~good], idx[good], a[good])
    return a


def normalized_track(stem, cfg):
    """Per-frame body-normalized landmarks + hands for a whole video.

    Returns dict: t (N,), coords (N,33,2), dh (N,21,2), bh (N,21,2), vis (N,33),
    torso_px (scalar), meta.
    """
    import pandas as pd
    df, meta = _config.load_pose(stem, cfg)
    W, H = meta["width"], meta["height"]
    nm = cfg.get("normalize", {})
    rotate = bool(nm.get("rotate_upright", False))
    vis_thr = float(nm.get("min_visibility", 0.5))
    t = df["t_ms"].to_numpy() / 1000.0
    Vz = np.stack([df[f"v{i}"].to_numpy() for i in range(L.N_LANDMARKS)], axis=1)

    Xr = np.stack([df[f"x{i}"].to_numpy() * W for i in range(L.N_LANDMARKS)], axis=1)
    Yr = np.stack([df[f"y{i}"].to_numpy() * H for i in range(L.N_LANDMARKS)], axis=1)
    Xr[Vz < vis_thr] = np.nan
    Yr[Vz < vis_thr] = np.nan
    X = np.stack([_interp_nan(Xr[:, i]) for i in range(L.N_LANDMARKS)], axis=1)
    Y = np.stack([_interp_nan(Yr[:, i]) for i in range(L.N_LANDMARKS)], axis=1)
    k = int(nm.get("smooth_frames", 7)) | 1
    if k >= 3:
        from scipy.ndimage import median_filter
        X = median_filter(X, size=(k, 1), mode="nearest")
        Y = median_filter(Y, size=(k, 1), mode="nearest")

    midhipX = (X[:, L.LEFT_HIP] + X[:, L.RIGHT_HIP]) / 2
    midhipY = (Y[:, L.LEFT_HIP] + Y[:, L.RIGHT_HIP]) / 2
    midshX = (X[:, L.LEFT_SHOULDER] + X[:, L.RIGHT_SHOULDER]) / 2
    midshY = (Y[:, L.LEFT_SHOULDER] + Y[:, L.RIGHT_SHOULDER]) / 2
    torso = float(np.nanmedian(np.hypot(midshX - midhipX, midshY - midhipY))) or 1.0

    ca = sa = None
    if rotate:
        ang = np.arctan2((midshX - midhipX) / torso, -(midshY - midhipY) / torso)
        ca, sa = np.cos(-ang)[:, None], np.sin(-ang)[:, None]

    def _norm(px, py):
        xn = (px - midhipX[:, None]) / torso
        yn = (py - midhipY[:, None]) / torso
        if rotate:
            xn, yn = ca * xn - sa * yn, sa * xn + ca * yn
        return xn, yn

    Xn, Yn = _norm(X, Y)
    coords = np.stack([Xn, Yn], axis=2)                    # (N,33,2)

    dh = np.full((len(t), NH, 2), np.nan)
    bh = np.full((len(t), NH, 2), np.nan)
    hpath = _config.data_dir(cfg) / f"{stem}.hands.parquet"
    if hpath.exists():
        h = pd.read_parquet(hpath).set_index("frame").reindex(df["frame"].to_numpy())
        for key, store in (("dh", dh), ("bh", bh)):
            pres = h[f"{key}_present"].fillna(False).to_numpy().astype(bool)
            hx = h[[f"{key}_x{j}" for j in range(NH)]].to_numpy() * W
            hy = h[[f"{key}_y{j}" for j in range(NH)]].to_numpy() * H
            hx[~pres] = np.nan
            hy[~pres] = np.nan
            hxn, hyn = _norm(hx, hy)
            store[:] = np.stack([hxn, hyn], axis=2)
    return dict(t=t, coords=coords, dh=dh, bh=bh, vis=Vz, torso_px=torso, meta=meta)


def _resample(times, src_t, arr):
    """Interpolate arr (Nt, K, 2) or (Nt, K) from src_t onto times (NaN-safe per column)."""
    times = np.asarray(times)
    if arr.ndim == 3:
        out = np.full((len(times), arr.shape[1], 2), np.nan)
        for i in range(arr.shape[1]):
            for a in range(2):
                v = ~np.isnan(arr[:, i, a])
                if v.sum() >= 2:
                    out[:, i, a] = np.interp(times, src_t[v], arr[v, i, a], left=np.nan, right=np.nan)
        return out
    out = np.full((len(times), arr.shape[1]), np.nan)
    for i in range(arr.shape[1]):
        v = ~np.isnan(arr[:, i])
        if v.sum() >= 2:
            out[:, i] = np.interp(times, src_t[v], arr[v, i], left=np.nan, right=np.nan)
    return out


def normalize_video(stem, cfg):
    import pandas as pd
    shots = pd.read_parquet(_config.data_dir(cfg) / f"{stem}.shots.parquet")
    tr = normalized_track(stem, cfg)
    nm = cfg.get("normalize", {})
    t_pre = -abs(float(nm.get("align_pre_s", 5.0)))
    t_post = float(nm.get("align_post_s", 1.0))
    grid_fps = float(nm.get("grid_fps", tr["meta"]["fps"]))
    grid = np.arange(t_pre, t_post + 1e-9, 1.0 / grid_fps)
    S, G = len(shots), len(grid)

    coords = np.full((S, G, L.N_LANDMARKS, 2), np.nan)
    vis = np.full((S, G, L.N_LANDMARKS), np.nan)
    dh_coords = np.full((S, G, NH, 2), np.nan)
    bh_coords = np.full((S, G, NH, 2), np.nan)
    for si, row in shots.reset_index(drop=True).iterrows():
        st = row["release_t"] + grid                       # absolute source times for this shot
        coords[si] = _resample(st, tr["t"], tr["coords"])
        vis[si] = _resample(st, tr["t"], tr["vis"])
        dh_coords[si] = _resample(st, tr["t"], tr["dh"])
        bh_coords[si] = _resample(st, tr["t"], tr["bh"])

    out = _config.data_dir(cfg) / f"{stem}.normalized.npz"
    np.savez(out, grid=grid, coords=coords, vis=vis,
             dh_coords=dh_coords, bh_coords=bh_coords,
             shots=shots["shot"].to_numpy(), release_t=shots["release_t"].to_numpy(),
             video=stem, handedness=cfg["archer"]["handedness"],
             W=tr["meta"]["width"], H=tr["meta"]["height"],
             torso_px=np.full(S, tr["torso_px"]))
    print(f"{stem}: normalized {S} shots onto grid [{t_pre:+.1f}, {t_post:+.1f}]s ({G} samples) -> {out.name}")
    return out


def run(videos, cfg):
    from pathlib import Path
    return [normalize_video(Path(v).stem, cfg) for v in videos]
