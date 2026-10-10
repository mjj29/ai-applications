# Windows setup: virtualenv + Python deps + MediaPipe models (no admin rights needed).
# Run from this folder with:   powershell -ExecutionPolicy Bypass -File setup.ps1
# (or double-click setup.cmd). Needs 64-bit Python 3.10-3.13 from python.org.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Pick a Python: the py launcher's newest supported version, else whatever `python` is.
$py = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($v in "3.12", "3.13", "3.11", "3.10") {
        & py "-$v" -c "import sys" 2>$null
        if ($LASTEXITCODE -eq 0) { $py = @("py", "-$v"); break }
    }
}
if (-not $py -and (Get-Command python -ErrorAction SilentlyContinue)) { $py = @("python") }
if (-not $py) {
    Write-Host "Python not found. Install Python 3.12 (64-bit) from https://www.python.org/downloads/windows/"
    Write-Host "and tick 'Add python.exe to PATH', then run this again."
    exit 1
}
$pyExe = $py[0]; $pyArgs = @($py | Select-Object -Skip 1)
Write-Host ">> Python: $(& $pyExe @pyArgs --version)"

if (-not (Test-Path .venv)) { & $pyExe @pyArgs -m venv .venv }
$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

Write-Host ">> Installing Python dependencies into .venv"
& $venvPy -m pip install --upgrade pip
& $venvPy -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host ">> Downloading MediaPipe model files into models\"
New-Item -ItemType Directory -Force models, data, output | Out-Null
$base = "https://storage.googleapis.com/mediapipe-models"
$models = @{
    "models\pose_landmarker_heavy.task" = "$base/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
    "models\pose_landmarker_full.task"  = "$base/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
    "models\hand_landmarker.task"       = "$base/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
}
foreach ($dest in $models.Keys) {
    if (Test-Path $dest) { Write-Host "   exists: $dest"; continue }
    Write-Host "   downloading: $dest"
    Invoke-WebRequest -Uri $models[$dest] -OutFile $dest -UseBasicParsing
}

Write-Host ">> Checking the install"
& $venvPy -c "import mediapipe, cv2, librosa, dtaidistance, imageio_ffmpeg; print('   ok: mediapipe', mediapipe.__version__, '| ffmpeg', imageio_ffmpeg.get_ffmpeg_exe())"
if ($LASTEXITCODE -ne 0) { throw "import check failed" }

Write-Host ""
Write-Host ">> Done. Drag a session folder onto watch-session.cmd (during capture) or"
Write-Host "   analyse-session.cmd (full analysis afterwards). See README 'Windows'."
