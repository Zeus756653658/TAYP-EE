@echo off
title TAYP EE - Web POS & Business Suite
color 0b

echo =======================================================
echo          TAYP EE - Web Point of Sale (POS)
echo     Next-Gen Web Edition with 5:00 PM Auto-Maintenance
echo =======================================================
echo.

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [SETUP] Initializing virtual environment...
    python -m venv .venv
    echo [SETUP] Installing dependencies...
    .\.venv\Scripts\pip.exe install -r requirements.txt
)

echo [STARTING] Launching Web POS Server on http://127.0.0.1:8080 ...
echo [MAINTENANCE] Scheduled Daily 5:00 PM Maintenance Active.
echo.

:: Open Browser automatically in 2 seconds
start "" timeout /t 2 /nobreak >nul & start http://127.0.0.1:8080

:: Run backend FastAPI server
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8080 --reload

pause
