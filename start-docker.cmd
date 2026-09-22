@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  copy /Y "docker-compose.env.example" ".env" >nul
  echo Created .env.
)
if not exist "deploy\cpa\config.yaml" (
  copy /Y "deploy\cpa\config.example.yaml" "deploy\cpa\config.yaml" >nul
  echo Created deploy\cpa\config.yaml from the safe template. Replace its placeholder CPA keys for a fresh install.
)
if not exist "deploy\cpa\.env" (
  copy /Y "deploy\cpa\.env.example" "deploy\cpa\.env" >nul
  echo Created deploy\cpa\.env from the safe template. Replace its placeholder CPA keys for a fresh install.
)
if not exist "deploy\cpa\auths" mkdir "deploy\cpa\auths" >nul 2>&1
if not exist "deploy\cpa\logs" mkdir "deploy\cpa\logs" >nul 2>&1
if not exist "deploy\cpa\plugins" mkdir "deploy\cpa\plugins" >nul 2>&1
if not exist "deploy\cpa\static" mkdir "deploy\cpa\static" >nul 2>&1
if not exist "deploy\new-api\.env" (
  copy /Y "deploy\new-api\.env.example" "deploy\new-api\.env" >nul
  echo Created deploy\new-api\.env from the safe template. Set a persistent SESSION_SECRET before production use.
)
if not exist "deploy\new-api\data" mkdir "deploy\new-api\data" >nul 2>&1
if not exist "deploy\new-api\logs" mkdir "deploy\new-api\logs" >nul 2>&1

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

start "" "http://127.0.0.1:4174/"
echo AI OPS + CPA + New API started: http://127.0.0.1:4174/
