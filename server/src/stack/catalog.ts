// The stack Finesse can install: one definition per service, with a pinned,
// tested image. Finesse releases bump these pins; the updater applies them.
//
// Paths: FINESSE_ROOT (config for every app) and FINESSE_DATA (media +
// downloads) are host paths, bind-mounted into the Finesse container at the
// SAME paths, so what Finesse sees on disk is exactly what it hands Docker.
// Every app sees the data tree at /data, so a finished download moves into
// the library as a rename (hardlink), never a copy.

export type StackServiceId =
  | 'jellyfin'
  | 'sonarr'
  | 'radarr'
  | 'lidarr'
  | 'prowlarr'
  | 'sabnzbd'
  | 'gluetun'
  | 'qbittorrent'
  | 'tailscale'
  | 'cloudflared'
  | 'romm-db'
  | 'romm'
  | 'wolf'

export interface StackContext {
  hostRoot: string
  hostData: string
  puid: number
  pgid: number
  timezone: string
  network: string
  /** Publish Jellyfin's own port for native Jellyfin apps (Swiftfin, Infuse…). */
  exposeJellyfin: boolean
  jellyfinPort: number
  /** /dev/dri present on the host → hardware transcoding (Intel/AMD). */
  gpu: boolean
  /** The host's group numbers for /dev/dri (filled in by the orchestrator). */
  gpuGroups?: string[]
  /** Host device paths that exist (probed through Docker — Finesse's own /dev is not the host's). */
  hostDevices?: string[]
  vpn?: VpnConfig
  tailscale?: { authKey: string; hostname: string }
  cloudflared?: { token: string }
  /** Outbound proxy for the apps that fetch metadata (networks that require one). */
  proxy?: AppProxy
  /** Games (RomM): generated database/auth secrets and optional artwork keys. */
  games?: GamesConfig
  /** Game streaming (Wolf): whether Docker can hand it an Nvidia card. */
  streaming?: { nvidia: boolean }
  /** Docker labels containers for SELinux (Fedora, Bazzite…): bind mounts then need label=disable (filled in by the orchestrator). */
  selinux?: boolean
}

export interface GamesConfig {
  dbPassword: string
  dbRootPassword: string
  secretKey: string
  igdb?: { clientId: string; clientSecret: string }
  steamGridDbKey?: string
  screenscraper?: { username: string; password: string }
  /** Finesse's own RomM account. Kept here so turning Games off and on again can still sign in. */
  login?: { username: string; password: string }
}

export interface AppProxy {
  http?: string
  https?: string
  noProxy?: string
  /** Host path of a PEM bundle the apps should trust (a TLS-inspecting proxy). */
  caBundle?: string
}

/** Apps that reach the internet for metadata and may need the proxy. Never the VPN or qBittorrent. */
export const PROXIED: StackServiceId[] = ['jellyfin', 'sonarr', 'radarr', 'lidarr', 'prowlarr', 'sabnzbd', 'romm']
const INTERNAL_HOSTS = 'localhost,127.0.0.1,finesse,jellyfin,sonarr,radarr,lidarr,prowlarr,sabnzbd,gluetun,qbittorrent,romm,romm-db,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'

/** Proxy env + CA mount for one app ({} when no proxy is configured). */
export function proxyFor(id: StackServiceId, ctx: StackContext): { env: Record<string, string>; binds: string[] } {
  const p = ctx.proxy
  if (!p || !PROXIED.includes(id) || !(p.http || p.https)) return { env: {}, binds: [] }
  const env: Record<string, string> = {}
  const noProxy = [INTERNAL_HOSTS, p.noProxy].filter(Boolean).join(',')
  if (p.http) Object.assign(env, { HTTP_PROXY: p.http, http_proxy: p.http })
  if (p.https) Object.assign(env, { HTTPS_PROXY: p.https, https_proxy: p.https })
  Object.assign(env, { NO_PROXY: noProxy, no_proxy: noProxy })
  const binds: string[] = []
  if (p.caBundle && id === 'romm') {
    // RomM's entrypoint treats every *_FILE variable as a Docker secret and
    // inlines the file (a CA bundle overflows the environment), so replace the
    // trust stores it reads instead: the system one and certifi's (httpx uses
    // certifi). The certifi path follows RomM's Python — check it on RomM bumps.
    binds.push(`${p.caBundle}:/etc/ssl/cert.pem:ro`, `${p.caBundle}:/src/.venv/lib/python3.14/site-packages/certifi/cacert.pem:ro`)
    Object.assign(env, { REQUESTS_CA_BUNDLE: '/etc/ssl/cert.pem', CURL_CA_BUNDLE: '/etc/ssl/cert.pem' })
  } else if (p.caBundle) {
    binds.push(`${p.caBundle}:/etc/finesse-ca.pem:ro`)
    Object.assign(env, { SSL_CERT_FILE: '/etc/finesse-ca.pem', REQUESTS_CA_BUNDLE: '/etc/finesse-ca.pem', CURL_CA_BUNDLE: '/etc/finesse-ca.pem' })
  }
  return { env, binds }
}

