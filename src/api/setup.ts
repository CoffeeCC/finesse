/** Client for the Finesse server's setup + system APIs (/api/setup, /api/system). */

import { mediaBrowserAuthHeader } from './client'
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
  libraries?: { movies?: boolean; shows?: boolean; music?: boolean; games?: boolean }
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
  checkUsenet: (s: UsenetServer) => call<Verdict>('POST', '/api/setup/check/usenet', s, { timeoutMs: 45000 }),
  checkIndexer: (ix: Indexer) => call<Verdict>('POST', '/api/setup/check/indexer', ix, { timeoutMs: 45000 }),
  checkVpn: (v: VpnDoc) => call<Verdict & { problems?: Problem[] }>('POST', '/api/setup/check/vpn', v, { timeoutMs: 150000 }),
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
