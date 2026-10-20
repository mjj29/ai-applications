"""Arrow scores and where they landed, matched to the analysed shots.

Score file (plain text, in the session folder): one line per end in shooting order, arrows in
shooting order, e.g.

    9 7lr 7lr
    t 5lr 7cl
    -------          <- optional separator: starts a new block (block 1, 2, ...)
    8hr t t
    27 23 = 50       <- lines with '=' (running totals) are ignored

Arrows: `t` / `x` = 10, `m` = miss (0), a number = that ring. A direction may follow the value:
vertical h/c/l (high/centre/low) then horizontal l/c/r (left/centre/right), e.g. `7lr` = a 7,
low right. 9s and 10s are usually written without one.

Files: `<session>/arrows.txt` when the session has one archer, or `<session>/arrows-<Archer>.txt`.
Each archer's score lines are matched to their ends in recording order.

Positions are approximate, in ring widths from the centre: radius = 10.5 - score (so a 10 sits
at 0.5, a 7 at 3.5), placed in the written direction (diagonals at 45 degrees). Arrows with no
direction have a radius but no x/y.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np

_ARROW = re.compile(r"^(t|x|m|10|[0-9])([hcl])?([lcr])?$", re.I)


def parse(text: str) -> list[dict]:
    """[{end, block, arrows: [{score, vert, horiz, raw}]}] in file order."""
    ends, block = [], 1
    for line in text.splitlines():
        s = line.strip().lower()
        if not s or "=" in s:
            continue
        if set(s) <= set("-_ "):
            block += 1
            continue
        arrows = []
        for tok in s.split():
            m = _ARROW.match(tok)
            if not m:
                raise ValueError(f"can't read arrow {tok!r} in line {line!r}")
            v = m.group(1)
            score = 10 if v in ("t", "x", "10") else 0 if v == "m" else int(v)
            arrows.append(dict(score=score, vert=m.group(2), horiz=m.group(3), raw=tok, x_ring=(v == "x")))
        ends.append(dict(end=len(ends) + 1, block=block, arrows=arrows))
    return ends


def position(a: dict) -> tuple[float, float, float]:
    """(radius, x, y) in ring widths; x/y are NaN without a direction (x right +, y up +)."""
    r = 10.5 - a["score"] if a["score"] > 0 else 11.0
    dx = {"l": -1, "c": 0, "r": 1}.get(a["horiz"] or "", None)
    dy = {"l": -1, "c": 0, "h": 1}.get(a["vert"] or "", None)
    if dx is None and dy is None:
        return r, np.nan, np.nan
    dx, dy = dx or 0, dy or 0
    n = np.hypot(dx, dy)
    return (r, 0.0, 0.0) if n == 0 else (r, r * dx / n, r * dy / n)


def score_file(session: Path, archer: str, n_archers: int) -> Path | None:
    for f in (Path(session) / f"arrows-{archer}.txt", Path(session) / "arrows.txt"):
        if f.exists() and (f.name != "arrows.txt" or n_archers == 1):
            return f
    return None


def attach(df, session: Path):
    """Add score / radius / x / y / block / end_scored columns to the insights shot table
    (rows: archer, end (1-based recording order), shot). Unmatched rows stay NaN."""
    import pandas as pd
    df = df.copy()
    for c in ("score", "ring_r", "hit_x", "hit_y", "block"):
        df[c] = np.nan
    archers = sorted(df["archer"].unique())
    for a in archers:
        f = score_file(session, a, len(archers))
        if f is None:
            continue
        ends = parse(f.read_text(encoding="utf-8"))
        mine = df[df.archer == a]
        n_vid = int(mine["end"].max()) if len(mine) else 0
        if n_vid != len(ends):
            print(f"  scores: {f.name} has {len(ends)} ends but {a} has {n_vid} recorded ends - "
                  f"matching the first {min(n_vid, len(ends))} in order")
        for e in ends[:n_vid]:
            rows = mine[mine["end"] == e["end"]].sort_values("shot")
            if len(rows) != len(e["arrows"]):
                print(f"  scores: end {e['end']}: {len(e['arrows'])} arrows written, {len(rows)} shots "
                      f"found - left unmatched")
                continue
            for (i, _), arr in zip(rows.iterrows(), e["arrows"]):
                r, x, y = position(arr)
                df.loc[i, ["score", "ring_r", "hit_x", "hit_y", "block"]] = [arr["score"], r, x, y, e["block"]]
    return df
