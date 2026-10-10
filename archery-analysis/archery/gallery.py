"""Quick-look pages: every shot of one archer, playable in a browser.

The first thing to show an archer after an end is their own shots, cut and lined up. These
pages need only the clips (stage 4) and the ghost overlay (stage 5b), so they are written as
soon as those exist, before the slower charts and reports.

  <results>/<archer>/shots.html   newest end first: the end's ghost overlay (all its shots
                                   body-aligned on the release), then each shot's clip
  <results>/index.html            one link per archer
"""
from __future__ import annotations

import html
from pathlib import Path

from . import config as _config

_STYLE = """
:root { color-scheme: light dark; --bg: #fafafa; --fg: #1d1d1f; --muted: #6e6e73; --card: #fff;
        --line: #d2d2d7; --accent: #0a66c2; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #161617; --fg: #f5f5f7; --muted: #a1a1a6; --card: #1f1f21; --line: #3a3a3c;
          --accent: #4ea1f3; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg);
       font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
h2 { font-size: 1.15rem; margin: 28px 0 8px; padding-top: 12px; border-top: 1px solid var(--line); }
p.sub { color: var(--muted); margin: 0 0 16px; }
a { color: var(--accent); }
.ghost { max-width: 720px; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px;
         padding: 8px; }
figcaption { color: var(--muted); font-size: 0.85rem; margin-top: 4px; }
video, img { width: 100%; height: auto; display: block; border-radius: 4px; background: #000; }
table { border-collapse: collapse; }
td, th { padding: 6px 12px; border-bottom: 1px solid var(--line); text-align: left; }
"""


def _page(title, body):
    return (f"<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
            f"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<title>{html.escape(title)}</title><style>{_STYLE}</style></head>\n"
            f"<body>\n{body}\n</body></html>\n")


def _shot_clips(odir: Path, stem: str) -> list[Path]:
    d = odir / stem
    if not d.is_dir():
        return []
    return sorted(d.glob("shot_*.mp4"), key=lambda p: int(p.stem.split("_")[1]))


def archer_page(name: str, videos: list[Path], cfg: dict) -> Path | None:
    """Write <output.dir>/shots.html for one archer. None if no end has clips yet."""
    odir = _config.output_dir(cfg)
    ends = []
    for v in sorted(videos, key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True):
        clips = _shot_clips(odir, v.stem)
        if clips:
            ends.append((v.stem, clips))
    if not ends:
        return None
    total = sum(len(c) for _, c in ends)
    parts = [f"<h1>{html.escape(name)}</h1>",
             f"<p class=\"sub\">{total} shots in {len(ends)} end{'s' if len(ends) != 1 else ''}, "
             f"newest first. <a href=\"../index.html\">All archers</a></p>"]
    for stem, clips in ends:
        parts.append(f"<h2>{html.escape(stem)}</h2>")
        ghost = odir / f"{stem}.ghost.mp4"
        if ghost.exists():
            poster = f"{stem}.ghost_release.png"
            pattr = f" poster=\"{html.escape(poster)}\"" if (odir / poster).exists() else ""
            parts.append(f"<figure class=\"ghost\"><video controls loop muted preload=\"metadata\"{pattr} "
                         f"src=\"{html.escape(ghost.name)}\"></video><figcaption>All {len(clips)} shots "
                         f"overlaid, body-aligned, release at 0</figcaption></figure>")
        else:
            parts.append("<p class=\"sub\">Aligned overlay still being made; refresh shortly.</p>")
        parts.append("<div class=\"shots\">")
        for c in clips:
            rel = f"{stem}/{c.name}"
            parts.append(f"<figure><video controls preload=\"metadata\" src=\"{html.escape(rel)}\"></video>"
                         f"<figcaption>Shot {c.stem.split('_')[1]}</figcaption></figure>")
        parts.append("</div>")
    out = odir / "shots.html"
    out.write_text(_page(f"{name} - shots", "\n".join(parts)), encoding="utf-8")
    return out


def session_page(rdir: Path, title: str, rows: list[tuple[str, int, int]]) -> Path:
    """Write <rdir>/index.html linking each archer's shots page. rows = (name, ends, shots)."""
    body = [f"<h1>{html.escape(title)}</h1>",
            "<table><tr><th>archer</th><th>ends</th><th>shots</th></tr>"]
    for name, n_ends, n_shots in rows:
        link = (f"<a href=\"{html.escape(name)}/shots.html\">{html.escape(name)}</a>"
                if (rdir / name / "shots.html").exists() else html.escape(name))
        body.append(f"<tr><td>{link}</td><td>{n_ends}</td><td>{n_shots}</td></tr>")
    body.append("</table>")
    out = rdir / "index.html"
    out.write_text(_page(title, "\n".join(body)), encoding="utf-8")
    return out
