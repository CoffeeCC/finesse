# Build Finesse and ship it to the TrueNAS nginx app.
# Usage: .\deploy\deploy.ps1   (from anywhere)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "Building..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Write-Host "Shipping dist/ to truenas..." -ForegroundColor Cyan
# Replace CONTENTS only — deleting the dist dir itself breaks the container's
# bind mount (it keeps the old inode) and serves an empty root until restart.
bash -lc "cd '$($root -replace '\\','/' -replace 'C:','/c')' && tar -czf - dist | ssh truenas 'rm -rf /mnt/HDDs/Applications/finesse/dist/* && tar -xzf - -C /mnt/HDDs/Applications/finesse'"

Write-Host "Done. Live at http://192.168.1.121:30500 (hashed assets bust caches automatically)" -ForegroundColor Green
