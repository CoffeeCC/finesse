// Who is calling: Jellyfin tokens (validated against Jellyfin, briefly cached),
// the service's own API key (ops scripts, treated as admin), and — before setup
// — the one-time setup code.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import type { Settings, SettingsStore } from './config.ts'
import { ApiError } from './http/core.ts'
import { JfError, type Jellyfin, type JfUser } from './jellyfin.ts'
import { logger } from './log.ts'

const log = logger('auth')

/** Pulls a Jellyfin token out of whichever header form the client used. */
export function tokenFrom(req: IncomingMessage, opts: { cookie?: string; query?: URLSearchParams } = {}): string | null {
  const h = req.headers
  const direct = h['x-emby-token'] ?? h['x-mediabrowser-token']
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  for (const header of [h.authorization, h['x-emby-authorization']]) {
    if (typeof header !== 'string' || !header.trim()) continue
    const m = /Token="([^"]+)"/i.exec(header)
    if (m) return m[1]!
    if (/^bearer\s+/i.test(header)) return header.replace(/^bearer\s+/i, '').trim()
    if (!/^(mediabrowser|emby)\s/i.test(header)) return header.trim()
  }
  if (opts.cookie && typeof h.cookie === 'string') {
    for (const part of h.cookie.split(';')) {
      const [k, ...v] = part.trim().split('=')
      if (k === opts.cookie && v.length) return decodeURIComponent(v.join('='))
    }
  }
  // Jellyfin's own form for media URLs a <video> loads (it can't send headers).
  const q = opts.query?.get('ApiKey') ?? opts.query?.get('api_key')
  if (q?.trim()) return q.trim()
  return null
}

const hash = (t: string) => createHash('sha256').update(t).digest('hex')

/** Jellyfin user ids of friends' viewers on this server (Groups): never household members. */
export function groupUserIds(s: Settings): Set<string> {
  const out = new Set<string>()
  for (const l of s.groups?.links ?? []) for (const v of Object.values(l.viewers)) out.add(v.userId)
  return out
}

export class Auth {
  private cache = new Map<string, { user: JfUser | null; at: number }>()
  private settings: SettingsStore
  private jf: Jellyfin

  constructor(settings: SettingsStore, jf: Jellyfin) {
    this.settings = settings
    this.jf = jf
  }

  /** Resolves a token to its Jellyfin user (positive 30s / negative 5s cache). */
  async userFor(token: string): Promise<JfUser | null> {
    const key = hash(token)
    const hit = this.cache.get(key)
    const now = Date.now()
    if (hit && now - hit.at < (hit.user ? 30000 : 5000)) return hit.user
    let user: JfUser | null
    try {
      user = await this.jf.me(token)
    } catch (e) {
      if (e instanceof JfError) {
        // Jellyfin is restarting (an update, a repair): a sign-in it confirmed
        // in the last few hours still counts, so admins can watch it come back.
        if (hit?.user && now - hit.at < 6 * 3600e3) return hit.user
        throw new ApiError(502, "Couldn't reach Jellyfin to check your sign-in")
      }
      throw e
    }
    if (this.cache.size > 5000) this.cache.clear()
    this.cache.set(key, { user, at: now })
    return user
  }

