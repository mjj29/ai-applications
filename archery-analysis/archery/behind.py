"""The second camera's view of each release (typically from behind the archer, draw side).

For every synced end (sync.json) and shot:
  - pose on the second camera's own frames from release - pre_s to release + post_s (all of
    them: a slow-motion phone file gives 120 real frames a second here), tracking the person
    nearest the middle of the picture (the archer the camera was set up on);
  - <output>/<stem>/shot_<n>.behind.mp4: a close-up of the head, draw hand and draw arm, played
    at behind.slow_factor slower than real time from real frames (with the main camera's
    release instant marked);
  - measures in the second view (torso lengths, image axes x right / y down, from the frame
    just before the loose):
      pluck        sideways travel of the draw hand away from the face in the first 0.15s
      hand_path    total draw-hand travel in 0.3s (the follow-through, as seen from behind)
      elbow_swing  sideways travel of the draw elbow in 0.3s (staying behind the arrow line or not)
      head_move    nose movement in 0.3s (a flinch or peek)
      bow_drop2    bow-hand drop in 0.5s
      release_t2   the loose timed in this view (first big bow jump), main-camera clock
Results: data/<stem>.behind.parquet (one row per shot) and the clips.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from . import config as _config
from . import landmarks as L
from . import sync as _sync


def _landmarker(cfg):
    import mediapipe as mp  # noqa: F401
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    bc = cfg.get("behind", {})
    # heavy: the full model misses a close archer seen from behind (2026-10-20: 1 of 2 people found)
    model = str((_config.PROJECT_ROOT / bc.get("model", "models/pose_landmarker_heavy.task")).resolve())
    return vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.VIDEO, num_poses=3,
        min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5, min_tracking_confidence=0.5))


def _frames(video, t0, t1):
    """(file time, BGR frame) for every frame of `video` between file times t0 and t1."""
    import cv2

    from .align import open_before
    cap = open_before(video, t0)
    try:
        while cap.grab():
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if t < t0:
                continue
            if t > t1:
                break
            ok, f = cap.retrieve()
            if ok:
                yield t, f
    finally:
        cap.release()


def _pick(people, W, H, prev):
    """The archer: nearest the previous pick; at the start, the person at full draw - both wrists
    up at shoulder height and spread wide (neighbours waiting or retrieving aren't)."""
    best, score = None, None
    for i, p in enumerate(people):
        xs, ys = [q.x for q in p], [q.y for q in p]
        cx, cy = np.mean(xs), np.mean(ys)
        if prev:
            s = -np.hypot(cx - prev[0], cy - prev[1])
        else:
            sh_y = (p[11].y + p[12].y) / 2
            hip_y = (p[23].y + p[24].y) / 2
            torso = max(hip_y - sh_y, 1e-3)
            spread = abs(p[15].x - p[16].x) * W / (torso * H)
            up = sum(abs(p[j].y - sh_y) < 0.35 * torso for j in (15, 16))
            s = spread + up
        if score is None or s > score:
            best, score = i, s
    return best


def archer_box(cam, syn, releases, cfg, pad=0.25):
    """Pixel box around the archer in the second view: in a still frame shortly before each
    release, detect everyone and take the person at full draw (see _pick); union of those boxes,
    grown by `pad`. Pose then runs on this crop only, so a neighbour can't steal the tracking."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    model = str((_config.PROJECT_ROOT / cfg.get("behind", {}).get("model", "models/pose_landmarker_heavy.task")).resolve())
    opts = vision.PoseLandmarkerOptions(base_options=mp_python.BaseOptions(model_asset_path=model),
                                        running_mode=vision.RunningMode.IMAGE, num_poses=4,
                                        min_pose_detection_confidence=0.3, min_pose_presence_confidence=0.3)
    boxes, W, H = [], None, None
    with vision.PoseLandmarker.create_from_options(opts) as lm:
        for rel in releases:
            for dt in (-0.6, -0.4, -0.2):
                fr = next(_frames(cam, _sync.cam2_time(rel + dt, syn), _sync.cam2_time(rel + dt + 0.2, syn)), None)
                if fr is None:
                    continue
                f = fr[1]
                H, W = f.shape[:2]
                res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,
                                         data=np.ascontiguousarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))))
                if res.pose_landmarks:
                    p = res.pose_landmarks[_pick(res.pose_landmarks, W, H, None)]
                    xs, ys = [q.x for q in p], [q.y for q in p]
                    boxes.append((min(xs), min(ys), max(xs), max(ys)))
    if not boxes:
        return None
    b = np.median(np.array(boxes), axis=0)
    w, h = b[2] - b[0], b[3] - b[1]
    return (int(max(0, (b[0] - pad * w) * W)), int(max(0, (b[1] - pad * h) * H)),
            int(min(W, (b[2] + pad * w) * W)), int(min(H, (b[3] + pad * h) * H)))


def shot_measures(rows, rel_t, cfg):
    """Measures from one shot's second-view landmarks (list of (t_main, (33,3) array))."""
    s = L.sides(cfg["archer"]["handedness"])
    t = np.array([r[0] for r in rows])
    P = np.stack([r[1] for r in rows])                       # (n, 33, 3) x, y in pixels, vis
    sh = (P[:, L.LEFT_SHOULDER, :2] + P[:, L.RIGHT_SHOULDER, :2]) / 2
    hp = (P[:, L.LEFT_HIP, :2] + P[:, L.RIGHT_HIP, :2]) / 2
    torso = float(np.nanmedian(np.linalg.norm(sh - hp, axis=1))) or 1.0

    def at(lm, a, b):
        m = (t >= rel_t + a) & (t <= rel_t + b)
        return np.nanmedian(P[m, lm, :2], axis=0) if m.any() else np.array([np.nan, np.nan])
    dw0, de0, n0, bw0 = (at(lm, -0.06, -0.01) for lm in (s["draw_wrist"], s["draw_elbow"], L.NOSE, s["bow_wrist"]))
    face_side = np.sign((dw0 - n0)[0]) or 1.0                  # which way "away from the face" is
    out = {}
    m = (t >= rel_t) & (t <= rel_t + 0.15)
    out["pluck"] = float(np.nanmax((P[m, s["draw_wrist"], 0] - dw0[0]) * face_side) / torso) if m.any() else np.nan
    m3 = (t >= rel_t) & (t <= rel_t + 0.3)
    if m3.sum() >= 2:
        path = P[m3, s["draw_wrist"], :2]
        out["hand_path"] = float(np.nansum(np.linalg.norm(np.diff(path, axis=0), axis=1)) / torso)
    else:
        out["hand_path"] = np.nan
    de3, n3 = at(s["draw_elbow"], 0.25, 0.32), at(L.NOSE, 0.25, 0.32)
    out["elbow_swing"] = float(abs(de3[0] - de0[0]) / torso)
    out["head_move"] = float(np.linalg.norm(n3 - n0) / torso)
    bw5 = at(s["bow_wrist"], 0.45, 0.55)
    out["bow_drop2"] = float((bw5[1] - bw0[1]) / torso)
    win = (t >= rel_t - 0.1) & (t <= rel_t + 0.3)
    out["vis_draw_wrist"] = float(np.nanmedian(P[win, s["draw_wrist"], 2]))
    out["vis_draw_elbow"] = float(np.nanmedian(P[win, s["draw_elbow"], 2]))
    # a hand hidden behind the head (camera behind the draw side) is guessed, not seen
    if out["vis_draw_wrist"] < 0.5:
        out["pluck"] = out["hand_path"] = np.nan
    if out["vis_draw_elbow"] < 0.5:
        out["elbow_swing"] = np.nan
    return out, torso


def run_end(main_video: Path, cfg: dict, session: Path, make_clips: bool = True) -> pd.DataFrame | None:
    import cv2
    import mediapipe as mp

    from .align import ffmpeg_writer
    syn = _sync.load(session).get(main_video.stem)
    if not syn or syn.get("offset_s") is None:
        return None
    ddir, odir = _config.data_dir(cfg), _config.output_dir(cfg)
    shots = pd.read_parquet(ddir / f"{main_video.stem}.shots.parquet")
    bc = cfg.get("behind", {})
    pre, post = float(bc.get("pre_s", 0.8)), float(bc.get("post_s", 1.2))
    slow = float(bc.get("slow_factor", 4))
    cam = syn["path"]
    rows_out = []
    box = archer_box(cam, syn, shots["release_t"].to_numpy(float), cfg)
    if box is None:
        print(f"{main_video.stem}: couldn't find the archer in the second view")
        return None
    bx0, by0, bx1, by1 = box
    lm = _landmarker(cfg)
    try:
        last_ms = -1
        for _, r in shots.iterrows():
            rel = float(r["release_t"])
            t0, t1 = _sync.cam2_time(rel - pre, syn), _sync.cam2_time(rel + post, syn)
            rows, frames, prev = [], [], None
            for tf, f in _frames(cam, t0, t1):
                H, W = f.shape[:2]
                tm = tf / syn.get("stretch", 1.0) + syn["offset_s"]
                ms = max(int(tf * 1000), last_ms + 1)
                last_ms = ms
                crop = f[by0:by1, bx0:bx1]
                res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,
                                                   data=np.ascontiguousarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))), ms)
                if res.pose_landmarks:
                    cw, ch = bx1 - bx0, by1 - by0
                    i = _pick(res.pose_landmarks, cw, ch, prev)
                    p = res.pose_landmarks[i]
                    prev = (np.mean([q.x for q in p]), np.mean([q.y for q in p]))
                    rows.append((tm, np.array([[bx0 + q.x * cw, by0 + q.y * ch, q.visibility] for q in p], float)))
                frames.append((tm, f))
            if len(rows) < 5:
                continue
            meas, torso = shot_measures(rows, rel, cfg)
            meas.update(shot=int(r["shot"]), release_t=rel, n_frames=len(frames),
                        fps2=len(frames) / max(pre + post, 1e-6))
            rows_out.append(meas)
            if make_clips and frames:
                _clip(odir / main_video.stem / f"shot_{int(r['shot'])}.behind.mp4", frames, rows, rel, torso, cfg,
                      slow, ffmpeg_writer)
    finally:
        lm.close()
    if not rows_out:
        return None
    df = pd.DataFrame(rows_out)
    df.to_parquet(ddir / f"{main_video.stem}.behind.parquet")
    print(f"{main_video.stem}: behind view of {len(df)} shots ({df.fps2.median():.0f} frames/s around the loose)")
    return df


