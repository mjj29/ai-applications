"""2-shot delta: overlay two shots so their difference pops.

Both the real-frame version (reference cyan, highlight red; grey where identical, cyan/red
fringes where they differ) and the wireframe version (the two skeletons) run on the same
DTW-aligned event timeline as the ghost: draw and follow-through are DTW-aligned by actual
motion, the hold is the shorter shot's (longer shots' static middle cut), release anchored.

Outputs per tag:
  <tag>.delta.mp4 / .delta_release.png        real frames, tinted
  <tag>.delta_wire.mp4 / .delta_wire_release.png   skeletons, cyan vs red
"""
from __future__ import annotations

import cv2
import numpy as np

from . import align
from . import config as _config
from .compare import EDGES, HAND_EDGES

CYAN, RED = (255, 255, 0), (0, 0, 255)   # BGR


def _to_px(pt, scale, cx, cy):
    return int(round(cx + pt[0] * scale)), int(round(cy + pt[1] * scale))


def _draw_skeleton_cv2(img, coords, dh, color, scale, cx, cy):
    for i, j in EDGES:
        if np.isnan(coords[[i, j]]).any():
            continue
        cv2.line(img, _to_px(coords[i], scale, cx, cy), _to_px(coords[j], scale, cx, cy),
                 color, 2, cv2.LINE_AA)
    if dh is not None:
        for i, j in HAND_EDGES:
            if np.isnan(dh[[i, j]]).any():
                continue
            cv2.line(img, _to_px(dh[i], scale, cx, cy), _to_px(dh[j], scale, cx, cy),
                     color, 1, cv2.LINE_AA)


def delta(ref, hi, cfg, tag, ref_name="typical", hi_name="worst"):
    """ref, hi = (video_stem, shot_number)."""
    (src_r, src_h), labels, rel_gi = align.build_timelines([ref, hi], cfg)
    gfps = align.timeline_params(cfg)["play_fps"]
    canvas = align.ghost_canvas(cfg)
    Wc, Hc, T, Cx, Cy = (canvas[k] for k in ("Wc", "Hc", "T", "Cx", "Cy"))
    _, _, _, _, to_r = align.shot_info(*ref, cfg)
    _, _, _, _, to_h = align.shot_info(*hi, cfg)
    odir = _config.output_dir(cfg)

    # ---- real-frame tinted delta ----
    fr = align.aligned_frames(ref[0], src_r, to_r, canvas, cfg)
    fh = align.aligned_frames(hi[0], src_h, to_h, canvas, cfg)
    proc = align.ffmpeg_writer(odir / f"{tag}.delta.mp4", Wc, Hc, gfps)
    z = np.zeros((Hc, Wc), np.uint8)
    for gi in range(len(labels)):
        ga = cv2.cvtColor(fr[gi], cv2.COLOR_BGR2GRAY) if fr[gi] is not None else z
        gb = cv2.cvtColor(fh[gi], cv2.COLOR_BGR2GRAY) if fh[gi] is not None else z
        img = cv2.merge([ga, ga, gb])       # ref cyan, hi red, overlap grey
        _label(img, ref_name, hi_name, labels[gi], gi == rel_gi, Hc)
        proc.stdin.write(img.tobytes())
        if gi == rel_gi:
            cv2.imwrite(str(odir / f"{tag}.delta_release.png"), img)
    proc.stdin.close()
    proc.wait()

    # ---- wireframe delta (same timeline) ----
    cr, dr = align.aligned_pose(ref[0], src_r, cfg)
    ch, dh = align.aligned_pose(hi[0], src_h, cfg)
    proc = align.ffmpeg_writer(odir / f"{tag}.delta_wire.mp4", Wc, Hc, gfps)
    for gi in range(len(labels)):
        img = np.zeros((Hc, Wc, 3), np.uint8)
        _draw_skeleton_cv2(img, cr[gi], dr[gi], CYAN, T, Cx, Cy)
        _draw_skeleton_cv2(img, ch[gi], dh[gi], RED, T, Cx, Cy)
        _label(img, ref_name, hi_name, labels[gi], gi == rel_gi, Hc)
        proc.stdin.write(img.tobytes())
        if gi == rel_gi:
            cv2.imwrite(str(odir / f"{tag}.delta_wire_release.png"), img)
    proc.stdin.close()
    proc.wait()
    print(f"{tag}: {ref_name} {_config.short_label(ref[0])}#{ref[1]} vs {hi_name} "
          f"{_config.short_label(hi[0])}#{hi[1]}")


def _label(img, ref_name, hi_name, phase, is_release, Hc):
    f = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(img, f"cyan = {ref_name}", (8, 22), f, 0.55, CYAN, 2, cv2.LINE_AA)
    cv2.putText(img, f"red  = {hi_name}", (8, 44), f, 0.55, RED, 2, cv2.LINE_AA)
    cv2.putText(img, phase + ("  RELEASE" if is_release else ""), (8, Hc - 12), f, 0.6,
                (255, 255, 255), 2, cv2.LINE_AA)
