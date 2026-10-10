"""Stage 4 - cut single-shot segments.

Using the release times from stage 2, cut each shot into its own clip spanning
[release - clip_pad_pre_s, release + clip_pad_post_s], dropping the gaps (and the wind
let-downs) between shots. Re-encodes to H.264/AAC for frame-accurate, widely-playable
clips. Prefers system ffmpeg; falls back to the bundled imageio-ffmpeg binary.

Output: output/<stem>/shot_<n>.mp4
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pandas as pd

from . import config as _config


def _ffmpeg():
    ff = shutil.which("ffmpeg")
    if ff:
        return ff
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def clip_video(stem, cfg):
    ddir = _config.data_dir(cfg)
    shots = pd.read_parquet(ddir / f"{stem}.shots.parquet")
    meta = json.loads((ddir / f"{stem}.meta.json").read_text(encoding="utf-8"))
    video = meta["video"]
    sg = cfg["segment"]
    lead = float(sg.get("clip_lead_s", 3.0))
    post = float(sg.get("clip_pad_post_s", 2.0))
    outdir = _config.output_dir(cfg) / stem
    outdir.mkdir(parents=True, exist_ok=True)
    ff = _ffmpeg()
    # encoding speed vs quality: previews (fast profile) shrink and use a quicker preset
    enc = ["-c:v", "libx264", "-crf", str(sg.get("clip_crf", 18)),
           "-preset", str(sg.get("clip_preset", "fast"))]
    if sg.get("clip_max_height"):
        enc += ["-vf", f"scale=-2:'min({int(sg['clip_max_height'])},ih)'"]
    written = []
    for _, r in shots.iterrows():
        # start before the hold begins (captures raise + draw), end after follow-through
        start = max(0.0, float(r["hold_start_t"]) - lead)
        dur = float(r["release_t"]) + post - start
        out = outdir / f"shot_{int(r['shot'])}.mp4"
        cmd = [ff, "-v", "error", "-y", "-ss", f"{start:.3f}", "-i", str(video),
               "-t", f"{dur:.3f}", *enc, "-c:a", "aac", str(out)]
        subprocess.run(cmd, check=True)
        written.append(out)
    print(f"{stem}: cut {len(written)} shot clips -> {outdir}")
    return written


def run(videos, cfg):
    return [clip_video(Path(v).stem, cfg) for v in videos]
