@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22 或更新版本。
  pause
  exit /b 1
)
if not exist node_modules\vitepress\bin\vitepress.js (
  call npm.cmd ci
  if errorlevel 1 (
    echo 依赖安装失败，请检查 npm 网络连接。
    pause
    exit /b 1
  )
)
echo 文档地址：http://127.0.0.1:4173
echo 请保持本窗口运行。按 Ctrl+C 停止。
call npm.cmd run dev
if errorlevel 1 (
  echo 启动失败。如果端口已占用，请检查是否已启动本站。
  pause
)
