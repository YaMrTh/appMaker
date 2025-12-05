@echo off
REM ===========================
REM  Start local SOWELL app
REM ===========================

REM 1) Go to the folder where this .bat file lives
cd /d "%~dp0"

REM 2) Optional: show where we are
echo Working directory: %cd%

REM 3) Open the browser to the app URL (in background)
start "" "http://localhost:3000"

REM 4) Start the Node server (this will keep the window open)
echo Starting Node server...
node backend\server.js

REM 5) If node exits, pause so you can read any error
echo.
echo Server stopped. Press any key to close this window.
pause >nul
