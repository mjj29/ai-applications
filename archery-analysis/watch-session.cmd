@echo off
rem Drag a session folder (one subfolder per archer) onto this file, or run:
rem   watch-session.cmd "C:\path\to\session" [extra options]
setlocal
cd /d "%~dp0"
set "SESSION=%~1"
if "%SESSION%"=="" set /p "SESSION=Session folder: "
if not exist ".venv\Scripts\python.exe" (
  echo Not set up yet - run setup.cmd first.
  pause
  exit /b 1
)
echo Watching for new ends (fast previews). Leave this window open; Ctrl+C to stop.
".venv\Scripts\python.exe" -m archery.cli watch "%SESSION%" %2 %3 %4 %5 %6
pause