export interface VpnConfig {
  provider: string
  type: 'wireguard' | 'openvpn'
  wireguardPrivateKey?: string
  wireguardAddresses?: string
  wireguardPresharedKey?: string
  openvpnUser?: string
  openvpnPassword?: string
  countries?: string[]
  /** Custom WireGuard server (provider "custom"). */
  endpointIp?: string
  endpointPort?: number
  serverPublicKey?: string
}

export interface ServiceDef {
  id: StackServiceId
  name: string
  role: string
  image: string
  /** Hostname on the finesse network. */
  alias: string
  /** HTTP port inside the container (0 = none). */
  port: number
  /** Path prefix the app serves under (Jellyfin: /jellyfin). */
  basePath?: string
  /** HTTP path that answers 2xx/401 once the app is up. */
  healthPath?: string
  dependsOn?: StackServiceId[]
  /** Share another container's network namespace (qBittorrent → Gluetun). */
  networkOf?: StackServiceId
  extraAliases?: string[]
  env(ctx: StackContext): Record<string, string>
  binds(ctx: StackContext): string[]
  ports?(ctx: StackContext): { host: number; container: number; proto?: 'tcp' | 'udp' }[]
  capAdd?: string[]
  devices?(ctx: StackContext): string[]
  user?(ctx: StackContext): string | undefined
  groupAdd?(ctx: StackContext): string[]
  sysctls?: Record<string, string>
  /** Directories (relative to hostData) the service needs to exist. */
  dataDirs?: string[]
  /** Runs on the host's network (Wolf: Moonlight finds it and streams over UDP). */
  hostNetwork?: boolean
  /** Extra device rules (Wolf: the virtual controllers it creates while it runs). */
  deviceCgroupRules?: string[]
  /** Asks Docker for the Nvidia card(s). */
  nvidia?(ctx: StackContext): boolean
}

const cfg = (ctx: StackContext, id: string) => `${ctx.hostRoot}/config/${id}`

/** Wolf's API socket. It sits in Wolf's own config folder, which Finesse sees at the same path. */
/** Wolf's sockets (its API, and the PulseAudio it runs) live here, inside Finesse's folder. */
export const wolfRunDir = (ctx: { hostRoot: string }) => `${ctx.hostRoot}/config/wolf/run`
export const wolfSocket = (ctx: { hostRoot: string }) => `${wolfRunDir(ctx)}/wolf.sock`
/** The image Finesse's emulator apps run on in Wolf (Games on Whales' ES-DE: Sway, controllers, AppImage support). Pinned like the stack's images. */
export const EMULATOR_IMAGE = 'ghcr.io/games-on-whales/es-de:sha-bc4bb67'
/** Browser play: LinuxServer's Selkies desktop (WebSocket video, gamepads, audio), pinned by digest. */
export const PLAY_IMAGE = 'ghcr.io/linuxserver/baseimage-selkies@sha256:7cab02f9222937ad1e704cd904534d69a2300b2406af466241817be0ce1d0493'
const lsio = (ctx: StackContext) => ({ PUID: String(ctx.puid), PGID: String(ctx.pgid), TZ: ctx.timezone, UMASK: '002' })

