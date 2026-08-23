@echo off
REM Start The Common Confessor: local model, game server, and browser.
REM Pass-through options, for example:  start.cmd -ContextSize 16384 -NoBrowser
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 (
  echo.
  echo Startup failed. See the message above.
  pause
)
