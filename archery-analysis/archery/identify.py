"""Who is this? Match a new end to an archer already seen this session, or start a new one.

Archers take turns on one camera-facing spot, so each end is one person. We sample frames,
take the person on the shooting spot, and build an appearance signature:
  - colour histograms of the torso (shirt, chest guard, quiver strap) and of the thighs
    (trousers/shorts), in a hue/saturation space with separate bins for black/grey/white so
    dark or white kit isn't lost to meaningless hue;
  - body proportions (shoulder/hip width, upper arm and thigh length relative to the torso).
Clothes don't change within a session, so colour does most of the work; proportions break
ties between people in the same club shirt. New archers get a pseudonym (bird names); rename
them afterwards with `archery.cli rename`. Signatures are stored per end in
<session>/_ids/<stem>.json, and an archer's signature is the mean of their ends.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import config as _config
from . import landmarks as L

PSEUDONYMS = [
    "Kestrel", "Heron", "Wren", "Osprey", "Robin", "Merlin", "Plover", "Curlew", "Finch",
    "Swift", "Raven", "Lapwing", "Siskin", "Dunlin", "Avocet", "Godwit", "Linnet", "Tern",
    "Hobby", "Bunting", "Martin", "Pipit", "Egret", "Shrike",
]

# colour quantisation: 12 hues x 2 saturation x 2 value for chromatic pixels + 4 achromatic bins
N_HUE, ACHRO = 12, 4
N_BINS = N_HUE * 4 + ACHRO
PROPORTIONS = ["shoulder_w", "hip_w", "upper_arm", "thigh", "neck"]


def _quantise(hsv):
    """HSV pixels (N,3, OpenCV ranges) -> bin index per pixel."""
    h, s, v = hsv[:, 0].astype(int), hsv[:, 1].astype(int), hsv[:, 2].astype(int)
    achro = (s < 50) | (v < 45)
    hb = (h * N_HUE) // 180
    chrom = hb * 4 + (s >= 140) * 2 + (v >= 150)
    grey = N_HUE * 4 + np.clip(v * ACHRO // 256, 0, ACHRO - 1)
    return np.where(achro, grey, chrom)


def _hist(img_hsv, poly):
    import cv2
    H, W = img_hsv.shape[:2]
    mask = np.zeros((H, W), np.uint8)
    cv2.fillConvexPoly(mask, np.round(poly).astype(np.int32), 1)
    px = img_hsv[mask.astype(bool)]
    if len(px) < 200:
        return None
    return np.bincount(_quantise(px), minlength=N_BINS).astype(float) / len(px)


def _shrink(poly, f=0.8):
    c = poly.mean(axis=0)
    return c + (poly - c) * f


def _frame_features(frame_bgr, lms):
    """(torso hist, thigh hist, proportions) for one person in one frame (None where hidden)."""
    import cv2
    H, W = frame_bgr.shape[:2]
    P = np.array([[p.x * W, p.y * H] for p in lms])
    vis = np.array([p.visibility for p in lms])
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    ls, rs, lh, rh = L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP
    torso = thigh = None
    if vis[[ls, rs, lh, rh]].min() > 0.5:
        torso = _hist(hsv, _shrink(P[[ls, rs, rh, lh]]))
        if vis[[25, 26]].min() > 0.5:          # knees
            mid_l, mid_r = (P[lh] + P[25]) / 2, (P[rh] + P[26]) / 2
            thigh = _hist(hsv, _shrink(np.array([P[lh], P[rh], mid_r, mid_l]), 0.9))
    props = None
    if vis[[ls, rs, lh, rh, L.LEFT_ELBOW, L.RIGHT_ELBOW, 0]].min() > 0.5:
        mid_s, mid_h = (P[ls] + P[rs]) / 2, (P[lh] + P[rh]) / 2
        t = np.linalg.norm(mid_s - mid_h)
        if t > 10:
            arm = np.mean([np.linalg.norm(P[ls] - P[L.LEFT_ELBOW]), np.linalg.norm(P[rs] - P[L.RIGHT_ELBOW])])
            th = (np.mean([np.linalg.norm(P[lh] - P[25]), np.linalg.norm(P[rh] - P[26])])
                  if vis[[25, 26]].min() > 0.5 else np.nan)
            props = np.array([np.linalg.norm(P[ls] - P[rs]), np.linalg.norm(P[lh] - P[rh]),
                              arm, th, np.linalg.norm(P[0] - mid_s)]) / t
    return torso, thigh, props


def timeline(video, cfg, *, every_s=None):
    """Appearance of whoever is on the spot, sampled through the video every `every_s` seconds
    (identify.sample_every_s, default 1). Returns [{t, torso, thigh, proportions}] with None
    features where nobody was clearly there. Times are the frames' own timestamps."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    from .extract_pose import _select_person, spot_of

    ic = cfg.get("identify", {})
    every_s = float(every_s or ic.get("sample_every_s", 1.0))
    model = str((_config.PROJECT_ROOT / ic.get("model", "models/pose_landmarker_full.task")).resolve())
    opts = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.IMAGE, num_poses=int(ic.get("num_poses", 4)),
        min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5)
    spot = spot_of(cfg)
    cap = cv2.VideoCapture(str(video))
    rows, nxt = [], 0.0
    with vision.PoseLandmarker.create_from_options(opts) as lm:
        while cap.grab():
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if t < nxt:
                continue
            nxt = t + every_s
            ok, frame = cap.retrieve()
            if not ok:
                break
            row = dict(t=t, torso=None, thigh=None, proportions=None)
            res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,
                                     data=np.ascontiguousarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))))
            if res.pose_landmarks:
                sel, _ = _select_person(res.pose_landmarks, None, spot)
                if sel is not None:
                    to, th, pr = _frame_features(frame, res.pose_landmarks[sel])
                    row.update(torso=None if to is None else to.tolist(),
                               thigh=None if th is None else th.tolist(),
                               proportions=None if pr is None else pr.tolist())
            rows.append(row)
    cap.release()
    return rows


