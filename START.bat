@echo off
setlocal

REM Always run from this script folder (project root)
cd /d "%~dp0"

echo ==============================================
echo MartialSystem - Server Start
echo Root: %CD%
echo ==============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install Node.js and try again.
  pause
  exit /b 1
)

if not exist "server\index.js" (
  echo [ERROR] Could not find server\index.js in this folder.
  echo Make sure START.bat is inside the MartialSystem root.
  pause
  exit /b 1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":8010 .*LISTENING"') do (
  set "PID8010=%%P"
)

if defined PID8010 (
  echo [INFO] Port 8010 is busy by PID %PID8010%. Attempting to stop it...
  taskkill /PID %PID8010% /F >nul 2>&1
  if errorlevel 1 (
    echo [WARN] Could not stop PID %PID8010% automatically. Try Run as Administrator.
  ) else (
    echo [OK] Port 8010 released.
  )
  echo.
)

echo [INFO] Starting server...
node server\index.js

echo.
echo [INFO] Server stopped. Press any key to close.
pause >nul
