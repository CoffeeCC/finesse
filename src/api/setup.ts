/** Client for the Finesse server's setup + system APIs (/api/setup, /api/system). */

import { mediaBrowserAuthHeader, withToken } from './client'
import { finesseApi } from '../lib/finesseServer'

const CODE_KEY = 'finesse.setupCode'

export function getSetupCode(): string {
  try {
    return sessionStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setSetupCode(code: string) {
  try {
    if (code) sessionStorage.setItem(CODE_KEY, code)
    else sessionStorage.removeItem(CODE_KEY)
  } catch {
    /* private mode */
  }
}

export class ApiError extends Error {
  status: number
  details?: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

async function call<T>(method: string, path: string, body?: unknown, opts: { admin?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const code = getSetupCode()
  if (code) headers['X-Finesse-Setup-Code'] = code
  if (opts.admin !== false) {
    try {
      headers.Authorization = mediaBrowserAuthHeader()
    } catch {
      /* not signed in (setup) */
    }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000)
  let res: Response
  try {
    res = await fetch(finesseApi(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal })
  } catch (e) {
    throw new ApiError(0, (e as Error).name === 'AbortError' ? 'Finesse took too long to answer' : 'Can’t reach Finesse')
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const d = data as { error?: string; details?: unknown } | null
    throw new ApiError(res.status, d?.error || res.statusText || 'Request failed', d?.details)
  }
  return data as T
}

// ---------- types ----------

export interface Verdict {
  ok: boolean
  message: string
  detail?: Record<string, unknown>
}

export interface SystemItem extends Verdict {
  id: 'docker' | 'data' | 'root' | 'tun' | 'gpu' | 'ports' | 'machine' | string
  title: string
}

export interface VpnProvider {
  id: string
  name: string
  wireguard: boolean
  openvpn: boolean
  help: string
}

export interface SetupInfo {
  state: string
  mode: string
  defaults: { timezone: string; root: string; data: string; puid: number; pgid: number; gpu: boolean }
  vpnProviders: VpnProvider[]
  indexerSuggestions: { name: string; url: string }[]
  catalog: { id: string; name: string; role: string; image: string }[]
  lastError: string | null
}

export interface UsenetServer {
  name: string
  host: string
  port: number
  ssl: boolean
  username: string
  password: string
  connections: number
  priority?: number
}

export interface Indexer {
  name: string
  kind: 'newznab' | 'torznab'
  url: string
  apiKey?: string
}

export interface VpnDoc {
  provider: string
  type: 'wireguard' | 'openvpn'
  wireguard?: { privateKey: string; addresses?: string; presharedKey?: string; endpointIp?: string; endpointPort?: number; publicKey?: string }
  openvpn?: { username: string; password: string }
  countries?: string[]
}

export interface EmailDoc {
  host: string
  port: number
  secure?: boolean
  username?: string
  password?: string
  from: string
}

export interface SetupDoc {
  admin: { username: string; password: string }
  server?: { name?: string; language?: string; country?: string; timezone?: string }
  libraries?: { movies?: boolean; shows?: boolean; music?: boolean; games?: boolean; samples?: boolean }
  games?: { igdb?: { clientId: string; clientSecret: string }; steamGridDbKey?: string; screenscraper?: { username: string; password: string } }
  downloads?: { usenet?: { servers: UsenetServer[] } | null; torrents?: { vpn: VpnDoc } | null; indexers?: Indexer[] }
  quality?: { preset?: '720p' | '1080p' | '4k' | 'any' }
  remoteAccess?: { method: 'none' | 'tailscale' | 'cloudflare'; tailscale?: { authKey: string; hostname?: string }; cloudflare?: { token: string; publicUrl: string } }
  publicUrl?: string
  email?: EmailDoc | null
  options?: { exposeJellyfinPort?: boolean; jellyfinPort?: number }
}

export interface Problem {
  path: string
  message: string
}

export type StepState = 'pending' | 'running' | 'done' | 'error' | 'skipped'
export interface RunStatus {
  state: 'idle' | 'running' | 'done' | 'error'
  steps: { id: string; title: string; state: StepState; detail?: string; progress?: number }[]
  log: string[]
  warnings: string[]
  error?: string
  startedAt?: string
  finishedAt?: string
  services?: string[]
  setup?: string
}

// ---------- setup ----------

export const setupApi = {
  checkCode: () => call<{ ok: boolean }>('POST', '/api/setup/code', undefined, { admin: false }),
  info: () => call<SetupInfo>('GET', '/api/setup/info'),
  checkSystem: () => call<{ ok: boolean; items: SystemItem[] }>('POST', '/api/setup/check/system', undefined, { timeoutMs: 60000 }),
  /** A finished server: its last setup, with every secret masked (KEEP). null on older installs. */
  current: () => call<{ doc: SetupDoc | null }>('GET', '/api/setup/current'),
  checkUsenet: (s: UsenetServer) => call<Verdict>('POST', '/api/setup/check/usenet', s, { timeoutMs: 45000 }),
  checkIndexer: (ix: Indexer) => call<Verdict>('POST', '/api/setup/check/indexer', ix, { timeoutMs: 45000 }),
  checkVpn: (v: VpnDoc) => call<Verdict & { problems?: Problem[] }>('POST', '/api/setup/check/vpn', v, { timeoutMs: 240000 }),
  validate: (d: SetupDoc) => call<{ ok: boolean; problems: Problem[] }>('POST', '/api/setup/validate', d),
  apply: (d: SetupDoc) => call<RunStatus>('POST', '/api/setup/apply', d),
  status: () => call<RunStatus>('GET', '/api/setup/status'),
}

// ---------- system (admins) ----------

export type ServiceState = 'running' | 'starting' | 'restarting' | 'stopped' | 'paused' | 'missing' | 'unreachable'

export type BackupPart = 'settings' | 'apps' | 'watch' | 'requests' | 'games'
export interface BackupFile {
  name: string
  size: number
  at: string
  parts?: BackupPart[]
}
export interface BackupPartInfo {
  id: BackupPart
  label: string
  detail: string
  available: boolean
  bytes: number
  why?: string
}

export interface SystemStatus {
  version: string
  web: string | null
  mode: 'bundle' | 'adopt'
  setup: { state: string; completedAt: string | null; running: boolean }
  stack: { root: string; data: string; services: string[]; quality?: string; paused: string[]; jellyfinPort: number | null } | null
  updates: { auto: boolean; lastStackUpdate: string | null }
  busy: boolean
  previews?: { enabled: boolean; made: number; pending: number; total: number; lastRun: string | null }
  games?: { enabled: boolean; folder: string | null; job: { state: 'idle' | 'working' | 'done' | 'error'; detail?: string; error?: string } }
  streaming?: { enabled: boolean; job: { state: 'idle' | 'working' | 'done' | 'error'; detail?: string; error?: string } }
  backup?: { job: { state: 'idle' | 'working' | 'done' | 'error'; step?: string; file?: BackupFile; error?: string } }
  health: {
    checkedAt: string | null
    docker: boolean
    network: boolean
    services: { id: string; name: string; role: string; state: ServiceState; detail?: string; image: string; updatePending: boolean; startedAt?: string }[]
    vpn: { connected: boolean; publicIp?: string; country?: string; city?: string; error?: string } | null
    disks: { label: string; path: string; total: number; free: number }[]
    backups: { last: string | null; files: BackupFile[]; error?: string }
    events: { at: string; level: 'info' | 'warn' | 'error'; message: string }[]
  }
}

export const systemApi = {
  status: (refresh = false) => call<SystemStatus>('GET', `/api/system/status${refresh ? '?refresh' : ''}`, undefined, { timeoutMs: 60000 }),
  restart: (id: string) => call<{ ok: boolean }>('POST', `/api/system/services/${id}/restart`, undefined, { timeoutMs: 90000 }),
  stop: (id: string) => call<{ ok: boolean }>('POST', `/api/system/services/${id}/stop`, undefined, { timeoutMs: 90000 }),
  start: (id: string) => call<{ ok: boolean }>('POST', `/api/system/services/${id}/start`, undefined, { timeoutMs: 90000 }),
  logs: async (id: string, tail = 300) => {
    const res = await fetch(finesseApi(`/api/system/services/${id}/logs?tail=${tail}`), { headers: { Authorization: mediaBrowserAuthHeader() } })
    if (!res.ok) throw new ApiError(res.status, 'Couldn’t load the logs')
    return res.text()
  },
  updateApps: () => call<{ updated: string[] }>('POST', '/api/system/update-apps', {}, { timeoutMs: 900000 }),
  setPreviews: (enabled: boolean) => call<{ enabled: boolean }>('PUT', '/api/system/previews', { enabled }),
  setGames: (enabled: boolean, steamGridDbKey?: string) => call<{ job: unknown }>('PUT', '/api/system/games', { enabled, ...(steamGridDbKey ? { steamGridDbKey } : {}) }),
  setStreaming: (enabled: boolean) => call<{ job: unknown }>('PUT', '/api/system/streaming', { enabled }),
  streamingCheck: () => call<StreamingCheck>('GET', '/api/system/streaming/check', undefined, { timeoutMs: 60000 }),
  makePreviews: () => call<{ started: boolean }>('POST', '/api/system/previews'),
  setAutoUpdates: (auto: boolean) => call<{ auto: boolean }>('PUT', '/api/system/updates', { auto }),
  backupParts: () => call<{ parts: BackupPartInfo[] }>('GET', '/api/system/backups/parts'),
  /** Starts a backup in the background; follow it in status().backup.job. */
  startBackup: (parts: BackupPart[]) => call<{ job: unknown }>('POST', '/api/system/backups', { parts }),
  /** A one-time link the browser can download directly (big backups never pass through memory). */
  backupLink: async (name: string) => finesseApi((await call<{ url: string }>('POST', `/api/system/backups/${encodeURIComponent(name)}/link`)).url),
  email: () => call<{ email: (Omit<EmailDoc, 'password'> & { hasPassword: boolean }) | null; publicUrl: string | null }>('GET', '/api/system/email'),
  saveEmail: (body: { email?: (Partial<EmailDoc> & { keepPassword?: boolean }) | null; publicUrl?: string | null }) =>
    call<{ email: (Omit<EmailDoc, 'password'> & { hasPassword: boolean }) | null; publicUrl: string | null }>('PUT', '/api/system/email', body),
  testEmail: (to: string) => call<{ ok: boolean }>('POST', '/api/system/email/test', { to }, { timeoutMs: 45000 }),
}

// ---------- Groups: libraries shared between Finesse servers ----------

export interface Friend {
  id: string
  name: string
}
export interface GroupsOverview {
  name: string
  publicUrl: string | null
  libraries: { id: string; name: string; type: string | null }[]
  /** Servers that watch ours. */
  links: { id: string; name: string; url: string | null; libraries: string[]; createdAt: string; lastSeen: string | null; viewers: string[] }[]
  /** Servers whose libraries we watch. */
  friends: (Friend & { url: string; addedAt: string })[]
  codes: number
  offers: { id: string; name: string; url: string; at: string }[]
}

export const groupsApi = {
  /** Everyone at home: the friends' servers this one watches. */
  friends: () => call<{ friends: Friend[] }>('GET', '/api/groups/friends'),
  overview: () => call<GroupsOverview>('GET', '/api/groups'),
  createCode: (libraries: string[]) => call<{ code: string; expires: string }>('POST', '/api/groups/codes', { libraries }),
  setLinkLibraries: (id: string, libraries: string[]) => call<{ ok: boolean }>('PUT', `/api/groups/links/${id}`, { libraries }),
  removeLink: (id: string) => call<{ ok: boolean }>('DELETE', `/api/groups/links/${id}`),
  addFriend: (url: string, code: string) => call<Friend>('POST', '/api/groups/friends', { url, code }, { timeoutMs: 45000 }),
  removeFriend: (id: string) => call<{ ok: boolean }>('DELETE', `/api/groups/friends/${id}`),
  offer: (id: string, libraries: string[]) => call<{ ok: boolean }>('POST', `/api/groups/friends/${id}/offer`, { libraries }, { timeoutMs: 45000 }),
  acceptOffer: (id: string) => call<Friend>('POST', `/api/groups/offers/${id}/accept`, undefined, { timeoutMs: 45000 }),
  dismissOffer: (id: string) => call<{ ok: boolean }>('DELETE', `/api/groups/offers/${id}`),
}

// ---------- Game streaming (Wolf + Moonlight) ----------

export interface StreamApp {
  id: string
  title: string
  hdr: boolean
  icon: boolean
  /** Wolf UI: what Moonlight opens to reach the profiles' apps. */
  launcher?: true
}

export interface StreamProfile {
  id: string
  name: string
  apps: StreamApp[]
}

/** What game streaming needs from the server (Settings → Server, before turning it on). */
export interface StreamingCheck {
  gpu: 'nvidia' | 'intel-amd' | null
  allGood: boolean
  items: { id: string; ok: boolean; title: string; detail: string; fix?: string[] }[]
  /** Why Wolf can't run on this server at all; it isn't offered then. */
  blocked?: string
}

export interface StreamingAdmin {
  ok: boolean
  error?: string
  pending: { id: string; ip: string }[]
  devices: { id: string; name: string | null; pairedAt: string | null }[]
}

export type EmulatorId = 'pcsx2' | 'dolphin' | 'rpcs3' | 'cemu' | 'switch' | 'esde'

/** One of Finesse's emulator apps in Wolf: the RomM consoles it plays, and the profiles that have it. */
export interface StreamEmulator {
  id: EmulatorId
  title: string
  consoles: string[]
  profiles: string[]
  /** A game can be started in an open Moonlight session from Finesse. */
  play: boolean
}

/** The emulator apps' settings (host paths, as Wolf sees them). */
export interface EmulatorSettings {
  apps: EmulatorId[]
  switchEmulator?: 'ryujinx' | 'eden'
  paths: { roms?: string; emulators?: string; firmware?: string; keys?: string; saves?: string }
  folders?: Partial<Record<EmulatorId, { firmware?: string; keys?: string }>>
  profiles?: string[]
}

export interface EmulatorReadiness {
  id: EmulatorId
  title: string
  name: string
  consoles: string[]
  ready: boolean
  items: { label: string; state: 'ok' | 'missing' | 'unseen'; required: boolean; detail: string }[]
}

export interface StreamSession {
  id: string
  ip: string
  app: string | null
}

export const streamingApi = {
  /** Everyone at home: what Wolf can stream. */
  apps: () => call<{ ok: boolean; apps: StreamApp[]; profiles?: StreamProfile[]; emulators?: StreamEmulator[]; error?: string }>('GET', '/api/streaming'),
  iconUrl: (id: string) => withToken(finesseApi(`/api/streaming/apps/${encodeURIComponent(id)}/icon`)),
  admin: () => call<StreamingAdmin>('GET', '/api/streaming/admin'),
  pair: (request: string, pin: string, name: string) =>
    call<{ ok: boolean; error?: string; device?: { id: string; name: string } }>('POST', '/api/streaming/pair', { request, pin, name }, { timeoutMs: 30000 }),
  remove: (id: string) => call<{ ok: boolean }>('DELETE', `/api/streaming/devices/${encodeURIComponent(id)}`),
  /** Administrators: the emulator apps, their folders, and what each still needs. */
  emulators: () => call<{ settings: EmulatorSettings | null; readiness: EmulatorReadiness[]; profiles: { id: string; name: string }[] }>('GET', '/api/streaming/emulators'),
  saveEmulators: (s: EmulatorSettings) =>
    call<{ ok: boolean; error?: string; profiles?: string[]; changed?: boolean; readiness: EmulatorReadiness[] }>('PUT', '/api/streaming/emulators', s, { timeoutMs: 60000 }),
  /** Moonlight sessions open right now. */
  sessions: () => call<{ ok: boolean; sessions: StreamSession[]; error?: string }>('GET', '/api/streaming/sessions'),
  /** Start a RomM game in an open Moonlight session. */
  play: (rom: number, session: string, profile?: string) => call<{ ok: boolean; app: string }>('POST', '/api/streaming/play', { rom, session, profile }, { timeoutMs: 30000 }),
}

// ---------- Browser play (Selkies) ----------

export interface PlaySession {
  id: string
  title: string
  emulator: EmulatorId
  state: 'starting' | 'ready' | 'error'
  detail: string | null
  error: string | null
  /** The player's page on the Finesse server (/play/<id>/). */
  url: string
}

export const playApi = {
  start: (rom: number, profile?: string) => call<PlaySession>('POST', '/api/play', { rom, profile }, { timeoutMs: 30000 }),
  get: (id: string) => call<PlaySession>('GET', `/api/play/${encodeURIComponent(id)}`),
  stop: (id: string) => call<{ ok: boolean }>('DELETE', `/api/play/${encodeURIComponent(id)}`),
  /** Ends the game as the page goes away (a request that outlives the page). */
  stopOnLeave: (id: string) => {
    try {
      void fetch(finesseApi(`/api/play/${encodeURIComponent(id)}`), { method: 'DELETE', keepalive: true, headers: { Authorization: mediaBrowserAuthHeader() } }).catch(() => {})
    } catch {
      /* signed out */
    }
  },
}
