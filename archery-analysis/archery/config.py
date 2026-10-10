"""Load the YAML pipeline configuration (and session/archer/profile overlays)."""
from __future__ import annotations

import copy
import re
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = PROJECT_ROOT / "config.yaml"
VIDEO_EXTS = (".mp4", ".mov", ".mkv", ".avi", ".m4v")


def load_config(path=DEFAULT_CONFIG) -> dict:
    """Read config.yaml into a plain dict."""
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def merge(base: dict, over: dict | None) -> dict:
    """Deep-merge `over` onto a copy of `base` (dicts merge, everything else replaces)."""
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def apply_profile(cfg: dict, profile: str | None) -> dict:
    """Overlay a named profile from cfg['profiles'] (e.g. 'fast' for in-session previews)."""
    if not profile or profile == "full":
        return cfg
    prof = cfg.get("profiles", {}).get(profile)
    if prof is None:
        raise SystemExit(f"unknown profile {profile!r} (define it under 'profiles:' in config.yaml)")
    return merge(cfg, prof)


def resolve_videos(cfg: dict, explicit=None) -> list[Path]:
    """Resolve the list of input videos: explicit args win, else config globs."""
    if explicit:
        return [Path(p) for p in explicit]
    out: list[Path] = []
    for pat in cfg.get("input", {}).get("videos", []):
        out.extend(sorted(PROJECT_ROOT.glob(pat)))
    return out


def list_videos(folder: Path) -> list[Path]:
    """Video files directly inside `folder`, oldest name first."""
    return sorted(p for p in Path(folder).iterdir()
                  if p.is_file() and p.suffix.lower() in VIDEO_EXTS and not p.name.startswith("."))


def short_label(stem: str) -> str:
    """Compact per-video label for plots/tables, e.g. '0935' for a phone/webcam timestamp name."""
    # PXL_20260628_093550027 (Pixel), WIN_20261011_19_30_12_Pro (Windows Camera),
    # VID_20261011_193012, 20261011_193012 ... -> HHMM of the recording time.
    m = re.search(r"20\d{6}[_-](\d{2})[_-]?(\d{2})", stem)
    if m:
        return m.group(1) + m.group(2)
    tail = re.split(r"[_\s.-]+", stem.strip())
    tail = [t for t in tail if t]
    return (tail[-1] if tail else stem)[:8]


def load_pose(stem: str, cfg: dict):
    """Load a video's pose track + meta sidecar produced by stage 1."""
    import json

    import pandas as pd
    ddir = data_dir(cfg)
    df = pd.read_parquet(ddir / f"{stem}.pose.parquet")
    meta = json.loads((ddir / f"{stem}.meta.json").read_text(encoding="utf-8"))
    return df, meta


def data_dir(cfg: dict) -> Path:
    d = PROJECT_ROOT / cfg.get("output", {}).get("data_dir", "data")
    d.mkdir(parents=True, exist_ok=True)
    return d


def output_dir(cfg: dict) -> Path:
    d = PROJECT_ROOT / cfg.get("output", {}).get("dir", "output")
    d.mkdir(parents=True, exist_ok=True)
    return d