def signature_of(samples, video) -> dict:
    """Signature (as `signature` returns) from timeline samples."""
    torsos = [s["torso"] for s in samples if s.get("torso") is not None]
    thighs = [s["thigh"] for s in samples if s.get("thigh") is not None]
    props = [s["proportions"] for s in samples if s.get("proportions") is not None]
    return dict(video=Path(video).name,
                torso=np.mean(torsos, axis=0).tolist() if torsos else None,
                thigh=np.mean(thighs, axis=0).tolist() if thighs else None,
                proportions=np.nanmedian(np.array(props, float), axis=0).tolist() if props else None,
                frames=dict(torso=len(torsos), thigh=len(thighs), proportions=len(props)))


def turns(samples, cfg) -> list[tuple[float, float]]:
    """Split a recording into turns: archers take turns on the spot within one recording (one
    shoots 3-5 arrows, steps off, the next steps on). Groups the timeline into consecutive
    chunks, merges neighbouring chunks that look like the same person, folds turns shorter than
    identify.min_turn_s into a neighbour, and returns [(start_s, end_s)] cut points that cover
    the whole recording (cuts fall midway between the last sample of one person and the first
    of the next)."""
    ic = cfg.get("identify", {})
    thr = float(ic.get("turn_threshold", ic.get("match_threshold", 0.42)))
    chunk_s = float(ic.get("turn_chunk_s", 5.0))
    min_turn = float(ic.get("min_turn_s", 20.0))
    seen = [s for s in samples if s.get("torso") is not None]
    if not samples:
        return []
    end_t = float(samples[-1]["t"]) + 1.0
    if len(seen) < 2:
        return [(0.0, end_t)]
    # chunks of consecutive samples -> runs: [first sample index, last sample index] into `seen`
    runs, cur = [], [0, 0]
    for i in range(1, len(seen)):
        if seen[i]["t"] - seen[cur[0]]["t"] < chunk_s:
            cur[1] = i
        else:
            runs.append(cur)
            cur = [i, i]
    runs.append(cur)

    def sig(r):
        return signature_of(seen[r[0]:r[1] + 1], "")

    def dur(r):
        return seen[r[1]]["t"] - seen[r[0]]["t"]

    while True:   # merge the closest-looking neighbours until every neighbour pair differs
        ds = [distance(sig(a), sig(b)) for a, b in zip(runs, runs[1:])]
        if not ds or min(ds) >= thr:
            break
        k = int(np.argmin(ds))
        runs[k:k + 2] = [[runs[k][0], runs[k + 1][1]]]
    while len(runs) > 1:  # fold blips (someone walking past, a mis-detection) into a neighbour
        short = [k for k, r in enumerate(runs) if dur(r) < min_turn]
        if not short:
            break
        k = min(short, key=lambda k: dur(runs[k]))
        if k == 0:
            j = 1
        elif k == len(runs) - 1:
            j = k - 1
        else:
            j = min((k - 1, k + 1), key=lambda j: distance(sig(runs[k]), sig(runs[j])))
        lo, hi = sorted((k, j))
        runs[lo:hi + 1] = [[runs[lo][0], runs[hi][1]]]
    # Last pass on whole turns: neighbouring turns that look like the same person overall are one
    # turn (6s chunks can differ - turning side-on, someone walking past - where whole turns don't).
    k = 0
    while k < len(runs) - 1:
        if distance(sig(runs[k]), sig(runs[k + 1])) < thr:
            runs[k:k + 2] = [[runs[k][0], runs[k + 1][1]]]
        else:
            k += 1
    cuts = [0.0]
    for a, b in zip(runs, runs[1:]):
        cuts.append((seen[a[1]]["t"] + seen[b[0]]["t"]) / 2)
    cuts.append(end_t)
    return list(zip(cuts[:-1], cuts[1:]))


