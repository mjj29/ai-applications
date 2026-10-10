@echo off
rem Drag a session folder (one subfolder per archer) onto this file, or run:
rem   analyse-session.cmd "C:\path\to\session" [extra options]
setlocal
cd /d "%~dp0"
set "SESSION=%~1"
if "%SESSION%"=="" set /p "SESSION=Session folder: "
if not exist ".venv\Scripts\python.exe" (
  echo Not set up yet - run setup.cmd first.
  pause
  exit /b 1
)
echo Full-accuracy analysis of every archer in the session (slow).
".venv\Scripts\python.exe" -m archery.cli session "%SESSION%" %2 %3 %4 %5 %6
pause
