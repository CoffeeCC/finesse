# Build Finesse and ship it to the TrueNAS nginx app.
# Usage: .\deploy\deploy.ps1   (from anywhere)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "Building..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed" }

Write-Host "Shipping dist/ to truenas..." -ForegroundColor Cyan
# Two gotchas this avoids:
#  1) Deleting the dist dir itself breaks the container's bind mount (it keeps
#     the old inode and serves an empty root until a restart) — so we only ever
#     replace CONTENTS of dist, never the dir.
#  2) The dataset uses NFSv4 ACLs, so tar extracting straight into it spams
#     "Cannot change mode ... Operation not permitted" and exits non-zero even
#     though file content writes fine. So we stage in /tmp (normal perms) then
#     `cp` over — cp truncates+writes existing files (no chmod) and new files
#     inherit the dir's ACL. Clean, idempotent, inode-preserving.
$posix = $root -replace '\\','/' -replace '^C:','/c'
bash -lc "cd '$posix' && tar -C dist -czf - . | ssh truenas 'rm -rf /tmp/finesse-stage && mkdir -p /tmp/finesse-stage && tar -xzf - -C /tmp/finesse-stage && mkdir -p /mnt/HDDs/Applications/finesse/dist && cp -rf /tmp/finesse-stage/. /mnt/HDDs/Applications/finesse/dist/ && rm -rf /tmp/finesse-stage && echo DEPLOY_OK'"
if ($LASTEXITCODE -ne 0) { throw "deploy failed" }

Write-Host "Done. LAN http://192.168.1.121:30500  |  Funnel https://truenas-scale.taild65e2.ts.net:8444" -ForegroundColor Green