def signature(video, cfg, *, max_samples=150, show_progress=False):
    """Appearance signature of the archer on the spot in this video (dict, JSON-able)."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    from .extract_pose import _select_person, spot_of

    ic = cfg.get("identify", {})
    model = str((_config.PROJECT_ROOT / ic.get("model", "models/pose_landmarker_full.task")).resolve())
    opts = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.IMAGE, num_poses=int(ic.get("num_poses", 4)),
        min_pose_detection_confidence=0.5, min_pose_presence_confidence=0.5)
    spot = spot_of(cfg)
    cap = cv2.VideoCapture(str(video))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, n // max_samples)
    torsos, thighs, props = [], [], []
    with vision.PoseLandmarker.create_from_options(opts) as lm:
        fi = -1
        while True:
            if not cap.grab():
                break
            fi += 1
            if fi % step:
                continue
            ok, frame = cap.retrieve()
            if not ok:
                break
            res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB,
                                     data=np.ascontiguousarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))))
            if not res.pose_landmarks:
                continue
            sel, _ = _select_person(res.pose_landmarks, None, spot)
            if sel is None:
                continue
            t, th, p = _frame_features(frame, res.pose_landmarks[sel])
            if t is not None:
                torsos.append(t)
            if th is not None:
                thighs.append(th)
            if p is not None:
                props.append(p)
    cap.release()

    def _mean(hs):
        return (np.mean(hs, axis=0).tolist(), len(hs)) if hs else (None, 0)

    torso, nt = _mean(torsos)
    thigh, nth = _mean(thighs)
    prop = np.nanmedian(np.array(props), axis=0).tolist() if props else None
    return dict(video=Path(video).name, torso=torso, thigh=thigh, proportions=prop,
                frames=dict(torso=nt, thigh=nth, proportions=len(props)))


def _bhatt(a, b):
    """Bhattacharyya distance in [0,1] between two normalised histograms."""
    if a is None or b is None:
        return None
    bc = float(np.sum(np.sqrt(np.asarray(a) * np.asarray(b))))
    return float(np.sqrt(max(0.0, 1.0 - bc)))


def distance(s1, s2):
    """Combined appearance distance (0 = identical). Torso colour dominates."""
    parts, weights = [], []
    for key, w in (("torso", 0.7), ("thigh", 0.15)):
        d = _bhatt(s1.get(key), s2.get(key))
        if d is not None:
            parts.append(d)
            weights.append(w)
    p1, p2 = s1.get("proportions"), s2.get("proportions")
    if p1 is not None and p2 is not None:
        a, b = np.array(p1, float), np.array(p2, float)
        ok = ~(np.isnan(a) | np.isnan(b))
        if ok.any():   # mean relative difference, scaled so ~15% difference ~ 1
            parts.append(min(1.0, float(np.mean(np.abs(a[ok] - b[ok]) / ((a[ok] + b[ok]) / 2))) / 0.15))
            weights.append(0.15)
    if not parts:
        return 1.0
    return float(np.average(parts, weights=weights))


def _mean_sig(sigs):
    out = {}
    for key in ("torso", "thigh"):
        hs = [s[key] for s in sigs if s.get(key) is not None]
        out[key] = np.mean(hs, axis=0).tolist() if hs else None
    ps = [s["proportions"] for s in sigs if s.get("proportions") is not None]
    out["proportions"] = np.nanmedian(np.array(ps, float), axis=0).tolist() if ps else None
    return out


def ids_dir(session: Path) -> Path:
    d = Path(session) / "_ids"
    d.mkdir(parents=True, exist_ok=True)
    return d


def known_archers(session: Path) -> dict[str, dict]:
    """{archer: mean signature} from the stored per-end signatures of each archer folder."""
    from .session import archers
    out = {}
    idd = ids_dir(session)
    for name, vids in archers(session).items():
        sigs = []
        for v in vids:
            f = idd / f"{v.stem}.json"
            if f.exists():
                sigs.append(json.loads(f.read_text(encoding="utf-8")))
        if sigs:
            out[name] = _mean_sig(sigs)
    return out


def new_pseudonym(session: Path) -> str:
    taken = {p.name for p in Path(session).iterdir() if p.is_dir()}
    for name in PSEUDONYMS:
        if name not in taken:
            return name
    i = 1
    while f"Archer{i:02d}" in taken:
        i += 1
    return f"Archer{i:02d}"


def identify(video: Path, session: Path, cfg, sig: dict | None = None) -> tuple[str, dict]:
    """Decide which archer folder this video belongs to. Returns (name, signature)."""
    sig = sig or signature(video, cfg)
    thr = float(cfg.get("identify", {}).get("match_threshold", 0.42))
    known = known_archers(session)
    scored = sorted(((distance(sig, s), n) for n, s in known.items()))
    if sig["torso"] is None:
        print(f"   {Path(video).name}: nobody clearly on the spot - can't identify")
    if scored:
        print("   appearance distance: " + ", ".join(f"{n} {d:.2f}" for d, n in scored)
              + f"   (same person if < {thr:.2f})")
    if scored and scored[0][0] < thr and sig["torso"] is not None:
        return scored[0][1], sig
    return new_pseudonym(session), sig
