@echo off
chcp 65001 >nul
title 剪球环境安装
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请先安装 Node.js 18 或更高版本。
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo 未找到 Python。请先安装 Python 3.10 或更高版本。
  pause
  exit /b 1
)

echo 正在安装剪球本地分析依赖...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo 依赖安装失败，请检查网络或 Python pip 配置。
  pause
  exit /b 1
)

python -c "import cv2,numpy; print('OpenCV',cv2.__version__,'NumPy',numpy.__version__)"
echo.
echo 环境已经就绪。现在可以双击 start-jianqiu.cmd。
pause
