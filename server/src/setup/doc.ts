// The setup document: everything Finesse needs to build a server, in one JSON
// object. The wizard assembles it step by step; an AI agent (or a human who
// prefers files) writes it directly. Both go through validate() + apply().
// Kept in sync with /setup.schema.json by server/test/setup.test.ts.

import type { StackServiceId, VpnConfig } from '../stack/catalog.ts'
import type { IndexerInput, UsenetServer } from '../stack/wire.ts'
import { validateEmulators, type EmulatorSettings } from '../emulators.ts'

export interface SetupDoc {
  version?: 1
  admin: { username: string; password: string }
  server?: { name?: string; language?: string; country?: string; timezone?: string }
  libraries?: { movies?: boolean; shows?: boolean; music?: boolean; games?: boolean }
  /** Games (RomM): optional artwork/metadata accounts. Box art works without them. */
  games?: { igdb?: { clientId: string; clientSecret: string }; steamGridDbKey?: string; screenscraper?: { username: string; password: string } }
  downloads?: {
    usenet?: { servers: UsenetServer[] } | null
    torrents?: { vpn: VpnDoc } | null
    indexers?: IndexerInput[]
  }
  quality?: { preset?: QualityPreset }
  remoteAccess?: { method: 'none' | 'tailscale' | 'cloudflare'; tailscale?: { authKey: string; hostname?: string }; cloudflare?: { token: string; publicUrl: string } }
  /** Where people reach Finesse from outside (own reverse proxy); Tailscale/Cloudflare fill it in. */
  publicUrl?: string
  email?: { host: string; port: number; secure?: boolean; username?: string; password?: string; from: string } | null
  options?: { exposeJellyfinPort?: boolean; jellyfinPort?: number }
  /** Emulators as Wolf apps (game streaming), with the folders they get: host paths. */
  emulators?: EmulatorSettings
}

export type QualityPreset = '720p' | '1080p' | '4k' | 'any'

export interface VpnDoc {
  provider: string
  type: 'wireguard' | 'openvpn'
  wireguard?: { privateKey: string; addresses?: string; presharedKey?: string; endpointIp?: string; endpointPort?: number; publicKey?: string }
  openvpn?: { username: string; password: string }
  countries?: string[]
}

/** Gluetun provider ids (VPN_SERVICE_PROVIDER) and whether WireGuard works with them. */
export const VPN_PROVIDERS: { id: string; name: string; wireguard: boolean; openvpn: boolean; help: string }[] = [
  { id: 'mullvad', name: 'Mullvad', wireguard: true, openvpn: false, help: 'Account → WireGuard configuration → generate a key; copy PrivateKey and Address.' },
  { id: 'protonvpn', name: 'Proton VPN', wireguard: true, openvpn: true, help: 'Downloads → WireGuard configuration (enable NAT-PMP / port forwarding for torrents); copy PrivateKey. OpenVPN: use the OpenVPN / IKEv2 username + password.' },
  { id: 'airvpn', name: 'AirVPN', wireguard: true, openvpn: true, help: 'Client Area → Config generator → WireGuard; copy PrivateKey, PresharedKey and Address.' },
  { id: 'nordvpn', name: 'NordVPN', wireguard: true, openvpn: true, help: 'WireGuard (NordLynx) needs your private key from Nord’s API; OpenVPN: “Service credentials” username + password.' },
  { id: 'surfshark', name: 'Surfshark', wireguard: true, openvpn: true, help: 'Manual setup → WireGuard → generate a key pair; copy the private key and address.' },
  { id: 'windscribe', name: 'Windscribe', wireguard: true, openvpn: true, help: 'Config generator → WireGuard; copy PrivateKey, PresharedKey and Address.' },
  { id: 'ivpn', name: 'IVPN', wireguard: true, openvpn: true, help: 'Account → WireGuard → add a key; copy the private key and IP address.' },
  { id: 'fastestvpn', name: 'FastestVPN', wireguard: true, openvpn: true, help: 'Use the WireGuard credentials from your dashboard.' },
  { id: 'private internet access', name: 'Private Internet Access', wireguard: false, openvpn: true, help: 'OpenVPN with your PIA username (p1234567) and password.' },
  { id: 'expressvpn', name: 'ExpressVPN', wireguard: false, openvpn: true, help: 'Set up on other devices → Manual config → OpenVPN username + password.' },
  { id: 'cyberghost', name: 'CyberGhost', wireguard: false, openvpn: true, help: 'My devices → Other → OpenVPN username + password.' },
  { id: 'ipvanish', name: 'IPVanish', wireguard: false, openvpn: true, help: 'Your IPVanish email and password.' },
  { id: 'purevpn', name: 'PureVPN', wireguard: false, openvpn: true, help: 'Manual configuration → OpenVPN credentials.' },
  { id: 'privado', name: 'PrivadoVPN', wireguard: false, openvpn: true, help: 'OpenVPN username + password from the dashboard.' },
  { id: 'torguard', name: 'TorGuard', wireguard: false, openvpn: true, help: 'VPN credentials (service username + password).' },
  { id: 'vyprvpn', name: 'VyprVPN', wireguard: false, openvpn: true, help: 'Your VyprVPN email and password.' },
  { id: 'custom', name: 'Other (custom WireGuard)', wireguard: true, openvpn: false, help: 'Paste values from any WireGuard config: PrivateKey, Address, the peer’s PublicKey and Endpoint.' },
]

