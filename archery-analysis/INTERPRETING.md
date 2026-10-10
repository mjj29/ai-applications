# How to read your archery analysis

Open this file in VS Code's **Markdown preview** (Ctrl/Cmd-Shift-V) so the images show.
Examples below use the first end, `PXL_20260628_084843741.TS`.

## The mental model (three ideas)

1. **Release = time 0.** Every shot is lined up on the instant of the loose. Times before
   release are negative (`-2.0s` = two seconds before the shot goes), after are positive
   (follow-through). This is why shots of different lengths can still be compared — the
   thing that matters (release) is always at 0.
2. **Body-normalized.** Each shot is re-centred on your hips and scaled by your torso
   length, so where you stood, how far from the camera, and your size are removed. What's
   left is *form* — joint angles and limb positions. Distances are in **body-lengths**
   (1 = one torso, hip-to-shoulder).
3. **Pooled.** For outlier-finding, all ~37 shots from all six ends are thrown into one
   pile, so "typical" is defined by your whole session, not one end.

## Where to start (do these in order)

1. **Did detection work?** Glance at each `…segment.png`. You should see your 6 shots.
2. **Which shots were odd, and how?** Read the `outliers` console output / `outliers.png`.
3. **See the odd shot.** Open that shot's `…overlay_release.png` and `…ghost.mp4`.
4. **Check consistency through the shot.** Look at `…angles.png`.

---

## 1. `…segment.png` — did it find your shots?

![segment](output/PXL_20260628_084843741.TS.segment.png)

**What it is:** how the tool found your shots in the raw video.
- **Top:** how high your bow hand is. The **green bands** are sustained holds = your shots.
- **Middle:** how fast your string hand is moving (spikes at the release).
- **Bottom:** the audio; **navy dots** are sharp sounds (clicker/shot), **red lines** mark
  the detected release of each shot.

**How to read it:** count the green bands — there should be one per arrow (6). Wind
let-downs (raise, then come down without shooting) appear as bumps that are *not* shaded.

**What to check:** 6 green bands, red release lines sitting at the end of each hold. If a
shot is missing or an extra one appears, that's where to look. (One end found 7 — the
extra was a let-down; see "require_audio" in the README to auto-drop those.)

---

## 2. `outliers` — which shots were atypical, and why

Run `python -m archery.cli outliers`. It prints, in plain English, the shots that least
resemble your typical form near release, e.g.:

```
0935#1 (atypicality 5.0): follow-through travel +0.7 body-lengths (usually +0.1);
        spine lean from vertical -24.8deg (usually -1.8deg); anchor height ...
```

**How to read it:** each line is one shot (`0935#1` = end starting …0935, shot 1). The
number is how unusual it was overall; then the 2–3 things most different from *your* norm,
with your usual value in brackets. So that shot leaned back ~25° (you normally stand
near-vertical) and threw the string hand much further on release.

**The heatmap** `output/outliers.png` is the same information as a grid — one row per shot
(most unusual at top), one column per measurement. **Red = more than usual, blue = less.**
A row that's mostly grey = a textbook shot; a row with strong red/blue cells = an odd one.

![outliers](output/outliers.png)

**Trust note:** the top one or two rows may be huge (saturated) — those are usually a
**tracking glitch or a non-shot**, not real form (the tool says so in the plain-English
output). The *interesting* ones are the moderate outliers below them.

**This finds unusual _form_, not bad _scores_.** If you tell me which arrows actually
scored badly, I can point at the form that goes with low scores instead — much sharper.

---

## 3. `…overlay_release.png` — spot the difference at release

![overlay](output/PXL_20260628_084843741.TS.overlay_release.png)

**What it is:** every shot's stick-figure (upper body) at the instant of release, on top of
each other. Each colour is one shot; the **thick black** figure is the average. The small
tangle at the top-centre is your **draw hand** (string hand at anchor).

**How to read it:** where the coloured lines lie on top of each other, that part of your
form is consistent. Where one colour flies off on its own, that shot did something
different. Here, one shot's bow arm (the line going right) drops at a different angle than
the rest — that's the shot to examine.

---

## 4. `…angles.png` — consistency through the whole shot

![angles](output/PXL_20260628_084843741.TS.angles.png)

**What it is:** key joint angles over time, with **0 = release** (red dashed line). Each
colour is a shot; **black** is the average; the **grey band** is the normal spread.

**How to read it:**
- **Narrow grey band = consistent;** a **wide band = inconsistent** at that moment.
- During the aim/hold (left of 0) your lines should be tight and flat — that's good. After
  release they fan out (follow-through varies naturally — less important).
- A single colour that jumps away from the pack is that shot misbehaving.

(Ignore the occasional thin spike — that's a momentary landmark mis-read, not real motion.)

---

## 5. `…tracks.png` — the path your hands take

![tracks](output/PXL_20260628_084843741.TS.tracks.png)

**What it is:** the path of your **draw wrist (○)** and **bow wrist (□)** through the shot,
one coloured line per shot, with a marker at release. Tightly-overlapping paths = repeatable
hand movement; a stray path = a shot where a hand travelled differently.

---

## 6. `…ghost.mp4` / `…ghost_release.png` — the real footage, overlaid

`ghost.mp4` is the **animation** — play it (any video player or VS Code). It's your actual
footage from every shot in the end, lined up on your body and blended together, playing
from the draw through the release. `ghost_release.png` is just one frozen frame of it (the
release instant).

**How to read it:** parts that stay **sharp** are where every shot was identical; parts that
**blur or double** are where shots differed. The background blurs because the tool pins your
*body*, not the scene — that's expected. This is the qualitative "do my shots look the same"
view; the plots above are the precise version.

---

## Glossary

- **t = 0 / release** — the instant the arrow leaves; everything is timed from here.
- **body-lengths** — distance in units of your torso (hip→shoulder); removes camera distance.
- **atypicality / z / σ** — how far from your own normal a shot is. ~1 = normal scatter,
  3 = clearly unusual, 20+ = almost certainly a measurement glitch, not real form.
- **hold** — sustained full draw; how the tool tells a real shot from a wind let-down.
