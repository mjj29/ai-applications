"""Session insights: what changes across an archer's shots, and how the archers differ.

Pools every shot of each archer (all ends of the session) into one table:
  - timing      draw (raise -> full draw), aim (full draw -> loose), bow-up time
  - form        the 12 release features from outliers.py (angles, anchor, elbow, lean, ...)
  - release     creep/expansion before the loose (draw hand along the aim line, last 0.6s),
                draw-hand travel back after the loose ("live" vs "dead" release),
                bow-hand drop after the loose
  - context     end number, shot number within the turn, clock time
and looks for structure: consistency per archer, trends through the session (fatigue),
first arrow of a turn vs the rest, and which measurements move together.

Writes <session>/<results>/insights/: shots.csv, *.png and insights.html.
"""
from __future__ import annotations

import html
import re
import textwrap
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as _config
from . import landmarks as L
from . import outliers as _out

TIMING = {"draw_s": "draw time (raise to full draw)", "aim_s": "aim time (full draw to loose)",
          "bowup_s": "bow-up time (bow raised to loose)"}
RELEASE = {"creep": "creep before the loose (+ forward / - expanding)",
           "live_release": "draw hand travel back in 0.3s after the loose",
           "hand_drop": "draw hand drop in 0.3s after the loose",
           "elbow_drop": "draw elbow drop in 0.3s after the loose",
           "bow_drop": "bow-hand drop in 0.5s after the loose"}


def _clock(stem: str, t: float) -> float | None:
    """Minutes since midnight of the loose, from a 'YYYYMMDD_HHMMSS' recording name."""
    m = re.search(r"\d{8}_(\d{2})(\d{2})(\d{2})", stem)
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2)) + (int(m.group(3)) + t) / 60.0


def _release_features(coords, grid, s):
    """Creep, live release and bow drop per shot (torso lengths)."""
    def at(lm, lo, hi):
        m = (grid >= lo) & (grid <= hi)
        return np.nanmean(coords[:, m, lm, :], axis=1)
    # aim line: draw shoulder -> bow wrist during the last moments of aim
    aim = at(s["bow_wrist"], -0.6, -0.05) - at(s["draw_shoulder"], -0.6, -0.05)
    aim /= np.linalg.norm(aim, axis=1, keepdims=True) + 1e-9
    dw_a, dw_b = at(s["draw_wrist"], -0.65, -0.55), at(s["draw_wrist"], -0.1, -0.02)
    creep = np.sum((dw_b - dw_a) * aim, axis=1)                    # + = towards the bow
    dw_0, dw_3 = at(s["draw_wrist"], -0.04, 0.0), at(s["draw_wrist"], 0.25, 0.35)
    live = -np.sum((dw_3 - dw_0) * aim, axis=1)                    # + = back, away from the bow
    bw_0, bw_5 = at(s["bow_wrist"], -0.04, 0.0), at(s["bow_wrist"], 0.45, 0.55)
    drop = bw_5[:, 1] - bw_0[:, 1]                                 # + = down (image y down)
    hand_drop = dw_3[:, 1] - dw_0[:, 1]                            # + = down (falls to the chest)
    de_0, de_3 = at(s["draw_elbow"], -0.04, 0.0), at(s["draw_elbow"], 0.25, 0.35)
    elbow_drop = de_3[:, 1] - de_0[:, 1]                           # + = the draw elbow collapses down
    return {"creep": creep, "live_release": live, "hand_drop": hand_drop, "elbow_drop": elbow_drop,
            "bow_drop": drop}


def shot_table(session: Path, base: dict, profile: str = "full") -> pd.DataFrame:
    from .session import archer_cfg, archers
    rows = []
    for name, vids in archers(session).items():
        cfg = archer_cfg(base, session, name, profile)
        ddir = _config.data_dir(cfg)
        s = L.sides(cfg["archer"]["handedness"])
        stems = [v.stem for v in sorted(vids, key=lambda p: p.name)
                 if (ddir / f"{v.stem}.normalized.npz").exists()]
        for e, stem in enumerate(stems, 1):
            d = np.load(ddir / f"{stem}.normalized.npz", allow_pickle=True)
            coords, grid = d["coords"], d["grid"]
            F, names = _out._features(coords, grid, cfg)
            R = _release_features(coords, grid, s)
            seg = _out.segment_lengths(coords, grid, cfg)
            shots = pd.read_parquet(ddir / f"{stem}.shots.parquet").set_index("shot")
            for i, sh in enumerate(d["shots"]):
                r = shots.loc[int(sh)]
                row = dict(archer=name, end=e, stem=stem, shot=int(sh), n_in_turn=len(d["shots"]),
                           release_t=float(r["release_t"]), release_source=r.get("release_source", ""),
                           clock_min=_clock(stem, float(r["release_t"])),
                           draw_s=float(r["draw_end_t"] - r["draw_start_t"]),
                           aim_s=float(r["release_t"] - r["draw_end_t"]),
                           bowup_s=float(r["release_t"] - r["hold_start_t"]))
                row.update({n: float(F[i, k]) for k, n in enumerate(names)})
                row.update({k: float(v[i]) for k, v in R.items()})
                row.update({f"seg_{k}": float(v[i]) for k, v in seg.items()})
                rows.append(row)
    df = pd.DataFrame(rows)
    return _mask(df, float(base.get("outliers", {}).get("collapsed_limb_frac", 0.5))) if len(df) else df


