"""Stage 5b - ghost overlay of real video frames.

Overlays the actual footage of every shot in an end, body-aligned, as a translucent
"ghost" (onion-skin): each shot is warped so the archer's body sits at a fixed canvas
point/scale, then the shots are averaged. Sharp where execution is identical, blurred
where a shot differs. Anchored on release (t=0). Uses the shared per-shot fixed transform
(`align.aligned_frames`), so the footage is steady rather than jittering on hip noise.

Output (H.264, plays everywhere):
  output/<stem>.ghost.mp4          translucent overlay animated through time-from-release
  output/<stem>.ghost_release.png  one still: the ghost at the release instant
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from . import align
from . import config as _config


def ghost_video(stem, cfg):
    import pandas as pd
    shots = pd.read_parquet(_config.data_dir(cfg) / f"{stem}.shots.parquet")
    nz = np.load(_config.data_dir(cfg) / f"{stem}.normalized.npz", allow_pickle=True)
    torso_px = nz["torso_px"]
    canvas = align.ghost_canvas(cfg)
    Wc, Hc = canvas["Wc"], canvas["Hc"]
    shot_list = [(stem, int(r["shot"])) for _, r in shots.iterrows()]
    src_list, labels, rel_gi = align.build_timelines(shot_list, cfg)   # DTW-aligned per shot
    gfps = align.timeline_params(cfg)["play_fps"]
    G = len(labels)

    acc = np.zeros((G, Hc, Wc, 3), np.float32)
    cnt = np.zeros(G, np.int32)
    for si, (_, r) in enumerate(shots.iterrows()):
        torso = float(torso_px[si]) if si < len(torso_px) else 1.0
        frames = align.aligned_frames(stem, src_list[si], torso, canvas, cfg)
        for gi, f in enumerate(frames):
            if f is not None:
                acc[gi] += f
                cnt[gi] += 1

    odir = _config.output_dir(cfg)
    proc = align.ffmpeg_writer(odir / f"{stem}.ghost.mp4", Wc, Hc, gfps)
    for gi in range(G):
        img = (acc[gi] / max(cnt[gi], 1)).astype(np.uint8)
        lab = labels[gi] + ("  RELEASE" if gi == rel_gi else "")
        cv2.putText(img, lab, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
        proc.stdin.write(img.tobytes())
        if gi == rel_gi:
            cv2.imwrite(str(odir / f"{stem}.ghost_release.png"), img)
    proc.stdin.close()
    proc.wait()
    print(f"{stem}: ghost overlay of {len(shots)} shots -> {stem}.ghost.mp4 (+ ghost_release.png)")


def run(videos, cfg):
    return [ghost_video(Path(v).stem, cfg) for v in videos]
