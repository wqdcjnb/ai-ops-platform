@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  copy /Y "docker-compose.env.example" ".env" >nul
  echo Created .env.
)
where docker-compose >nul 2>&1
if %errorlevel%==0 (
  docker-compose up -d --build
) else (
  docker compose up -d --build
)

if errorlevel 1 (
  echo Docker startup failed. Make sure Docker Desktop is running.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-workbuddy-connector.ps1"
if errorlevel 1 (
  echo Warning: AI OPS local client connector could not start. Direct Codex and WorkBuddy import will be unavailable until this is resolved.
) else (
  echo AI OPS local client connector is ready.
)

start "" "http://127.0.0.1:4174/"
echo AI OPS unified model gateway started: http://127.0.0.1:4174/
