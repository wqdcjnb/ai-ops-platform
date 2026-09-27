@echo off
setlocal
cd /d "%~dp0"

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup-docker.ps1"
if errorlevel 1 (
  echo.
  echo AI OPS backup failed. Read the message above.
  pause
  exit /b 1
)

endlocal
