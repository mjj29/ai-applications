"""Second camera: pair its recordings with the main camera's ends and line them up in time.

Each end may be recorded on two cameras that were started by hand, one after the other, so
their recordings start a few seconds apart (and either may miss the first arrow). Neither may
have sound. What both see is each release: the bow jumps forward. So:

  1. pair files by time: a second-camera recording belongs to the main-camera end whose time
     window (start from the file name or file time, plus duration) it overlaps most;
  2. find the releases in the second view from its own motion (a jump in frame difference
     out of a still stretch, anywhere in the frame - from behind, the bow and string hand
     fill the picture);
  3. offset = the shift that best matches the main camera's release times to the second
     camera's (an end's 3-6 releases form a pattern of intervals; one missing or extra
     release on either side is tolerated). Then refine on the motion curves themselves,
     cross-correlating the main view's bow-box motion with the second view's, to about a frame.

Files: <session>/<archer>/_cam2/<main stem>.<ext> (moved there by `pair`), and
<session>/_cam2/sync.json {main stem: {file, offset_s, fps, matched, residual_s}} where
main time = second-camera time + offset_s.

Slow-motion phone recordings: Android/iOS slow motion is stored either at the capture rate
(e.g. 240 fps, real time in the timestamps) or "baked" at 30 fps playback (time stretched 8x).
Baked files are detected from the release intervals (they come out 4-8x the main camera's)
and the stretch factor is fitted along with the offset.
"""
from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

import numpy as np

from . import config as _config


