@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-codex-config.ps1" -TargetPath %*

