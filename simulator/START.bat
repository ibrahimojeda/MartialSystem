@echo off
title MartialSystem Simulator - Port 8011
echo.
echo ========================================
echo   MartialSystem Simulator
echo   Dashboard: http://localhost:8011
echo ========================================
echo.
cd /d "%~dp0"
node server.js
pause