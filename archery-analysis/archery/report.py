"""Generate a self-contained interpreting report into the output dir.

Fills the top-level template (report_template.md) with this run's results and relative
links, and writes it to <output.dir>/report.md -- so pointing output.dir at a new
location gives that run its own self-contained report. Also builds the 2-shot deltas:
most-vs-least typical (session), and each end's worst shot vs your typical reference.
"""
from __future__ import annotations

from pathlib import Path

from . import config as _config
from . import delta as _delta
from . import outliers


def _img(rel, alt):
    return f"![{alt}]({rel})"


def run(videos, cfg):
    stems = [Path(v).stem for v in videos]
    odir = _config.output_dir(cfg)
    template = Path(cfg.get("report", {}).get("template") or (_config.PROJECT_ROOT / "report_template.md"))

    df = outliers.score_shots(stems, cfg)
    df_sorted = df.sort_values("score", ascending=False)
    real = df[~df["is_artifact"]]
    if real.empty:
        real = df
    ref_row = real.loc[real["score"].idxmin()]
    ref, ref_lbl = (ref_row["video"], int(ref_row["shot"])), ref_row["label"]
    worst_row = real.loc[real["score"].idxmax()]

    # --- session: most typical vs least typical ---
    _delta.delta(ref, (worst_row["video"], int(worst_row["shot"])), cfg, tag="delta_session",
                 ref_name=f"most typical ({ref_lbl})", hi_name=f"least typical ({worst_row['label']})")
    session_md = "\n".join([
        f"- **Most typical:** {ref_lbl}  •  **Least typical:** {worst_row['label']} "
        f"(atypicality {worst_row['score']:.1f}) — {worst_row['summary']}", "",
        _img("delta_session.delta_release.png", "most vs least typical frames") + " " +
        _img("delta_session.delta_wire_release.png", "most vs least typical skeleton"),
        "",
        "[▶ play delta_session.delta.mp4 (real frames)](delta_session.delta.mp4)",
        "",
        "[▶ play delta_session.delta_wire.mp4 (skeletons)](delta_session.delta_wire.mp4)",
    ])

    # --- per-end: that end's worst shot vs its OWN most-typical shot ---
    # (same video => matching camera/background => clean real-frame delta).
    per = []
    for stem in stems:
        sub = real[real["video"] == stem]
        if sub.empty:
            continue
        w = sub.loc[sub["score"].idxmax()]
        b = sub.loc[sub["score"].idxmin()]
        tag = f"{stem}.delta_worst"
        _delta.delta((stem, int(b["shot"])), (stem, int(w["shot"])), cfg, tag=tag,
                     ref_name=f"best in end ({b['label']})", hi_name=f"worst ({w['label']})")
        per.append(
            f"### {stem}\n\n"
            f"Best **{b['label']}** vs worst **{w['label']}** (atypicality {w['score']:.1f}) "
            f"— {w['summary']}\n\n"
            f"{_img(tag + '.delta_release.png', 'worst vs best frames')} "
            f"{_img(tag + '.delta_wire_release.png', 'worst vs best skeleton')}\n\n"
            f"[▶ {tag}.delta.mp4 (real frames)]({tag}.delta.mp4)\n\n"
            f"[▶ {tag}.delta_wire.mp4 (skeletons)]({tag}.delta_wire.mp4)\n")
    per_md = "\n".join(per) if per else "_no shots found_"

    # --- ranked outlier table ---
    rows = ["| shot | atypicality | flag | what was different |", "|---|---|---|---|"]
    for _, r in df_sorted.iterrows():
        flag = "⚠ glitch / non-shot" if r["is_artifact"] else ""
        rows.append(f"| {r['label']} | {r['score']:.1f} | {flag} | {r['summary']} |")
    table_md = "\n".join(rows)

    # --- per-end gallery ---
    gal = []
    for stem in stems:
        gal.append(
            f"### {stem}\n\n"
            f"{_img(stem + '.segment.png', 'segment')}\n\n"
            f"{_img(stem + '.overlay_release.png', 'overlay at release')} "
            f"{_img(stem + '.angles.png', 'angles')}\n\n"
            f"{_img(stem + '.tracks.png', 'tracks')} "
            f"{_img(stem + '.ghost_release.png', 'ghost at release')}\n\n"
            f"[▶ {stem}.ghost.mp4]({stem}.ghost.mp4) · [▶ {stem}.overlay.mp4]({stem}.overlay.mp4) "
            f"· clips in `{stem}/`\n")
    gallery_md = "\n".join(gal)

    summary = (f"**{len(stems)} ends, {len(df)} shots.** Most typical shot: **{ref_lbl}**. "
               f"Most atypical (excluding glitches): **{worst_row['label']}**.")
    title = odir.name if odir.name not in ("output", ".") else "this run"

    text = template.read_text(encoding="utf-8")
    for k, v in {"TITLE": title, "SUMMARY": summary, "SESSION_DELTA": session_md,
                 "PER_END_WORST": per_md, "OUTLIER_TABLE": table_md, "GALLERY": gallery_md}.items():
        text = text.replace("{{" + k + "}}", v)
    out = odir / "report.md"
    out.write_text(text, encoding="utf-8")
    # the same report as a web page, with the overlay/ghost/delta videos playable in place
    from . import mdhtml
    (odir / "report.html").write_text(
        mdhtml.page(f"{title} - report", text.replace(
            "Open in VS Code's Markdown preview\n> (Ctrl/Cmd-Shift-V) so the images and links work.",
            "report.md has the same content as Markdown.")),
        encoding="utf-8")
    print(f"wrote {out}  (ref {ref_lbl}; session worst {worst_row['label']})")
    return out
