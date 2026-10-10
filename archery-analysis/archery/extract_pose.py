"""Stage 1 - pose extraction.

Run MediaPipe PoseLandmarker over every (or every Nth) frame of a video. Multiple
people may be in frame, so we keep up to `pose.num_poses` detections per frame and
lock onto the archer per `archer.select`:
  nearest - largest bounding box (outdoors, you closest to the camera)
  spot    - whoever's torso centre is inside `archer.spot` (fixed shooting position, archers
            taking turns; people waiting behind the line or on other targets are ignored,
            even if they are nearer the camera). Frames with nobody on the spot are empty.
Either way a continuity tie-breaker avoids flicker between similarly-sized people.

Output per video:
  data/<stem>.pose.parquet  - wide table, one row per processed frame:
      frame, t_ms, n_people, bbox (bx0,by0,bx1,by1),
      x{i}/y{i}/z{i}/v{i}   for i in 0..32  (image-normalized landmarks + visibility)
      wx{i}/wy{i}/wz{i}      for i in 0..32  (world landmarks, metres, hip-centred)
  data/<stem>.meta.json     - width, height, fps, frame counts, model, stride
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


def _make_landmarker(cfg):
    pc = cfg["pose"]
    model_path = str((_config.PROJECT_ROOT / pc["model"]).resolve())
    delegate = {
        "cpu": mp_python.BaseOptions.Delegate.CPU,
        "gpu": mp_python.BaseOptions.Delegate.GPU,
    }[str(pc.get("delegate", "cpu")).lower()]
    base = mp_python.BaseOptions(model_asset_path=model_path, delegate=delegate)
    opts = vision.PoseLandmarkerOptions(
        base_options=base,
        running_mode=vision.RunningMode.VIDEO,
        num_poses=int(pc.get("num_poses", 3)),
        min_pose_detection_confidence=float(pc.get("min_detection_confidence", 0.5)),
        min_pose_presence_confidence=float(pc.get("min_detection_confidence", 0.5)),
        min_tracking_confidence=float(pc.get("min_tracking_confidence", 0.5)),
        output_segmentation_masks=False,
    )
    return vision.PoseLandmarker.create_from_options(opts)


def torso_centre(lms):
    """Mean of the shoulder and hip midpoints: steadier than the hips alone, which are noisy
    when partly hidden (bow, quiver, bottom of frame)."""
    idx = (L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP)
    return sum(lms[i].x for i in idx) / 4, sum(lms[i].y for i in idx) / 4


def _person_metrics(lms):
    """(area, bbox (x0,y0,x1,y1), centroid (cx,cy), torso centre (tx,ty)) in image-normalized units."""
    xs = [lm.x for lm in lms]
    ys = [lm.y for lm in lms]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return (x1 - x0) * (y1 - y0), (x0, y0, x1, y1), ((x0 + x1) / 2, (y0 + y1) / 2), torso_centre(lms)


def _select_person(pose_landmarks_list, prev_centroid, spot=None):
    """Pick the archer: largest bbox (optionally only among people whose torso centre is inside
    `spot` = (x0,y0,x1,y1)); continuity tie-breaker among near-equals. None if nobody qualifies."""
    metrics = [_person_metrics(lms) for lms in pose_landmarks_list]
    cand = list(range(len(metrics)))
    if spot is not None:
        sx0, sy0, sx1, sy1 = spot
        cand = [i for i in cand if sx0 <= metrics[i][3][0] <= sx1 and sy0 <= metrics[i][3][1] <= sy1]
        if not cand:
            return None, None
    best_i = max(cand, key=lambda i: metrics[i][0])
    if prev_centroid is not None:
        best_area = metrics[best_i][0]
        near = [i for i in cand if metrics[i][0] >= 0.7 * best_area]
        if len(near) > 1:
            pcx, pcy = prev_centroid
            best_i = min(near, key=lambda i: (metrics[i][2][0] - pcx) ** 2 + (metrics[i][2][1] - pcy) ** 2)
    return best_i, metrics[best_i][:3]


def spot_of(cfg):
    """The configured shooting-spot box (grown by archer.spot_margin of its size on each side,
    to tolerate landmark noise), or None when selecting by size alone."""
    ac = cfg.get("archer", {})
    if str(ac.get("select", "nearest")).lower() != "spot":
        return None
    spot = ac.get("spot")
    if not spot or len(spot) != 4:
        print("  archer.select is 'spot' but archer.spot isn't set "
              "(run the 'spot' command); falling back to nearest")
        return None
    x0, y0, x1, y1 = (float(v) for v in spot)
    m = float(ac.get("spot_margin", 0.25))
    mx, my = m * (x1 - x0), m * (y1 - y0)
    return x0 - mx, y0 - my, x1 + mx, y1 + my


def extract_pose(video_path, cfg, *, max_frames=None, stride=None, show_progress=True):
    """Extract the selected archer's pose track. Returns (DataFrame, meta dict)."""
    video_path = Path(video_path)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video: {video_path}")
    fps = cfg.get("input", {}).get("fps") or cap.get(cv2.CAP_PROP_FPS) or 60.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    stride = int(stride or cfg.get("pose", {}).get("sample_stride", 1))
    nlm = L.N_LANDMARKS

    spot = spot_of(cfg)
    landmarker = _make_landmarker(cfg)
    meta_rows, norm, world, bboxes = [], [], [], []
    prev_centroid = None
    frame_idx, processed = -1, 0
    pbar = tqdm(total=total, disable=not show_progress, unit="f", desc=video_path.stem[:24])
    try:
        while True:
            if not cap.grab():
                break
            frame_idx += 1
            pbar.update(1)
            if frame_idx % stride != 0:
                continue
            ok, frame = cap.retrieve()
            if not ok:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
            t_ms = int(round(frame_idx * 1000.0 / fps))
            res = landmarker.detect_for_video(mp_image, t_ms)
            n_people = len(res.pose_landmarks)
            sel = None
            if n_people:
                sel, picked = _select_person(res.pose_landmarks, prev_centroid, spot)
            if sel is None:
                norm.append(np.full((nlm, 4), np.nan, np.float32))
                world.append(np.full((nlm, 3), np.nan, np.float32))
                bboxes.append((np.nan,) * 4)
                meta_rows.append((frame_idx, t_ms, 0))
            else:
                _, bbox, centroid = picked
                prev_centroid = centroid
                lms = res.pose_landmarks[sel]
                norm.append(np.array([[p.x, p.y, p.z, p.visibility] for p in lms], np.float32))
                if res.pose_world_landmarks and len(res.pose_world_landmarks) > sel:
                    wl = res.pose_world_landmarks[sel]
                    world.append(np.array([[p.x, p.y, p.z] for p in wl], np.float32))
                else:
                    world.append(np.full((nlm, 3), np.nan, np.float32))
                bboxes.append(bbox)
                meta_rows.append((frame_idx, t_ms, n_people))
            processed += 1
            if max_frames and processed >= max_frames:
                break
    finally:
        pbar.close()
        cap.release()
        landmarker.close()

    norm = np.stack(norm)
    world = np.stack(world)
    bb = np.asarray(bboxes, np.float32)
    df = pd.DataFrame(meta_rows, columns=["frame", "t_ms", "n_people"])
    cols = {}
    for i in range(nlm):
        cols[f"x{i}"], cols[f"y{i}"], cols[f"z{i}"], cols[f"v{i}"] = norm[:, i, 0], norm[:, i, 1], norm[:, i, 2], norm[:, i, 3]
    for i in range(nlm):
        cols[f"wx{i}"], cols[f"wy{i}"], cols[f"wz{i}"] = world[:, i, 0], world[:, i, 1], world[:, i, 2]
    df = pd.concat([df, pd.DataFrame(cols)], axis=1)
    df["bx0"], df["by0"], df["bx1"], df["by1"] = bb[:, 0], bb[:, 1], bb[:, 2], bb[:, 3]
    meta = dict(video=str(video_path), width=width, height=height, fps=float(fps),
                n_frames_total=total, stride=stride, frames_processed=int(len(df)),
                model=cfg["pose"]["model"], select=cfg.get("archer", {}).get("select", "nearest"),
                spot=list(spot) if spot else None)
    return df, meta


def run(videos, cfg, *, overwrite=False):
    """Extract pose for each video, writing parquet + meta sidecar. Skips existing."""
    ddir = _config.data_dir(cfg)
    out = []
    for v in videos:
        v = Path(v)
        pq = ddir / f"{v.stem}.pose.parquet"
        if pq.exists() and not overwrite:
            print(f"skip (exists): {pq.name}")
            out.append(pq)
            continue
        df, meta = extract_pose(v, cfg)
        df.to_parquet(pq)
        (ddir / f"{v.stem}.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        n_missing = int((df["n_people"] == 0).sum())
        print(f"wrote {pq.name}: {len(df)} frames, {n_missing} with no detection")
        out.append(pq)
    return out
