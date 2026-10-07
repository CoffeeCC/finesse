// Groups: households that each run Finesse share chosen libraries with each
// other, watch-only.
//
// Two servers pair with a one-time code. The sharing server keeps a "link" for
// every server that watches it: which of its libraries that server sees, and a
// hashed secret the watching server signs its calls with. The watching server
// keeps a "friend" with the address and the secret.
//
// When someone on the watching server opens a friend's library, the call goes
// to their own Finesse (/api/groups/friends/:id/jellyfin/…), which checks their
// sign-in and passes it on to the friend's Finesse (/api/groups/peer/jellyfin/…)
// with the secret and who is watching. The friend's Finesse gives each such
// person a hidden Jellyfin user of their own: it only sees the shared libraries
// and can only play them (no requests, downloads, deleting, subtitles editing or
// signing in anywhere), so watch progress is per person. Its token never leaves
// the friend's server: replies carry a placeholder, which the watching server
// swaps for the person's own sign-in so media URLs keep working. Only the
// calls the app needs to browse and play get through.
//
// Unpairing from either side, or changing what's shared, takes effect on the
// next request.

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { groupUserIds, tokenFrom, type Auth } from './auth.ts'

export { groupUserIds }
import type { GroupFriend, GroupLink, GroupsState, Settings, SettingsStore } from './config.ts'
import { ApiError, clientIp, readJson, sendJson, type Router } from './http/core.ts'
import { joinUrl, proxyHttp } from './http/proxy.ts'
import { JfError, mediaBrowserHeader, type Jellyfin } from './jellyfin.ts'
import { logger } from './log.ts'
import type { GroupsApi } from './moments.ts'

const log = logger('groups')

/** Stands in for a friend's Jellyfin token in anything that leaves their server. */
export const PEER_TOKEN = 'FINESSE_PEER_TOKEN'
const CODE_TTL_MS = 7 * 24 * 3600e3
const SEEN_EVERY_MS = 10 * 60e3
// Library kinds the app can't show from a friend's server, so they're never offered.
// (Playlists belong to one person, and the app has no pages for the others.)
const NOT_SHARED = new Set(['musicvideos', 'playlists', 'books', 'photos', 'livetv'])
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const newId = () => randomBytes(5).toString('hex').slice(0, 8)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function newPairCode(): string {
  let c = ''
  for (let i = 0; i < 12; i++) c += ALPHABET[randomInt(ALPHABET.length)]
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`
}
const normCode = (c: unknown) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export function groupsOf(s: Settings): GroupsState {
  const g = s.groups
  return { links: g?.links ?? [], friends: g?.friends ?? [], codes: g?.codes ?? [], offers: g?.offers ?? [], orphans: g?.orphans ?? [] }
}

/** "sam.example.com", "https://x.ts.net/finesse/" → "https://sam.example.com", "https://x.ts.net". */
export function normalizeServerUrl(input: unknown): string {
  let raw = String(input ?? '').trim()
  if (!raw) throw new ApiError(400, 'Enter your friend’s Finesse address')
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new ApiError(400, 'That doesn’t look like a web address')
  }
  // Plain http sends the link's secret as it is: fine at home, not across the internet.
  if (u.protocol === 'http:' && !privateHost(u.hostname)) throw new ApiError(400, 'Use the https:// address (or the Tailscale one), so the link between your servers is encrypted')
  const path = u.pathname.replace(/\/finesse(\/.*)?$/i, '').replace(/\/+$/, '')
  return `${u.protocol}//${u.host}${path}`
}

/** A host that's only reachable at home (or on Tailscale): this machine, a LAN address or name. */
export function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa') || !h.includes('.') && !h.includes(':')) return true
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
}

// ---------- which friend calls get through (after the user id is pinned) ----------

