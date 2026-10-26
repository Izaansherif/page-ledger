@echo off
title Page Ledger - leave this black window open
cd /d "%~dp0"
echo.
echo  Starting Page Ledger...
echo  Opening http://localhost:8888 in your browser.
echo  KEEP THIS WINDOW OPEN while using the app.
echo.
start "" http://localhost:8888
node dev-server.js
echo.
echo The app stopped. Read any message above, then press a key to close.
pause >nul
