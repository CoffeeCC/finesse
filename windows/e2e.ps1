# The whole Windows install, for real, on a Windows machine (CI): Finesse Setup installs Finesse as a service
# from a local bundle, setup runs through Finesse's own API with a Windows document (Jellyfin, Prowlarr, Radarr,
# SABnzbd and qBittorrent downloaded and started as Windows programs), the apps answer, a service restart brings
# them back, a movie can be added (Add media), and uninstalling leaves nothing running.
#
#   pwsh windows/e2e.ps1 -Setup out/FinesseSetup.exe -Bundle finesse-windows-X-x64.zip
param(
  [Parameter(Mandatory)] [string] $Setup,
  [Parameter(Mandatory)] [string] $Bundle,
  [string] $Media = 'C:\FinesseMedia'
)
$ErrorActionPreference = 'Stop'
$Setup = (Resolve-Path $Setup).Path
$Bundle = (Resolve-Path $Bundle).Path

function Say($m) { Write-Host "`n== $m" }

function Until($what, [scriptblock] $ok, [int] $seconds = 180) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) {
    try { if (& $ok) { return } } catch { }
    Start-Sleep -Seconds 3
  }
  throw "Timed out after ${seconds}s waiting for: $what"
}

function Answers($url) {
  try { $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5; return $r.StatusCode -lt 400 }
  catch { $c = $_.Exception.Response.StatusCode.value__; return $c -eq 401 -or $c -eq 403 }
}

Say 'Install (no window)'
$p = Start-Process $Setup -ArgumentList '--install', '--media', $Media, '--bundle', "`"$Bundle`"" -Wait -PassThru -RedirectStandardOutput install.out
Get-Content install.out
if ($p.ExitCode -ne 0) { throw "Finesse Setup exited with $($p.ExitCode)" }
$res = (Get-Content install.out | Select-Object -Last 1 | ConvertFrom-Json).result
$port = $res.port
$code = $res.code
Write-Host "Finesse $($res.version) on port $port, setup code: $([bool]$code)"
if ((Get-Service Finesse).Status -ne 'Running') { throw 'The Finesse service isn''t running' }
if (-not (Answers "http://localhost:$port/api/health")) { throw 'Finesse isn''t answering' }
if (-not $code) { throw 'No setup code' }

Say 'Setup through the API (Windows document: torrents locked to an adapter, no Gluetun)'
$h = @{ 'x-finesse-setup-code' = $code }
$base = "http://localhost:$port"
$info = Invoke-RestMethod "$base/api/setup/info" -Headers $h
if ($info.host -ne 'native') { throw "Finesse says its apps run on '$($info.host)', not natively" }
Write-Host "Network adapters: $(($info.adapters | ForEach-Object { $_.name }) -join ', ')"
$adapter = if ($info.adapters.Count) { $info.adapters[0].name } else { 'Ethernet' }
$doc = @{
  admin = @{ username = 'ci'; password = 'ci-password-123' }
  libraries = @{ movies = $true; shows = $false; music = $false; samples = $false }
  downloads = @{
    usenet = @{ servers = @(@{ name = 'Test'; host = 'news.example.com'; port = 563; ssl = $true; username = 'u'; password = 'p'; connections = 4 }) }
    torrents = @{ adapter = $adapter }
  }
  remoteAccess = @{ method = 'none' }
} | ConvertTo-Json -Depth 8
$v = Invoke-RestMethod -Method Post "$base/api/setup/validate" -Headers $h -Body $doc -ContentType 'application/json'
if (-not $v.ok) { throw "The document has problems: $($v.problems | ConvertTo-Json -Depth 4)" }
$null = Invoke-RestMethod -Method Post "$base/api/setup/apply" -Headers $h -Body $doc -ContentType 'application/json'
$seen = 0
$end = (Get-Date).AddMinutes(25)
$st = [pscustomobject]@{ state = 'running'; log = @() }
do {
  Start-Sleep -Seconds 5
  try { $st = Invoke-RestMethod "$base/api/setup/status" -Headers $h }
  catch { Write-Host "  (Finesse isn't answering: $($_.Exception.Message))"; continue }
  $st.log | Select-Object -Skip $seen | ForEach-Object { Write-Host "  $_" }
  $seen = $st.log.Count
} while ($st.state -eq 'running' -and (Get-Date) -lt $end)
if ($st.warnings) { Write-Host "Warnings: $($st.warnings -join ' | ')" }
if ($st.state -ne 'done') { throw "Setup ended as '$($st.state)': $($st.error)" }

Say 'The apps answer as Windows programs'
$apps = @{ 'Jellyfin' = 'http://127.0.0.1:8096/jellyfin/System/Info/Public'; 'Prowlarr' = 'http://127.0.0.1:9696/ping'; 'Radarr' = 'http://127.0.0.1:7878/ping' }
foreach ($a in $apps.GetEnumerator()) { if (-not (Answers $a.Value)) { throw "$($a.Key) isn't answering at $($a.Value)" } else { Write-Host "$($a.Key) answers" } }
Get-Process jellyfin, Prowlarr.Console, Radarr.Console, SABnzbd-console, qbittorrent -ErrorAction SilentlyContinue | Format-Table Name, Id, StartTime

Say 'Add media: a movie into a folder of its own'
$node = "$env:ProgramFiles\Finesse\app\$($res.version)\node.exe"
& $node "$PSScriptRoot\e2e-media.mjs" "http://127.0.0.1:$port" 'http://127.0.0.1:8096/jellyfin' 'ci' 'ci-password-123' $Media
if ($LASTEXITCODE -ne 0) { throw 'Add media failed' }

Say 'Restarting the service: the apps stop with it and come back'
Restart-Service Finesse
Until 'Finesse to answer again' { Answers "$base/api/health" } 120
Until 'Jellyfin to answer again' { Answers $apps['Jellyfin'] } 240
Until 'Radarr to answer again' { Answers $apps['Radarr'] } 240
Write-Host 'Everything came back'

Say 'Uninstall'
$p = Start-Process $Setup -ArgumentList '--uninstall', '--quiet', '--delete-settings' -Wait -PassThru -RedirectStandardOutput uninstall.out
Get-Content uninstall.out
if ($p.ExitCode -ne 0) { throw "Uninstall exited with $($p.ExitCode)" }
Start-Sleep -Seconds 5
if (Get-Service Finesse -ErrorAction SilentlyContinue) { throw 'The Finesse service is still there' }
if (Get-Service SABnzbd -ErrorAction SilentlyContinue) { throw 'The SABnzbd service Finesse registered is still there' }
$left = Get-Process node, jellyfin, Prowlarr.Console, Radarr.Console, SABnzbd-console, qbittorrent -ErrorAction SilentlyContinue
if ($left) { $left | Format-Table Name, Id; throw 'Apps are still running after uninstall' }
if (-not (Test-Path $Media)) { throw 'Uninstall removed the media folder' }
Write-Host "`nAll good: installed, set up, restarted and removed."