# release measures and the arm segments they rely on (the rest are in outliers.DEPENDS)
_DEPENDS = {**_out.DEPENDS, "creep": ("draw_fore",), "live_release": ("draw_fore",),
            "hand_drop": ("draw_fore",), "elbow_drop": ("draw_upper",), "bow_drop": ("bow_fore", "bow_reach")}


def _mask(df, frac):
    """Blank measures whose limb the tracking lost on that shot (see outliers.collapsed),
    judged against each archer's own shots. Adds lost_<segment> flags."""
    df = df.copy()
    for a, idx in df.groupby("archer").groups.items():
        seg = {k: df.loc[idx, f"seg_{k}"].to_numpy(float) for k in _out.SEGMENTS}
        bad = _out.collapsed(seg, frac)
        for k, b in bad.items():
            df.loc[idx, f"lost_{k}"] = b
        for col, segs in _DEPENDS.items():
            if col in df:
                for k in segs:
                    df.loc[idx[bad[k]], col] = np.nan
    return df


def _label(col):
    if col in TIMING:
        return TIMING[col], "s"
    if col in RELEASE:
        return RELEASE[col], "torso"
    return _out.FEATURE_INFO.get(col, (col, ""))


def _spearman(x, y):
    from scipy.stats import spearmanr
    ok = np.isfinite(x) & np.isfinite(y)
    if ok.sum() < 6:
        return np.nan, np.nan
    r = spearmanr(x[ok], y[ok])
    return float(r.statistic), float(r.pvalue)