# ---------------------------------------------------------------- file times
def _ffprobe_info(video: Path) -> dict:
    """duration (s), creation_time (datetime or None), nominal fps, has_audio - via ffmpeg -i."""
    from .clip import _ffmpeg
    r = subprocess.run([_ffmpeg(), "-hide_banner", "-i", str(video)], capture_output=True, text=True,
                       errors="replace")
    e = r.stderr
    dur = re.search(r"Duration: (\d+):(\d+):([\d.]+)", e)
    ct = re.search(r"creation_time\s*:\s*(\S+)", e)
    fps = re.search(r"(\d+(?:\.\d+)?) fps", e)
    cap = re.search(r"capture\.fps\s*:\s*([\d.]+)", e)
    created = None
    if ct:
        try:
            created = datetime.fromisoformat(ct.group(1).replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
        except ValueError:
            created = None
    return dict(duration=(int(dur[1]) * 3600 + int(dur[2]) * 60 + float(dur[3])) if dur else None,
                created=created, fps=float(fps.group(1)) if fps else None, has_audio="Audio:" in e,
                capture_fps=float(cap.group(1)) if cap else None)


def stretch_of(video) -> float:
    """How many times slower than real time the file plays: slow-motion phone video stored at
    30 fps but captured at 120/240 (Android writes com.android.capture.fps). 1 for normal video."""
    i = _ffprobe_info(video)
    if i["capture_fps"] and i["fps"] and i["capture_fps"] > 1.5 * i["fps"]:
        return float(round(i["capture_fps"] / i["fps"]))
    return 1.0


def start_time(video: Path) -> datetime | None:
    """Recording start: from a YYYYMMDD_HHMMSS-style name (SparkoCam, Pixel PXL_..., IMG_...,
    VID_...), else the container's creation time, else the file's modification time minus its
    duration."""
    name = Path(video).name
    m = re.search(r"(20\d{6})[_-]?(\d{6})", name)
    if m:
        t = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
        if name.upper().startswith("PXL_"):          # Pixel names its files in UTC
            from datetime import timezone
            t = t.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
        return t
    info = _ffprobe_info(video)
    if info["created"]:
        return info["created"]
    if info["duration"]:
        return datetime.fromtimestamp(Path(video).stat().st_mtime - info["duration"])
    return None


def window(video: Path) -> tuple[datetime, float] | None:
    """(start, real-time duration): a slow-motion file covers duration / stretch of real time."""
    st = start_time(video)
    dur = _ffprobe_info(video)["duration"]
    return (st, dur / stretch_of(video)) if st and dur else None


def pair(main_videos: list[Path], cam2_videos: list[Path]) -> dict[Path, Path]:
    """{main video: second-camera video} by greatest overlap of recording windows (each used
    once). Turn parts (<stem>_t2 ...) share their original's window, offset by the cut."""
    def win(v):
        w = window(v)
        return (w[0].timestamp(), w[0].timestamp() + w[1]) if w else None
    mw = {v: win(v) for v in main_videos}
    cw = {v: win(v) for v in cam2_videos}
    cand = []
    for m, a in mw.items():
        for c, b in cw.items():
            if a and b:
                ov = min(a[1], b[1]) - max(a[0], b[0])
                if ov > 0:
                    cand.append((ov, m, c))
    out, used_m, used_c = {}, set(), set()
    for ov, m, c in sorted(cand, key=lambda x: -x[0]):
        if m not in used_m and c not in used_c:
            out[m] = c
            used_m.add(m)
            used_c.add(c)
    return out


# ---------------------------------------------------------------- motion + releases
def motion_curve(video, roi=None, t_from=0.0, t_to=None, scale=0.25):
    """(times, mean abs frame difference) at the file's own frame times, on a downscaled
    grayscale copy (the whole frame, or roi = (x0, y0, x1, y1) in full-size pixels)."""
    import cv2

    from .align import open_before
    cap = open_before(video, t_from) if t_from > 0 else cv2.VideoCapture(str(video))
    prev, ts, ds = None, [], []
    try:
        while cap.grab():
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if t < t_from:
                continue
            if t_to is not None and t > t_to:
                break
            ok, f = cap.retrieve()
            if not ok:
                break
            if roi:
                f = f[roi[1]:roi[3], roi[0]:roi[2]]
            g = cv2.cvtColor(cv2.resize(f, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA),
                             cv2.COLOR_BGR2GRAY)
            g = cv2.GaussianBlur(g, (5, 5), 0).astype(np.int16)
            if prev is not None:
                ts.append(t)
                ds.append(float(np.mean(np.abs(g - prev))))
            prev = g
    finally:
        cap.release()
    return np.array(ts), np.array(ds)


def releases_from_motion(ts, ds, min_gap_s=8.0, quiet_s=0.6, still=2.0, jump=4.0):
    """Release candidates in a motion curve: a sudden jump (>= jump x the quiet level) that comes
    straight out of a still stretch (mean <= still x quiet level over quiet_s before it) - the aim
    then the loose. Candidates closer than min_gap_s keep the stronger. Returns (times, strengths)."""
    if len(ts) < 10:
        return np.array([]), np.array([])
    base = max(float(np.percentile(ds, 20)), 1e-3)
    cands = []
    for i in range(1, len(ts)):
        if ds[i] < jump * base:
            continue
        pre = ds[(ts >= ts[i] - quiet_s) & (ts < ts[i])]
        if len(pre) >= 3 and float(np.mean(pre)) <= still * base:
            cands.append((float(ts[i]), float(ds[i] / base)))
    out = []
    for t, s in cands:
        if out and t - out[-1][0] < min_gap_s:
            if s > out[-1][1]:
                out[-1] = (t, s)
        else:
            out.append((t, s))
    return np.array([t for t, _ in out]), np.array([s for _, s in out])


def match_offset(main_t, cam_t, tol=0.35, stretches=(1.0, 4.0, 8.0)):
    """Best (offset, stretch, n_matched, residual): main = cam / stretch + offset. Tries every
    pairing of one main release with one camera release as the anchor and keeps the shift that
    matches the most releases within tol (ties: smallest residual)."""
    best = (None, 1.0, 0, np.inf)
    for k in stretches:
        c = np.asarray(cam_t, float) / k
        for a in main_t:
            for b in c:
                off = a - b
                d = np.abs((c + off)[:, None] - np.asarray(main_t)[None, :])
                hit = d.min(axis=1) < tol
                n = int(hit.sum())
                res = float(np.mean(d.min(axis=1)[hit])) if n else np.inf
                if n > best[2] or (n == best[2] and res < best[3]):
                    best = (float(off), k, n, res)
    return best


def refine(main_curve, cam_curve, offset, stretch=1.0, search_s=0.5, step=1 / 240):
    """Cross-correlate the two motion curves (resampled to a common fine grid) around the coarse
    offset; returns the offset with the highest normalised correlation."""
    (mt, md), (ct, cd) = main_curve, cam_curve
    if len(mt) < 10 or len(ct) < 10:
        return offset
    ct = ct / stretch
    lo, hi = max(mt[0], ct[0] + offset - search_s), min(mt[-1], ct[-1] + offset + search_s)
    if hi - lo < 5:
        return offset
    g = np.arange(lo, hi, step)
    m = np.interp(g, mt, md)
    m = (m - m.mean()) / (m.std() + 1e-9)
    best, best_off = -np.inf, offset
    for off in np.arange(offset - search_s, offset + search_s, step):
        c = np.interp(g, ct + off, cd, left=np.nan, right=np.nan)
        ok = np.isfinite(c)
        if ok.sum() < len(g) * 0.5:
            continue
        cc = (c[ok] - c[ok].mean()) / (c[ok].std() + 1e-9)
        r = float(np.mean(m[ok] * cc))
        if r > best:
            best, best_off = r, float(off)
    return best_off


# ---------------------------------------------------------------- per end
def _archer_box(main_video, cfg, pad=0.15):
    """Pixel box around the tracked archer over the whole end (pose bounding boxes), so the main
    view's motion is the archer's own, not the neighbours'."""
    import pandas as pd
    ddir = _config.data_dir(cfg)
    df = pd.read_parquet(ddir / f"{Path(main_video).stem}.pose.parquet")
    m = json.loads((ddir / f"{Path(main_video).stem}.meta.json").read_text(encoding="utf-8"))
    W, H = m["width"], m["height"]
    x0, y0 = np.nanpercentile(df.bx0, 5), np.nanpercentile(df.by0, 5)
    x1, y1 = np.nanpercentile(df.bx1, 95), np.nanpercentile(df.by1, 95)
    w, h = x1 - x0, y1 - y0
    return (int(max(0, (x0 - pad * w) * W)), int(max(0, (y0 - pad * h) * H)),
            int(min(W, (x1 + pad * w) * W)), int(min(H, (y1 + pad * h) * H)))


def _corr(mt, md, ct, cd, offsets, step):
    """Normalised correlation of the main curve with the camera curve shifted by each offset."""
    lo, hi = mt[0], mt[-1]
    g = np.arange(lo, hi, step)
    m = np.interp(g, mt, md)
    m = (m - m.mean()) / (m.std() + 1e-9)
    out = []
    for off in offsets:
        c = np.interp(g, ct + off, cd, left=np.nan, right=np.nan)
        ok = np.isfinite(c)
        if ok.sum() < len(g) * 0.4:
            out.append(-np.inf)
            continue
        cc = (c[ok] - c[ok].mean()) / (c[ok].std() + 1e-9)
        out.append(float(np.mean(m[ok] * cc)))
    return np.array(out)


def sync_end(main_video: Path, cam_video: Path, main_cfg: dict, search_s: float = 8.0) -> dict:
    """Offset of cam_video relative to main_video (main time = cam file time / stretch + offset).

    The recording clocks put the offset within a few seconds (the two cameras are started by
    hand one after the other). Within +/-search_s of that, the shift that best lines up the
    archer's movement in the two views (raise, draw, loose, bow down) wins, at 50 ms; then it is
    refined to ~4 ms around it. Checked by how well the second view's motion jumps at each
    main-camera release."""
    import pandas as pd
    ddir = _config.data_dir(main_cfg)
    shots = pd.read_parquet(ddir / f"{main_video.stem}.shots.parquet")
    main_rel = shots["release_t"].to_numpy(float)
    k = stretch_of(cam_video)
    info = _ffprobe_info(cam_video)
    res = dict(file=Path(cam_video).name, fps=info["fps"], stretch=k, cam_has_audio=info["has_audio"],
               main_releases=[round(float(x), 3) for x in main_rel])
    sm, sc = start_time(main_video), start_time(cam_video)
    prior = (sc - sm).total_seconds() if sm and sc else 0.0
    # turn parts (<stem>_tN) start at the cut, not at the recording's start
    mt, md = motion_curve(main_video, roi=_archer_box(main_video, main_cfg))
    ct, cd = motion_curve(cam_video)
    ct = ct / k                                        # camera curve in real seconds
    coarse = np.arange(prior - search_s, prior + search_s, 0.05)
    r1 = _corr(mt, md, ct, cd, coarse, 0.05)
    off = float(coarse[int(np.argmax(r1))])
    fine = np.arange(off - 0.1, off + 0.1, 1 / 240)
    r2 = _corr(mt, md, ct, cd, fine, 1 / 240)
    off = float(fine[int(np.argmax(r2))])
    # check: does the second view jump at each release?
    hits = []
    for t in main_rel:
        w = (ct + off > t - 0.3) & (ct + off < t + 0.3)
        q = (ct + off > t - 1.2) & (ct + off < t - 0.4)
        if w.any() and q.any():
            hits.append(float(cd[w].max() / (np.median(cd[q]) + 1e-6)))
    res.update(offset_s=round(off, 4), clock_offset_s=round(prior, 3), correlation=round(float(r2.max()), 3),
               release_jump=[round(h, 1) for h in hits])
    return res


def cam2_time(main_t: float, s: dict) -> float:
    """Second-camera file time for a main-camera time."""
    return (main_t - s["offset_s"]) * s.get("stretch", 1.0)


def load(session: Path) -> dict:
    f = Path(session) / "_cam2" / "sync.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def save(session: Path, data: dict):
    d = Path(session) / "_cam2"
    d.mkdir(parents=True, exist_ok=True)
    (d / "sync.json").write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


def run(session: Path, cam2_folder: Path, base: dict, profile: str = "full", only=None) -> dict:
    """Pair every second-camera recording in cam2_folder with an end and sync it (only: just
    these main-camera videos)."""
    from .session import archer_cfg, archers
    session = Path(session).resolve()
    cam2 = _config.list_videos(Path(cam2_folder))
    found = archers(session)
    owner = {v: a for a, vids in found.items() for v in vids if only is None or v in only}
    # turn parts share their original recording's window: pair on originals, then map
    mains = list(owner)
    pairs = pair(mains, cam2)
    data = load(session)
    for m, c in sorted(pairs.items(), key=lambda kv: kv[0].name):
        cfg = archer_cfg(base, session, owner[m], profile)
        try:
            s = sync_end(m, c, cfg)
        except Exception as e:  # noqa: BLE001
            s = dict(file=c.name, offset_s=None, note=f"{type(e).__name__}: {e}")
        s["path"] = str(c)
        s["archer"] = owner[m]
        data[m.stem] = s
        ok = s.get("offset_s") is not None
        print(f"  {m.stem} <- {c.name}: " + (f"offset {s['offset_s']:+.3f}s (clocks said {s['clock_offset_s']:+.1f}), "
                                              f"x{s['stretch']:g} slow, motion correlation {s['correlation']}, "
                                              f"jump at each release x{s['release_jump']}" if ok else s.get("note", "not synced")))
    unpaired = [c.name for c in cam2 if c not in pairs.values()]
    if unpaired:
        print(f"  not paired with any end (no overlapping recording time): {', '.join(unpaired)}")
    save(session, data)
    return data
