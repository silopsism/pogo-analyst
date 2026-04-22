$ErrorActionPreference = "Stop"

Write-Host "Stopping stale Node processes..." -ForegroundColor Cyan
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Rebuilding app bundle..." -ForegroundColor Cyan
npm.cmd run build

Write-Host "Starting local dev server..." -ForegroundColor Cyan
npm.cmd run dev
