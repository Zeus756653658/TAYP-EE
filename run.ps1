# TAYP EE - Web POS Launcher (PowerShell)
$Host.UI.RawUI.WindowTitle = "TAYP EE - Web POS & Business Suite"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "         TAYP EE - Web Point of Sale (POS)" -ForegroundColor Yellow
Write-Host "    Next-Gen Web Edition with 5:00 PM Auto-Maintenance" -ForegroundColor White
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "[SETUP] Initializing virtual environment..." -ForegroundColor Yellow
    python -m venv .venv
    Write-Host "[SETUP] Installing dependencies..." -ForegroundColor Yellow
    .\.venv\Scripts\pip.exe install -r requirements.txt
}

Write-Host "[STARTING] Launching Web POS Server on http://127.0.0.1:8080 ..." -ForegroundColor Green
Write-Host "[MAINTENANCE] Scheduled Daily 5:00 PM Maintenance Active." -ForegroundColor Magenta
Write-Host ""

# Launch Browser
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://127.0.0.1:8080"
} | Out-Null

# Run Server
& .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8080 --reload
