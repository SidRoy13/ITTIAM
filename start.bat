@echo off
REM One-click launcher for the Auction House site.
set "PATH=%ProgramFiles%\nodejs;%PATH%"
cd /d "%~dp0"
echo Starting Auction House on http://localhost:3000 ...
node server.js
pause
