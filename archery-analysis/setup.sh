#!/usr/bin/env bash
# Set up the archery analysis project: virtualenv + Python deps + MediaPipe models.
# Nothing here needs root. System ffmpeg (optional but recommended) is a separate
# step that DOES need sudo — see the note at the end and the README.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"
VENV=".venv"

echo ">> Python: $("$PYTHON" --version)"
[ -d "$VENV" ] || "$PYTHON" -m venv "$VENV"

echo ">> Installing Python dependencies into $VENV"
"$VENV/bin/pip" install --upgrade pip
"$VENV/bin/pip" install -r requirements.txt

echo ">> Downloading MediaPipe model files into models/"
mkdir -p models
fetch() { # url dest
  if [ -f "$2" ]; then echo "   exists: $2"; return; fi
  echo "   downloading: $2"
  if command -v curl >/dev/null 2>&1; then curl -fSL "$1" -o "$2"; else wget -O "$2" "$1"; fi
}
BASE="https://storage.googleapis.com/mediapipe-models"
fetch "$BASE/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task" "models/pose_landmarker_heavy.task"
fetch "$BASE/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"   "models/pose_landmarker_full.task"
fetch "$BASE/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"                    "models/hand_landmarker.task"

mkdir -p data output

echo
echo ">> Done. Activate the environment with:"
echo "     source $VENV/bin/activate"
echo
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo ">> NOTE: system 'ffmpeg' not found. For best final-render speed/quality run:"
  echo "     sudo apt update && sudo apt install -y ffmpeg"
  echo "   Otherwise the bundled imageio-ffmpeg binary is used automatically."
fi
