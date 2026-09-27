@echo off
setlocal
cd /d "%~dp0"

PowerShell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-client-connector.ps1" %*
if errorlevel 1 (
  echo.
  echo The local connector could not be started. Node.js 22 or later is required on this employee computer.
  pause
  exit /b 1
)

pause
endlocal
