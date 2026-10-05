// Finesse server settings: a JSON file in the config dir (written atomically,
// mode 0600 — it holds API keys), overlaid by environment variables.
//
// Two ways to run:
//   bundle — Finesse installed the stack itself (setup wizard / headless apply)
//            and keeps every service's URL + key here.
//   adopt  — pointed at services that already exist (e.g. a NAS that ran nginx
//            + the Python invite service): JELLYFIN_URL / JELLYFIN_API_KEY /
//            RADARR_URL … in the environment. Env always wins over the file,
//            so an adopted install keeps working exactly as configured.

import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export type ServiceId =
  | 'jellyfin'
  | 'radarr'
  | 'sonarr'
  | 'lidarr'
  | 'prowlarr'
  | 'sabnzbd'
  | 'qbittorrent'
  | 'gluetun'
  | 'romm'
  | 'steamgriddb'

export interface Endpoint {
  /** Base URL as Finesse reaches it (inside the Docker network in bundle mode). */
  url?: string
  apiKey?: string
  username?: string
  password?: string
}

export type SetupState = 'new' | 'applying' | 'ready' | 'error'

export interface Settings {
  version: 1
  instanceId: string
  mode: 'bundle' | 'adopt'
  createdAt: string
  /** Where people reach Finesse (for invite links / QR codes); optional. */
  publicUrl?: string
  jellyfin: Endpoint & {
    /** Path Jellyfin itself serves under ("/jellyfin" in bundle mode, "" for a plain Jellyfin). */
    basePath: string
  }
  services: Partial<Record<Exclude<ServiceId, 'jellyfin'>, Endpoint>>
  setup: {
    state: SetupState
    /** scrypt hash of the one-time setup code (bundle mode, before setup). */
    codeHash?: string
    codeSalt?: string
    startedAt?: string
    completedAt?: string
    lastError?: string
    /** The last setup document applied (secrets included; it never leaves the server unmasked). */
    lastDoc?: unknown
  }
  updates: {
    repo: string
    /** Install new releases of the stack automatically (Finesse web builds always prompt). */
    auto: boolean
  }
  /** Host-side paths + choices the stack was built with (bundle mode). */
  stack?: {
    hostRoot: string
    hostData: string
    timezone: string
    puid: number
    pgid: number
    services: string[]
    /** Full VPN settings (secrets included) — needed to recreate Gluetun. */
    vpn?: import('./stack/catalog.ts').VpnConfig
    remote?: { method: 'none' | 'tailscale' | 'cloudflare'; tailscale?: { authKey: string; hostname: string }; cloudflare?: { token: string } }
    exposeJellyfin?: boolean
    jellyfinPort?: number
    quality?: string
    /** Game streaming (Wolf): whether Docker hands it the Nvidia card. */
    streaming?: { nvidia: boolean }
    /** Services an administrator stopped on purpose (the health loop leaves them alone). */
    paused?: string[]
  }
  /** Games (RomM) secrets, saved before RomM's database is first created — it
   *  keeps the password it was initialised with, so these must never change. */
  games?: import('./stack/catalog.ts').GamesConfig
  /** Hover/hero preview clips made from the library (bundle mode). */
  previews?: { enabled: boolean }
  /** Bookkeeping for the self-maintenance loop. */
  maintenance?: { lastBackup?: string; lastStackUpdate?: string }
  /** Quality profile names new requests use, per app. */
  requests?: { profiles: Record<string, string> }
  /** Groups: libraries shared between Finesse servers (see groups.ts). */
  groups?: GroupsState
  /** Game streaming through Wolf: its API socket (WOLF_SOCKET), and names for paired Moonlight devices. */
  streaming?: { socket?: string; devices?: Record<string, { name: string; pairedAt: string }> }
  /** Emulators as Wolf apps: which ones, and the folders they get (host paths). */
  emulators?: import('./emulators.ts').EmulatorSettings
  /** SMTP for emailing invites (optional). */
  email?: { host: string; port: number; secure?: boolean; username?: string; password?: string; from: string }
}

/** A server that watches libraries we share (we're the sharing side). */
export interface GroupLink {
  id: string
  name: string
  /** Where that server is reached (for its admins' reference; optional). */
  url?: string
  /** sha256 of the secret it signs its calls with. */
  secretHash: string
  /** Our Jellyfin library ids it can see. */
  libraries: string[]
  createdAt: string
  lastSeen?: string
  /** One hidden Jellyfin user per person on that server who opened something. */
  viewers: Record<string, { userId: string; name: string; password: string; token?: string }>
}

/** A server whose shared libraries our household watches. */
export interface GroupFriend {
  id: string
  name: string
  url: string
  linkId: string
  secret: string
  addedAt: string
}

export interface GroupsState {
  links: GroupLink[]
  friends: GroupFriend[]
  /** One-time pairing codes we handed out (hashed), with what they'll share. */
  codes: { hash: string; libraries: string[]; expires: string }[]
  /** A friend server offering to share back with us. */
  offers: { id: string; name: string; url: string; code: string; at: string }[]
}

export interface Paths {
  configDir: string
  settingsFile: string
  invitesDb: string
  /** Web build baked into the image (read-only). */
  bakedWeb: string
  /** Web builds installed by the in-app updater. */
  updatedWeb: string
  /** Legacy single web dir (FINESSE_DIST): served AND updated in place. */
  legacyDist?: string
  previews: string
  backups: string
}

const env = process.env

