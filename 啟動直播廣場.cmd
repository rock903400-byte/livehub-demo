@echo off
setlocal
title LiveHub local server
cd /d "%~dp0"

set PORT=8777
set PAGE=live-wall-xhs.html

where python >nul 2>nul
if errorlevel 1 goto nopython

start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:%PORT%/%PAGE%"

echo.
echo   LiveHub is starting...
echo.
echo   Main page : http://localhost:%PORT%/%PAGE%
echo   Dark wall : http://localhost:%PORT%/live-wall.html
echo   Product   : http://localhost:%PORT%/index.html
echo.
echo   The browser will open automatically.
echo   To stop: close this window, or press Ctrl+C.
echo.
echo   ------------------------------------------------------------
echo.

python -m http.server %PORT% --bind 127.0.0.1
goto end

:nopython
echo.
echo   Python not found on PATH. Cannot start the local server.
echo.
pause

:end