export const CATALOG: Record<StackServiceId, ServiceDef> = {
  jellyfin: {
    id: 'jellyfin',
    name: 'Jellyfin',
    role: 'Streaming server',
    image: 'jellyfin/jellyfin:12.1.20260915-010956',
    alias: 'jellyfin',
    port: 8096,
    basePath: '/jellyfin',
    healthPath: '/jellyfin/System/Info/Public',
    env: (ctx) => ({ TZ: ctx.timezone, JELLYFIN_PublishedServerUrl: '' }),
    binds: (ctx) => [`${cfg(ctx, 'jellyfin')}:/config`, `${cfg(ctx, 'jellyfin')}/cache:/cache`, `${ctx.hostData}/media:/data/media:ro`],
    ports: (ctx) => (ctx.exposeJellyfin ? [{ host: ctx.jellyfinPort, container: 8096 }] : []),
    devices: (ctx) => (ctx.gpu ? ['/dev/dri:/dev/dri'] : []),
    user: (ctx) => `${ctx.puid}:${ctx.pgid}`,
    // By number: Jellyfin's image has no "render" group, and Docker refuses group names an image doesn't know.
    groupAdd: (ctx) => (ctx.gpu ? (ctx.gpuGroups ?? []) : []),
    dataDirs: ['media/movies', 'media/tv', 'media/music'],
  },
  prowlarr: {
    id: 'prowlarr',
    name: 'Prowlarr',
    role: 'Indexer manager',
    image: 'lscr.io/linuxserver/prowlarr:2.6.5.5623-ls162',
    alias: 'prowlarr',
    port: 9696,
    healthPath: '/ping',
    env: lsio,
    binds: (ctx) => [`${cfg(ctx, 'prowlarr')}:/config`],
  },
  sonarr: {
    id: 'sonarr',
    name: 'Sonarr',
    role: 'Shows',
    image: 'lscr.io/linuxserver/sonarr:4.0.20.3014-ls326',
    alias: 'sonarr',
    port: 8989,
    healthPath: '/ping',
    dependsOn: ['prowlarr'],
    env: lsio,
    binds: (ctx) => [`${cfg(ctx, 'sonarr')}:/config`, `${ctx.hostData}:/data`],
    dataDirs: ['media/tv'],
  },
  radarr: {
    id: 'radarr',
    name: 'Radarr',
    role: 'Movies',
    image: 'lscr.io/linuxserver/radarr:6.4.4.10685-ls318',
    alias: 'radarr',
    port: 7878,
    healthPath: '/ping',
    dependsOn: ['prowlarr'],
    env: lsio,
    binds: (ctx) => [`${cfg(ctx, 'radarr')}:/config`, `${ctx.hostData}:/data`],
    dataDirs: ['media/movies'],
  },
  lidarr: {
    id: 'lidarr',
    name: 'Lidarr',
    role: 'Music',
    image: 'lscr.io/linuxserver/lidarr:3.1.0.4875-ls42',
    alias: 'lidarr',
    port: 8686,
    healthPath: '/ping',
    dependsOn: ['prowlarr'],
    env: lsio,
    binds: (ctx) => [`${cfg(ctx, 'lidarr')}:/config`, `${ctx.hostData}:/data`],
    dataDirs: ['media/music'],
  },
  sabnzbd: {
    id: 'sabnzbd',
    name: 'SABnzbd',
    role: 'Usenet downloader',
    image: 'lscr.io/linuxserver/sabnzbd:5.1.3-ls274',
    alias: 'sabnzbd',
    port: 8080,
    healthPath: '/api?mode=version',
    env: lsio,
    binds: (ctx) => [`${cfg(ctx, 'sabnzbd')}:/config`, `${ctx.hostData}:/data`],
    dataDirs: ['usenet/incomplete', 'usenet/complete/movies', 'usenet/complete/tv', 'usenet/complete/music'],
  },
  gluetun: {
    id: 'gluetun',
    name: 'Gluetun',
    role: 'VPN tunnel for torrents',
    image: 'qmcgaw/gluetun:v3.41.3',
    alias: 'gluetun',
    // qBittorrent lives inside Gluetun's network namespace: reach it via these.
    extraAliases: ['qbittorrent'],
    port: 8000,
    capAdd: ['NET_ADMIN'],
    devices: () => ['/dev/net/tun:/dev/net/tun'],
    env: (ctx) => gluetunEnv(ctx),
    binds: (ctx) => [`${cfg(ctx, 'gluetun')}:/gluetun`],
  },
  qbittorrent: {
    id: 'qbittorrent',
    name: 'qBittorrent',
    role: 'Torrent downloader (VPN only)',
    image: 'lscr.io/linuxserver/qbittorrent:5.2.3',
    alias: 'qbittorrent',
    port: 8080,
    healthPath: '/api/v2/app/version',
    dependsOn: ['gluetun'],
    networkOf: 'gluetun',
    env: (ctx) => ({ ...lsio(ctx), WEBUI_PORT: '8080', TORRENTING_PORT: '6881' }),
    binds: (ctx) => [`${cfg(ctx, 'qbittorrent')}:/config`, `${ctx.hostData}:/data`],
    dataDirs: ['torrents/movies', 'torrents/tv', 'torrents/music', 'torrents/incomplete'],
  },
  tailscale: {
    id: 'tailscale',
    name: 'Tailscale',
    role: 'Remote access (Funnel)',
    image: 'tailscale/tailscale:v1.102.5',
    alias: 'tailscale',
    port: 0,
    capAdd: ['NET_ADMIN', 'NET_RAW'],
    devices: () => ['/dev/net/tun:/dev/net/tun'],
    env: (ctx) => ({
      TS_AUTHKEY: ctx.tailscale?.authKey ?? '',
      TS_HOSTNAME: ctx.tailscale?.hostname ?? 'finesse',
      TS_STATE_DIR: '/var/lib/tailscale',
      TS_USERSPACE: 'false',
      TS_SERVE_CONFIG: '/config/serve.json',
    }),
    binds: (ctx) => [`${cfg(ctx, 'tailscale')}/state:/var/lib/tailscale`, `${cfg(ctx, 'tailscale')}:/config`],
  },
  cloudflared: {
    id: 'cloudflared',
    name: 'Cloudflare Tunnel',
    role: 'Remote access (tunnel)',
    image: 'cloudflare/cloudflared:2026.9.3',
    alias: 'cloudflared',
    port: 0,
    env: (ctx) => ({ TUNNEL_TOKEN: ctx.cloudflared?.token ?? '' }),
    binds: () => [],
  },
  'romm-db': {
    id: 'romm-db',
    name: 'RomM database',
    role: 'Games library database',
    image: 'mariadb:11.8.9',
    alias: 'romm-db',
    port: 0,
    env: (ctx) => ({
      TZ: ctx.timezone,
      MARIADB_ROOT_PASSWORD: ctx.games?.dbRootPassword ?? '',
      MARIADB_DATABASE: 'romm',
      MARIADB_USER: 'romm',
      MARIADB_PASSWORD: ctx.games?.dbPassword ?? '',
    }),
    binds: (ctx) => [`${cfg(ctx, 'romm-db')}:/var/lib/mysql`],
    user: (ctx) => `${ctx.puid}:${ctx.pgid}`,
  },
  romm: {
    id: 'romm',
    name: 'RomM',
    role: 'Games library',
    image: 'rommapp/romm:5.3.1',
    alias: 'romm',
    port: 8080,
    healthPath: '/api/heartbeat',
    dependsOn: ['romm-db'],
    env: (ctx) => {
      const g = ctx.games
      const env: Record<string, string> = {
        TZ: ctx.timezone,
        // Finesse reaches RomM over the Docker network; some hosts have IPv6 off.
        IPV4_ONLY: 'true',
        DB_HOST: 'romm-db',
        DB_NAME: 'romm',
        DB_USER: 'romm',
        DB_PASSWD: g?.dbPassword ?? '',
        ROMM_AUTH_SECRET_KEY: g?.secretKey ?? '',
        // New games show up on their own: a rescan shortly after files change, and nightly.
        ENABLE_RESCAN_ON_FILESYSTEM_CHANGE: 'true',
        RESCAN_ON_FILESYSTEM_CHANGE_DELAY: '2',
        ENABLE_SCHEDULED_RESCAN: 'true',
        // Box art and descriptions from sources that need no account.
        LAUNCHBOX_API_ENABLED: 'true',
        ENABLE_SCHEDULED_UPDATE_LAUNCHBOX_METADATA: 'true',
        HASHEOUS_API_ENABLED: 'true',
        PLAYMATCH_API_ENABLED: 'true',
      }
      if (g?.igdb) Object.assign(env, { IGDB_CLIENT_ID: g.igdb.clientId, IGDB_CLIENT_SECRET: g.igdb.clientSecret })
      if (g?.steamGridDbKey) env.STEAMGRIDDB_API_KEY = g.steamGridDbKey
      if (g?.screenscraper) Object.assign(env, { SCREENSCRAPER_USER: g.screenscraper.username, SCREENSCRAPER_PASSWORD: g.screenscraper.password })
      return env
    },
    binds: (ctx) => [
      `${ctx.hostData}/media/games:/romm/library`,
      `${cfg(ctx, 'romm')}/resources:/romm/resources`,
      `${cfg(ctx, 'romm')}/assets:/romm/assets`,
      `${cfg(ctx, 'romm')}/config:/romm/config`,
      `${cfg(ctx, 'romm')}/redis:/redis-data`,
    ],
    user: (ctx) => `${ctx.puid}:${ctx.pgid}`,
    dataDirs: ['media/games/roms', 'media/games/bios'],
  },  // Game streaming: Wolf streams Steam and other apps to Moonlight. It starts
  // each app in a container of its own (hence Docker), creates virtual
  // controllers (uinput/uhid, cgroup rule for input devices) and is found by
  // Moonlight on the home network (host networking). Its folders must have the
  // same path inside and out: Wolf hands them to the app containers it starts.
  wolf: {
    id: 'wolf',
    name: 'Wolf',
    role: 'Game streaming',
    image: 'ghcr.io/games-on-whales/wolf:sha-facb8e0',
    alias: 'wolf',
    port: 0,
    hostNetwork: true,
    env: (ctx) => {
      const dir = cfg(ctx, 'wolf')
      return {
        TZ: ctx.timezone,
        WOLF_CFG_FILE: `${dir}/cfg/config.toml`,
        WOLF_PRIVATE_KEY_FILE: `${dir}/cfg/key.pem`,
        WOLF_PRIVATE_CERT_FILE: `${dir}/cfg/cert.pem`,
        HOST_APPS_STATE_FOLDER: dir,
        XDG_RUNTIME_DIR: `${dir}/run`,
        WOLF_SOCKET_PATH: wolfSocket(ctx),
        // Games keep their saves as the same user as every other app.
        WOLF_DEFAULT_RUN_UID: String(ctx.puid),
        WOLF_DEFAULT_RUN_GID: String(ctx.pgid),
        ...(ctx.streaming?.nvidia ? { NVIDIA_DRIVER_CAPABILITIES: 'all', NVIDIA_VISIBLE_DEVICES: 'all' } : {}),
      }
    },
    binds: (ctx) => [
      `${cfg(ctx, 'wolf')}:${cfg(ctx, 'wolf')}`,
      `${cfg(ctx, 'wolf')}/run:${cfg(ctx, 'wolf')}/run`,
      '/var/run/docker.sock:/var/run/docker.sock',
      '/dev:/dev',
      '/run/udev:/run/udev',
    ],
    devices: () => ['/dev/dri:/dev/dri', '/dev/uinput:/dev/uinput', '/dev/uhid:/dev/uhid'],
    deviceCgroupRules: ['c 13:* rmw'],
    nvidia: (ctx) => Boolean(ctx.streaming?.nvidia),
  },
}

