# Archery analysis: notes for Claude

This folder is a CPU-only pose-analysis pipeline for recurve archers (MediaPipe, OpenCV,
librosa). Matt drives it from Claude on a Windows laptop that is also recording the session.
README.md explains the outputs and design; config.yaml holds every tunable.

## Setup (once per machine, Windows)

- Needs 64-bit Python 3.10–3.13 (3.12 preferred). Run `setup.cmd`, or
  `powershell -ExecutionPolicy Bypass -File setup.ps1`. It creates `.venv`, installs
  requirements.txt, downloads the models into `models\` and ends with an import check.
- Run everything as `.venv\Scripts\python.exe -m archery.cli ...` from this folder.
- Set `watch.incoming` in config.yaml to the folder the recorder saves into. Ask Matt which
  recorder he's using if you can't tell (Windows Camera saves to `Pictures\Camera Roll`, OBS to
  `Videos`). Use forward slashes or single quotes in YAML.

## A session

1. Make a session folder, e.g. `sessions\2026-10-11`. Results go inside it, under `_quick\`
   (in-session) and `_analysis\` (full run).
2. **Shooting spot.** Once the camera is in place and the first recording exists, run
   `spot <recording> --session <session>`, look at `<session>\_analysis\spot.png` (read the
   image), and choose the person standing on the shooting position. Then run
   `spot <recording> --session <session> --pick N`. Re-run this if the camera moves.
3. **During the session**, start the watcher as a background process and leave it running:
   `watch <session>`. Each new recording in the incoming folder is identified by appearance
   (clothing colours and body proportions of whoever is on the spot), moved into
   `<session>\<Pseudonym>\` (Kestrel, Heron, ...), and processed with the fast profile
   (about 1.5x the video's length). Each archer's `_quick\<name>\report.md` is then refreshed.
   Recordings already in the incoming folder when the watcher starts are ignored; use
   `sort <session>` to file those.
4. **Afterwards**, run `session <session>` for the full-accuracy run (heavy model, about 7x the
   video's length, so it can take hours). Start at `<session>\_analysis\index.md`.

## Who's who

- `who <session>` lists each pseudonym's ends and a matrix of appearance distances
  (same person if below `identify.match_threshold`, 0.42).
- The watcher prints `?? A and B look alike` when two pseudonyms are probably one person.
  Confirm with Matt (or check a frame of each) before running `merge <session> B A`.
- `rename <session> Kestrel Alice` gives a pseudonym a real name, but only when Matt asks.
  The pseudonyms are deliberate.
- `move <session> <video file> <archer>` fixes an end that was filed under the wrong archer.
- These commands carry over the existing results and rebuild the affected reports. Run them
  between ends, or with the watcher stopped, to avoid racing it.

## Checking results

- Always look at each end's `<stem>.segment.png` first: the red lines should sit on the
  releases. The `expected_shots` warning is only a hint (indoor ends are 3 arrows; set it in
  `session.yaml`).
- "no shots detected" usually means the archer isn't inside the spot box. Check `spot.png`.
- A PermissionError while refreshing a report means a result video is open in a player
  (Windows locks open files). The report retries after the next end.
- Pose extraction is CPU-only on purpose: the GPU delegate corrupted landmarks on the
  development machine.

## Code

`archery/` is one module per stage (see README "Project layout"); `session.py` handles session
folders, watch, sort, merge and move; `identify.py` handles appearance signatures and matching.
This code is mirrored from Matt's Linux dev copy (`~/archery-videos`) into
github.com/mjj29/ai-applications under `archery-analysis/`. If you change code here, commit
and push it so the copies don't drift.
