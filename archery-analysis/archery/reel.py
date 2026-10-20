"""One video per archer: every shot of the session in order, back to back.

The baseline review tool: watch all of an archer's shots one after another. Each shot clip
(stage 4) gets a caption - end number, recording time, shot number - and the captioned clips
are joined into

  <output.dir>/<archer>.reel.mp4

Captioned copies are cached in <output.dir>/_reel/ so adding an end only encodes its new shots.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import numpy as np

from . import config as _config
from .clip import _ffmpeg

_FONTS = ["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf",
          "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
          "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"]


def _font():
    for f in _FONTS:
        if os.path.exists(f):
            return f
    return None


def _esc(s: str) -> str:
    """Escape text for an ffmpeg filter argument (drawtext value inside single quotes)."""
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\u2019").replace("%", "\\%")


def _when(stem: str) -> str:
    """'20261013_202513_t2' -> '20:25' (recording start), or '' if the name has no time."""
    m = re.search(r"\d{8}_(\d{2})(\d{2})\d{2}", stem)
    return f"{m.group(1)}:{m.group(2)}" if m else ""


def _clips(odir: Path, stem: str) -> list[Path]:
    d = odir / stem
    return sorted(d.glob("shot_*.mp4"), key=lambda p: int(p.stem.split("_")[1])) if d.is_dir() else []


def build(name: str, videos: list[Path], cfg: dict) -> Path | None:
    """Write <output.dir>/<name>.reel.mp4 from every end's shot clips, in recording order."""
    odir = _config.output_dir(cfg)
    rc = cfg.get("reel", {})
    height = int(rc.get("height", 720))
    fps = float(rc.get("fps", 30))
    ends = [(v.stem, _clips(odir, v.stem)) for v in sorted(videos, key=lambda p: p.name)]
    ends = [(s, c) for s, c in ends if c]
    if not ends:
        return None
    cache = odir / "_reel"
    cache.mkdir(parents=True, exist_ok=True)
    ff, font = _ffmpeg(), _font()
    parts = []
    for k, (stem, clips) in enumerate(ends, 1):
        when = _when(stem)
        for clip in clips:
            n = clip.stem.split("_")[1]
            seg = cache / f"{stem}_shot_{n}.mp4"
            if not seg.exists() or seg.stat().st_mtime < clip.stat().st_mtime:
                label = f"{name}   end {k} of {len(ends)}" + (f" ({when})" if when else "") + \
                        f"   shot {n} of {len(clips)}"
                vf = f"scale=-2:{height},fps={fps:g},format=yuv420p"
                if font:
                    vf += (f",drawtext=fontfile='{_esc(font)}':text='{_esc(label)}':x=16:y=16:"
                           f"fontsize={max(18, height // 28)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8")
                subprocess.run([ff, "-v", "error", "-y", "-i", str(clip), "-an", "-vf", vf,
                                "-c:v", "libx264", "-preset", str(rc.get("preset", "veryfast")),
                                "-crf", str(rc.get("crf", 22)), str(seg)], check=True)
            parts.append(seg)
    listing = cache / "reel.txt"
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    out = odir / f"{name}.reel.mp4"
    subprocess.run([ff, "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-c", "copy", "-movflags", "+faststart", str(out)], check=True)
    print(f"{name}: reel of {len(parts)} shots from {len(ends)} ends -> {out.name}")
    return out


# ---------------------------------------------------------------- two cameras, side by side
class _Frames:
    """Frames of one video in time order, with 'the frame showing at time t' lookups.
    `tmap` maps reel (main-camera) time to this file's time; frames are cropped/resized on read."""

    def __init__(self, video, t_from, tmap, prep):
        import cv2

        from .align import open_before
        self.tmap, self.prep, self.cv2 = tmap, prep, cv2
        self.cap = open_before(video, max(0.0, tmap(t_from) - 0.2))
        self.cur = self.nxt = None
        self._advance()

    def _advance(self):
        cap = self.cap
        if cap.grab():
            t = cap.get(self.cv2.CAP_PROP_POS_MSEC) / 1000.0
            self.nxt = (t, cap)
        else:
            self.nxt = None

    def at(self, t_main):
        """Latest frame at or before t_main (decoding forward as needed)."""
        tf = self.tmap(t_main)
        while self.nxt is not None and self.nxt[0] <= tf:
            ok, f = self.nxt[1].retrieve()
            if ok:
                self.cur = self.prep(f)
            self._advance()
        if self.cur is None and self.nxt is not None:      # first frame comes after t: show it
            ok, f = self.nxt[1].retrieve()
            if ok:
                self.cur = self.prep(f)
        return self.cur

    def close(self):
        self.cap.release()


