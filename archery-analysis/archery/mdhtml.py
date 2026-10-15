"""Just enough Markdown -> HTML for the generated reports, with the videos embedded.

Markdown previews show the images but only link the .mp4s (the overlay, ghost and delta
videos that matter most). This renders the report's own subset of Markdown - headings,
paragraphs, lists, quotes, tables, images, links, **bold**, *italic*, `code` - and turns every
link to a video into an inline player.
"""
from __future__ import annotations

import html
import re

_VIDEO = (".mp4", ".webm", ".mov")


def _inline(text: str) -> str:
    out, pos = [], 0
    # images and links first (their targets must not be touched by the emphasis rules)
    for m in re.finditer(r"(!?)\[([^\]]*)\]\(([^)\s]+)\)", text):
        out.append(_emph(html.escape(text[pos:m.start()], quote=False)))
        img, label, href = m.group(1), m.group(2), m.group(3)
        h = html.escape(href)
        if img:
            out.append(f"<img src=\"{h}\" alt=\"{html.escape(label)}\" loading=\"lazy\">")
        elif href.lower().endswith(_VIDEO):
            out.append(f"<figure class=\"video\"><video controls preload=\"metadata\" src=\"{h}\"></video>"
                       f"<figcaption>{_emph(html.escape(label.replace('▶', '').strip(), quote=False))}"
                       f"</figcaption></figure>")
        else:
            out.append(f"<a href=\"{h}\">{_emph(html.escape(label, quote=False))}</a>")
        pos = m.end()
    out.append(_emph(html.escape(text[pos:], quote=False)))
    return "".join(out)


def _emph(s: str) -> str:
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<i>\1</i>", s)
    return s


def to_html(md: str) -> str:
    lines, out, i = md.splitlines(), [], 0
    para: list[str] = []

    def flush():
        if para:
            out.append(f"<p>{_inline(' '.join(para))}</p>")
            para.clear()

    while i < len(lines):
        ln = lines[i]
        s = ln.strip()
        if not s:
            flush()
            i += 1
        elif m := re.match(r"(#{1,6})\s+(.*)", s):
            flush()
            n = len(m.group(1))
            out.append(f"<h{n}>{_inline(m.group(2))}</h{n}>")
            i += 1
        elif s.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            if rows:
                head = "".join(f"<th>{_inline(c)}</th>" for c in rows[0])
                body = "".join("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>" for r in rows[1:])
                out.append(f"<table><tr>{head}</tr>{body}</table>")
        elif s.startswith(">"):
            flush()
            q = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                q.append(lines[i].strip()[1:].strip())
                i += 1
            out.append(f"<blockquote>{_inline(' '.join(q))}</blockquote>")
        elif re.match(r"[-*]\s+", s):
            flush()
            items = []
            while i < len(lines) and (re.match(r"\s*[-*]\s+", lines[i]) or
                                      (items and lines[i].startswith("  ") and lines[i].strip())):
                if re.match(r"\s*[-*]\s+", lines[i]):
                    items.append(re.sub(r"^\s*[-*]\s+", "", lines[i]))
                else:
                    items[-1] += " " + lines[i].strip()
                i += 1
            out.append("<ul>" + "".join(f"<li>{_inline(it)}</li>" for it in items) + "</ul>")
        else:
            para.append(s)
            i += 1
    flush()
    return "\n".join(out)


EXTRA_STYLE = """
img { max-width: min(100%, 560px); margin: 4px 4px 4px 0; vertical-align: top; }
figure.video { max-width: 760px; margin: 8px 0 16px; }
blockquote { color: var(--muted); border-left: 3px solid var(--line); margin: 8px 0; padding: 2px 12px; }
td, th { font-size: 0.9rem; vertical-align: top; }
"""


def page(title: str, md: str) -> str:
    from .gallery import _page
    return _page(title, f"<style>{EXTRA_STYLE}</style>\n" + to_html(md))
