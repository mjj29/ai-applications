"""Stage 5 - overlay shots (wireframe) and highlight differences.

Runs on the SAME DTW-aligned event timeline as the ghost/delta (draw + follow DTW-aligned
by motion, hold shorter-full/longer-cut, release anchored), so the skeleton overlay is
synced the same way the footage overlays are.

Outputs (per tag = video stem, or 'all' when pooled):
  <tag>.overlay.mp4          every shot's skeleton, colour-coded, animated through the timeline
  <tag>.overlay_release.png  skeletons at the release instant (+ mean)
  <tag>.angles.png           joint angles across the timeline, mean +/- 2 std band
  <tag>.tracks.png           draw-/bow-hand paths overlaid
Also prints each shot's deviation from the mean near release.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from . import align
from . import config as _config
from . import landmarks as L

# Upper body only (legs are noisy and irrelevant to release form).
EDGES = [
    (11, 12), (11, 23), (12, 24), (23, 24),          # shoulders, torso sides, hips
    (11, 13), (13, 15), (12, 14), (14, 16),          # arms
    (0, 11), (0, 12),                                # head -> shoulders
]
HAND_EDGES = [
    (0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12), (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20), (0, 17),
]
UPPER = [0, 11, 12, 13, 14, 15, 16, 23, 24]


def _to_px(pt, scale, cx, cy):
    return int(round(cx + pt[0] * scale)), int(round(cy + pt[1] * scale))


def _draw_skeleton_cv2(img, coords, dh, color, scale, cx, cy, lw=2):
    for i, j in EDGES:
        if np.isnan(coords[[i, j]]).any():
            continue
        cv2.line(img, _to_px(coords[i], scale, cx, cy), _to_px(coords[j], scale, cx, cy), color, lw, cv2.LINE_AA)
    if dh is not None:
        for i, j in HAND_EDGES:
            if np.isnan(dh[[i, j]]).any():
                continue
            cv2.line(img, _to_px(dh[i], scale, cx, cy), _to_px(dh[j], scale, cx, cy), color, 1, cv2.LINE_AA)


def _draw_skeleton(ax, pts, color, lw=1.5, alpha=1.0, label=None):
    first = True
    for i, j in EDGES:
        if np.isnan(pts[[i, j]]).any():
            continue
        ax.plot([pts[i, 0], pts[j, 0]], [pts[i, 1], pts[j, 1]], "-", color=color, lw=lw,
                alpha=alpha, solid_capstyle="round", label=label if first else None)
        first = False


def _draw_hand(ax, pts, color, lw=1.0, alpha=0.9):
    for i, j in HAND_EDGES:
        if np.isnan(pts[[i, j]]).any():
            continue
        ax.plot([pts[i, 0], pts[j, 0]], [pts[i, 1], pts[j, 1]], "-", color=color, lw=lw, alpha=alpha)


def _colors(n):
    import matplotlib.pyplot as plt
    return plt.cm.viridis(np.linspace(0, 1, n))


def _load(stems, cfg):
    """Build the DTW-aligned timeline for every shot of the given videos and sample poses."""
    import pandas as pd
    shot_list, labels_video = [], []
    for stem in stems:
        s = pd.read_parquet(_config.data_dir(cfg) / f"{stem}.shots.parquet")
        for sh in s["shot"]:
            shot_list.append((stem, int(sh)))
            labels_video.append(f"{_config.short_label(stem)}#{int(sh)}")
    src_list, tl, rel_gi = align.build_timelines(shot_list, cfg)
    T = len(tl)
    coords = np.full((len(shot_list), T, L.N_LANDMARKS, 2), np.nan)
    dh = np.full((len(shot_list), T, 21, 2), np.nan)
    for k, (stem, _sh) in enumerate(shot_list):
        c, d = align.aligned_pose(stem, src_list[k], cfg)
        coords[k], dh[k] = c, d
    return coords, dh, tl, rel_gi, labels_video


def _angle(coords, a, b, c):
    ba = coords[:, :, a, :] - coords[:, :, b, :]
    bc = coords[:, :, c, :] - coords[:, :, b, :]
    cos = (ba * bc).sum(-1) / (np.linalg.norm(ba, axis=-1) * np.linalg.norm(bc, axis=-1) + 1e-9)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def compare(stems, cfg, *, tag=None, make_video=True):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    coords, dh, tl, rel_gi, names = _load(stems, cfg)
    S, T = coords.shape[0], coords.shape[1]
    tag = tag or (stems[0] if len(stems) == 1 else f"{len(stems)}videos")
    if len(stems) > 1:
        names = [n for n in names]
    else:
        names = [f"shot {n.split('#')[-1]}" for n in names]
    sides = L.sides(cfg["archer"]["handedness"])
    cols = _colors(S)
    odir = _config.output_dir(cfg)

    # ---- deviation near release (upper body) ----
    w = slice(max(0, rel_gi - 6), rel_gi + 6)
    mean_sk = np.nanmean(coords, axis=0)
    dev = np.sqrt(np.nansum((coords - mean_sk[None]) ** 2, axis=-1))
    shot_dev = np.nanmean(dev[:, w][:, :, UPPER], axis=(1, 2))
    order = np.argsort(-shot_dev)
    print(f"[{tag}] shot deviation from mean near release (larger = more different):")
    for r in order:
        print(f"   {names[r]:>12}: {shot_dev[r]:.3f}{'   <-- biggest outlier' if r == order[0] else ''}")

    # ---- 1. skeleton overlay at release ----
    fig, ax = plt.subplots(figsize=(6, 8))
    for s in range(S):
        _draw_skeleton(ax, coords[s, rel_gi], cols[s], lw=1.3, alpha=0.7, label=names[s])
        _draw_hand(ax, dh[s, rel_gi], cols[s], lw=0.9, alpha=0.8)
    _draw_skeleton(ax, mean_sk[rel_gi], "black", lw=2.6, alpha=0.9, label="mean")
    ax.set_aspect("equal"); ax.invert_yaxis(); ax.set_xticks([]); ax.set_yticks([])
    ax.set_title(f"{tag}\nskeletons at release, body-normalized")
    ax.legend(fontsize=7, loc="best")
    fig.tight_layout(); fig.savefig(odir / f"{tag}.overlay_release.png", dpi=120); plt.close(fig)

    # ---- 2. joint angles across the (event-aligned) timeline ----
    specs = {
        "draw elbow": (sides["draw_shoulder"], sides["draw_elbow"], sides["draw_wrist"]),
        "bow elbow": (sides["bow_shoulder"], sides["bow_elbow"], sides["bow_wrist"]),
        "draw shoulder": (sides["draw_elbow"], sides["draw_shoulder"],
                          L.LEFT_HIP if cfg["archer"]["handedness"] == "right" else L.RIGHT_HIP),
    }
    x = np.arange(T)
    fig, axes = plt.subplots(len(specs), 1, figsize=(11, 9), sharex=True)
    for axi, (nm, (a, b, c)) in zip(axes, specs.items()):
        ser = _angle(coords, a, b, c)
        m, sd = np.nanmean(ser, 0), np.nanstd(ser, 0)
        axi.fill_between(x, m - 2 * sd, m + 2 * sd, color="grey", alpha=0.2, label="mean +/- 2 std")
        for s in range(S):
            axi.plot(x, ser[s], color=cols[s], lw=1.0, alpha=0.8)
        axi.plot(x, m, color="black", lw=2.0)
        axi.axvline(rel_gi, color="red", lw=1.0, ls="--")
        axi.set_ylabel(f"{nm}\n(deg)")
    axes[0].set_title(f"{tag} — joint angles across draw -> hold -> release -> follow (red = release)")
    ticks = [i for i in range(0, T, max(1, T // 8))]
    axes[-1].set_xticks(ticks); axes[-1].set_xticklabels([tl[i] for i in ticks], rotation=45, ha="right", fontsize=7)
    axes[0].legend(fontsize=7, loc="best")
    fig.tight_layout(); fig.savefig(odir / f"{tag}.angles.png", dpi=120); plt.close(fig)

    # ---- 3. hand tracks ----
    fig, ax = plt.subplots(figsize=(7, 8))
    for key, marker in [("draw_wrist", "o"), ("bow_wrist", "s")]:
        j = sides[key]
        for s in range(S):
            path = coords[s, :, j, :]
            ax.plot(path[:, 0], path[:, 1], color=cols[s], lw=1.0, alpha=0.7)
            ax.scatter(*coords[s, rel_gi, j], color=cols[s], marker=marker, s=30, zorder=3,
                       edgecolor="k", linewidth=0.4)
    ax.set_aspect("equal"); ax.invert_yaxis(); ax.set_xticks([]); ax.set_yticks([])
    ax.set_title(f"{tag} — hand tracks (o=draw wrist, s=bow wrist; markers at release)")
    fig.tight_layout(); fig.savefig(odir / f"{tag}.tracks.png", dpi=120); plt.close(fig)

    # ---- 4. animated skeleton overlay (cv2, phase timeline) ----
    if make_video:
        _overlay_video(coords, dh, tl, rel_gi, cols, odir / f"{tag}.overlay.mp4", cfg)

    print(f"[{tag}] wrote overlay_release.png, angles.png, tracks.png"
          + (", overlay.mp4" if make_video else "") + f"  ({S} shots)")
    return dict(shot_dev=shot_dev, names=names)


def _overlay_video(coords, dh, tl, rel_gi, cols, out_path, cfg):
    canvas = align.ghost_canvas(cfg)
    Wc, Hc, T_scale, Cx, Cy = (canvas[k] for k in ("Wc", "Hc", "T", "Cx", "Cy"))
    gfps = align.timeline_params(cfg)["play_fps"]
    bgr = [(int(b * 255), int(g * 255), int(r * 255)) for r, g, b, _ in cols]
    proc = align.ffmpeg_writer(out_path, Wc, Hc, gfps)
    S = coords.shape[0]
    for gi in range(len(tl)):
        img = np.zeros((Hc, Wc, 3), np.uint8)
        for s in range(S):
            _draw_skeleton_cv2(img, coords[s, gi], dh[s, gi], bgr[s], T_scale, Cx, Cy, lw=1)
        mean_sk = np.nanmean(coords[:, gi], axis=0)
        _draw_skeleton_cv2(img, mean_sk, None, (255, 255, 255), T_scale, Cx, Cy, lw=2)
        lab = tl[gi] + ("  RELEASE" if gi == rel_gi else "")
        cv2.putText(img, lab, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
        proc.stdin.write(img.tobytes())
    proc.stdin.close()
    proc.wait()


def run(videos, cfg, *, combined=False):
    stems = [Path(v).stem for v in videos]
    res = [compare([s], cfg) for s in stems]
    if combined and len(stems) > 1:
        res.append(compare(stems, cfg, tag="all"))
    return res
