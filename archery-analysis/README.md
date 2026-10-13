# Archery shot analysis

Turn raw "end" videos (each ~6 arrows) into **release-aligned, body-normalized pose
tracks** so shot execution can be overlaid and compared — across your own shots and,
later, across different archers.

> Status: **implemented and run end-to-end on the six sample videos.** Stages 1–5 work
> (see Usage). Tuned for a recurve archer who holds at full draw with a clicker; the
> tunables in `config.yaml` adapt it to other archers/footage.
>
> **New to the outputs? Read [INTERPRETING.md](INTERPRETING.md)** — a plain-English guide
> to every chart (open it in VS Code's Markdown preview so the images show).

## What it does (mapped to the original goals)

| Goal | Stage / module |
|------|----------------|
| Find the start/end of each shot | `archery/segment.py` |
| Cut into single-shot segments, dropping the gaps | `archery/clip.py` |
| Align each shot so identical shots line up | `archery/normalize.py` |
| Pose detection — arm/hand/body position and tracks | `archery/extract_pose.py` |
| Overlay shots to spot differences | `archery/compare.py` |
| Highlight differences in execution | `archery/compare.py` |

## Key design decisions

- **Release is t = 0.** Shots vary in length (especially fighting the wind), but the
  release is the moment that matters, so every clip is aligned on the release frame —
  negative time = draw/aim, 0 = release, positive = follow-through.
- **The clicker is the release marker.** This is a recurve setup with a clicker, so the
  click is a sharp audio transient just before loose. Audio onset detection pinpoints
  it far more precisely than vision alone.
- **One archer at a time.** Several people may be in frame. Outdoors the closest one (largest
  body) is tracked; indoors, whoever stands on the configured shooting spot (`archer.select: spot`).
- **Other archers' clicks are rejected.** An audio onset is only accepted as *your*
  release when it coincides with *your* pose-confirmed release motion (release hand
  snapping back). Being closest, your click is also the loudest.
- **Body-relative normalization = reusable.** Landmarks are re-expressed relative to
  your own body (origin at hip centre, scaled by torso length), which makes the data
  camera- and archer-independent — the reason this works on other archers later.
- **DTW for the variable phase.** Dynamic time warping aligns the differently-timed
  draw/aim phases by shape while keeping the release pinned at t = 0.

## Club / indoor sessions with several archers

For a fixed camera on one shooting spot, with archers taking turns:

1. **One folder per session, one subfolder per archer.** Save each end into the archer's
   folder (one video = one end):

   ```
   2026-10-11/
     Alice/   WIN_20261011_19_30_12_Pro.mp4  ...
     Bob/     ...
   ```

2. **Tell it where the shooting spot is** (once per session, after the first video is in):

   ```bash
   python -m archery.cli spot 2026-10-11            # writes 2026-10-11/_analysis/spot.png
   python -m archery.cli spot 2026-10-11 --pick 1   # save person 1's box to session.yaml
   ```

   The picture numbers everyone detected, with a green box around each person's torso. Pick
   the archer on the shooting spot. From then on only someone whose torso centre is inside that
   box is tracked, so people waiting behind the line or shooting on neighbouring targets are ignored
   even when they're closer to the camera. Use `--at SECONDS` to grab a different moment.
   Don't move the camera after this; if you do, re-run `spot`. Frame the shooter from at least
   the hips up, because hips anchor both the spot and the body normalization.

   **Recordings straight from the recorder's folder.** Set `watch.incoming` in `config.yaml`
   to the folder your recorder saves into. The watcher then identifies who is on the spot in
   each new recording, from their clothing colours and body proportions, and files it under a
   pseudonym (`Kestrel/`, `Heron/`, ...), reusing the same pseudonym on later ends. Use
   `who <session>` to see the pseudonyms and how alike they look, `rename <session> Kestrel Alice`
   to name one, `merge <session> Heron Kestrel` when one archer was split in two (e.g. after a
   lighting change), and `move <session> <video> <archer>` to fix a single end. `sort <session>`
   files recordings that were already in the folder. To set the spot from a recording that is
   still in the incoming folder, use `spot <recording> --session <session>`.

3. **During the session**, leave this running. Each end is processed (fast profile: about 1.6x
   the video's length on the i7-10510U capture laptop) as soon as its file is complete:

   ```bash
   python -m archery.cli watch 2026-10-11           # results in 2026-10-11/_quick/
   ```

   The first thing ready is the part to show the archer: their shots cut into clips, then all of
   an end's shots overlaid and body-aligned on the release (the "ghost"). Open
   `_quick/index.html` in a browser and click the archer: `shots.html` plays every shot they've
   shot so far, newest end first. Ends are taken one at a time, oldest first, and each archer's
   slower report (`report.md`: outliers, most vs least typical) is rebuilt only once no other
   end is waiting.

   Recordings can be `.mp4`, `.mov`, `.mkv`, `.avi`, `.m4v` or `.wmv`.

4. **Afterwards**, run the full-accuracy analysis (heavy model, every frame, hand detail,
   roughly 7x the video's length, so leave it running overnight for a big session):

   ```bash
   python -m archery.cli session 2026-10-11         # results in 2026-10-11/_analysis/
   python -m archery.cli session 2026-10-11 --archer Alice   # just one archer
   ```

Start at `_analysis/index.md` (or `_quick/index.md`), which has one row per archer linking
their `report.md` (`index.html` alongside links each archer's `shots.html`). Each archer is analysed only against their own shots. "Typical" and
"outlier" are never judged across archers.

Settings layer as `config.yaml` <- `<session>/session.yaml` <- `<session>/<archer>/archer.yaml`
<- profile. See [`session.example.yaml`](session.example.yaml): it sets indoor ends to 3 arrows
and holds the spot. A left-handed archer would get `archer: {handedness: left}` in their
`archer.yaml`. The `fast` profile used by `watch` is defined under `profiles:` in `config.yaml`.

Recording tips: record at a constant frame rate (phones and the Windows Camera app do; some
screen-capture tools don't), with sound on, because the clicker click confirms each shot. Indoors
the neighbours' clickers are also audible. That's fine: a click only counts when it lines up
with the tracked archer's own release.

## Windows (capture laptop)

1. Install **64-bit Python 3.12** from python.org and tick *Add python.exe to PATH*.
2. Get this folder (e.g. `git clone https://github.com/mjj29/ai-applications` and use the
   `archery-analysis` folder), then double-click **`setup.cmd`**. It creates `.venv`,
   installs the requirements and downloads the models. No admin rights are needed, and
   ffmpeg comes bundled via `imageio-ffmpeg`.
3. Drag the session folder onto:
   - **`pick-spot.cmd`**: shows who's in frame. Then run `pick-spot.cmd "<folder>" --pick N`
     from a terminal to save the spot.
   - **`watch-session.cmd`**: start it when the session starts and leave the window open.
   - **`analyse-session.cmd`**: the full analysis afterwards.

   The same commands work from PowerShell as `.venv\Scripts\python.exe -m archery.cli ...`.

If a report refresh fails with a permission error, a result video is probably open in a
player (Windows locks open files). Close it and the report refreshes after the next end.

## Requirements

### System packages (need sudo — optional but recommended)

```bash
sudo apt update && sudo apt install -y ffmpeg
```

`ffmpeg` (with `ffprobe`) is used for fast clip cutting and final renders. If you skip
it, the pipeline falls back to the bundled `imageio-ffmpeg` binary automatically.
`python3-venv`/`python3-pip` are also needed if not already present.

> No `libGL`/GUI packages are required: we use `opencv-python-headless` and render to
> files rather than on-screen windows.

### Python dependencies

Pinned in [`requirements.txt`](requirements.txt). Highlights: `mediapipe` (pose/hand
landmarks), `opencv-python-headless` (frame I/O, drawing, affine warp), `librosa`
(clicker/onset detection), `scipy`/`scikit-learn`/`dtaidistance` (segmentation +
alignment), `matplotlib` (plots), `pandas`/`pyarrow` (pose tracks as Parquet).

## Install

```bash
./setup.sh            # creates .venv, installs requirements, downloads MediaPipe models
source .venv/bin/activate
```

Or manually:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# then download the two model files (see setup.sh) into models/
```

## Usage

```bash
source .venv/bin/activate
python -m archery.cli run-all                 # stages 1–5 for every video in config.yaml
# or one stage at a time (each reads the previous stage's artifacts from data/):
python -m archery.cli extract                 # 1.  body pose tracks   -> data/<stem>.pose.parquet
python -m archery.cli hands                    # 1b. hand landmarks     -> data/<stem>.hands.parquet
python -m archery.cli segment                 # 2.  shots + release    -> data/<stem>.shots.parquet + output/<stem>.segment.png
python -m archery.cli normalize               # 3.  release-aligned     -> data/<stem>.normalized.npz
python -m archery.cli clip                    # 4.  single-shot mp4s    -> output/<stem>/shot_N.mp4
python -m archery.cli compare                 # 5.  overlays + plots    -> output/<stem>.{overlay_release,angles,tracks}.png + .overlay.mp4
python -m archery.cli ghost                    # 5b. ghost overlay video -> output/<stem>.ghost.mp4 + .ghost_release.png
python -m archery.cli outliers                 #     pooled outlier scan -> output/outliers.png + data/outliers.parquet
python -m archery.cli report                   #     per-run report + 2-shot deltas -> <output.dir>/report.md
python -m archery.cli compare path/to/one.mp4 # run on specific file(s) instead of the config glob
```

`run-all` does the whole pipeline (it skips pose/hand extraction if already done). Order if
running piecemeal: `extract` → `segment` → `hands` → `normalize` → `clip`/`compare`/`ghost` →
`outliers` → `report`. `outliers` and `report` pool across every video, so run them last.

**Per-run reports to different locations.** `report` fills the top-level template
[`report_template.md`](report_template.md) with this run's results and writes a
self-contained `report.md` into `output.dir`. Point `output.dir` (in `config.yaml`) at a new
folder per run/archer and each gets its own report + images + deltas, all relatively linked.

Stage 1 is the slow part (~13 min/video on CPU at 60 fps); it skips videos already
extracted. Stages 2–5 are seconds. Always eyeball `output/<stem>.segment.png` to confirm
the shot/release detection before trusting the comparisons.

## Outputs

Per video (`<stem>` = the video filename without extension):
- `output/<stem>.segment.png` — activity signal, release-hand speed, audio onsets, and the
  detected holds/releases. Your verification plot.
- `output/<stem>.overlay_release.png` — every shot's skeleton at the release instant, plus
  the mean. Spot-the-difference at t=0.
- `output/<stem>.overlay.mp4` — the skeleton overlay animated through the **event-aligned
  timeline** (draw/hold/release/follow, DTW-synced); shots move together, an off one drifts.
- `output/<stem>.angles.png` — draw-elbow / bow-elbow / draw-shoulder angles across that
  timeline, all shots + mean ± 2 std band (band widens where you're inconsistent).
- `output/<stem>.tracks.png` — draw-hand and bow-hand paths overlaid.
- `output/<stem>.ghost.mp4` / `.ghost_release.png` — real footage of every shot, body-aligned
  and blended (onion-skin); sharp where consistent, blurred/doubled where a shot differs.
- `output/<stem>/shot_N.mp4` — each shot cut from the start of the draw through follow-through.

Across all videos:
- `<output.dir>/report.md` — **start here.** Self-contained run report: most-typical vs
  least-typical shot, each end's best-vs-worst, the ranked outlier table, and a per-end gallery,
  all linked to the images below. Open in VS Code's Markdown preview.
- `output/delta_session.delta_*` and `output/<stem>.delta_worst.delta_*` — 2-shot deltas on the
  DTW-aligned timeline: `.delta.mp4` (tinted real frames) and `.delta_wire.mp4` (skeletons), each
  with a `_release.png` still. Cyan = typical shot, red = atypical; fringes/separation = the difference.

All overlays/deltas share one **event-aligned timeline**: draw and follow-through are DTW-aligned
by actual motion, the hold is the shorter shot's (longer shots' static middle cut), release anchored;
played at `timeline.slow_factor`. Set `timeline.mode: release` for plain release-aligned real time.
- `output/outliers.png` + `data/outliers.parquet` — every shot pooled, scored for how atypical
  its release form is, with a per-shot/per-feature z-score heatmap. (Detects form outliers, not
  arrow score — supply shot scores to sharpen it.)

A shot flagged `release_source = pose` in `data/<stem>.shots.parquet` had no matching
clicker/shot audio — usually a false positive (a long hold that wasn't a real shot). The
console also ranks each shot by how far it deviates from the mean near release.

## Project layout

```
config.yaml          # all tunables (per-session / per-archer); edit this, not the code
session.example.yaml # per-session overrides for indoor/club sessions (spot, 3-arrow ends)
requirements.txt     # Python deps
setup.sh             # one-shot environment setup (venv + deps + models), Linux/macOS
setup.ps1, *.cmd     # Windows setup + drag-a-folder launchers (watch / analyse / pick spot)
models/              # MediaPipe .task model files (downloaded; gitignored)
data/                # intermediate artifacts: pose tracks, segments (gitignored)
output/              # overlay videos + plots (gitignored)
archery/
  config.py          # load config.yaml
  extract_pose.py    # stage 1 — per-frame body/hand landmarks, nearest archer
  segment.py         # stage 2 — find shots + release frame (pose + clicker audio)
  normalize.py       # stage 3 — center/scale on body; reindex time to release == t0
  clip.py            # stage 4 — cut single-shot segments (ffmpeg)
  compare.py         # stage 5 — overlay tracks, plot angles, highlight deviations
  gallery.py         # shots.html per archer (every clip + aligned ghost) and index.html
  reel.py            # <archer>.reel.mp4: all an archer's shots back to back, captioned
  insights.py        # session-wide statistics per archer (trends, consistency, comparisons)
  session.py         # per-archer session folders: batch run, watch, spot, merge/move
  identify.py        # appearance signatures: which archer is this end?
  cli.py             # `python -m archery.cli <stage>`
```

Each stage reads/writes intermediate files under `data/`, so reruns are cheap and you
can inspect/tune one stage at a time.

## Reuse on new videos / other archers

For several archers, use a session folder (see *Club / indoor sessions* above). For a
one-off set of videos, point `input.videos` in `config.yaml` at the new files and rerun. Because pose data is
normalized to the body, comparisons across archers are meaningful. Per-archer settings
(handedness, which person to track) live in the `archer:` block.

## Dependency licenses (all permissive — safe to reuse/distribute)

| Library | License |
|---------|---------|
| MediaPipe | Apache-2.0 |
| OpenCV (opencv-python-headless) | Apache-2.0 |
| NumPy / SciPy / pandas / scikit-learn / matplotlib | BSD |
| librosa | ISC |
| dtaidistance | Apache-2.0 |
| PyYAML | MIT |
| imageio-ffmpeg | BSD-2 (wraps an LGPL ffmpeg build, invoked as a separate binary) |

Deliberately avoided: **OpenPose** (non-commercial license) and **Ultralytics YOLO**
(AGPL-3.0) as the default pose backend.

## Troubleshooting

- **`mediapipe` install fails** — ensure pip is current (`pip install -U pip`); 0.10.35
  provides a `py3-none-manylinux_2_28` wheel that works on Python 3.13.
- **`librosa`/`numba` import error on 3.13** — onset detection can fall back to a pure
  SciPy implementation; raise an issue/ask and we'll switch the audio stage over.
- **`cv2` import error about `libGL`** — you installed full `opencv-python`; use
  `opencv-python-headless` (as pinned) or `sudo apt install -y libgl1`.
