// Moments: flag a stretch of a video ("this scene 😭") and send it to people at
// home or to friends' servers (Groups). They get a notification, the stretch
// shows on the player's timeline, and the note pops up when playback gets there.
//
// A moment lives on the server that has the video, so there's one copy and its
// ids are that server's own. Who sees it is its audience: everyone (or some
// people) at home, and whole friends' servers, by their link.
//
//   A title of ours:     stored here. Friends' servers that watch it are sent it
//                        by fetching (they hold the pairing secret; we don't call
//                        them), every couple of minutes.
//   A title of a friend: our server hands it to theirs over the pairing link,
//                        with who it's for here, and fetches it back like any
//                        other moment of theirs.
//
// Friends' servers only ever see moments meant for them, of titles they can
// already watch. Notes are plain text.

import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { groupUserIds, type Auth } from './auth.ts'
import type { GroupFriend, GroupLink, SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import type { Jellyfin, JfUser } from './jellyfin.ts'
import { logger } from './log.ts'

const log = logger('moments')

export const NOTE_MAX = 200
/** The longest stretch you can flag. */
export const SPAN_MAX = 600
const KEEP = 5000
const FEED_DAYS = 60
const FEED_MAX = 300
const POLL_MS = 2 * 60e3

/** Who a moment is for: "home" (people on this server) or a friend server's link id; `u` narrows it to some people there. */
export interface Audience {
  s: string
  u: string[] | null
}

interface Row {
  id: string
  item: string
  title: string
  subtitle: string
  start: number | null
  end: number | null
  note: string
  spoiler: number
  author_name: string
  author_server: string | null
  author_user: string
  audience: string
  created: number
}

interface RemoteRow {
  friend: string
  id: string
  item: string
  title: string
  subtitle: string
  start: number | null
  end: number | null
  note: string
  spoiler: number
  author_name: string
  author_here: string | null
  users: string | null
  created: number
}

/** What a friend's server sends us: moments of its titles meant for us. */
export interface FeedMoment {
  id: string
  item: string
  title: string
  subtitle: string
  /** Null for the whole title (a recommendation). */
  start: number | null
  end: number | null
  note: string
  spoiler: boolean
  from: string
  /** One of our people wrote it (their id here). */
  fromHere: string | null
  /** Which of our people it's for (null: everyone). */
  users: string[] | null
  created: number
}

export interface GroupsApi {
  peerLink(req: IncomingMessage): GroupLink
  callFriend<T>(f: GroupFriend, path: string, body?: unknown): Promise<T>
  ourName(): Promise<string>
  friends(): GroupFriend[]
  links(): GroupLink[]
}

const newId = () => randomBytes(9).toString('base64url')
const RAW = /^[0-9a-f]{32}$/i
const TAGGED = /^f-([a-z0-9]{8})-([0-9a-f]{32})$/i

/** Plain, single-line-ish text: no control characters, trimmed, capped. */
export function cleanNote(v: unknown): string {
  return String(v ?? '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, NOTE_MAX)
}

/** A start and end in seconds, sane and at most SPAN_MAX apart; both null for the whole title. */
export function cleanSpan(start: unknown, end: unknown): { start: number | null; end: number | null } {
  if (start == null && end == null) return { start: null, end: null }
  const a = Math.round(Number(start) * 10) / 10
  const b = Math.round(Number(end) * 10) / 10
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > 24 * 3600) throw new ApiError(400, 'Pick where the moment starts and ends')
  if (b - a < 1) throw new ApiError(400, 'A moment is at least a second long')
  if (b - a > SPAN_MAX) throw new ApiError(400, 'A moment is at most 10 minutes long')
  return { start: a, end: b }
}

export class MomentStore {
  readonly db: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS moments (
        id TEXT PRIMARY KEY,
        item TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL DEFAULT '',
        start REAL,
        "end" REAL,
        note TEXT NOT NULL DEFAULT '',
        spoiler INTEGER NOT NULL DEFAULT 0,
        author_name TEXT NOT NULL,
        author_server TEXT,
        author_user TEXT NOT NULL,
        audience TEXT NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS moments_item ON moments(item);
      CREATE INDEX IF NOT EXISTS moments_created ON moments(created);
      CREATE TABLE IF NOT EXISTS remote (
        friend TEXT NOT NULL,
        id TEXT NOT NULL,
        item TEXT NOT NULL,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL DEFAULT '',
        start REAL,
        "end" REAL,
        note TEXT NOT NULL DEFAULT '',
        spoiler INTEGER NOT NULL DEFAULT 0,
        author_name TEXT NOT NULL,
        author_here TEXT,
        users TEXT,
        created INTEGER NOT NULL,
        PRIMARY KEY (friend, id)
      );
      CREATE TABLE IF NOT EXISTS reads (
        user TEXT NOT NULL,
        key TEXT NOT NULL,
        PRIMARY KEY (user, key)
      );
    `)
  }

  add(m: Omit<Row, 'audience'> & { audience: Audience[] }) {
    this.db
      .prepare('INSERT INTO moments (id, item, title, subtitle, start, "end", note, spoiler, author_name, author_server, author_user, audience, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, m.item, m.title, m.subtitle, m.start, m.end, m.note, m.spoiler ? 1 : 0, m.author_name, m.author_server, m.author_user, JSON.stringify(m.audience), m.created)
    this.db.prepare('DELETE FROM moments WHERE id IN (SELECT id FROM moments ORDER BY created DESC LIMIT -1 OFFSET ?)').run(KEEP)
  }

  get(id: string): (Row & { aud: Audience[] }) | null {
    const r = this.db.prepare('SELECT * FROM moments WHERE id = ?').get(id) as Row | undefined
    return r ? { ...r, aud: JSON.parse(r.audience) as Audience[] } : null
  }

  remove(id: string) {
    this.db.prepare('DELETE FROM moments WHERE id = ?').run(id)
  }

  /** Moments of one title, or the newest ones (since a time). */
  list(opts: { item?: string; since?: number; limit?: number }): (Row & { aud: Audience[] })[] {
    const rows = (
      opts.item
        ? this.db.prepare('SELECT * FROM moments WHERE item = ? ORDER BY start IS NOT NULL, start').all(opts.item)
        : this.db.prepare('SELECT * FROM moments WHERE created >= ? ORDER BY created DESC LIMIT ?').all(opts.since ?? 0, opts.limit ?? FEED_MAX)
    ) as unknown as Row[]
    return rows.map((r) => ({ ...r, aud: JSON.parse(r.audience) as Audience[] }))
  }

  /** Replaces everything we know of a friend's moments with what they sent just now. */
  replaceRemote(friend: string, feed: FeedMoment[]) {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM remote WHERE friend = ?').run(friend)
      const ins = this.db.prepare('INSERT OR REPLACE INTO remote (friend, id, item, title, subtitle, start, "end", note, spoiler, author_name, author_here, users, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      for (const m of feed) ins.run(friend, m.id, m.item, m.title, m.subtitle, m.start, m.end, m.note, m.spoiler ? 1 : 0, m.from, m.fromHere, m.users ? JSON.stringify(m.users) : null, m.created)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  dropRemote(friendIdsKept: string[]) {
    const all = (this.db.prepare('SELECT DISTINCT friend FROM remote').all() as { friend: string }[]).map((r) => r.friend)
    for (const f of all) if (!friendIdsKept.includes(f)) this.db.prepare('DELETE FROM remote WHERE friend = ?').run(f)
  }

  remote(opts: { friend?: string; since: number }): RemoteRow[] {
    return (
      opts.friend
        ? this.db.prepare('SELECT * FROM remote WHERE friend = ? AND created >= ? ORDER BY created DESC').all(opts.friend, opts.since)
        : this.db.prepare('SELECT * FROM remote WHERE created >= ? ORDER BY created DESC LIMIT 500').all(opts.since)
    ) as unknown as RemoteRow[]
  }

  readKeys(user: string): Set<string> {
    return new Set((this.db.prepare('SELECT key FROM reads WHERE user = ?').all(user) as { key: string }[]).map((r) => r.key))
  }

  markRead(user: string, keys: string[]) {
    const ins = this.db.prepare('INSERT OR IGNORE INTO reads (user, key) VALUES (?, ?)')
    for (const k of keys.slice(0, 500)) ins.run(user, k)
  }
}

/** Whether `user` (one of our people) is in this audience. */
export function forPerson(aud: Audience[], user: string): boolean {
  return aud.some((a) => a.s === 'home' && (a.u === null || a.u.includes(user)))
}

/** A friend server's slice of an audience, if it's in it. */
export function forLink(aud: Audience[], link: string): Audience | null {
  return aud.find((a) => a.s === link) ?? null
}

// ---------- rate limits ----------
const made = new Map<string, number[]>()
function limit(key: string, perHour: number) {
  const now = Date.now()
  const list = (made.get(key) ?? []).filter((t) => now - t < 3600e3)
  if (list.length >= perHour) throw new ApiError(429, 'That’s a lot of moments for one hour. Try again a bit later.')
  list.push(now)
  made.set(key, list)
  if (made.size > 5000) made.clear()
}

interface JfItemLite {
  Id: string
  Name?: string
  Type?: string
  SeriesName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  ProductionYear?: number
}

export function registerMoments(router: Router, deps: { settings: SettingsStore; jf: Jellyfin; auth: Auth; groups: GroupsApi; store?: MomentStore }) {
  const { settings, jf, auth, groups } = deps
  const store = deps.store ?? new MomentStore(join(settings.paths.configDir, 'moments.db'))

  async function person(req: IncomingMessage): Promise<JfUser & { admin: boolean }> {
    const user = await auth.requireUser(req)
    if (user.Id === 'service' || !RAW.test(user.Id)) throw new ApiError(403, 'Sign in as a person')
    if (groupUserIds(settings.get()).has(user.Id)) throw new ApiError(403, 'Sign in as a person')
    return { ...user, admin: Boolean(user.Policy?.IsAdministrator) }
  }

  // ---------- titles: names, and which libraries they're in ----------
  // (Asked as list queries: with the server's own key, Jellyfin answers those
  // without a user, where /Items/{id} wants one.)
  const itemCache = new Map<string, { at: number; title: string; subtitle: string }>()
  async function title(raw: string): Promise<{ title: string; subtitle: string }> {
    const hit = itemCache.get(raw)
    if (hit && Date.now() - hit.at < 10 * 60e3) return hit
    const r = await jf.request<{ Items?: JfItemLite[] }>(`/Items?Ids=${raw}&Recursive=true&Fields=ProductionYear&EnableImages=false`).catch(() => null)
    const it = r?.Items?.find((i) => String(i.Id).toLowerCase() === raw)
    if (!it) throw new ApiError(404, 'That title isn’t on this server any more')
    const episode = it.Type === 'Episode'
    const out = {
      at: Date.now(),
      title: (episode ? it.SeriesName || it.Name : it.Name) || 'A title',
      subtitle: episode
        ? [it.ParentIndexNumber != null && it.IndexNumber != null ? `S${it.ParentIndexNumber}:E${it.IndexNumber}` : null, it.Name].filter(Boolean).join(' · ')
        : it.ProductionYear
          ? String(it.ProductionYear)
          : '',
    }
    if (itemCache.size > 2000) itemCache.clear()
    itemCache.set(raw, out)
    return out
  }
  const inLib = new Map<string, { at: number; yes: boolean }>()
  async function inLibrary(raw: string, lib: string): Promise<boolean> {
    const key = `${raw}/${lib}`
    const hit = inLib.get(key)
    if (hit && Date.now() - hit.at < 10 * 60e3) return hit.yes
    const r = await jf.request<{ Items?: { Id: string }[] }>(`/Items?Ids=${raw}&ParentId=${lib}&Recursive=true&Limit=1&EnableImages=false`).catch(() => null)
    const yes = Boolean(r?.Items?.some((i) => String(i.Id).toLowerCase() === raw))
    if (inLib.size > 5000) inLib.clear()
    inLib.set(key, { at: Date.now(), yes })
    return yes
  }
  /** Whether a friend's server can watch this title (it's in a library shared with it). */
  async function linkSees(link: GroupLink, raw: string): Promise<boolean> {
    for (const lib of link.libraries) if (await inLibrary(raw, lib.toLowerCase())) return true
    return false
  }

  /** People on this server you can send a moment to (not friends' viewer accounts, not you). */
  async function people(except: string): Promise<{ id: string; name: string }[]> {
    const users = await jf.request<{ Id: string; Name: string; Policy?: { IsDisabled?: boolean } }[]>('/Users').catch(() => [])
    const viewers = groupUserIds(settings.get())
    return (Array.isArray(users) ? users : [])
      .filter((u) => u.Id !== except && !viewers.has(u.Id) && !u.Policy?.IsDisabled)
      .map((u) => ({ id: u.Id, name: u.Name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  const friendOf = (id: string) => groups.friends().find((f) => f.id === id)
  const fromLabel = (r: Row): string => {
    if (!r.author_server) return r.author_name
    const link = groups.links().find((l) => l.id === r.author_server)
    return link ? `${r.author_name} · ${link.name}` : r.author_name
  }

  // ---------- fetching friends' moments ----------
  const pollState = new Map<string, { at: number; skipUntil: number; running?: Promise<void> }>()
  async function pollFriend(f: GroupFriend, force = false): Promise<void> {
    const st = pollState.get(f.id) ?? { at: 0, skipUntil: 0 }
    pollState.set(f.id, st)
    if (st.running) return st.running
    if (!force && Date.now() < st.skipUntil) return
    st.running = (async () => {
      try {
        const feed = await groups.callFriend<{ moments?: FeedMoment[] }>(f, '/api/groups/peer/moments')
        store.replaceRemote(f.id, (feed?.moments ?? []).filter(validFeed).slice(0, FEED_MAX))
        st.skipUntil = 0
      } catch (e) {
        const status = (e as ApiError).status
        // An older Finesse (no moments yet) or a server that's off: ask less often.
        st.skipUntil = Date.now() + (status === 404 ? 30 * 60e3 : 5 * 60e3)
        log.debug(`couldn’t fetch moments from ${f.name}: ${(e as Error).message}`)
      } finally {
        st.at = Date.now()
        st.running = undefined
      }
    })()
    return st.running
  }
  const pollAll = async () => {
    const friends = groups.friends()
    store.dropRemote(friends.map((f) => f.id))
    for (const f of friends) await pollFriend(f)
  }
  setInterval(() => void pollAll().catch(() => {}), POLL_MS).unref()
  setTimeout(() => void pollAll().catch(() => {}), 5000).unref()

  // ---------- the app ----------

  // Who you can send a moment of this title to.
  router.get('/api/moments/targets', async ({ req, res, url }) => {
    const me = await person(req)
    const item = String(url.searchParams.get('item') ?? '')
    const here = await people(me.Id)
    const tagged = TAGGED.exec(item)
    if (tagged) {
      const f = friendOf(tagged[1]!)
      if (!f) throw new ApiError(404, 'That server isn’t shared with you (any more)')
      return sendJson(res, 200, { people: here, friends: [{ id: 'owner', name: f.name }] })
    }
    if (!RAW.test(item)) throw new ApiError(400, 'Which title?')
    await title(item.toLowerCase())
    const friends: { id: string; name: string }[] = []
    for (const l of groups.links()) if (!l.paused && (await linkSees(l, item.toLowerCase()))) friends.push({ id: `link:${l.id}`, name: l.name })
    sendJson(res, 200, { people: here, friends })
  })

  // Flag a moment.
  router.post('/api/moments', async ({ req, res }) => {
    const me = await person(req)
    const body = await readJson<{ item?: unknown; start?: unknown; end?: unknown; note?: unknown; spoiler?: unknown; to?: unknown }>(req, 8192)
    const item = String(body.item ?? '')
    const { start, end } = cleanSpan(body.start, body.end)
    const note = cleanNote(body.note)
    const spoiler = body.spoiler === true
    const to = Array.isArray(body.to) ? body.to.map(String).slice(0, 100) : []
    limit(`u:${me.Id}`, 30)
    const everyone = to.includes('home')
    const valid = new Set((await people(me.Id)).map((p) => p.id.toLowerCase()))
    const picked = to.filter((t) => t.startsWith('user:')).map((t) => t.slice(5).toLowerCase()).filter((id) => valid.has(id))

    const tagged = TAGGED.exec(item)
    if (tagged) {
      const f = friendOf(tagged[1]!)
      if (!f) throw new ApiError(404, 'That server isn’t shared with you (any more)')
      const r = await groups.callFriend<{ id: string }>(f, '/api/groups/peer/moments', {
        item: tagged[2]!.toLowerCase(),
        start,
        end,
        note,
        spoiler,
        viewer: me.Id.toLowerCase(),
        name: me.Name,
        owner: to.includes('owner'),
        users: everyone ? null : picked,
      })
      await pollFriend(f, true)
      return sendJson(res, 201, { key: `r:${f.id}:${r.id}` })
    }

    if (!RAW.test(item)) throw new ApiError(400, 'Which title?')
    const raw = item.toLowerCase()
    const t = await title(raw)
    const audience: Audience[] = []
    if (everyone || picked.length) audience.push({ s: 'home', u: everyone ? null : picked })
    for (const target of to.filter((x) => x.startsWith('link:'))) {
      const link = groups.links().find((l) => l.id === target.slice(5))
      if (!link) continue
      if (!(await linkSees(link, raw))) throw new ApiError(400, `${link.name} can’t watch this one, so it can’t go to them`)
      audience.push({ s: link.id, u: null })
    }
    const id = newId()
    store.add({ id, item: raw, title: t.title, subtitle: t.subtitle, start, end, note, spoiler: spoiler ? 1 : 0, author_name: me.Name, author_server: null, author_user: me.Id.toLowerCase(), audience, created: Date.now() })
    log.info(`${me.Name} ${start === null ? 'recommended' : 'flagged a moment in'} ${t.title} (${audience.length ? audience.map((a) => (a.s === 'home' ? 'home' : 'a friend')).join(', ') : 'just for them'})`)
    sendJson(res, 201, { key: `l:${id}` })
  })

  // The moments of a title you can see, for the player's timeline.
  router.get('/api/moments/item/:item', async ({ req, res, params }) => {
    const me = await person(req)
    const uid = me.Id.toLowerCase()
    const item = String(params.item ?? '')
    const tagged = TAGGED.exec(item)
    if (tagged) {
      const f = friendOf(tagged[1]!)
      if (!f) return sendJson(res, 200, { moments: [] })
      const r = await groups.callFriend<{ moments?: FeedMoment[] }>(f, `/api/groups/peer/moments?item=${tagged[2]!.toLowerCase()}`).catch(() => ({ moments: [] as FeedMoment[] }))
      const list = (r.moments ?? []).filter(validFeed).filter((m) => m.fromHere === uid || (m.users === null ? true : m.users.includes(uid)))
      return sendJson(res, 200, {
        moments: list.map((m) => ({ key: `r:${f.id}:${m.id}`, start: m.start, end: m.end, note: m.note, spoiler: m.spoiler, from: m.fromHere ? m.from : `${m.from} · ${f.name}`, mine: m.fromHere === uid, created: m.created })),
      })
    }
    if (!RAW.test(item)) throw new ApiError(400, 'Which title?')
    const list = store.list({ item: item.toLowerCase() }).filter((m) => (!m.author_server && m.author_user === uid) || forPerson(m.aud, uid) || me.admin)
    sendJson(res, 200, {
      moments: list.map((m) => ({ key: `l:${m.id}`, start: m.start, end: m.end, note: m.note, spoiler: m.spoiler === 1, from: fromLabel(m), mine: !m.author_server && m.author_user === uid, canDelete: me.admin || (!m.author_server && m.author_user === uid), created: m.created })),
    })
  })

  // What's been sent to you, newest first.
  router.get('/api/moments/inbox', async ({ req, res, url }) => {
    const me = await person(req)
    const uid = me.Id.toLowerCase()
    const since = Date.now() - FEED_DAYS * 86400e3
    // Fresh enough? Fetch friends' when it's been a while: in the background, or
    // first when the app asks (opening the list), at most every few seconds.
    const fresh = url.searchParams.get('fresh') === '1'
    const stale = groups.friends().filter((f) => Date.now() - (pollState.get(f.id)?.at ?? 0) > (fresh ? 3e3 : 60e3))
    if (fresh) await Promise.all(stale.map((f) => pollFriend(f, true)))
    else for (const f of stale) void pollFriend(f)
    const read = store.readKeys(uid)
    const local = store
      .list({ since })
      .filter((m) => forPerson(m.aud, uid) && !(!m.author_server && m.author_user === uid))
      .map((m) => ({ key: `l:${m.id}`, item: m.item, title: m.title, subtitle: m.subtitle, start: m.start, end: m.end, note: m.note, spoiler: m.spoiler === 1, from: fromLabel(m), created: m.created }))
    const names = new Map(groups.friends().map((f) => [f.id, f.name]))
    const remote = store
      .remote({ since })
      .filter((r) => names.has(r.friend) && r.author_here !== uid && (r.users === null || (JSON.parse(r.users) as string[]).includes(uid)))
      .map((r) => ({
        key: `r:${r.friend}:${r.id}`,
        item: `f-${r.friend}-${r.item}`,
        title: r.title,
        subtitle: r.subtitle,
        start: r.start,
        end: r.end,
        note: r.note,
        spoiler: r.spoiler === 1,
        from: r.author_here ? r.author_name : `${r.author_name} · ${names.get(r.friend)}`,
        created: r.created,
      }))
    const items = [...local, ...remote]
      .sort((a, b) => b.created - a.created)
      .slice(0, 60)
      .map((m) => ({ ...m, read: read.has(m.key) }))
    sendJson(res, 200, { moments: items, unread: items.filter((m) => !m.read).length })
  })

  router.post('/api/moments/read', async ({ req, res }) => {
    const me = await person(req)
    const body = await readJson<{ keys?: unknown }>(req, 65536)
    const keys = Array.isArray(body.keys) ? body.keys.map(String).filter((k) => /^(l:[\w-]{8,20}|r:[a-z0-9]{8}:[\w-]{8,20})$/.test(k)) : []
    store.markRead(me.Id.toLowerCase(), keys)
    sendJson(res, 200, { ok: true })
  })

  router.delete('/api/moments/:key', async ({ req, res, params }) => {
    const me = await person(req)
    const uid = me.Id.toLowerCase()
    const key = String(params.key ?? '')
    const remote = /^r:([a-z0-9]{8}):([\w-]{8,20})$/.exec(key)
    if (remote) {
      const f = friendOf(remote[1]!)
      if (!f) throw new ApiError(404, 'That moment is gone')
      await groups.callFriend(f, `/api/groups/peer/moments/${remote[2]}/delete`, { viewer: uid })
      await pollFriend(f, true)
      return sendJson(res, 200, { ok: true })
    }
    const local = /^l:([\w-]{8,20})$/.exec(key)
    const m = local ? store.get(local[1]!) : null
    if (!m) throw new ApiError(404, 'That moment is gone')
    if (!me.admin && !(m.author_server === null && m.author_user === uid)) throw new ApiError(403, 'Only whoever flagged it (or an admin) can delete it')
    store.remove(m.id)
    sendJson(res, 200, { ok: true })
  })

  // Administrators: whether friends' servers may send moments here.
  router.get('/api/moments/settings', async ({ req, res }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, { fromFriends: settings.get().momentsFromFriends !== false })
  })
  router.put('/api/moments/settings', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ fromFriends?: unknown }>(req)
    if (typeof body.fromFriends !== 'boolean') throw new ApiError(400, 'fromFriends must be true or false')
    const on = body.fromFriends
    settings.update((s) => void (s.momentsFromFriends = on))
    sendJson(res, 200, { fromFriends: on })
  })

  // ---------- friends' servers calling us ----------

  const feedOf = (link: GroupLink, m: Row & { aud: Audience[] }): FeedMoment => {
    const slice = forLink(m.aud, link.id)
    const theirs = m.author_server === link.id
    return {
      id: m.id,
      item: m.item,
      title: m.title,
      subtitle: m.subtitle,
      start: m.start,
      end: m.end,
      note: m.note,
      spoiler: m.spoiler === 1,
      from: m.author_name,
      fromHere: theirs ? m.author_user : null,
      users: slice ? slice.u : theirs ? [] : [],
      created: m.created,
    }
  }
  const visibleTo = (link: GroupLink, m: Row & { aud: Audience[] }) => m.author_server === link.id || forLink(m.aud, link.id) !== null

  router.get('/api/groups/peer/moments', async ({ req, res, url }) => {
    const link = groups.peerLink(req)
    const item = url.searchParams.get('item')
    if (item && !RAW.test(item)) throw new ApiError(400, 'Which title?')
    const list = item ? store.list({ item: item.toLowerCase() }) : store.list({ since: Date.now() - FEED_DAYS * 86400e3, limit: 2000 })
    sendJson(res, 200, { moments: list.filter((m) => visibleTo(link, m)).slice(0, FEED_MAX).map((m) => feedOf(link, m)) })
  })

  router.post('/api/groups/peer/moments', async ({ req, res }) => {
    const link = groups.peerLink(req)
    if (settings.get().momentsFromFriends === false) throw new ApiError(403, 'That server isn’t taking moments from friends right now')
    const body = await readJson<{ item?: unknown; start?: unknown; end?: unknown; note?: unknown; spoiler?: unknown; viewer?: unknown; name?: unknown; owner?: unknown; users?: unknown }>(req, 16384)
    const item = String(body.item ?? '').toLowerCase()
    const viewer = String(body.viewer ?? '').toLowerCase()
    if (!RAW.test(item) || !RAW.test(viewer)) throw new ApiError(400, 'Which title, and who?')
    const { start, end } = cleanSpan(body.start, body.end)
    const note = cleanNote(body.note)
    limit(`l:${link.id}`, 60)
    if (!(await linkSees(link, item))) throw new ApiError(403, 'That title isn’t shared with you')
    const t = await title(item)
    const users = body.users === null ? null : Array.isArray(body.users) ? body.users.map((u) => String(u).toLowerCase()).filter((u) => RAW.test(u)).slice(0, 100) : []
    const audience: Audience[] = [{ s: link.id, u: users }]
    if (body.owner === true) audience.push({ s: 'home', u: null })
    const id = newId()
    const name = cleanNote(body.name).replace(/\s+/g, ' ').slice(0, 40) || 'A friend'
    store.add({ id, item, title: t.title, subtitle: t.subtitle, start, end, note, spoiler: body.spoiler === true ? 1 : 0, author_name: name, author_server: link.id, author_user: viewer, audience, created: Date.now() })
    log.info(`${name} (${link.name}) ${start === null ? 'recommended' : 'flagged a moment in'} ${t.title}`)
    sendJson(res, 201, { id })
  })

  router.post('/api/groups/peer/moments/:id/delete', async ({ req, res, params }) => {
    const link = groups.peerLink(req)
    const body = await readJson<{ viewer?: unknown }>(req)
    const m = store.get(String(params.id ?? ''))
    if (!m || !visibleTo(link, m)) throw new ApiError(404, 'That moment is gone')
    if (!(m.author_server === link.id && m.author_user === String(body.viewer ?? '').toLowerCase())) throw new ApiError(403, 'Only whoever flagged it can delete it')
    store.remove(m.id)
    sendJson(res, 200, { ok: true })
  })

  return { store, pollAll }
}

function validFeed(m: FeedMoment): boolean {
  return (
    !!m &&
    typeof m.id === 'string' &&
    /^[\w-]{8,20}$/.test(m.id) &&
    RAW.test(String(m.item)) &&
    ((m.start === null && m.end === null) || (Number.isFinite(m.start) && Number.isFinite(m.end) && m.end! > m.start! && m.end! - m.start! <= SPAN_MAX + 1)) &&
    Number.isFinite(m.created) &&
    (m.users === null || Array.isArray(m.users))
  ) && Object.assign(m, {
    title: String(m.title ?? '').slice(0, 200),
    subtitle: String(m.subtitle ?? '').slice(0, 200),
    note: cleanNote(m.note),
    spoiler: m.spoiler === true,
    from: cleanNote(m.from).replace(/\s+/g, ' ').slice(0, 40) || 'A friend',
    fromHere: m.fromHere && RAW.test(String(m.fromHere)) ? String(m.fromHere).toLowerCase() : null,
    users: m.users === null ? null : m.users.map(String).filter((u) => RAW.test(u)),
  }) !== null
}
