@echo off
chcp 65001 >nul
title 剪球本地服务
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装 Node.js 后再运行。
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/health' -TimeoutSec 1; if ($r.status -eq 'ok') { exit 0 } } catch { exit 1 }"
if not errorlevel 1 (
  echo 剪球已经在运行：http://127.0.0.1:4173/
  start "" "http://127.0.0.1:4173/"
  pause
  exit /b 0
)

echo 正在启动剪球...
start "" "http://127.0.0.1:4173/"
node app\server.js

echo.
echo 剪球服务已经停止。上方如有错误信息，请保留窗口内容。
pause
