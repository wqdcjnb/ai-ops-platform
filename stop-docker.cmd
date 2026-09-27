@echo off
setlocal
cd /d "%~dp0"

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-docker.ps1"
if errorlevel 1 (
  echo.
  echo AI OPS could not be stopped cleanly. Read the message above.
  pause
  exit /b 1
)

endlocal