const ID = '[0-9a-f]{32}'
const ALLOWED: Record<string, RegExp[]> = {
  GET: [
    new RegExp(`^users/${ID}/(views|items|items/latest|items/resume|items/${ID}|items/${ID}/(intros|localtrailers|specialfeatures))$`),
    /^(userviews|useritems\/resume|items|genres|shows\/nextup|system\/info\/public|system\/ping)$/,
    new RegExp(`^items/${ID}(/similar|/images/[a-z]+(/\\d+)?)?$`),
    new RegExp(`^shows/${ID}/(seasons|episodes)$`),
    new RegExp(`^mediasegments/${ID}$`),
    new RegExp(`^videos/${ID}/(stream(\\.[a-z0-9]+)?|master\\.m3u8|main\\.m3u8|live\\.m3u8)$`),
    new RegExp(`^videos/${ID}/hls1/[^/]+/[^/]+$`),
    new RegExp(`^videos/${ID}/${ID}/subtitles/\\d+(/\\d+)?/(stream\\.[a-z0-9]+|subtitles\\.m3u8)$`),
    new RegExp(`^videos/${ID}/trickplay/\\d+/(\\d+\\.jpg|tiles\\.m3u8)$`),
    new RegExp(`^audio/${ID}/(universal|stream(\\.[a-z0-9]+)?|main\\.m3u8|master\\.m3u8|lyrics)$`),
    new RegExp(`^audio/${ID}/hls1/[^/]+/[^/]+$`),
  ],
  POST: [
    new RegExp(`^items/${ID}/playbackinfo$`),
    /^sessions\/playing(\/progress|\/stopped|\/ping)?$/,
    new RegExp(`^(users/${ID}/playeditems|userplayeditems|users/${ID}/favoriteitems|userfavoriteitems)/${ID}$`),
    new RegExp(`^useritems/${ID}/userdata$`),
  ],
  DELETE: [
    new RegExp(`^(users/${ID}/playeditems|userplayeditems|users/${ID}/favoriteitems|userfavoriteitems)/${ID}$`),
    /^videos\/activeencodings$/,
  ],
}
ALLOWED.HEAD = ALLOWED.GET!

/**
 * The Jellyfin path and query a friend's viewer may call, with every user id
 * pinned to their own hidden user. Null when it isn't something the app needs.
 */
export function peerRequest(method: string, rest: string, query: URLSearchParams, viewerUserId: string): { path: string; query: URLSearchParams } | null {
  let path: string
  try {
    path = decodeURIComponent(rest)
  } catch {
    return null
  }
  if (/[\\\0]|\.\./.test(path)) return null
  path = path.replace(/^\/+/, '').replace(/\/+$/, '')
  path = path.replace(/^users\/[^/]+(?=\/|$)/i, `Users/${viewerUserId}`)
  const q = new URLSearchParams()
  for (const [k, v] of query) {
    const key = k.toLowerCase()
    if (key === 'apikey' || key === 'api_key') continue
    q.append(k, key === 'userid' ? viewerUserId : v)
  }
  const ok = (ALLOWED[method.toUpperCase()] ?? []).some((r) => r.test(path.toLowerCase()))
  return ok ? { path, query: q } : null
}

/** Where files sit on the sharing server is nobody else's business: drop "Path" from JSON replies. */
export function withoutPaths(text: string): string {
  if (!text.includes('"Path"')) return text
  try {
    const walk = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(walk)
      if (!v || typeof v !== 'object') return v
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k !== 'Path') out[k] = walk(x)
      return out
    }
    return JSON.stringify(walk(JSON.parse(text)))
  } catch {
    return text
  }
}

