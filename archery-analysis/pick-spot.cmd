@echo off
rem Drag a session folder (one subfolder per archer) onto this file, or run:
rem   pick-spot.cmd "C:\path\to\session" [extra options]
setlocal
cd /d "%~dp0"
set "SESSION=%~1"
if "%SESSION%"=="" set /p "SESSION=Session folder: "
if not exist ".venv\Scripts\python.exe" (
  echo Not set up yet - run setup.cmd first.
  pause
  exit /b 1
)
echo Detecting people in a frame to choose the shooting spot.
".venv\Scripts\python.exe" -m archery.cli spot "%SESSION%" %2 %3 %4 %5 %6
pause
