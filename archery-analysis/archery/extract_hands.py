"""Stage 1b - hand landmark extraction.

Runs MediaPipe HandLandmarker (21 landmarks/hand) to add finger/wrist detail the body
pose model lacks. Only frames inside each shot's analysis window are processed (hands
matter around the draw/release), which keeps it ~3x faster than a full pass.

Multiple people may be in frame, so detected hands are associated to *your* draw/bow
wrists by proximity to the pose wrists from stage 1 (other archers' hands are ignored).
Hands are stored as "draw" / "bow" (handedness-aware), not MediaPipe's Left/Right label.

Requires data/<stem>.pose.parquet and data/<stem>.shots.parquet.
Output: data/<stem>.hands.parquet with, per processed frame:
  frame, dh_present, bh_present, dh_x{i}/dh_y{i}/dh_z{i}, bh_x{i}/bh_y{i}/bh_z{i} (i 0..20)
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
from tqdm import tqdm

from . import config as _config
from . import landmarks as L

N_HAND = 21


def _make_landmarker(cfg):
    pc = cfg["pose"]
    hc = cfg.get("hands", {})
    model = str((_config.PROJECT_ROOT / pc["hand_model"]).resolve())
    delegate = {"cpu": mp_python.BaseOptions.Delegate.CPU,
                "gpu": mp_python.BaseOptions.Delegate.GPU}[str(pc.get("delegate", "cpu")).lower()]
    base = mp_python.BaseOptions(model_asset_path=model, delegate=delegate)
    opts = vision.HandLandmarkerOptions(
        base_options=base, running_mode=vision.RunningMode.VIDEO,
        num_hands=int(hc.get("num_hands", 4)),
        min_hand_detection_confidence=float(hc.get("min_detection_confidence", 0.4)),
        min_tracking_confidence=float(hc.get("min_tracking_confidence", 0.4)),
    )
    return vision.HandLandmarker.create_from_options(opts)


def _frames_to_process(pose_df, shots, meta, cfg):
    fps = meta["fps"]
    nm = cfg.get("normalize", {})
    pre = (float(nm.get("align_pre_s", 5.0)) + 0.5) * fps
    post = (float(nm.get("align_post_s", 1.0)) + 0.5) * fps
    keep = np.zeros(int(meta["n_frames_total"]) + 1, bool)
    for _, r in shots.iterrows():
        a = max(0, int(r["release_frame"] - pre))
        b = min(len(keep) - 1, int(r["release_frame"] + post))
        keep[a:b + 1] = True
    return keep


def extract_hands(video_path, cfg, show_progress=True):
    stem = Path(video_path).stem
    pose_df, meta = _config.load_pose(stem, cfg)
    shots = pd.read_parquet(_config.data_dir(cfg) / f"{stem}.shots.parquet")
    fps, W, H = meta["fps"], meta["width"], meta["height"]
    sides = L.sides(cfg["archer"]["handedness"])
    dwi, bwi = sides["draw_wrist"], sides["bow_wrist"]

    # per-frame pose wrist positions (px) and torso scale, indexed by source frame number
    pf = pose_df.set_index("frame")
    keep = _frames_to_process(pose_df, shots, meta, cfg)

    landmarker = _make_landmarker(cfg)
    cap = cv2.VideoCapture(str(video_path))
    rows = []
    frame_idx = -1
    total = int(meta["n_frames_total"])
    pbar = tqdm(total=int(keep.sum()), disable=not show_progress, unit="f", desc=stem[:20] + " hands")
    try:
        while True:
            if not cap.grab():
                break
            frame_idx += 1
            if frame_idx >= len(keep) or not keep[frame_idx]:
                continue
            ok, frame = cap.retrieve()
            if not ok:
                break
            pbar.update(1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            t_ms = int(round(frame_idx * 1000.0 / fps))
            res = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,
                                                       data=np.ascontiguousarray(rgb)), t_ms)
            row = {"frame": frame_idx, "dh_present": False, "bh_present": False}
            if frame_idx in pf.index and res.hand_landmarks:
                p = pf.loc[frame_idx]
                draw_px = (p[f"x{dwi}"] * W, p[f"y{dwi}"] * H)
                bow_px = (p[f"x{bwi}"] * W, p[f"y{bwi}"] * H)
                midhip = (((p["x23"] + p["x24"]) / 2) * W, ((p["y23"] + p["y24"]) / 2) * H)
                midsh = (((p["x11"] + p["x12"]) / 2) * W, ((p["y11"] + p["y12"]) / 2) * H)
                torso = float(np.hypot(midsh[0] - midhip[0], midsh[1] - midhip[1])) or 0.15 * W
                max_d = 0.6 * torso
                best = {"dh": (max_d, None), "bh": (max_d, None)}
                for lms in res.hand_landmarks:
                    wx, wy = lms[0].x * W, lms[0].y * H
                    dd = np.hypot(wx - draw_px[0], wy - draw_px[1])
                    db = np.hypot(wx - bow_px[0], wy - bow_px[1])
                    key, d = ("dh", dd) if dd <= db else ("bh", db)
                    if d < best[key][0]:
                        best[key] = (d, np.array([[h.x, h.y, h.z] for h in lms], np.float32))
                for key in ("dh", "bh"):
                    arr = best[key][1]
                    if arr is not None:
                        row[f"{key}_present"] = True
                        for i in range(N_HAND):
                            row[f"{key}_x{i}"], row[f"{key}_y{i}"], row[f"{key}_z{i}"] = arr[i]
            rows.append(row)
    finally:
        pbar.close()
        cap.release()
        landmarker.close()

    df = pd.DataFrame(rows)
    out = _config.data_dir(cfg) / f"{stem}.hands.parquet"
    df.to_parquet(out)
    dn = int(df["dh_present"].sum()) if len(df) else 0
    bn = int(df["bh_present"].sum()) if len(df) else 0
    print(f"{stem}: hands on {len(df)} frames (draw seen {dn}, bow seen {bn}) -> {out.name}")
    return out


def run(videos, cfg, *, overwrite=False):
    if not cfg.get("hands", {}).get("enabled", True):
        print("hands: disabled in this profile (hands.enabled: false) - skipping")
        return []
    out = []
    for v in videos:
        stem = Path(v).stem
        pq = _config.data_dir(cfg) / f"{stem}.hands.parquet"
        if pq.exists() and not overwrite:
            print(f"skip (exists): {pq.name}")
            out.append(pq)
            continue
        out.append(extract_hands(v, cfg))
    return out
