@echo off
REM Keeps https://beardoauction.loca.lt alive: auto-reconnects if localtunnel drops
REM and keeps re-requesting the "beardoauction" subdomain until it's granted.
REM Start the server first (start.bat), then run this in a second window.
set "PATH=%ProgramFiles%\nodejs;%PATH%"
:loop
echo [%date% %time%] Connecting tunnel (requesting beardoauction)...
lt --port 3000 --subdomain beardoauction
echo [%date% %time%] Tunnel dropped. Reconnecting in 3s... (Ctrl+C to stop)
timeout /t 3 /nobreak >NUL
goto loop