def _clip(out, frames, rows, rel, torso, cfg, slow, ffmpeg_writer):
    """Close-up (head, draw hand, draw arm) at `slow` x slower than real time, real frames only."""
    import cv2
    s = L.sides(cfg["archer"]["handedness"])
    P = np.stack([r[1] for r in rows])
    t = np.array([r[0] for r in rows])
    m = (t >= rel - 0.3) & (t <= rel + 0.3)
    pts = P[m][:, [L.NOSE, s["draw_wrist"], s["draw_elbow"], s["draw_shoulder"], s["bow_shoulder"]], :2].reshape(-1, 2)
    H, W = frames[0][1].shape[:2]
    cx, cy = np.nanmedian(pts[:, 0]), np.nanmedian(pts[:, 1])
    half_w = min(W / 2, max(1.3 * torso, 0.6 * (np.nanpercentile(pts[:, 0], 95) - np.nanpercentile(pts[:, 0], 5)) + 0.4 * torso))
    half_h = half_w * 0.75
    x0, y0 = int(np.clip(cx - half_w, 0, W - 2 * half_w)), int(np.clip(cy - half_h, 0, H - 2 * half_h))
    x1, y1 = int(x0 + 2 * half_w), int(y0 + 2 * half_h)
    out.parent.mkdir(parents=True, exist_ok=True)
    ow, oh = 960, 720
    real_fps = len(frames) / max(frames[-1][0] - frames[0][0], 1e-6)
    play_fps = min(60.0, real_fps / slow)
    proc = ffmpeg_writer(out, ow, oh, play_fps)
    for tm, f in frames:
        g = cv2.resize(f[y0:y1, x0:x1], (ow, oh), interpolation=cv2.INTER_CUBIC)
        d = tm - rel
        cv2.rectangle(g, (0, 0), (ow, 40), (0, 0, 0), -1)
        cv2.putText(g, f"t={d:+.3f}s{'  RELEASE' if abs(d) < 0.5 / real_fps else ''}   "
                       f"{real_fps / play_fps:.0f}x slower", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                    (255, 255, 255), 2, cv2.LINE_AA)
        proc.stdin.write(np.ascontiguousarray(g).tobytes())
    proc.stdin.close()
    proc.wait()


def run(videos, cfg, session: Path):
    return [run_end(Path(v), cfg, session) for v in videos]