export function resolvePaths(): Paths {
  const configDir = resolve(env.FINESSE_CONFIG_DIR || '/config')
  return {
    configDir,
    settingsFile: join(configDir, 'finesse.json'),
    invitesDb: resolve(env.INVITES_DB || join(configDir, 'invites.db')),
    bakedWeb: resolve(env.FINESSE_WEB_DIR || '/app/web'),
    updatedWeb: join(configDir, 'web'),
    legacyDist: env.FINESSE_DIST ? resolve(env.FINESSE_DIST) : undefined,
    previews: resolve(env.FINESSE_PREVIEWS_DIR || join(configDir, 'previews')),
    backups: resolve(env.FINESSE_BACKUP_DIR || join(configDir, 'backups')),
  }
}

function defaults(): Settings {
  return {
    version: 1,
    instanceId: randomUUID(),
    mode: 'bundle',
    createdAt: new Date().toISOString(),
    jellyfin: { basePath: '' },
    services: {},
    setup: { state: 'new' },
    updates: { repo: 'CoffeeCC/finesse', auto: true },
  }
}

const ENV_SERVICES: [Exclude<ServiceId, 'jellyfin'>, string][] = [
  ['radarr', 'RADARR'],
  ['sonarr', 'SONARR'],
  ['lidarr', 'LIDARR'],
  ['prowlarr', 'PROWLARR'],
  ['sabnzbd', 'SAB'],
  ['qbittorrent', 'QBIT'],
  ['romm', 'ROMM'],
  ['steamgriddb', 'STEAMGRIDDB'],
]

/** Environment overlay (never written back to disk). */
function applyEnv(s: Settings): Settings {
  const out: Settings = structuredClone(s)
  if (env.JELLYFIN_URL) out.jellyfin.url = env.JELLYFIN_URL.replace(/\/+$/, '')
  if (env.JELLYFIN_API_KEY) out.jellyfin.apiKey = env.JELLYFIN_API_KEY.trim()
  if (env.JELLYFIN_BASE_PATH !== undefined) out.jellyfin.basePath = normalizeBase(env.JELLYFIN_BASE_PATH)
  for (const [id, prefix] of ENV_SERVICES) {
    const url = env[`${prefix}_URL`]
    const key = env[`${prefix}_API_KEY`] ?? env[`${prefix}_KEY`]
    const user = env[`${prefix}_USERNAME`]
    const pass = env[`${prefix}_PASSWORD`]
    if (url || key || user || pass) {
      const cur = out.services[id] ?? {}
      out.services[id] = {
        ...cur,
        ...(url ? { url: url.replace(/\/+$/, '') } : {}),
        ...(key ? { apiKey: key.trim() } : {}),
        ...(user ? { username: user } : {}),
        ...(pass ? { password: pass } : {}),
      }
    }
  }
  if (env.WOLF_SOCKET?.trim()) out.streaming = { ...out.streaming, socket: env.WOLF_SOCKET.trim() }
  if (env.FINESSE_REPO) out.updates.repo = env.FINESSE_REPO.trim()
  if (env.FINESSE_PUBLIC_URL) out.publicUrl = env.FINESSE_PUBLIC_URL.replace(/\/+$/, '')
  // Env-configured Jellyfin with no settings file = an adopted, already-running setup.
  if (env.JELLYFIN_URL && env.JELLYFIN_API_KEY && s.setup.state === 'new' && !s.stack) {
    out.mode = 'adopt'
    out.setup = { ...out.setup, state: 'ready' }
  }
  if (env.FINESSE_MODE === 'adopt' || env.FINESSE_MODE === 'bundle') out.mode = env.FINESSE_MODE
  return out
}

export function normalizeBase(p: string): string {
  const t = p.trim().replace(/\/+$/, '')
  if (!t) return ''
  return t.startsWith('/') ? t : `/${t}`
}

export class SettingsStore {
  private file: Settings
  private merged: Settings
  readonly paths: Paths

  constructor(paths: Paths = resolvePaths()) {
    this.paths = paths
    this.file = this.load()
    this.merged = applyEnv(this.file)
  }

  private load(): Settings {
    if (!existsSync(this.paths.settingsFile)) return defaults()
    const raw = JSON.parse(readFileSync(this.paths.settingsFile, 'utf8')) as Partial<Settings>
    const d = defaults()
    return {
      ...d,
      ...raw,
      jellyfin: { ...d.jellyfin, ...raw.jellyfin },
      services: { ...raw.services },
      setup: { ...d.setup, ...raw.setup },
      updates: { ...d.updates, ...raw.updates },
    }
  }

  /** Effective settings (file + env). */
  get(): Settings {
    return this.merged
  }

  /** Change the persisted settings; env overrides are re-applied on top. */
  update(fn: (s: Settings) => void): Settings {
    const next = structuredClone(this.file)
    fn(next)
    this.file = next
    this.persist()
    this.merged = applyEnv(this.file)
    return this.merged
  }

  private persist() {
    mkdirSync(dirname(this.paths.settingsFile), { recursive: true })
    const tmp = `${this.paths.settingsFile}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(this.file, null, 2) + '\n', { mode: 0o600 })
    try {
      chmodSync(tmp, 0o600)
    } catch {
      /* some filesystems (NFSv4 ACL datasets) refuse chmod — the create mode stands */
    }
    renameSync(tmp, this.paths.settingsFile)
  }

  /** Persist once so a fresh install gets a stable instance id. */
  ensureSaved() {
    if (!existsSync(this.paths.settingsFile)) this.persist()
  }
}
