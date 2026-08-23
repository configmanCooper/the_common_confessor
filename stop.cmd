@echo off
REM Stop The Common Confessor and reclaim the GPU memory its model was holding.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
