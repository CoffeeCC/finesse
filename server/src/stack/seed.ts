// Config files Finesse writes BEFORE an app's first start, so every app comes
// up already keyed, already behind Finesse's auth, already pointing at the
// shared data tree. Existing files are never clobbered: if an app already has
// a config (an adopted or re-run install), Finesse reads its key instead.

import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { chownSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const newKey = () => randomBytes(16).toString('hex')
export const newPassword = () => randomBytes(18).toString('base64url')

export function writeOwned(file: string, content: string, uid: number, gid: number, mode = 0o640) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, { mode })
  try {
    chownSync(file, uid, gid)
    chownSync(dirname(file), uid, gid)
  } catch {
    /* not root (dev) — the app's own PUID handling copes */
  }
}

// ---------- Servarr (Sonarr / Radarr / Lidarr / Prowlarr) ----------

const ARR_PORTS: Record<string, number> = { sonarr: 8989, radarr: 7878, lidarr: 8686, prowlarr: 9696 }

/** Ensures config.xml exists with an API key; returns the key in use. */
export function seedArr(configDir: string, app: 'sonarr' | 'radarr' | 'lidarr' | 'prowlarr', uid: number, gid: number): string {
  const file = join(configDir, 'config.xml')
  if (existsSync(file)) {
    const m = /<ApiKey>([^<]+)<\/ApiKey>/.exec(readFileSync(file, 'utf8'))
    if (m) return m[1]!.trim()
  }
  const key = newKey()
  const name = app[0]!.toUpperCase() + app.slice(1)
  // AuthenticationMethod External: Finesse is the front door (the apps are
  // only reachable on the private finesse network, never published).
  writeOwned(
    file,
    `<Config>
  <BindAddress>*</BindAddress>
  <Port>${ARR_PORTS[app]}</Port>
  <EnableSsl>False</EnableSsl>
  <LaunchBrowser>False</LaunchBrowser>
  <ApiKey>${key}</ApiKey>
  <AuthenticationMethod>External</AuthenticationMethod>
  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
  <UrlBase></UrlBase>
  <InstanceName>${name}</InstanceName>
  <UpdateMechanism>Docker</UpdateMechanism>
  <LogLevel>info</LogLevel>
  <AnalyticsEnabled>False</AnalyticsEnabled>
</Config>
`,
    uid,
    gid,
  )
  return key
}

// ---------- SABnzbd ----------

export function seedSab(configDir: string, uid: number, gid: number): string {
  const file = join(configDir, 'sabnzbd.ini')
  if (existsSync(file)) {
    const m = /^api_key\s*=\s*(\S+)/m.exec(readFileSync(file, 'utf8'))
    if (m) return m[1]!
  }
  const key = newKey()
  // Minimal ini — SABnzbd fills every other default on first start. The host
  // whitelist lets the other containers call it by name.
  writeOwned(
    file,
    `__version__ = 19
__encoding__ = utf-8
[misc]
api_key = ${key}
nzb_key = ${newKey()}
host_whitelist = sabnzbd, finesse-sabnzbd
download_dir = /data/usenet/incomplete
complete_dir = /data/usenet/complete
permissions = 775
check_new_rel = 0
auto_browser = 0
[categories]
[[*]]
name = *
order = 0
pp = 3
script = None
dir = ""
newzbin = ""
priority = 0
[[movies]]
name = movies
order = 1
pp = ""
script = Default
dir = movies
newzbin = ""
priority = -100
[[tv]]
name = tv
order = 2
pp = ""
script = Default
dir = tv
newzbin = ""
priority = -100
[[music]]
name = music
order = 3
pp = ""
script = Default
dir = music
newzbin = ""
priority = -100
`,
    uid,
    gid,
  )
  return key
}

// ---------- qBittorrent ----------

/** qBittorrent's WebUI\Password_PBKDF2 value (PBKDF2-SHA512, 100k rounds). */
export function qbitPasswordHash(password: string): string {
  const salt = randomBytes(16)
  const dk = pbkdf2Sync(password, salt, 100000, 64, 'sha512')
  return `@ByteArray(${salt.toString('base64')}:${dk.toString('base64')})`
}

/** Writes qBittorrent.conf if missing; returns the WebUI password to store (or null if kept). */
export function seedQbit(configDir: string, uid: number, gid: number): { username: string; password: string } | null {
  const file = join(configDir, 'qBittorrent', 'qBittorrent.conf')
  if (existsSync(file)) return null
  const password = newPassword()
  writeOwned(
    file,
    `[BitTorrent]
Session\\DefaultSavePath=/data/torrents
Session\\TempPath=/data/torrents/incomplete
Session\\TempPathEnabled=true
Session\\Port=6881
Session\\GlobalMaxRatio=2
Session\\GlobalMaxSeedingMinutes=10080
Session\\QueueingSystemEnabled=true

[LegalNotice]
Accepted=true

[Preferences]
WebUI\\Address=*
WebUI\\Port=8080
WebUI\\Username=finesse
WebUI\\Password_PBKDF2="${qbitPasswordHash(password)}"
WebUI\\HostHeaderValidation=false
WebUI\\CSRFProtection=false
WebUI\\AuthSubnetWhitelistEnabled=true
WebUI\\AuthSubnetWhitelist=10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
`,
    uid,
    gid,
  )
  return { username: 'finesse', password }
}

// ---------- Gluetun ----------

/** Control-server auth (required by newer Gluetun): one API-key role for Finesse. */
export function seedGluetunAuth(configDir: string, apiKey: string) {
  writeOwned(
    join(configDir, 'auth', 'config.toml'),
    `# Written by Finesse — lets it read the tunnel's status and public IP.
[[roles]]
name = "finesse"
routes = ["GET /v1/publicip/ip", "GET /v1/vpn/status", "PUT /v1/vpn/status", "GET /v1/portforward"]
auth = "apikey"
apikey = "${apiKey}"
`,
    0,
    0,
    0o600,
  )
}

// ---------- Tailscale ----------

/** Funnel: publish Finesse (http://finesse:8080) over HTTPS on the tailnet name. */
export function seedTailscaleServe(configDir: string) {
  writeOwned(
    join(configDir, 'serve.json'),
    JSON.stringify(
      {
        TCP: { '443': { HTTPS: true } },
        Web: { '${TS_CERT_DOMAIN}:443': { Handlers: { '/': { Proxy: 'http://finesse:8080' } } } },
        AllowFunnel: { '${TS_CERT_DOMAIN}:443': true },
      },
      null,
      2,
    ),
    0,
    0,
  )
}

// ---------- Jellyfin ----------

/** Serve Jellyfin under /jellyfin from its very first start (BaseUrl only
 *  takes effect on a restart, so it's set before Jellyfin ever runs). */
export function seedJellyfin(configDir: string, uid: number, gid: number) {
  const file = join(configDir, 'config', 'network.xml')
  if (existsSync(file)) return
  writeOwned(
    file,
    `<?xml version="1.0" encoding="utf-8"?>
<NetworkConfiguration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BaseUrl>/jellyfin</BaseUrl>
  <EnableUPnP>false</EnableUPnP>
  <EnableRemoteAccess>true</EnableRemoteAccess>
</NetworkConfiguration>
`,
    uid,
    gid,
  )
}