function gluetunEnv(ctx: StackContext): Record<string, string> {
  const v = ctx.vpn
  const env: Record<string, string> = {
    TZ: ctx.timezone,
    // Let the other containers on the finesse network reach qBittorrent's UI.
    FIREWALL_INPUT_PORTS: '8080',
    // Private ranges stay reachable (LAN + Docker networks); everything else goes through the tunnel.
    FIREWALL_OUTBOUND_SUBNETS: '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16',
    HEALTH_TARGET_ADDRESSES: 'cloudflare.com:443,github.com:443',
    DOT: 'on',
    UPDATER_PERIOD: '24h',
  }
  if (!v) return env
  env.VPN_SERVICE_PROVIDER = v.provider
  env.VPN_TYPE = v.type
  if (v.type === 'wireguard') {
    if (v.wireguardPrivateKey) env.WIREGUARD_PRIVATE_KEY = v.wireguardPrivateKey
    if (v.wireguardAddresses) env.WIREGUARD_ADDRESSES = v.wireguardAddresses
    if (v.wireguardPresharedKey) env.WIREGUARD_PRESHARED_KEY = v.wireguardPresharedKey
    if (v.provider === 'custom') {
      if (v.endpointIp) env.WIREGUARD_ENDPOINT_IP = v.endpointIp
      if (v.endpointPort) env.WIREGUARD_ENDPOINT_PORT = String(v.endpointPort)
      if (v.serverPublicKey) env.WIREGUARD_PUBLIC_KEY = v.serverPublicKey
    }
  } else {
    if (v.openvpnUser) env.OPENVPN_USER = v.openvpnUser
    if (v.openvpnPassword) env.OPENVPN_PASSWORD = v.openvpnPassword
  }
  if (v.countries?.length) env.SERVER_COUNTRIES = v.countries.join(',')
  return env
}

/** Install order: dependencies first. */
export function orderServices(ids: StackServiceId[]): StackServiceId[] {
  const out: StackServiceId[] = []
  const visit = (id: StackServiceId, seen: Set<StackServiceId>) => {
    if (out.includes(id)) return
    if (seen.has(id)) throw new Error(`dependency cycle at ${id}`)
    seen.add(id)
    for (const d of CATALOG[id].dependsOn ?? []) if (ids.includes(d)) visit(d, seen)
    out.push(id)
  }
  for (const id of ids) visit(id, new Set())
  return out
}

export const containerName = (id: StackServiceId) => `finesse-${id}`