export interface Problem {
  path: string
  message: string
}

const str = (v: unknown) => typeof v === 'string'
const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0
const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** Flags misspelt or unsupported keys (the schema's additionalProperties: false). */
function known(p: Problem[], v: unknown, at: string, keys: string[]) {
  if (v === undefined || v === null) return
  if (!isObj(v)) {
    p.push({ path: at, message: 'Must be an object' })
    return
  }
  for (const k of Object.keys(v)) if (!keys.includes(k)) p.push({ path: at ? `${at}.${k}` : k, message: `Unknown setting "${k}" — expected one of: ${keys.join(', ')}` })
}

function bool(p: Problem[], v: unknown, at: string) {
  if (v !== undefined && typeof v !== 'boolean') p.push({ path: at, message: 'Must be true or false' })
}

export function validateSetup(input: unknown): { doc: SetupDoc | null; problems: Problem[] } {
  const p: Problem[] = []
  const d = input as SetupDoc
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { doc: null, problems: [{ path: '', message: 'Setup must be a JSON object' }] }

  known(p, d, '', ['$schema', 'version', 'admin', 'server', 'libraries', 'games', 'downloads', 'quality', 'remoteAccess', 'publicUrl', 'email', 'options', 'emulators'])
  if (d.version !== undefined && d.version !== 1) p.push({ path: 'version', message: 'Only version 1 exists' })
  known(p, d.admin, 'admin', ['username', 'password'])
  known(p, d.server, 'server', ['name', 'language', 'country', 'timezone'])
  known(p, d.libraries, 'libraries', ['movies', 'shows', 'music', 'games'])
  for (const k of ['movies', 'shows', 'music', 'games'] as const) bool(p, d.libraries?.[k], `libraries.${k}`)
  known(p, d.games, 'games', ['igdb', 'steamGridDbKey', 'screenscraper'])
  known(p, d.games?.igdb, 'games.igdb', ['clientId', 'clientSecret'])
  known(p, d.games?.screenscraper, 'games.screenscraper', ['username', 'password'])
  known(p, d.downloads, 'downloads', ['usenet', 'torrents', 'indexers'])
  known(p, d.downloads?.usenet, 'downloads.usenet', ['servers'])
  known(p, d.downloads?.torrents, 'downloads.torrents', ['vpn'])
  known(p, d.downloads?.torrents?.vpn, 'downloads.torrents.vpn', ['provider', 'type', 'wireguard', 'openvpn', 'countries'])
  known(p, d.downloads?.torrents?.vpn?.wireguard, 'downloads.torrents.vpn.wireguard', ['privateKey', 'addresses', 'presharedKey', 'endpointIp', 'endpointPort', 'publicKey'])
  known(p, d.downloads?.torrents?.vpn?.openvpn, 'downloads.torrents.vpn.openvpn', ['username', 'password'])
  const countries = d.downloads?.torrents?.vpn?.countries
  if (countries !== undefined && (!Array.isArray(countries) || !countries.every(nonEmpty))) p.push({ path: 'downloads.torrents.vpn.countries', message: 'A list of country names, e.g. ["Netherlands"]' })
  if (d.downloads?.indexers !== undefined && !Array.isArray(d.downloads.indexers)) p.push({ path: 'downloads.indexers', message: 'Must be a list' })
  known(p, d.quality, 'quality', ['preset'])
  known(p, d.remoteAccess, 'remoteAccess', ['method', 'tailscale', 'cloudflare'])
  known(p, d.remoteAccess?.tailscale, 'remoteAccess.tailscale', ['authKey', 'hostname'])
  known(p, d.remoteAccess?.cloudflare, 'remoteAccess.cloudflare', ['token', 'publicUrl'])
  known(p, d.email, 'email', ['host', 'port', 'secure', 'username', 'password', 'from'])
  bool(p, d.email?.secure, 'email.secure')
  known(p, d.options, 'options', ['exposeJellyfinPort', 'jellyfinPort'])
  bool(p, d.options?.exposeJellyfinPort, 'options.exposeJellyfinPort')

  if (!isObj(d.admin)) p.push({ path: 'admin', message: 'An admin account is required' })
  else {
    if (!nonEmpty(d.admin.username) || !/^[A-Za-z0-9._@-]{2,64}$/.test(d.admin.username)) p.push({ path: 'admin.username', message: 'Use 2–64 letters, numbers, . _ @ or -' })
    if (!str(d.admin.password) || d.admin.password.length < 8) p.push({ path: 'admin.password', message: 'Use at least 8 characters' })
  }
  if (d.server?.timezone !== undefined && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$|^UTC$|^Etc\/[A-Za-z0-9+-]+$/.test(d.server.timezone)) p.push({ path: 'server.timezone', message: 'Use an IANA time zone like Europe/London' })
  if (d.server?.country !== undefined && !/^[A-Z]{2}$/.test(d.server.country)) p.push({ path: 'server.country', message: 'Use a two-letter country code like US' })
  if (d.server?.language !== undefined && !/^[a-z]{2}(-[A-Z]{2})?$/.test(d.server.language)) p.push({ path: 'server.language', message: 'Use a language code like en or pt-BR' })

  const dl = d.downloads
  const servers = dl?.usenet?.servers ?? []
  if (dl?.usenet && (!Array.isArray(servers) || servers.length === 0)) p.push({ path: 'downloads.usenet.servers', message: 'Add at least one Usenet server (or set usenet to null)' })
  ;(Array.isArray(servers) ? servers : []).forEach((s, i) => {
    const at = `downloads.usenet.servers[${i}]`
    known(p, s, at, ['name', 'host', 'port', 'ssl', 'username', 'password', 'connections', 'priority'])
    bool(p, s.ssl, `${at}.ssl`)
    if (s.priority !== undefined && (!Number.isInteger(s.priority) || s.priority < 0 || s.priority > 100)) p.push({ path: `${at}.priority`, message: 'Priority is 0 (primary) to 100' })
    if (!nonEmpty(s.host) || /\s|\//.test(s.host)) p.push({ path: `${at}.host`, message: 'Enter the server’s host name, e.g. news.example.com' })
    if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) p.push({ path: `${at}.port`, message: 'Port must be 1–65535 (usually 563 with SSL)' })
    if (!Number.isInteger(s.connections) || s.connections < 1 || s.connections > 100) p.push({ path: `${at}.connections`, message: 'Connections must be 1–100' })
    if (!str(s.username)) p.push({ path: `${at}.username`, message: 'Username is required' })
    if (!str(s.password)) p.push({ path: `${at}.password`, message: 'Password is required' })
    if (!nonEmpty(s.name)) p.push({ path: `${at}.name`, message: 'Give the server a name' })
  })
  const vpn = dl?.torrents?.vpn
  if (dl?.torrents && !vpn) p.push({ path: 'downloads.torrents.vpn', message: 'Torrents always run behind a VPN — add your VPN details' })
  if (vpn) {
    const prov = VPN_PROVIDERS.find((x) => x.id === vpn.provider)
    if (!prov) p.push({ path: 'downloads.torrents.vpn.provider', message: `Unknown provider — use one of: ${VPN_PROVIDERS.map((x) => x.id).join(', ')}` })
    if (vpn.type !== 'wireguard' && vpn.type !== 'openvpn') p.push({ path: 'downloads.torrents.vpn.type', message: 'Type is wireguard or openvpn' })
    else if (prov && !prov[vpn.type]) p.push({ path: 'downloads.torrents.vpn.type', message: `${prov.name} works with ${prov.wireguard ? 'WireGuard' : 'OpenVPN'} here` })
    if (vpn.type === 'wireguard') {
      if (!nonEmpty(vpn.wireguard?.privateKey) || !/^[A-Za-z0-9+/]{42,43}=?$/.test(vpn.wireguard!.privateKey)) p.push({ path: 'downloads.torrents.vpn.wireguard.privateKey', message: 'Paste the WireGuard PrivateKey (44 characters ending in =)' })
      if (vpn.provider !== 'nordvpn' && !nonEmpty(vpn.wireguard?.addresses)) p.push({ path: 'downloads.torrents.vpn.wireguard.addresses', message: 'Paste the WireGuard Address, e.g. 10.64.222.21/32' })
      if (vpn.provider === 'custom' && (!nonEmpty(vpn.wireguard?.endpointIp) || !nonEmpty(vpn.wireguard?.publicKey)))
        p.push({ path: 'downloads.torrents.vpn.wireguard', message: 'A custom WireGuard server needs endpointIp, endpointPort and publicKey' })
    }
    if (vpn.type === 'openvpn' && (!nonEmpty(vpn.openvpn?.username) || !nonEmpty(vpn.openvpn?.password))) p.push({ path: 'downloads.torrents.vpn.openvpn', message: 'OpenVPN needs a username and password' })
  }
  ;(Array.isArray(dl?.indexers) ? dl.indexers : []).forEach((ix, i) => {
    const at = `downloads.indexers[${i}]`
    known(p, ix, at, ['name', 'kind', 'url', 'apiKey', 'definition'])
    if (!nonEmpty(ix.name)) p.push({ path: `${at}.name`, message: 'Give the indexer a name' })
    if (ix.kind !== 'newznab' && ix.kind !== 'torznab') p.push({ path: `${at}.kind`, message: 'Kind is newznab (Usenet) or torznab (torrents)' })
    try {
      const u = new URL(ix.url)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
    } catch {
      p.push({ path: `${at}.url`, message: 'Enter the indexer’s address, e.g. https://api.nzbgeek.info' })
    }
    if (ix.kind === 'torznab' && !vpn) p.push({ path: `${at}.kind`, message: 'Torrent indexers need the torrent downloader (add a VPN)' })
    if (ix.kind === 'newznab' && servers.length === 0) p.push({ path: `${at}.kind`, message: 'Usenet indexers need a Usenet server' })
  })
  if (d.quality?.preset !== undefined && !['720p', '1080p', '4k', 'any'].includes(d.quality.preset)) p.push({ path: 'quality.preset', message: 'Preset is 720p, 1080p, 4k or any' })
  const ra = d.remoteAccess
  if (ra) {
    if (!['none', 'tailscale', 'cloudflare'].includes(ra.method)) p.push({ path: 'remoteAccess.method', message: 'Method is none, tailscale or cloudflare' })
    if (ra.method === 'tailscale' && (!nonEmpty(ra.tailscale?.authKey) || !ra.tailscale!.authKey.startsWith('tskey-'))) p.push({ path: 'remoteAccess.tailscale.authKey', message: 'Paste a Tailscale auth key (tskey-auth-…)' })
    if (ra.method === 'cloudflare') {
      if (!nonEmpty(ra.cloudflare?.token)) p.push({ path: 'remoteAccess.cloudflare.token', message: 'Paste the tunnel token from the Cloudflare dashboard' })
      if (!nonEmpty(ra.cloudflare?.publicUrl) || !/^https:\/\//.test(ra.cloudflare!.publicUrl)) p.push({ path: 'remoteAccess.cloudflare.publicUrl', message: 'Enter the public address, e.g. https://media.example.com' })
    }
  }
  if (d.publicUrl !== undefined && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(d.publicUrl)) p.push({ path: 'publicUrl', message: 'Enter a full address, e.g. https://media.example.com' })
  if (ra?.method === 'tailscale' && ra.tailscale?.hostname !== undefined && !/^[a-z0-9-]{1,63}$/.test(ra.tailscale.hostname)) p.push({ path: 'remoteAccess.tailscale.hostname', message: 'Use lowercase letters, numbers and dashes' })
  if (d.email) {
    if (!nonEmpty(d.email.host)) p.push({ path: 'email.host', message: 'SMTP host is required' })
    if (!Number.isInteger(d.email.port)) p.push({ path: 'email.port', message: 'SMTP port is required (587 or 465)' })
    if (!nonEmpty(d.email.from) || !/@/.test(d.email.from)) p.push({ path: 'email.from', message: 'From address is required' })
  }
  const g = d.games
  if (g) {
    if (d.libraries?.games !== true) p.push({ path: 'games', message: 'Turn on libraries.games to use these settings' })
    if (g.igdb && (!nonEmpty(g.igdb.clientId) || !nonEmpty(g.igdb.clientSecret))) p.push({ path: 'games.igdb', message: 'IGDB needs a Client ID and a Client Secret (from dev.twitch.tv)' })
    if (g.steamGridDbKey !== undefined && !/^[A-Za-z0-9]{16,64}$/.test(g.steamGridDbKey)) p.push({ path: 'games.steamGridDbKey', message: 'Paste the API key from steamgriddb.com → Preferences → API' })
    if (g.screenscraper && (!nonEmpty(g.screenscraper.username) || !nonEmpty(g.screenscraper.password))) p.push({ path: 'games.screenscraper', message: 'ScreenScraper needs your username and password' })
  }
  if (d.emulators !== undefined) p.push(...validateEmulators(d.emulators))
  const jp = d.options?.jellyfinPort
  if (jp !== undefined && (!Number.isInteger(jp) || jp < 1024 || jp > 65535)) p.push({ path: 'options.jellyfinPort', message: 'Port must be 1024–65535' })
  return { doc: p.length ? null : d, problems: p }
}

/** Which services a document needs, in install order. */
export function servicesFor(d: SetupDoc): StackServiceId[] {
  const out: StackServiceId[] = ['jellyfin']
  const usenet = (d.downloads?.usenet?.servers?.length ?? 0) > 0
  const torrents = Boolean(d.downloads?.torrents?.vpn)
  if (usenet || torrents) {
    out.push('prowlarr')
    const libs = { movies: true, shows: true, music: true, ...d.libraries }
    if (libs.shows) out.push('sonarr')
    if (libs.movies) out.push('radarr')
    if (libs.music) out.push('lidarr')
  }
  if (usenet) out.push('sabnzbd')
  if (torrents) out.push('gluetun', 'qbittorrent')
  if (d.libraries?.games) out.push('romm-db', 'romm')
  if (d.remoteAccess?.method === 'tailscale') out.push('tailscale')
  if (d.remoteAccess?.method === 'cloudflare') out.push('cloudflared')
  return out
}

export function vpnConfig(v: VpnDoc): VpnConfig {
  return {
    provider: v.provider,
    type: v.type,
    wireguardPrivateKey: v.wireguard?.privateKey,
    wireguardAddresses: v.wireguard?.addresses,
    wireguardPresharedKey: v.wireguard?.presharedKey,
    endpointIp: v.wireguard?.endpointIp,
    endpointPort: v.wireguard?.endpointPort,
    serverPublicKey: v.wireguard?.publicKey,
    openvpnUser: v.openvpn?.username,
    openvpnPassword: v.openvpn?.password,
    countries: v.countries,
  }
}

/** Quality profile names each *arr ships with, per preset. */
export function qualityProfiles(preset: QualityPreset = '1080p') {
  switch (preset) {
    case '720p':
      return { radarr: 'HD-720p', sonarr: 'HD-720p', lidarr: 'Standard' }
    case '4k':
      return { radarr: 'Ultra-HD', sonarr: 'Ultra-HD', lidarr: 'Lossless' }
    case 'any':
      return { radarr: 'Any', sonarr: 'Any', lidarr: 'Any' }
    default:
      return { radarr: 'HD-1080p', sonarr: 'HD-1080p', lidarr: 'Standard' }
  }
}

/** A copy with every secret replaced — safe to log or return. */
export function redact(d: SetupDoc): SetupDoc {
  const c: SetupDoc = structuredClone(d)
  const hide = (s?: string) => (s ? '••••' : s)
  if (c.admin) c.admin.password = hide(c.admin.password) as string
  c.downloads?.usenet?.servers?.forEach((s) => (s.password = hide(s.password) as string))
  c.downloads?.indexers?.forEach((ix) => (ix.apiKey = hide(ix.apiKey)))
  const v = c.downloads?.torrents?.vpn
  if (v?.wireguard) {
    v.wireguard.privateKey = hide(v.wireguard.privateKey) as string
    v.wireguard.presharedKey = hide(v.wireguard.presharedKey)
  }
  if (v?.openvpn) v.openvpn.password = hide(v.openvpn.password) as string
  if (c.remoteAccess?.tailscale) c.remoteAccess.tailscale.authKey = hide(c.remoteAccess.tailscale.authKey) as string
  if (c.remoteAccess?.cloudflare) c.remoteAccess.cloudflare.token = hide(c.remoteAccess.cloudflare.token) as string
  if (c.email?.password) c.email.password = hide(c.email.password)
  if (c.games?.igdb) c.games.igdb.clientSecret = hide(c.games.igdb.clientSecret) as string
  if (c.games?.steamGridDbKey) c.games.steamGridDbKey = hide(c.games.steamGridDbKey)
  if (c.games?.screenscraper) c.games.screenscraper.password = hide(c.games.screenscraper.password) as string
  return c
}
