@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  copy /Y "docker-compose.env.example" ".env" >nul
  echo 已创建 .env，请在正式使用前修改 AUTH_ADMIN_PASSWORD。
)

where docker-compose >nul 2>&1
if %errorlevel%==0 (
  docker-compose up -d --build
) else (
  docker compose up -d --build
)

if errorlevel 1 (
  echo Docker 启动失败，请确认 Docker Desktop 已启动。
  pause
  exit /b 1
)

start "" "http://127.0.0.1:4174/"
echo AI OPS 已启动：http://127.0.0.1:4174/
