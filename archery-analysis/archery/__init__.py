"""Archery shot-analysis pipeline.

Turns raw "end" videos (each ~6 arrows) into release-aligned, body-normalized
pose tracks so shot execution can be overlaid and compared across shots and archers.

Stages (see the matching modules):
  1. extract_pose - per-frame body/hand landmarks; lock onto the nearest archer
  2. segment      - find the ~6 shots and the release frame in each (pose + clicker audio)
  3. normalize    - center/scale on the body; reindex time so release == t0
  4. clip         - cut single-shot segments with padding (ffmpeg)
  5. compare      - overlay skeletons/tracks, plot joint angles, highlight deviations
"""

__version__ = "0.1.0"