/** Jellyfin user names allow letters, digits, spaces and -'._@+ only. */
export function jfName(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .normalize('NFKD')
    .replace(/[^\w \-'.@+]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------- rate limit for pairing codes ----------

const guesses = new Map<string, { n: number; since: number }>()
function pairLimit(req: IncomingMessage) {
  const g = guesses.get(clientIp(req))
  if (g && Date.now() - g.since < 10 * 60e3 && g.n >= 10) throw new ApiError(429, 'Too many wrong codes. Wait a few minutes and check the code.')
}
function wrongPair(req: IncomingMessage): ApiError {
  const ip = clientIp(req)
  const now = Date.now()
  const g = guesses.get(ip)
  const cur = g && now - g.since < 10 * 60e3 ? g : { n: 0, since: now }
  cur.n++
  guesses.set(ip, cur)
  if (guesses.size > 10000) guesses.clear()
  return new ApiError(404, 'That code didn’t work. Codes work once and last 7 days; ask for a new one.')
}

export function registerGroups(router: Router, deps: { settings: SettingsStore; jf: Jellyfin; auth: Auth }): GroupsApi {
  const { settings, jf, auth } = deps
  const update = (fn: (g: GroupsState) => void) =>
    settings.update((s) => {
      const g = groupsOf(s)
      fn(g)
      s.groups = g
    })

  let nameCache: { name: string; at: number } | null = null
  async function ourName(): Promise<string> {
    if (nameCache && Date.now() - nameCache.at < 600000) return nameCache.name
    const info = await jf.request<{ ServerName?: string }>('/System/Info/Public', { timeoutMs: 8000 }).catch(() => null)
    nameCache = { name: info?.ServerName?.trim() || 'Finesse', at: Date.now() }
    return nameCache.name
  }

  /** The libraries a friend can watch or listen to: films, shows, music and mixed ones. */
  async function libraries(): Promise<{ id: string; name: string; type: string | null }[]> {
    const r = await jf.request<{ Items?: { Id: string; Name: string; CollectionType?: string }[] }>('/Library/MediaFolders')
    return (r.Items ?? []).filter((i) => !NOT_SHARED.has(i.CollectionType ?? '')).map((i) => ({ id: i.Id, name: i.Name, type: i.CollectionType ?? null }))
  }

  /** Signed calls between servers: `Authorization: FinessePeer <linkId>:<secret>`. */
  function peerLink(req: IncomingMessage): GroupLink {
    const m = /^FinessePeer ([a-z0-9]+):([A-Za-z0-9_-]+)$/.exec(String(req.headers.authorization ?? ''))
    const link = m ? groupsOf(settings.get()).links.find((l) => l.id === m[1]) : undefined
    if (!m || !link) throw new ApiError(401, 'This server isn’t shared with you (any more)')
    const a = Buffer.from(hash(m[2]!))
    const b = Buffer.from(link.secretHash)
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, 'This server isn’t shared with you (any more)')
    if (link.paused) throw new ApiError(503, 'Your friend is changing what they share. Try again in a few minutes.')
    if (!link.lastSeen || Date.now() - Date.parse(link.lastSeen) > SEEN_EVERY_MS) {
      update((g) => {
        const l = g.links.find((x) => x.id === link.id)
        if (l) l.lastSeen = new Date().toISOString()
      })
    }
    return link
  }

  function viewerPolicy(base: Record<string, unknown>, libs: string[]): Record<string, unknown> {
    return {
      ...base,
      IsAdministrator: false,
      IsHidden: true,
      IsDisabled: false,
      EnableAllFolders: false,
      EnabledFolders: libs,
      EnableContentDownloading: false,
      EnableSyncTranscoding: false,
      EnableLiveTvAccess: false,
      EnableLiveTvManagement: false,
      EnableContentDeletion: false,
      EnableContentDeletionFromFolders: [],
      EnablePublicSharing: false,
      EnableCollectionManagement: false,
      EnableSubtitleManagement: false,
      EnableLyricManagement: false,
      AllowCameraUpload: false,
      EnableRemoteControlOfOtherUsers: false,
      EnableSharedDeviceControl: false,
      EnableUserPreferenceAccess: false,
      EnableRemoteAccess: true,
      EnableMediaPlayback: true,
      EnableAudioPlaybackTranscoding: true,
      EnableVideoPlaybackTranscoding: true,
      EnablePlaybackRemuxing: true,
    }
  }

  async function setLibraries(userId: string, libs: string[]) {
    const full = await jf.request<{ Policy?: Record<string, unknown> }>(`/Users/${userId}`)
    await jf.request(`/Users/${userId}/Policy`, { method: 'POST', body: viewerPolicy(full.Policy ?? {}, libs) })
  }

  async function signIn(link: GroupLink, viewerId: string, name: string, password: string): Promise<string> {
    const r = await jf.request<{ AccessToken: string }>('/Users/AuthenticateByName', {
      method: 'POST',
      token: '',
      body: { Username: name, Pw: password },
      deviceId: `finesse-group-${link.id}-${viewerId.slice(0, 12)}`,
      deviceName: `Finesse · ${link.name}`,
    })
    return r.AccessToken
  }

  // One creation at a time per viewer, even when the app fires calls in parallel.
  const pending = new Map<string, Promise<{ userId: string; token: string }>>()
  function viewerFor(link: GroupLink, viewerId: string, viewerName: string): Promise<{ userId: string; token: string }> {
    const known = link.viewers[viewerId]
    if (known?.token) return Promise.resolve({ userId: known.userId, token: known.token })
    const key = `${link.id}/${viewerId}`
    let p = pending.get(key)
    if (!p) {
      p = (async () => {
        let v = known
        if (!v) {
          const base = `${jfName(viewerName).slice(0, 40) || 'Viewer'} @ ${jfName(link.name).slice(0, 40) || 'a friend'}`
          let user: { Id: string } | null = null
          let name = base
          for (let n = 2; !user && n < 50; n++) {
            user = await jf.request<{ Id: string }>('/Users/New', { method: 'POST', body: { Name: name } }).catch((e) => {
              if (e instanceof JfError && e.status === 400) {
                name = `${base} ${n}`
                return null
              }
              throw e
            })
          }
          if (!user) throw new ApiError(502, 'Couldn’t make a viewer for your friend’s server')
          const password = randomBytes(24).toString('base64url')
          await jf.request(`/Users/${user.Id}/Password`, { method: 'POST', body: { Id: user.Id, NewPw: password } })
          await setLibraries(user.Id, link.libraries)
          v = { userId: user.Id, name, password }
          log.info(`${link.name}: made a viewer for ${viewerName}`)
        }
        const token = await signIn(link, viewerId, v.name, v.password)
        const saved = { ...v, token }
        update((g) => {
          const l = g.links.find((x) => x.id === link.id)
          if (l) l.viewers[viewerId] = saved
        })
        return { userId: saved.userId, token }
      })().finally(() => pending.delete(key))
      pending.set(key, p)
    }
    return p
  }

  /** Deletes viewer accounts; ones Jellyfin couldn't delete right now are kept for retrying. */
  async function deleteViewers(userIds: string[]) {
    const failed: string[] = []
    for (const id of userIds) await jf.request(`/Users/${id}`, { method: 'DELETE' }).catch((e: Error) => (/404/.test(e.message) ? undefined : void failed.push(id)))
    update((g) => {
      g.orphans = [...new Set([...(g.orphans ?? []).filter((o) => !userIds.includes(o)), ...failed])]
    })
    if (failed.length) log.warn(`couldn’t delete ${failed.length} friend viewer account(s) yet; trying again later`)
    return failed
  }

  /** Leftover viewer accounts: tried again whenever sharing changes (and every ten minutes). */
  const retryOrphans = async () => {
    const left = groupsOf(settings.get()).orphans ?? []
    if (left.length) await deleteViewers(left).catch(() => {})
  }

  async function removeLink(link: GroupLink) {
    await retryOrphans()
    update((g) => {
      g.links = g.links.filter((l) => l.id !== link.id)
    })
    await deleteViewers(Object.values(link.viewers).map((v) => v.userId))
  }

  // Leftover viewer accounts (Jellyfin was down when a friend left): every ten minutes until gone.
  setInterval(() => void retryOrphans(), 10 * 60000).unref()

  async function callFriend<T>(f: { url: string; linkId?: string; secret?: string }, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${f.url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(f.linkId ? { Authorization: `FinessePeer ${f.linkId}:${f.secret}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      })
    } catch (e) {
      throw new ApiError(502, `Couldn’t reach ${new URL(f.url).host}. Check the address, and that their server is on. (${(e as Error).message})`)
    }
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new ApiError([401, 403, 404, 429].includes(res.status) ? res.status : 502, (data as { error?: string } | null)?.error ?? `Their server answered ${res.status}`)
    return data as T
  }

  async function pairWith(url: string, code: string) {
    const s = settings.get()
    const info = await callFriend<{ name?: string; instanceId?: string }>({ url }, '/api/finesse').catch((e) => {
      throw e instanceof ApiError && e.status === 502 ? e : new ApiError(400, 'That address doesn’t answer like a Finesse server. Check it and try again.')
    })
    if (info?.name !== 'finesse') throw new ApiError(400, 'That address doesn’t answer like a Finesse server. Check it and try again.')
    if (info.instanceId === s.instanceId) throw new ApiError(400, 'That’s this server’s own address')
    const r = await callFriend<{ linkId: string; secret: string; name: string }>({ url }, '/api/groups/peer/pair', { code, name: await ourName(), url: s.publicUrl ?? null })
    const friend: GroupFriend = { id: newId(), name: String(r.name || 'A friend’s server').slice(0, 60), url, linkId: r.linkId, secret: r.secret, addedAt: new Date().toISOString() }
    update((g) => {
      g.friends = [...g.friends.filter((f) => !(f.url === url && f.linkId === r.linkId)), friend]
    })
    log.info(`now watching ${friend.name}`)
    return friend
  }

  const friendPublic = (f: GroupFriend) => ({ id: f.id, name: f.name, url: f.url, addedAt: f.addedAt })

  // ---------- administrators: the Groups settings ----------

  router.get('/api/groups', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const s = settings.get()
    const g = groupsOf(s)
    sendJson(res, 200, {
      name: await ourName(),
      publicUrl: s.publicUrl ?? null,
      libraries: await libraries().catch(() => []),
      links: g.links.map((l) => ({ id: l.id, name: l.name, url: l.url ?? null, libraries: l.libraries, createdAt: l.createdAt, lastSeen: l.lastSeen ?? null, viewers: Object.values(l.viewers).map((v) => v.name) })),
      friends: g.friends.map(friendPublic),
      codes: g.codes.filter((c) => Date.parse(c.expires) > Date.now()).length,
      offers: g.offers.map((o) => ({ id: o.id, name: o.name, url: o.url, at: o.at })),
    })
  })

  // A code for a friend's server, sharing these libraries.
  router.post('/api/groups/codes', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ libraries?: unknown }>(req)
    const all = new Set((await libraries()).map((l) => l.id))
    const libs = Array.isArray(body.libraries) ? body.libraries.map(String).filter((id) => all.has(id)) : []
    if (!libs.length) throw new ApiError(400, 'Pick at least one library to share')
    const code = newPairCode()
    const expires = new Date(Date.now() + CODE_TTL_MS).toISOString()
    update((g) => {
      g.codes = [...g.codes.filter((c) => Date.parse(c.expires) > Date.now()), { hash: hash(normCode(code)), libraries: libs, expires }]
    })
    sendJson(res, 201, { code, expires })
  })

  router.put('/api/groups/links/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ libraries?: unknown }>(req)
    const all = new Set((await libraries()).map((l) => l.id))
    const libs = Array.isArray(body.libraries) ? body.libraries.map(String).filter((id) => all.has(id)) : null
    if (!libs) throw new ApiError(400, 'libraries must be a list')
    const link = groupsOf(settings.get()).links.find((l) => l.id === params.id)
    if (!link) throw new ApiError(404, 'No such server')
    await retryOrphans()
    const narrowing = link.libraries.some((id) => !libs.includes(id))
    // Narrowing: nothing of theirs gets through until every viewer account is updated.
    update((g) => {
      const l = g.links.find((x) => x.id === link.id)
      if (l) Object.assign(l, { libraries: libs, paused: narrowing ? true : l.paused })
    })
    const stuck: string[] = []
    for (const [key, v] of Object.entries(link.viewers)) {
      try {
        await setLibraries(v.userId, libs)
      } catch (e) {
        log.warn(`couldn’t update ${v.name}: ${(e as Error).message}`)
        // Can't change what it sees: delete it instead (it's made again, with today's list, next time).
        const failed = await deleteViewers([v.userId])
        update((g) => {
          const l = g.links.find((x) => x.id === link.id)
          if (l) delete l.viewers[key]
        })
        if (failed.length) stuck.push(v.name)
      }
    }
    if (stuck.length) {
      // Their viewer accounts are pending deletion and the link stays paused until then; say so.
      throw new ApiError(502, `Jellyfin didn’t accept the change for ${stuck.join(', ')}. ${link.name} can’t watch anything until it does; Finesse keeps trying.`)
    }
    update((g) => {
      const l = g.links.find((x) => x.id === link.id)
      if (l) delete l.paused
    })
    sendJson(res, 200, { ok: true, libraries: libs })
  })

  router.delete('/api/groups/links/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const link = groupsOf(settings.get()).links.find((l) => l.id === params.id)
    if (!link) throw new ApiError(404, 'No such server')
    await removeLink(link)
    log.info(`stopped sharing with ${link.name}`)
    sendJson(res, 200, { ok: true })
  })

  router.post('/api/groups/friends', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ url?: unknown; code?: unknown }>(req)
    const code = normCode(body.code)
    if (code.length !== 12) throw new ApiError(400, 'The code is 12 letters and numbers, like ABCD-EFGH-JKLM')
    sendJson(res, 201, friendPublic(await pairWith(normalizeServerUrl(body.url), code)))
  })

  router.delete('/api/groups/friends/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const f = groupsOf(settings.get()).friends.find((x) => x.id === params.id)
    if (!f) throw new ApiError(404, 'No such server')
    await callFriend(f, '/api/groups/peer/leave', {}).catch(() => {})
    update((g) => {
      g.friends = g.friends.filter((x) => x.id !== f.id)
    })
    sendJson(res, 200, { ok: true })
  })

  // Share back: make a code for this friend and hand it to their server, whose
  // admins then add us with one click.
  router.post('/api/groups/friends/:id/offer', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const s = settings.get()
    if (!s.publicUrl) throw new ApiError(400, 'Set your server’s public address first (Settings → Server → Invites & sharing), so their server can reach yours')
    const f = groupsOf(s).friends.find((x) => x.id === params.id)
    if (!f) throw new ApiError(404, 'No such server')
    const body = await readJson<{ libraries?: unknown }>(req)
    const all = new Set((await libraries()).map((l) => l.id))
    const libs = Array.isArray(body.libraries) ? body.libraries.map(String).filter((id) => all.has(id)) : []
    if (!libs.length) throw new ApiError(400, 'Pick at least one library to share')
    const code = newPairCode()
    update((g) => {
      g.codes = [...g.codes.filter((c) => Date.parse(c.expires) > Date.now()), { hash: hash(normCode(code)), libraries: libs, expires: new Date(Date.now() + CODE_TTL_MS).toISOString() }]
    })
    await callFriend(f, '/api/groups/peer/offer', { code, url: s.publicUrl })
    sendJson(res, 200, { ok: true })
  })

  router.post('/api/groups/offers/:id/accept', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const o = groupsOf(settings.get()).offers.find((x) => x.id === params.id)
    if (!o) throw new ApiError(404, 'That offer is gone')
    const friend = await pairWith(o.url, normCode(o.code))
    update((g) => {
      g.offers = g.offers.filter((x) => x.id !== o.id)
    })
    sendJson(res, 201, friendPublic(friend))
  })

  router.delete('/api/groups/offers/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    update((g) => {
      g.offers = g.offers.filter((x) => x.id !== params.id)
    })
    sendJson(res, 200, { ok: true })
  })

  // ---------- everyone at home: friends' servers ----------

  router.get('/api/groups/friends', async ({ req, res }) => {
    const user = await auth.requireUser(req)
    if (user.Id === 'service') throw new ApiError(403, 'Sign in as a person')
    sendJson(res, 200, { friends: groupsOf(settings.get()).friends.map((f) => ({ id: f.id, name: f.name })) })
  })

  // Browse and play a friend's shared libraries through our own server.
  router.any('/api/groups/friends/:id/jellyfin/*', async ({ req, res, params, url }) => {
    const user = await auth.requireUser(req, { query: url.searchParams })
    if (user.Id === 'service' || !/^[0-9a-f]{32}$/i.test(user.Id)) throw new ApiError(403, 'Sign in as a person')
    const f = groupsOf(settings.get()).friends.find((x) => x.id === params.id)
    if (!f) throw new ApiError(404, 'That server isn’t shared with you (any more)')
    const own = tokenFrom(req, { query: url.searchParams }) ?? ''
    const search = new URLSearchParams(url.searchParams)
    search.delete('ApiKey')
    search.delete('api_key')
    const target = joinUrl(f.url, `/api/groups/peer/jellyfin/${params.rest ?? ''}`, search.toString() ? `?${search}` : '')
    await proxyHttp(req, res, {
      target,
      stripAuth: true,
      setHeaders: {
        authorization: `FinessePeer ${f.linkId}:${f.secret}`,
        'x-finesse-viewer': user.Id.toLowerCase(),
        'x-finesse-viewer-name': encodeURIComponent(user.Name ?? ''),
        'accept-encoding': 'identity',
      },
      rewriteText: (t) => t.split(PEER_TOKEN).join(own),
      timeoutMs: 20000,
    })
  })

  // ---------- friends' servers calling us ----------

  router.post('/api/groups/peer/pair', async ({ req, res }) => {
    pairLimit(req)
    const body = await readJson<{ code?: unknown; name?: unknown; url?: unknown }>(req)
    const h = hash(normCode(body.code))
    const code = groupsOf(settings.get()).codes.find((c) => c.hash === h && Date.parse(c.expires) > Date.now())
    if (!code) throw wrongPair(req)
    const secret = randomBytes(32).toString('base64url')
    let url: string | undefined
    try {
      url = body.url ? normalizeServerUrl(body.url) : undefined
    } catch {
      url = undefined
    }
    const link: GroupLink = {
      id: newId(),
      name: String(body.name ?? '').trim().slice(0, 60) || 'A friend’s server',
      ...(url ? { url } : {}),
      secretHash: hash(secret),
      libraries: code.libraries,
      createdAt: new Date().toISOString(),
      viewers: {},
    }
    update((g) => {
      g.codes = g.codes.filter((c) => c.hash !== h)
      g.links.push(link)
    })
    log.info(`sharing with ${link.name} now`)
    sendJson(res, 201, { linkId: link.id, secret, name: await ourName() })
  })

  router.post('/api/groups/peer/leave', async ({ req, res }) => {
    const link = peerLink(req)
    await removeLink(link)
    log.info(`${link.name} stopped watching`)
    sendJson(res, 200, { ok: true })
  })

  router.post('/api/groups/peer/offer', async ({ req, res }) => {
    const link = peerLink(req)
    const body = await readJson<{ code?: unknown; url?: unknown }>(req)
    const code = normCode(body.code)
    if (code.length !== 12) throw new ApiError(400, 'Bad code')
    const url = normalizeServerUrl(body.url)
    update((g) => {
      g.offers = [...g.offers.filter((o) => o.url !== url), { id: newId(), name: link.name, url, code, at: new Date().toISOString() }].slice(-20)
    })
    sendJson(res, 200, { ok: true })
  })

  router.any('/api/groups/peer/jellyfin/*', async ({ req, res, params, url }) => {
    const link = peerLink(req)
    const viewerId = String(req.headers['x-finesse-viewer'] ?? '').toLowerCase()
    if (!/^[0-9a-f]{32}$/.test(viewerId)) throw new ApiError(400, 'Missing viewer')
    let viewerName = ''
    try {
      viewerName = decodeURIComponent(String(req.headers['x-finesse-viewer-name'] ?? ''))
    } catch {
      /* keep empty */
    }
    // Allowed at all? Checked before anything is created for this viewer.
    if (!peerRequest(req.method ?? 'GET', params.rest ?? '', url.searchParams, '0'.repeat(32))) throw new ApiError(403, 'Not available through a friend’s server')
    const v = await viewerFor(link, viewerId, viewerName)
    const call = peerRequest(req.method ?? 'GET', params.rest ?? '', url.searchParams, v.userId)
    if (!call) throw new ApiError(403, 'Not available through a friend’s server')
    const target = joinUrl(jf.base(), `/${call.path}`, call.query.toString() ? `?${call.query}` : '')
    await proxyHttp(req, res, {
      target,
      stripAuth: true,
      // Jellyfin 12 only takes the standard header (no X-Emby-Token any more).
      setHeaders: {
        authorization: mediaBrowserHeader(v.token, `finesse-group-${link.id}-${viewerId.slice(0, 12)}`, `Finesse - ${link.name}`),
        'accept-encoding': 'identity',
        'x-finesse-viewer': null,
        'x-finesse-viewer-name': null,
      },
      rewriteText: (t) => withoutPaths(t.split(v.token).join(PEER_TOKEN)),
      timeoutMs: 20000,
    })
    // Jellyfin dropped the token (restart, sign-out): sign in again next time.
    if (res.statusCode === 401) {
      update((g) => {
        const l = g.links.find((x) => x.id === link.id)
        if (l?.viewers[viewerId]) delete l.viewers[viewerId].token
      })
    }
  })

  return {
    peerLink,
    callFriend,
    ourName,
    friends: () => groupsOf(settings.get()).friends,
    links: () => groupsOf(settings.get()).links,
  }
}
