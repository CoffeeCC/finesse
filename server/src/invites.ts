// Invites — a drop-in port of deploy/invite-service/server.py: same routes
// (under /invite-api), same JSON shapes and status codes, same SQLite schema,
// so an existing invites.db just keeps working.

import { randomInt } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { inviteEmail, sendMail } from './email.ts'
import { ApiError, clientIp, readJson, sendJson, type Router } from './http/core.ts'
import { JfError, type Jellyfin } from './jellyfin.ts'

const USERNAME_RE = /^[A-Za-z0-9._-]{2,32}$/
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/
const CODE_RE = /^[A-Za-z0-9]{4,16}$/

interface InviteRow {
  id: number
  code: string
  created_at: string
  expires_at: string | null
  unlimited: number
  used: number
  used_at: string | null
  used_by_username: string | null
  allow_downloads: number
  allow_live_tv: number
  max_active_sessions: number | null
  label: string | null
  created_by: string | null
}
interface Lib {
  id: string
  name: string
}

export class InviteStore {
  readonly db: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        unlimited INTEGER NOT NULL DEFAULT 0,
        used INTEGER NOT NULL DEFAULT 0,
        used_at TEXT,
        used_by_username TEXT,
        allow_downloads INTEGER NOT NULL DEFAULT 1,
        allow_live_tv INTEGER NOT NULL DEFAULT 0,
        max_active_sessions INTEGER,
        label TEXT,
        created_by TEXT
      );
      CREATE TABLE IF NOT EXISTS invite_libraries (
        invite_id INTEGER NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
        library_id TEXT NOT NULL,
        name_cache TEXT,
        PRIMARY KEY (invite_id, library_id)
      );
      CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
    `)
  }

  byCode(code: string): InviteRow | undefined {
    return this.db.prepare('SELECT * FROM invites WHERE code = ? COLLATE NOCASE').get(code.trim()) as InviteRow | undefined
  }
  byId(id: number): InviteRow | undefined {
    return this.db.prepare('SELECT * FROM invites WHERE id = ?').get(id) as InviteRow | undefined
  }
  libs(id: number): Lib[] {
    return (this.db.prepare('SELECT library_id, name_cache FROM invite_libraries WHERE invite_id = ?').all(id) as { library_id: string; name_cache: string | null }[]).map(
      (r) => ({ id: r.library_id, name: r.name_cache || r.library_id }),
    )
  }
  all(): InviteRow[] {
    return this.db.prepare('SELECT * FROM invites ORDER BY id DESC').all() as unknown as InviteRow[]
  }
}

function status(row: InviteRow): 'used' | 'expired' | 'pending' {
  if (row.used && !row.unlimited) return 'used'
  if (row.expires_at) {
    const t = Date.parse(row.expires_at.replace(/\+00:00$/, 'Z'))
    if (!Number.isNaN(t) && t <= Date.now()) return 'expired'
  }
  return 'pending'
}

function rowPublic(row: InviteRow, libs: Lib[]) {
  return {
    code: row.code,
    status: status(row),
    label: row.label,
    libraries: libs.map((l) => l.name),
    allow_downloads: Boolean(row.allow_downloads),
    allow_live_tv: Boolean(row.allow_live_tv),
    expires_at: row.expires_at,
  }
}

function rowAdmin(row: InviteRow, libs: Lib[]) {
  return {
    ...rowPublic(row, libs),
    id: row.id,
    created_at: row.created_at,
    unlimited: Boolean(row.unlimited),
    used: Boolean(row.used),
    used_at: row.used_at,
    used_by_username: row.used_by_username,
    created_by: row.created_by,
    library_ids: libs.map((l) => l.id),
    max_active_sessions: row.max_active_sessions,
  }
}

// Wrong invite codes per address: invite codes are 8 random characters, but an
// admin can pick a short one ("FAMILY"), so guessing is slowed down.
const guesses = new Map<string, { n: number; since: number }>()
function guessLimit(req: IncomingMessage) {
  const g = guesses.get(clientIp(req))
  if (g && Date.now() - g.since < 10 * 60e3 && g.n >= 20) throw new ApiError(429, 'Too many wrong invite codes — wait a few minutes and check the link you were sent')
}
function wrongCode(req: IncomingMessage): ApiError {
  const ip = clientIp(req)
  const now = Date.now()
  const g = guesses.get(ip)
  const cur = g && now - g.since < 10 * 60e3 ? g : { n: 0, since: now }
  cur.n++
  guesses.set(ip, cur)
  if (guesses.size > 10000) guesses.clear()
  return new ApiError(404, 'Invite not found')
}

function generateCode(length = 8): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < length; i++) s += alphabet[randomInt(alphabet.length)]
  return s
}

export async function listLibraries(jf: Jellyfin): Promise<Lib[]> {
  try {
    const data = await jf.request<{ Items?: { Id: string; Name?: string }[] } | { Id: string; Name?: string }[]>('/Library/MediaFolders')
    const items = Array.isArray(data) ? data : data?.Items
    const out = (items ?? []).map((f) => ({ id: String(f.Id), name: f.Name || 'Library' }))
    if (out.length) return out
  } catch (e) {
    if (!(e instanceof JfError)) throw e
  }
  try {
    const folders = await jf.request<{ ItemId?: string; Guid?: string; Id?: string; Name?: string }[]>('/Library/VirtualFolders')
    return (folders ?? []).flatMap((f) => {
      const id = f.ItemId || f.Guid || f.Id
      return id ? [{ id: String(id), name: f.Name || 'Library' }] : []
    })
  } catch (e) {
    if (e instanceof JfError) throw new ApiError(502, `Could not list libraries: ${e.message}`)
    throw e
  }
}

async function createJellyfinUser(
  jf: Jellyfin,
  o: { username: string; password: string; libraryIds: string[]; allowDownloads: boolean; allowLiveTv: boolean; maxSessions: number | null },
): Promise<string> {
  let user: { Id: string }
  try {
    user = await jf.request<{ Id: string }>('/Users/New', { method: 'POST', body: { Name: o.username } })
  } catch (e) {
    if (e instanceof JfError && e.status === 400) throw new ApiError(400, 'That username is already taken')
    throw new ApiError(502, `Jellyfin create failed: ${(e as Error).message}`)
  }
  const uid = user.Id
  try {
    await jf.request(`/Users/${uid}/Password`, { method: 'POST', body: { Id: uid, NewPw: o.password } })
    const full = await jf.request<{ Policy?: Record<string, unknown> }>(`/Users/${uid}`)
    const policy: Record<string, unknown> = {
      ...(full.Policy ?? {}),
      IsAdministrator: false,
      IsHidden: false,
      IsDisabled: false,
      EnableContentDownloading: o.allowDownloads,
      EnableLiveTvAccess: o.allowLiveTv,
      EnableLiveTvManagement: false,
      EnableContentDeletion: false,
      EnableContentDeletionFromFolders: [],
      EnablePublicSharing: false,
      AllowCameraUpload: false,
      EnableSubtitleManagement: false,
      EnableRemoteControlOfOtherUsers: false,
      EnableSharedDeviceControl: false,
      EnableRemoteAccess: true,
      EnableMediaPlayback: true,
      EnableAudioPlaybackTranscoding: true,
      EnableVideoPlaybackTranscoding: true,
      EnablePlaybackRemuxing: true,
    }
    if (o.maxSessions !== null && o.maxSessions !== undefined) policy.MaxActiveSessions = o.maxSessions
    if (o.libraryIds.length) {
      policy.EnableAllFolders = false
      policy.EnabledFolders = o.libraryIds
    } else {
      policy.EnableAllFolders = true
    }
    await jf.request(`/Users/${uid}/Policy`, { method: 'POST', body: policy })
  } catch (e) {
    await jf.request(`/Users/${uid}`, { method: 'DELETE' }).catch(() => {})
    throw e
  }
  return uid
}

export function registerInvites(router: Router, deps: { store: InviteStore; jf: Jellyfin; auth: Auth; settings?: SettingsStore }) {
  const { store, jf, auth, settings } = deps
  const P = '/invite-api'

  router.get(`${P}/health`, ({ res }) => sendJson(res, 200, { status: 'ok' }))

  router.get(`${P}/v1/libraries`, async ({ req, res }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, { libraries: await listLibraries(jf) })
  })

  router.get(`${P}/v1/invites`, async ({ req, res }) => {
    await auth.requireAdmin(req)
    const rows = store.all()
    const invites = rows.map((r) => rowAdmin(r, store.libs(r.id)))
    sendJson(res, 200, { invites, count: invites.length })
  })

  router.get(`${P}/v1/invites/:code`, async ({ req, res, params }) => {
    const code = params.code!
    if (/^\d+$/.test(code)) {
      await auth.requireAdmin(req)
      const row = store.byId(Number(code))
      if (!row) throw new ApiError(404, 'Invite not found')
      return sendJson(res, 200, rowAdmin(row, store.libs(row.id)))
    }
    guessLimit(req)
    const row = store.byCode(code)
    if (!row) throw wrongCode(req)
    sendJson(res, 200, rowPublic(row, store.libs(row.id)))
  })

  router.post(`${P}/v1/join`, async ({ req, res }) => {
    const body = await readJson<Record<string, unknown>>(req)
    const code = String(body.code ?? '').trim()
    const username = String(body.username ?? '').trim()
    const password = String(body.password ?? '')
    if (!code || !CODE_RE.test(code)) throw new ApiError(400, 'Invalid invite code')
    if (!USERNAME_RE.test(username)) throw new ApiError(400, 'Username must be 2–32 characters (letters, numbers, . _ -)')
    if (!PASSWORD_RE.test(password)) throw new ApiError(400, 'Password must be 8+ characters with upper, lower, and a number')
    guessLimit(req)
    const row = store.byCode(code)
    if (!row) throw wrongCode(req)
    const st = status(row)
    if (st === 'used') throw new ApiError(410, 'This invite has already been used')
    if (st === 'expired') throw new ApiError(410, 'This invite has expired')
    // Claim a single-use invite before creating the account, so two people
    // joining with it at the same moment can't both get in.
    if (!row.unlimited && store.db.prepare('UPDATE invites SET used=1 WHERE id=? AND used=0').run(row.id).changes !== 1) {
      throw new ApiError(410, 'This invite has already been used')
    }
    const release = () => {
      if (!row.unlimited) store.db.prepare('UPDATE invites SET used=0 WHERE id=?').run(row.id)
    }
    let uid: string
    try {
      uid = await createJellyfinUser(jf, {
        username,
        password,
        libraryIds: store.libs(row.id).map((l) => l.id),
        allowDownloads: Boolean(row.allow_downloads),
        allowLiveTv: Boolean(row.allow_live_tv),
        maxSessions: row.max_active_sessions,
      })
    } catch (e) {
      release()
      if (e instanceof JfError) throw new ApiError(502, `Jellyfin error: ${e.message}`)
      throw e
    }
    const now = new Date().toISOString()
    if (!row.unlimited) store.db.prepare('UPDATE invites SET used=1, used_at=?, used_by_username=? WHERE id=?').run(now, username, row.id)
    else store.db.prepare('UPDATE invites SET used_at=?, used_by_username=? WHERE id=?').run(now, username, row.id)
    sendJson(res, 201, { ok: true, username, user_id: uid, message: 'Account created' })
  })

  router.post(`${P}/v1/invites`, async ({ req, res }) => {
    const me = await auth.requireAdmin(req)
    const body = await readJson<Record<string, unknown>>(req)
    const code = String(body.code ?? '').trim().toUpperCase() || generateCode()
    if (!CODE_RE.test(code)) throw new ApiError(400, 'Invalid code format')
    let expiresAt: string | null = null
    if (body.expires_in_days !== undefined && body.expires_in_days !== null) {
      const days = Number(body.expires_in_days)
      if (!Number.isInteger(days)) throw new ApiError(400, 'expires_in_days must be an integer')
      if (days > 0) expiresAt = new Date(Date.now() + days * 86400000).toISOString()
    }
    const libraryIds = body.library_ids ?? []
    if (!Array.isArray(libraryIds)) throw new ApiError(400, 'library_ids must be an array')
    const known = new Map((await listLibraries(jf)).map((l) => [l.id, l.name]))
    const resolved = libraryIds.map((id) => ({ id: String(id), name: known.get(String(id)) ?? String(id) }))
    if (store.byCode(code)) throw new ApiError(409, 'Invite code already exists')
    const maxSessions = body.max_active_sessions === undefined || body.max_active_sessions === null ? null : Number(body.max_active_sessions)
    const label = String(body.label ?? '').trim() || null
    const info = store.db
      .prepare(
        `INSERT INTO invites (code, created_at, expires_at, unlimited, used, allow_downloads, allow_live_tv, max_active_sessions, label, created_by)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .run(code, new Date().toISOString(), expiresAt, body.unlimited ? 1 : 0, body.allow_downloads === false ? 0 : 1, body.allow_live_tv ? 1 : 0, maxSessions, label, me.Name || 'admin')
    const id = Number(info.lastInsertRowid)
    const ins = store.db.prepare('INSERT INTO invite_libraries (invite_id, library_id, name_cache) VALUES (?,?,?)')
    for (const l of resolved) ins.run(id, l.id, l.name)
    sendJson(res, 201, rowAdmin(store.byId(id)!, resolved))
  })

  // Email an invite (needs SMTP set up). The link uses the public address when
  // there is one, else the address the admin is using right now.
  router.post(`${P}/v1/invites/:code/email`, async ({ req, res, params }) => {
    const me = await auth.requireAdmin(req)
    const s = settings?.get()
    if (!s?.email?.host) throw new ApiError(409, 'Set up email first (Settings → Server → Email)')
    const body = await readJson<{ to?: string; note?: string; origin?: string }>(req)
    const to = String(body.to ?? '').trim()
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new ApiError(400, 'Enter a valid email address')
    const row = /^\d+$/.test(params.code!) ? store.byId(Number(params.code)) : store.byCode(params.code!)
    if (!row) throw new ApiError(404, 'Invite not found')
    if (status(row) !== 'pending') throw new ApiError(410, `This invite is ${status(row)}`)
    const origin = (s.publicUrl || String(body.origin ?? '')).replace(/\/+$/, '')
    if (!/^https?:\/\//.test(origin)) throw new ApiError(400, 'Finesse doesn’t know its public address yet — set one in Settings → Server')
    const link = `${origin}/finesse/invite/${encodeURIComponent(row.code)}`
    const serverName = (await jf.request<{ ServerName?: string }>('/System/Info/Public').catch(() => ({}) as { ServerName?: string })).ServerName || 'Finesse'
    const mail = inviteEmail({ serverName, link, code: row.code, from: me.Id === 'service' ? undefined : me.Name, note: String(body.note ?? '').trim().slice(0, 500) || undefined, expires: row.expires_at })
    try {
      await sendMail(s.email, { to, ...mail })
    } catch (e) {
      throw new ApiError(502, (e as Error).message)
    }
    sendJson(res, 200, { ok: true, to, link })
  })

  router.delete(`${P}/v1/invites/:id`, async ({ req, res, params }) => {
    if (!/^\d+$/.test(params.id!)) throw new ApiError(404, 'Not found')
    await auth.requireAdmin(req)
    const row = store.byId(Number(params.id))
    if (!row) throw new ApiError(404, 'Invite not found')
    store.db.prepare('DELETE FROM invites WHERE id=?').run(row.id)
    sendJson(res, 200, { ok: true })
  })
}
