"""Pooled cross-video outlier analysis.

Pools every shot from every video into one population (more data = better sense of what
"typical" is), builds an interpretable feature vector per shot describing execution
around the release, and flags the atypical shots using robust statistics (median / MAD,
so a few bad shots don't distort the baseline).

This detects FORM outliers, not arrow score. If you supply which shots scored poorly
(a labels file), correlating these features to score would be far sharper -- ask and
we'll wire it.

Features per shot (body-normalized; evaluated near release unless noted):
  angle_draw_elbow, angle_bow_elbow, angle_draw_shoulder, angle_bow_shoulder
  spine_tilt_deg            lean of mid-hip->mid-shoulder from vertical
  head_forward              nose offset from shoulder centre along the aim axis
  draw_wrist_x/y            anchor position (string hand at full draw)
  bow_wrist_y               bow-arm height
  draw_elbow_y              draw-elbow height (high/low elbow)
  aim_wobble                bow-hand motion during the last ~0.6s of aim (steadiness)
  followthrough             draw-hand travel in the 0.3s after release

Outputs:
  output/outliers.png       shots x features z-score heatmap (atypical cells stand out)
  data/outliers.parquet     per-shot scores, feature values, and robust z-scores
  console                   shots ranked by atypicality + what differs on the worst ones
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from . import config as _config
from . import landmarks as L


FEATURE_INFO = {
    "angle_draw_elbow": ("draw-elbow bend", "deg"),
    "angle_bow_elbow": ("bow-arm elbow angle", "deg"),
    "angle_draw_shoulder": ("draw-shoulder angle", "deg"),
    "angle_bow_shoulder": ("bow-shoulder angle", "deg"),
    "spine_tilt_deg": ("spine lean from vertical", "deg"),
    "head_forward": ("head forward/back vs shoulders", "bl"),
    "draw_wrist_x": ("anchor horizontal position", "bl"),
    "draw_wrist_y": ("anchor height", "bl"),
    "bow_wrist_y": ("bow-hand height", "bl"),
    "draw_elbow_y": ("draw-elbow height", "bl"),
    "aim_wobble": ("aim wobble (last 0.6s)", "bl"),
    "followthrough": ("follow-through travel", "bl"),
}


def _lbl(t):
    """(stem, shot) -> short display label like '0935#4'."""
    return f"{_config.short_label(t[0])}#{t[1]}"


def _load_all(stems, cfg):
    coords, labels = [], []
    grid = None
    for stem in stems:
        f = _config.data_dir(cfg) / f"{stem}.normalized.npz"
        if not f.exists():
            continue
        d = np.load(f, allow_pickle=True)
        grid = d["grid"]
        coords.append(d["coords"])
        for s in d["shots"]:
            labels.append((stem, int(s)))
    return np.concatenate(coords, axis=0), grid, labels


def _wmean(arr, grid, lo, hi):
    m = (grid >= lo) & (grid <= hi)
    return np.nanmean(arr[:, m], axis=1)


def _angle(coords, a, b, c):
    ba = coords[:, :, a, :] - coords[:, :, b, :]
    bc = coords[:, :, c, :] - coords[:, :, b, :]
    cos = (ba * bc).sum(-1) / (np.linalg.norm(ba, axis=-1) * np.linalg.norm(bc, axis=-1) + 1e-9)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def _features(coords, grid, cfg):
    s = L.sides(cfg["archer"]["handedness"])
    rel = (-0.15, 0.05)                       # tight window at release
    feats = {}
    feats["angle_draw_elbow"] = _wmean(_angle(coords, s["draw_shoulder"], s["draw_elbow"], s["draw_wrist"]), grid, *rel)
    feats["angle_bow_elbow"] = _wmean(_angle(coords, s["bow_shoulder"], s["bow_elbow"], s["bow_wrist"]), grid, *rel)
    feats["angle_draw_shoulder"] = _wmean(_angle(coords, s["draw_elbow"], s["draw_shoulder"], L.LEFT_HIP if cfg["archer"]["handedness"] == "right" else L.RIGHT_HIP), grid, *rel)
    feats["angle_bow_shoulder"] = _wmean(_angle(coords, s["bow_elbow"], s["bow_shoulder"], L.RIGHT_HIP if cfg["archer"]["handedness"] == "right" else L.LEFT_HIP), grid, *rel)

    midsh = (coords[:, :, L.LEFT_SHOULDER, :] + coords[:, :, L.RIGHT_SHOULDER, :]) / 2
    spine = midsh  # mid-hip is origin, so mid-shoulder vector == spine direction
    feats["spine_tilt_deg"] = _wmean(np.degrees(np.arctan2(spine[..., 0], -spine[..., 1])), grid, *rel)
    nose = coords[:, :, L.NOSE, :]
    feats["head_forward"] = _wmean(nose[..., 0] - midsh[..., 0], grid, *rel)

    pos = _wmean(coords, grid, *rel)          # (S,33,2)
    feats["draw_wrist_x"] = pos[:, s["draw_wrist"], 0]
    feats["draw_wrist_y"] = pos[:, s["draw_wrist"], 1]
    feats["bow_wrist_y"] = pos[:, s["bow_wrist"], 1]
    feats["draw_elbow_y"] = pos[:, s["draw_elbow"], 1]

    # dynamic: aim steadiness (bow-hand wobble in last ~0.6s) and follow-through travel
    am = (grid >= -0.7) & (grid <= -0.1)
    bw = coords[:, :, s["bow_wrist"], :]
    feats["aim_wobble"] = np.nanstd(bw[:, am, 0], axis=1) + np.nanstd(bw[:, am, 1], axis=1)
    dw0 = _wmean(coords[:, :, s["draw_wrist"], :], grid, -0.05, 0.05)
    dw1 = _wmean(coords[:, :, s["draw_wrist"], :], grid, 0.2, 0.35)
    feats["followthrough"] = np.linalg.norm(dw1 - dw0, axis=1)

    names = list(feats)
    F = np.column_stack([feats[n] for n in names])
    return F, names


# Which arm segments each measure relies on. When pose tracking loses a limb (e.g. a bow arm
# pointing away from a front-on camera into the clutter of the riser), its elbow and wrist
# points collapse together and the measures built on them become meaningless numbers.
SEGMENTS = {"bow_upper": ("bow_shoulder", "bow_elbow"), "bow_fore": ("bow_elbow", "bow_wrist"),
            "draw_upper": ("draw_shoulder", "draw_elbow"), "draw_fore": ("draw_elbow", "draw_wrist"),
            # a straight bow arm keeps its reach; tracking that folds the arm shortens it
            "bow_reach": ("bow_shoulder", "bow_wrist")}
DEPENDS = {
    "angle_bow_elbow": ("bow_upper", "bow_fore", "bow_reach"), "angle_bow_shoulder": ("bow_upper",),
    "bow_wrist_y": ("bow_fore", "bow_reach"), "aim_wobble": ("bow_fore", "bow_reach"),
    "angle_draw_elbow": ("draw_upper", "draw_fore"), "angle_draw_shoulder": ("draw_upper",),
    "draw_elbow_y": ("draw_upper",), "draw_wrist_x": ("draw_fore",), "draw_wrist_y": ("draw_fore",),
    "followthrough": ("draw_fore",),
}


def segment_lengths(coords, grid, cfg):
    """Length of each arm segment at the loose, per shot (torso lengths)."""
    s = L.sides(cfg["archer"]["handedness"])
    pos = _wmean(coords, grid, -0.15, 0.05)
    return {k: np.linalg.norm(pos[:, s[a]] - pos[:, s[b]], axis=1) for k, (a, b) in SEGMENTS.items()}


def collapsed(seglens: dict, frac: float = 0.5) -> dict:
    """{segment: bool per shot}: True where that segment is shorter than `frac` of its usual
    full length (90th percentile over these shots) - the tracking lost that limb."""
    return {k: v < frac * np.nanpercentile(v, 90) for k, v in seglens.items()}


def mask_collapsed(F, names, seglens, frac=0.5):
    """Blank (NaN) every measure whose limb collapsed on that shot."""
    F = F.copy()
    bad = collapsed(seglens, frac)
    for j, n in enumerate(names):
        for seg in DEPENDS.get(n, ()):
            F[bad[seg], j] = np.nan
    return F


def _robust_z(F):
    med = np.nanmedian(F, axis=0)
    mad = np.nanmedian(np.abs(F - med), axis=0)
    scale = 1.4826 * mad
    scale[scale < 1e-9] = np.nanstd(F, axis=0)[scale < 1e-9] + 1e-9
    return (F - med) / scale, med, scale


def _compute(stems, cfg):
    coords, grid, labels = _load_all(stems, cfg)
    F, names = _features(coords, grid, cfg)
    F = mask_collapsed(F, names, segment_lengths(coords, grid, cfg),
                       float(cfg.get("outliers", {}).get("collapsed_limb_frac", 0.5)))
    Z, med, _ = _robust_z(F)
    score = np.sqrt(np.nanmean(Z ** 2, axis=1))         # overall atypicality (RMS z)
    return coords, grid, labels, F, names, Z, med, score


def score_shots(stems, cfg):
    """Per-shot atypicality table (used by the report + delta picks)."""
    _, _, labels, F, names, Z, med, score = _compute(stems, cfg)
    rows = []
    for i, (stem, shot) in enumerate(labels):
        maxz = float(np.nanmax(np.abs(Z[i])))
        bits = []
        for j in np.argsort(-np.abs(Z[i]))[:3]:
            lbl, unit = FEATURE_INFO.get(names[j], (names[j], ""))
            u = "deg" if unit == "deg" else " body-lengths"
            bits.append(f"{lbl} {F[i, j]:+.1f}{u} (usually {med[j]:+.1f}{u})")
        rows.append(dict(video=stem, shot=int(shot),
                         label=f"{_config.short_label(stem)}#{int(shot)}",
                         score=float(score[i]), max_abs_z=maxz,
                         is_artifact=bool(score[i] > 8 or maxz > 20),
                         summary="; ".join(bits)))
    return pd.DataFrame(rows)


def analyze(stems, cfg, top_features=4):
    coords, grid, labels, F, names, Z, med, score = _compute(stems, cfg)
    disp = [_lbl(t) for t in labels]
    order = np.argsort(-score)

    print(f"Pooled {len(labels)} shots from {len(stems)} videos; {len(names)} features.\n")
    print("Most atypical shots (RMS robust-z over features; flag |z|>=3 per feature):")
    for r in order:
        tops = np.argsort(-np.abs(Z[r]))[:top_features]
        desc = []
        for j in tops:
            zz = Z[r, j]
            arrow = "hi" if zz > 0 else "lo"
            desc.append(f"{names[j]} {F[r, j]:.1f} ({arrow} {zz:+.1f}sigma; typ {med[j]:.1f})")
        star = " *" if np.nanmax(np.abs(Z[r])) >= 3 else ""
        print(f"  {disp[r]:>8}  score={score[r]:.2f}{star}")
        print(f"            {' | '.join(desc)}")

    print("\nPlain-English read on the most atypical shots:")
    for r in order[:7]:
        mx = float(np.nanmax(np.abs(Z[r])))
        if score[r] > 8 or mx > 20:
            print(f"  {disp[r]}: extreme outlier (z up to {mx:.0f}) -> almost certainly a "
                  f"tracking error or a non-shot, not a form issue. Check its clip/overlay.")
            continue
        bits = []
        for j in np.argsort(-np.abs(Z[r]))[:3]:
            lbl, unit = FEATURE_INFO.get(names[j], (names[j], ""))
            u = "deg" if unit == "deg" else " body-lengths"
            bits.append(f"{lbl} {F[r, j]:+.1f}{u} (usually {med[j]:+.1f}{u})")
        print(f"  {disp[r]} (atypicality {score[r]:.1f}): " + "; ".join(bits))

    out = pd.DataFrame(F, columns=names)
    out.insert(0, "shot", disp)
    out.insert(1, "score", score)
    for j, n in enumerate(names):
        out[f"z_{n}"] = Z[:, j]
    out.to_parquet(_config.data_dir(cfg) / "outliers.parquet")
    _heatmap(Z, disp, names, score, order, cfg)
    print(f"\nwrote output/outliers.png and data/outliers.parquet")
    return out


def _heatmap(Z, labels, names, score, order, cfg):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    Zo = Z[order]
    fig, ax = plt.subplots(figsize=(1.1 * len(names) + 3, 0.32 * len(labels) + 2))
    im = ax.imshow(Zo, aspect="auto", cmap="coolwarm", vmin=-4, vmax=4)
    ax.set_xticks(range(len(names)))
    ax.set_xticklabels(names, rotation=45, ha="right", fontsize=8)
    ax.set_yticks(range(len(labels)))
    ax.set_yticklabels([f"{labels[r]}  ({score[r]:.2f})" for r in order], fontsize=8)
    ax.set_title("Per-shot robust z-scores (sorted by atypicality; red=high, blue=low)")
    fig.colorbar(im, ax=ax, label="robust z", shrink=0.6)
    fig.tight_layout()
    fig.savefig(_config.output_dir(cfg) / "outliers.png", dpi=120)
    plt.close(fig)


def run(videos, cfg):
    stems = [Path(v).stem for v in videos]
    return analyze(stems, cfg)