def analyse(df: pd.DataFrame, outdir: Path) -> dict:
    """Charts + tables. Returns {'trends': df, 'turn': df, 'spread': df, 'pairs': df}."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    outdir.mkdir(parents=True, exist_ok=True)
    df.to_csv(outdir / "shots.csv", index=False)
    cols = list(TIMING) + list(_out.FEATURE_INFO) + list(RELEASE)
    names = sorted(df["archer"].unique())
    colours = dict(zip(names, ["#1f77b4", "#d62728", "#2ca02c", "#9467bd", "#ff7f0e"]))

    # 1. every measurement against clock time, both archers (fatigue / drift)
    n = len(cols)
    fig, axes = plt.subplots((n + 3) // 4, 4, figsize=(16, 3.0 * ((n + 3) // 4)))
    trends = []
    for ax, c in zip(axes.flat, cols):
        for a in names:
            sub = df[df.archer == a]
            ax.plot(sub.clock_min, sub[c], "o", ms=4, color=colours[a], alpha=0.8, label=a)
            rho, p = _spearman(sub.clock_min.to_numpy(float), sub[c].to_numpy(float))
            trends.append(dict(archer=a, measure=c, rho=rho, p=p, n=int(sub[c].notna().sum())))
        lab, unit = _label(c)
        ax.set_title("\n".join(textwrap.wrap(f"{lab} [{unit}]", 40)), fontsize=9)
        ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{int(v // 60)}:{int(v % 60):02d}"))
        ax.tick_params(labelsize=7)
    for ax in list(axes.flat)[n:]:
        ax.axis("off")
    axes.flat[0].legend(fontsize=8)
    fig.suptitle("Every measurement through the session (x = time of the shot)", fontsize=12)
    fig.tight_layout()
    fig.savefig(outdir / "through_session.png", dpi=80)
    plt.close(fig)

    # 2. spread per archer (robust SD), so consistency can be compared measure by measure
    spread = []
    for a in names:
        sub = df[df.archer == a]
        for c in cols:
            v = sub[c].dropna().to_numpy(float)
            if len(v):
                spread.append(dict(archer=a, measure=c, median=float(np.median(v)),
                                   robust_sd=float(1.4826 * np.median(np.abs(v - np.median(v)))), n=len(v)))
    spread = pd.DataFrame(spread)

    # 3. first arrow of a turn vs the rest
    turn = []
    for a in names:
        sub = df[df.archer == a]
        first, rest = sub[sub.shot == 1], sub[sub.shot > 1]
        for c in cols:
            if first[c].notna().sum() >= 3 and rest[c].notna().sum() >= 3:
                from scipy.stats import mannwhitneyu
                p = float(mannwhitneyu(first[c].dropna(), rest[c].dropna()).pvalue)
                turn.append(dict(archer=a, measure=c, first=float(first[c].median()),
                                 rest=float(rest[c].median()), p=p, n_first=len(first), n_rest=len(rest)))
    turn = pd.DataFrame(turn)

    # 4. which measures move together (per archer, aim time is the usual suspect)
    pairs = []
    for a in names:
        sub = df[df.archer == a]
        for i, c1 in enumerate(cols):
            for c2 in cols[i + 1:]:
                rho, p = _spearman(sub[c1].to_numpy(float), sub[c2].to_numpy(float))
                if np.isfinite(rho):
                    pairs.append(dict(archer=a, a=c1, b=c2, rho=rho, p=p))
    pairs = pd.DataFrame(pairs)

    # 5. archers side by side: distributions of the release-mechanics and timing measures
    show = list(TIMING) + list(RELEASE) + ["aim_wobble", "followthrough"]
    fig, axes = plt.subplots(1, len(show), figsize=(2.2 * len(show), 3.2))
    for ax, c in zip(axes, show):
        data = [df[df.archer == a][c].dropna().to_numpy(float) for a in names]
        ax.boxplot(data, widths=0.5, showfliers=False)
        for k, (a, v) in enumerate(zip(names, data), 1):
            ax.plot(np.random.default_rng(0).normal(k, 0.06, len(v)), v, "o", ms=3, color=colours[a], alpha=0.8)
        ax.set_xticks(range(1, len(names) + 1), names, fontsize=8)
        lab, unit = _label(c)
        ax.set_title("\n".join(textwrap.wrap(f"{lab} [{unit}]", 22)), fontsize=8)
        ax.tick_params(labelsize=7)
    fig.tight_layout()
    fig.savefig(outdir / "archers_compared.png", dpi=80)
    plt.close(fig)
    return dict(trends=pd.DataFrame(trends), spread=spread, turn=turn, pairs=pairs)


def _table(df, cols, fmt=None):
    fmt = fmt or {}
    head = "".join(f"<th>{html.escape(c)}</th>" for c in cols)
    body = "".join("<tr>" + "".join(
        f"<td>{html.escape(fmt[c](r[c]) if c in fmt else str(r[c]))}</td>" for c in cols) + "</tr>"
        for _, r in df.iterrows())
    return f"<table><tr>{head}</tr>{body}</table>"


def write(session: Path, base: dict, profile: str = "full") -> Path:
    from .gallery import _page
    from .session import results_dir
    session = Path(session).resolve()
    outdir = results_dir(session, profile) / "insights"
    df = shot_table(session, base, profile)
    res = analyse(df, outdir)
    f2, f3 = (lambda v: f"{v:+.2f}"), (lambda v: f"{v:.3f}")
    named = lambda c: _label(c)[0]  # noqa: E731
    tr = res["trends"].dropna()
    tr = tr[tr.p < 0.05].sort_values("p").assign(measure=lambda d: d.measure.map(named))
    tu = res["turn"]
    tu = tu[tu.p < 0.05].sort_values("p").assign(measure=lambda d: d.measure.map(named)) if len(tu) else tu
    pr = res["pairs"]
    pr = pr[(pr.p < 0.01)].sort_values("p").head(30).assign(a=lambda d: d.a.map(named), b=lambda d: d.b.map(named))
    sp = res["spread"].pivot(index="measure", columns="archer", values="robust_sd").reset_index()
    sp["measure"] = sp["measure"].map(named)
    counts = df.groupby("archer").agg(ends=("end", "max"), shots=("shot", "size")).reset_index()
    parts = [f"<h1>Session {html.escape(session.name)}: insights</h1>",
             "<p class=\"sub\">All of each archer's shots pooled. Exploratory: small samples, so treat "
             "p-values as pointers to look at the video, not proof.</p>",
             _table(counts, ["archer", "ends", "shots"]),
             "<h2>Archers side by side</h2><img src=\"archers_compared.png\">",
             "<h2>Through the session</h2><img src=\"through_session.png\">",
             "<h3>Trends with time (Spearman, p &lt; 0.05)</h3>",
             _table(tr, ["archer", "measure", "rho", "p", "n"], {"rho": f2, "p": f3}) if len(tr) else "<p>None.</p>",
             "<h3>First arrow of a turn vs the rest (p &lt; 0.05)</h3>",
             _table(tu, ["archer", "measure", "first", "rest", "p", "n_first", "n_rest"],
                    {"first": f2, "rest": f2, "p": f3}) if len(tu) else "<p>None.</p>",
             "<h3>Measures that move together (p &lt; 0.01)</h3>",
             _table(pr, ["archer", "a", "b", "rho", "p"], {"rho": f2, "p": f3}) if len(pr) else "<p>None.</p>",
             "<h3>Consistency: robust spread per measure (lower = more repeatable)</h3>",
             _table(sp, list(sp.columns), {c: f3 for c in sp.columns if c != "measure"}),
             "<p><a href=\"shots.csv\">shots.csv</a>: every shot and measure.</p>"]
    out = outdir / "insights.html"
    out.write_text(_page(f"Session {session.name} insights", "\n".join(parts)), encoding="utf-8")
    print(f"insights: {len(df)} shots -> {out}")
    return out