def _content_box(video):
    """(x0, y0, x1, y1) of the picture inside any black letterbox/pillarbox (from one frame)."""
    import cv2
    cap = cv2.VideoCapture(str(video))
    n = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(n // 3)))
    ok, f = cap.read()
    cap.release()
    if not ok:
        return None
    g = f.max(axis=2)
    rows, cols = np.flatnonzero(g.max(axis=1) > 24), np.flatnonzero(g.max(axis=0) > 24)
    if not len(rows) or not len(cols):
        return None
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def build_dual(name: str, videos: list[Path], cfg: dict, session: Path) -> Path | None:
    """<output.dir>/<name>.reel2.mp4: every shot with the main view and the second camera side by
    side, lined up in time (sync.json). Each shot plays in real time from the raise, then the
    release and follow-through again at reel.slow_factor slow motion - the second camera's own
    frames (a slow-motion phone recording gives genuinely in-between frames; the main view
    repeats its frames). Ends without a synced second camera show the main view only."""
    import cv2
    import pandas as pd

    from . import scores as _scores
    from . import sync as _sync
    from .align import ffmpeg_writer
    odir = _config.output_dir(cfg)
    ddir = _config.data_dir(cfg)
    rc, sg = cfg.get("reel", {}), cfg["segment"]
    H = int(rc.get("dual_height", 540)) & ~1
    fps = float(rc.get("fps", 30))
    slow = float(rc.get("slow_factor", 4))
    pre_s, post_s = float(rc.get("slow_pre_s", 0.5)), float(rc.get("slow_post_s", 1.2))
    lead, tail = float(sg.get("clip_lead_s", 3.0)), float(sg.get("clip_pad_post_s", 2.0))
    syncs = _sync.load(session)
    vids = sorted(videos, key=lambda p: p.name)
    sf = _scores.score_file(session, name, 1)
    arrows = _scores.parse(sf.read_text(encoding="utf-8")) if sf else []
    cache = odir / "_reel"
    cache.mkdir(parents=True, exist_ok=True)
    parts, n_dual = [], 0
    font = cv2.FONT_HERSHEY_SIMPLEX
    for k, v in enumerate(vids, 1):
        f = ddir / f"{v.stem}.shots.parquet"
        if not f.exists():
            continue
        shots = pd.read_parquet(f)
        s2 = syncs.get(v.stem) if syncs.get(v.stem, {}).get("offset_s") is not None else None
        n_dual += bool(s2)
        box1 = _content_box(v)
        box2 = _content_box(s2["path"]) if s2 else None

        def prep(img, box, h=H):
            if box:
                img = img[box[1]:box[3], box[0]:box[2]]
            return cv2.resize(img, (int(round(img.shape[1] * h / img.shape[0])) & ~1, h),
                              interpolation=cv2.INTER_AREA)
        for _, r in shots.iterrows():
            n = int(r["shot"])
            seg = cache / f"{v.stem}_shot_{n}.dual.mp4"
            if seg.exists() and seg.stat().st_mtime > max(f.stat().st_mtime, (session / "_cam2" / "sync.json").stat().st_mtime
                                                          if (session / "_cam2" / "sync.json").exists() else 0):
                parts.append(seg)
                continue
            rel = float(r["release_t"])
            t0, t1 = max(0.0, float(r["hold_start_t"]) - lead), rel + tail
            ticks = list(np.arange(t0, t1, 1 / fps)) + list(np.arange(rel - pre_s, rel + post_s, 1 / (fps * slow)))
            labels = ["" for _ in np.arange(t0, t1, 1 / fps)] + [f"{slow:g}x slower" for _ in np.arange(rel - pre_s, rel + post_s, 1 / (fps * slow))]
            a = arrows[k - 1]["arrows"][n - 1]["raw"] if k - 1 < len(arrows) and n - 1 < len(arrows[k - 1]["arrows"]) and \
                len(arrows[k - 1]["arrows"]) == len(shots) else None
            title = f"{name}  end {k}  shot {n}" + (f"  scored {a.upper()}" if a else "")
            A = _Frames(v, ticks[0], lambda t: t, lambda img: prep(img, box1))
            B = _Frames(s2["path"], ticks[0], lambda t, s=s2: _sync.cam2_time(t, s), lambda img: prep(img, box2)) if s2 else None
            proc, size = None, None
            last_t = None
            for t, lab in zip(ticks, labels):
                if last_t is not None and t < last_t:          # the slow replay restarts earlier
                    A.close()
                    A = _Frames(v, t, lambda x: x, lambda img: prep(img, box1))
                    if B:
                        B.close()
                        B = _Frames(s2["path"], t, lambda x, s=s2: _sync.cam2_time(x, s), lambda img: prep(img, box2))
                last_t = t
                fa = A.at(t)
                fb = B.at(t) if B else None
                if fa is None:
                    continue
                img = np.hstack([fa, fb]) if fb is not None else fa
                if size is None:
                    size = (img.shape[1] & ~1, img.shape[0] & ~1)
                    proc = ffmpeg_writer(seg, size[0], size[1], fps)
                img = cv2.resize(img, size) if (img.shape[1], img.shape[0]) != size else img
                img = np.ascontiguousarray(img)
                cv2.rectangle(img, (0, 0), (size[0], 40), (0, 0, 0), -1)
                d = t - rel
                cv2.putText(img, f"{title}   t={d:+.2f}s" + ("  RELEASE" if abs(d) < 0.02 else "")
                            + (f"   {lab}" if lab else ""), (12, 28), font, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
                proc.stdin.write(img.tobytes())
            A.close()
            if B:
                B.close()
            if proc:
                proc.stdin.close()
                proc.wait()
                parts.append(seg)
    if not parts:
        return None
    listing = cache / "reel2.txt"
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    out = odir / f"{name}.reel2.mp4"
    # side-by-side and main-only shots differ in width: re-encode to one size while joining
    subprocess.run([_ffmpeg(), "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-vf", f"scale=-2:{H},pad=ceil(iw/2)*2:{H}:(ow-iw)/2:0,format=yuv420p",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-movflags", "+faststart", str(out)],
                   check=True)
    print(f"{name}: two-view reel of {len(parts)} shots ({n_dual} ends with the second camera) -> {out.name}")
    return out
