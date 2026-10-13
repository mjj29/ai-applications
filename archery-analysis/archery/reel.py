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
