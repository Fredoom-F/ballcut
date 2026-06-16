@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\package-codex-config.ps1" %*

