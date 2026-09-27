@echo off
setlocal
cd /d "%~dp0"

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-docker.ps1" %*
if errorlevel 1 (
  echo.
  echo AI OPS failed to start. Read the message above, then try again.
  pause
  exit /b 1
)

endlocal