  private isServiceKey(token: string): boolean {
    const key = this.settings.get().jellyfin.apiKey
    if (!key) return false
    const a = Buffer.from(token)
    const b = Buffer.from(key)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  async requireUser(req: IncomingMessage, opts: { cookie?: string; query?: URLSearchParams } = {}): Promise<JfUser> {
    const token = tokenFrom(req, opts)
    if (!token) throw new ApiError(401, 'Sign in required')
    if (this.isServiceKey(token)) return { Id: 'service', Name: 'api-key', Policy: { IsAdministrator: true } }
    const user = await this.userFor(token)
    if (!user) throw new ApiError(401, 'Invalid session')
    // A friend's viewer (Groups) only ever plays through the friend proxy, never as one of us.
    if (groupUserIds(this.settings.get()).has(user.Id)) throw new ApiError(403, 'This account belongs to a friend’s server')
    return user
  }

  async requireAdmin(req: IncomingMessage): Promise<JfUser> {
    const token = tokenFrom(req)
    if (!token) throw new ApiError(401, 'Admin authentication required')
    const user = await this.requireUser(req)
    if (!user.Policy?.IsAdministrator) throw new ApiError(403, 'Administrator access required')
    return user
  }
}

// ---------- One-time setup code ----------
// Printed by the installer / container log, required by every setup call until
// setup completes. Stops a neighbour on the same network from claiming a fresh
// box. Stored hashed in settings; the plain code also sits in a 0600 file so
// `finesse setup-code` can show it again. Both go away once setup is done.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

export function newSetupCode(): string {
  const bytes = randomBytes(8)
  let s = ''
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i]! % ALPHABET.length]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

export function setupCodeFile(settings: SettingsStore): string {
  return join(settings.paths.configDir, 'setup-code')
}

/** Ensures a setup code exists while setup is pending; returns it (or null once set up). */
export function ensureSetupCode(settings: SettingsStore): string | null {
  const s = settings.get()
  if (s.mode !== 'bundle' || s.setup.state === 'ready') {
    clearSetupCode(settings)
    return null
  }
  const file = setupCodeFile(settings)
  if (s.setup.codeHash && existsSync(file)) return readFileSync(file, 'utf8').trim()
  const code = process.env.FINESSE_SETUP_CODE?.trim().toUpperCase() || newSetupCode()
  const salt = randomBytes(16).toString('hex')
  const digest = scryptSync(code.replace(/-/g, ''), salt, 32).toString('hex')
  settings.update((x) => {
    x.setup.codeHash = digest
    x.setup.codeSalt = salt
  })
  writeFileSync(file, code + '\n', { mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {
    /* ignore */
  }
  return code
}

export function clearSetupCode(settings: SettingsStore) {
  rmSync(setupCodeFile(settings), { force: true })
  if (settings.get().setup.codeHash) {
    settings.update((x) => {
      delete x.setup.codeHash
      delete x.setup.codeSalt
    })
  }
}

const attempts = new Map<string, { n: number; since: number }>()
let totalFailures = 0

/** Verifies the X-Finesse-Setup-Code header (rate-limited per client). */
export function requireSetupCode(settings: SettingsStore, req: IncomingMessage) {
  const s = settings.get()
  if (s.setup.state === 'ready') throw new ApiError(409, 'Finesse is already set up — sign in as an administrator instead')
  if (!s.setup.codeHash || !s.setup.codeSalt) throw new ApiError(503, 'No setup code yet — restart Finesse')
  checkSetupCode(s.setup.codeSalt, s.setup.codeHash, req)
}

/** The code check itself, with its limits: a few wrong tries per client a minute, and a cap overall.
 *  A code of the wrong shape is turned away before the (deliberately slow) hash. */
export function checkSetupCode(salt: string, codeHash: string, req: IncomingMessage) {
  const ip = req.socket.remoteAddress ?? '?'
  const now = Date.now()
  const a = attempts.get(ip)
  if (a && now - a.since < 60000 && a.n >= 10) throw new ApiError(429, 'Too many wrong setup codes — wait a minute')
  if (totalFailures > 200) throw new ApiError(429, 'Setup is locked after too many wrong codes — restart Finesse to try again')
  const given = String(req.headers['x-finesse-setup-code'] ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  const ok = given.length === 8 && timingSafeEqual(scryptSync(given, salt, 32), Buffer.from(codeHash, 'hex'))
  if (!ok) {
    totalFailures++
    const cur = a && now - a.since < 60000 ? a : { n: 0, since: now }
    cur.n++
    attempts.set(ip, cur)
    log.warn(`wrong setup code from ${ip}`)
    throw new ApiError(401, 'That setup code isn’t right')
  }
  attempts.delete(ip)
}
