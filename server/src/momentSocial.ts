// Reactions and comments on moments: what makes the feed a place people answer each other.
//
// They follow the moment. A moment lives on the server that has the video (moments.ts), so its
// reactions and comments live there too, one copy, and everyone who can see the moment sees the
// same thread:
//
//   A moment of ours:     kept here. People here react and comment directly; a friend's server
//                         sends its people's over the pairing link, and reads the thread the
//                         same way.
//   A moment of a friend: our server passes our people's reactions and comments to theirs, and
//                         asks theirs for the thread (briefly remembered, so a feed of twenty
//                         moments is one question per friend).
//
// Who can see or add to a thread is exactly who can see the moment (its audience); a friend's
// server only ever hears about moments it was sent. A friend's server can say "one of yours
// wrote this" only for what we really sent it (the `sent_social` table), so it can't put words
// in the mouth of anyone here. One reaction per person per moment, from a short fixed set;
// comments are plain text.

import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { groupUserIds, type Auth } from './auth.ts'
import type { GroupFriend, SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { logger } from './log.ts'
import { cleanNote, forLink, type GroupsApi, type MomentStore } from './moments.ts'

const log = logger('moments')

/** The reactions on offer. */
export const REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👏'] as const
export const COMMENT_MAX = 300
const THREAD_MAX = 200
const RAW = /^[0-9a-f]{32}$/i
const ID = /^[\w-]{8,20}$/
const HOME = ''

/** One reaction or comment as a friend's server is told it. */
export interface PeerReaction {
  emoji: string
  from: string
  /** One of the asking server's own people (their id there). */
  fromHere: string | null
  created: number
}
export interface PeerComment extends PeerReaction {
  id: string
  text: string
  emoji: ''
}
export interface PeerThread {
  reactions: PeerReaction[]
  comments: PeerComment[]
}

/** A thread as the app shows it to one person. */
export interface Thread {
  reactions: { emoji: string; count: number; mine: boolean; who: string[] }[]
  comments: { id: string; from: string; text: string; created: number; mine: boolean; canDelete: boolean }[]
}

/** Plain text like a moment's note (no control or direction-flipping characters), a little longer. */
const cleanComment = (v: unknown) =>
  String(v ?? '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, COMMENT_MAX)
const cleanName = (v: unknown) => cleanNote(v).replace(/\s+/g, ' ').slice(0, 40) || 'A friend'

interface ReactRow {
  moment: string
  server: string
  user: string
  name: string
  emoji: string
  created: number
}
interface CommentRow extends ReactRow {
  id: string
  text: string
}

export class SocialStore {
  private db: MomentStore['db']

  constructor(store: MomentStore) {
    this.db = store.db
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reactions (
        moment TEXT NOT NULL,
        server TEXT NOT NULL,
        user TEXT NOT NULL,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created INTEGER NOT NULL,
        PRIMARY KEY (moment, server, user)
      );
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        moment TEXT NOT NULL,
        server TEXT NOT NULL,
        user TEXT NOT NULL,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS comments_moment ON comments(moment, created);
      CREATE TABLE IF NOT EXISTS sent_social (
        friend TEXT NOT NULL,
        ref TEXT NOT NULL,
        user TEXT NOT NULL,
        created INTEGER NOT NULL,
        PRIMARY KEY (friend, ref, user)
      );
    `)
  }

  react(moment: string, server: string, user: string, name: string, emoji: string | null) {
    if (emoji === null) this.db.prepare('DELETE FROM reactions WHERE moment = ? AND server = ? AND user = ?').run(moment, server, user)
    else this.db.prepare('INSERT OR REPLACE INTO reactions (moment, server, user, name, emoji, created) VALUES (?, ?, ?, ?, ?, ?)').run(moment, server, user, name, emoji, Date.now())
  }

  comment(moment: string, server: string, user: string, name: string, text: string): string {
    const n = (this.db.prepare('SELECT COUNT(*) AS n FROM comments WHERE moment = ?').get(moment) as { n: number }).n
    if (n >= THREAD_MAX) throw new ApiError(409, 'This moment has all the comments it can hold')
    const id = randomBytes(9).toString('base64url')
    this.db.prepare('INSERT INTO comments (id, moment, server, user, name, text, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, moment, server, user, name, text, Date.now())
    return id
  }

  getComment(id: string): CommentRow | null {
    return (this.db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as CommentRow | undefined) ?? null
  }

  removeComment(id: string) {
    this.db.prepare('DELETE FROM comments WHERE id = ?').run(id)
  }

  thread(moment: string): { reactions: ReactRow[]; comments: CommentRow[] } {
    return {
      reactions: this.db.prepare('SELECT * FROM reactions WHERE moment = ? ORDER BY created').all(moment) as unknown as ReactRow[],
      comments: this.db.prepare('SELECT * FROM comments WHERE moment = ? ORDER BY created').all(moment) as unknown as CommentRow[],
    }
  }

  /** Threads of moments that are gone go with them. */
  sweep() {
    this.db.exec('DELETE FROM reactions WHERE moment NOT IN (SELECT id FROM moments); DELETE FROM comments WHERE moment NOT IN (SELECT id FROM moments);')
    this.db.prepare('DELETE FROM sent_social WHERE created < ?').run(Date.now() - 240 * 86400e3)
  }

  /** We sent this to a friend's server for this person: only then may it call it theirs. */
  recordSent(friend: string, ref: string, user: string) {
    this.db.prepare('INSERT OR REPLACE INTO sent_social (friend, ref, user, created) VALUES (?, ?, ?, ?)').run(friend, ref, user, Date.now())
  }
  forgetSent(friend: string, ref: string, user: string) {
    this.db.prepare('DELETE FROM sent_social WHERE friend = ? AND ref = ? AND user = ?').run(friend, ref, user)
  }
  wasSent(friend: string, ref: string, user: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM sent_social WHERE friend = ? AND ref = ? AND user = ?').get(friend, ref, user))
  }
}

// ---------- rate limits ----------
const made = new Map<string, number[]>()
function limit(key: string, perHour: number) {
  const now = Date.now()
  const list = (made.get(key) ?? []).filter((t) => now - t < 3600e3)
  if (list.length >= perHour) throw new ApiError(429, 'That’s a lot for one hour. Try again a bit later.')
  list.push(now)
  made.set(key, list)
  if (made.size > 5000) made.clear()
}

/** Reactions counted by emoji, most used first, with who (the first few names). */
function tally(rows: { emoji: string; from: string; mine: boolean }[]): Thread['reactions'] {
  const by = new Map<string, { emoji: string; count: number; mine: boolean; who: string[] }>()
  for (const r of rows) {
    const cur = by.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, who: [] }
    cur.count++
    if (r.mine) cur.mine = true
    if (cur.who.length < 6) cur.who.push(r.mine ? 'You' : r.from)
    by.set(r.emoji, cur)
  }
  return [...by.values()].sort((a, b) => b.count - a.count || REACTIONS.indexOf(a.emoji as (typeof REACTIONS)[number]) - REACTIONS.indexOf(b.emoji as (typeof REACTIONS)[number]))
}

export function registerMomentSocial(
  router: Router,
  deps: {
    settings: SettingsStore
    auth: Auth
    groups: GroupsApi
    store: MomentStore
    /** moments.ts: the moment as this person may see it, or null. */
    momentFor: (uid: string, key: string) => { item: string } | null
    parental?: import('./parental.ts').Parental
  },
) {
  const { settings, auth, groups, store, momentFor } = deps
  const social = new SocialStore(store)
  setInterval(() => social.sweep(), 3600e3).unref()

  async function person(req: IncomingMessage) {
    const user = await auth.requireUser(req)
    if (user.Id === 'service' || !RAW.test(user.Id)) throw new ApiError(403, 'Sign in as a person')
    if (groupUserIds(settings.get()).has(user.Id)) throw new ApiError(403, 'Sign in as a person')
    return { uid: user.Id.toLowerCase(), name: user.Name, admin: Boolean(user.Policy?.IsAdministrator) }
  }

  /** The moment behind a key, if this person may see it (and, for a limited profile, open its title). */
  async function seen(uid: string, key: string): Promise<{ local: string } | { friend: GroupFriend; id: string }> {
    const m = momentFor(uid, key)
    if (!m) throw new ApiError(404, 'That moment is gone')
    if (deps.parental?.limitOf(uid)) {
      const ok = m.item.startsWith('f-') ? false : await deps.parental.allows(uid, m.item.toLowerCase())
      if (!ok) throw new ApiError(403, 'This profile can’t open that title')
    }
    const local = /^l:([\w-]{8,20})$/.exec(key)
    if (local) return { local: local[1]! }
    const remote = /^r:([a-z0-9]{8}):([\w-]{8,20})$/.exec(key)!
    const friend = groups.friends().find((f) => f.id === remote[1])
    if (!friend) throw new ApiError(404, 'That moment is gone')
    return { friend, id: remote[2]! }
  }

  const linkName = (id: string) => groups.links().find((l) => l.id === id)?.name
  /** A row's author as people here read it: a friend's person carries their server's name. */
  const label = (r: { server: string; name: string }) => (r.server === HOME ? r.name : linkName(r.server) ? `${r.name} · ${linkName(r.server)}` : r.name)

  function localThread(id: string, uid: string, admin: boolean): Thread {
    const m = store.get(id)
    const t = social.thread(id)
    const own = Boolean(m && !m.author_server && m.author_user === uid)
    return {
      reactions: tally(t.reactions.map((r) => ({ emoji: r.emoji, from: label(r), mine: r.server === HOME && r.user === uid }))),
      comments: t.comments.map((c) => {
        const mine = c.server === HOME && c.user === uid
        return { id: c.id, from: mine ? 'You' : label(c), text: c.text, created: c.created, mine, canDelete: mine || own || admin }
      }),
    }
  }

  // ---------- a friend's threads, remembered for a few seconds ----------
  const remote = new Map<string, { at: number; threads: Promise<Record<string, PeerThread>> }>()
  function friendThreads(f: GroupFriend, fresh = false): Promise<Record<string, PeerThread>> {
    const hit = remote.get(f.id)
    if (hit && !fresh && Date.now() - hit.at < 12e3) return hit.threads
    const threads = groups
      .callFriend<{ threads?: Record<string, PeerThread> }>(f, '/api/groups/peer/moments/social')
      .then((r) => (r?.threads && typeof r.threads === 'object' ? r.threads : {}))
      // An older Finesse there (no threads yet), or it's off: nothing to show.
      .catch(() => ({}) as Record<string, PeerThread>)
    remote.set(f.id, { at: Date.now(), threads })
    return threads
  }
  function remoteThread(f: GroupFriend, id: string, raw: PeerThread | undefined, uid: string): Thread {
    const reactions = (Array.isArray(raw?.reactions) ? raw!.reactions : []).filter((r) => r && (REACTIONS as readonly string[]).includes(r.emoji)).slice(0, 500)
    const comments = (Array.isArray(raw?.comments) ? raw!.comments : []).filter((c) => c && typeof c.id === 'string' && ID.test(c.id)).slice(0, THREAD_MAX)
    // "One of yours" only where we really sent it for that person.
    const ours = (ref: string, who: unknown) => (typeof who === 'string' && RAW.test(who) && social.wasSent(f.id, ref, who.toLowerCase()) ? who.toLowerCase() : null)
    return {
      reactions: tally(
        reactions.map((r) => {
          const here = ours(`r:${id}`, r.fromHere)
          return { emoji: r.emoji, from: here ? cleanName(r.from) : `${cleanName(r.from)} · ${f.name}`, mine: here === uid }
        }),
      ),
      comments: comments.map((c) => {
        const here = ours(`c:${c.id}`, c.fromHere)
        const mine = here === uid
        return { id: c.id, from: mine ? 'You' : here ? cleanName(c.from) : `${cleanName(c.from)} · ${f.name}`, text: cleanComment(c.text), created: Number(c.created) || 0, mine, canDelete: mine }
      }),
    }
  }

  // ---------- the app ----------

  // The threads of the moments on screen.
  router.get('/api/moments/social', async ({ req, res, url }) => {
    const me = await person(req)
    const keys = String(url.searchParams.get('keys') ?? '').split(',').filter(Boolean).slice(0, 80)
    const out: Record<string, Thread> = {}
    await Promise.all(
      keys.map(async (key) => {
        const where = await seen(me.uid, key).catch(() => null)
        if (!where) return
        if ('local' in where) out[key] = localThread(where.local, me.uid, me.admin)
        else out[key] = remoteThread(where.friend, where.id, (await friendThreads(where.friend))[where.id], me.uid)
      }),
    )
    sendJson(res, 200, { threads: out, reactions: REACTIONS })
  })

  router.post('/api/moments/react', async ({ req, res }) => {
    const me = await person(req)
    const body = await readJson<{ key?: unknown; emoji?: unknown }>(req, 4096)
    const emoji = body.emoji === null ? null : String(body.emoji ?? '')
    if (emoji !== null && !(REACTIONS as readonly string[]).includes(emoji)) throw new ApiError(400, 'Pick one of the reactions')
    const key = String(body.key ?? '')
    const where = await seen(me.uid, key)
    limit(`r:${me.uid}`, 240)
    if ('local' in where) {
      social.react(where.local, HOME, me.uid, me.name, emoji)
      return sendJson(res, 200, { thread: localThread(where.local, me.uid, me.admin) })
    }
    // Remembered before it's sent, so the friend's server can call it ours the moment it has it.
    if (emoji !== null) social.recordSent(where.friend.id, `r:${where.id}`, me.uid)
    try {
      await groups.callFriend(where.friend, `/api/groups/peer/moments/${where.id}/react`, { viewer: me.uid, name: me.name, emoji })
    } catch (e) {
      throw peerError(e, where.friend)
    }
    if (emoji === null) social.forgetSent(where.friend.id, `r:${where.id}`, me.uid)
    sendJson(res, 200, { thread: remoteThread(where.friend, where.id, (await friendThreads(where.friend, true))[where.id], me.uid) })
  })

  router.post('/api/moments/comment', async ({ req, res }) => {
    const me = await person(req)
    const body = await readJson<{ key?: unknown; text?: unknown }>(req, 8192)
    const text = cleanComment(body.text)
    if (!text) throw new ApiError(400, 'Write something first')
    const key = String(body.key ?? '')
    const where = await seen(me.uid, key)
    limit(`c:${me.uid}`, 60)
    if ('local' in where) {
      social.comment(where.local, HOME, me.uid, me.name, text)
      return sendJson(res, 201, { thread: localThread(where.local, me.uid, me.admin) })
    }
    let r: { id?: string }
    try {
      r = await groups.callFriend<{ id?: string }>(where.friend, `/api/groups/peer/moments/${where.id}/comment`, { viewer: me.uid, name: me.name, text })
    } catch (e) {
      throw peerError(e, where.friend)
    }
    if (typeof r?.id === 'string' && ID.test(r.id)) social.recordSent(where.friend.id, `c:${r.id}`, me.uid)
    sendJson(res, 201, { thread: remoteThread(where.friend, where.id, (await friendThreads(where.friend, true))[where.id], me.uid) })
  })

  router.post('/api/moments/comment/delete', async ({ req, res }) => {
    const me = await person(req)
    const body = await readJson<{ key?: unknown; id?: unknown }>(req, 4096)
    const id = String(body.id ?? '')
    if (!ID.test(id)) throw new ApiError(400, 'Which comment?')
    const where = await seen(me.uid, String(body.key ?? ''))
    if ('local' in where) {
      const c = social.getComment(id)
      if (!c || c.moment !== where.local) throw new ApiError(404, 'That comment is gone')
      const m = store.get(where.local)
      const own = Boolean(m && !m.author_server && m.author_user === me.uid)
      if (!(c.server === HOME && c.user === me.uid) && !own && !me.admin) throw new ApiError(403, 'Only whoever wrote it, whoever flagged the moment, or an admin can delete it')
      social.removeComment(id)
      return sendJson(res, 200, { thread: localThread(where.local, me.uid, me.admin) })
    }
    try {
      await groups.callFriend(where.friend, `/api/groups/peer/moments/${where.id}/comment/${id}/delete`, { viewer: me.uid })
    } catch (e) {
      throw peerError(e, where.friend)
    }
    sendJson(res, 200, { thread: remoteThread(where.friend, where.id, (await friendThreads(where.friend, true))[where.id], me.uid) })
  })

  const peerError = (e: unknown, f: GroupFriend) => {
    const status = (e as ApiError).status
    if (status === 404) return new ApiError(409, `${f.name} is on an older Finesse that can’t take reactions or comments yet`)
    if (status === 403 || status === 409 || status === 429) return new ApiError(status, (e as Error).message)
    return new ApiError(502, `Couldn’t reach ${f.name} just now. Try again in a moment.`)
  }

  // ---------- friends' servers calling us ----------

  /** A moment of ours that this friend's server was sent (or one of its people wrote). */
  const theirs = (linkId: string, id: string) => {
    const m = ID.test(id) ? store.get(id) : null
    if (!m || !(m.author_server === linkId || forLink(m.aud, linkId) !== null)) throw new ApiError(404, 'That moment is gone')
    return m
  }
  const peerThread = (linkId: string, id: string): PeerThread => {
    const t = social.thread(id)
    // Their own people by id; ours by name; a third server's people with that server's name.
    const from = (r: { server: string; name: string }) => (r.server === linkId || r.server === HOME ? r.name : label(r))
    return {
      reactions: t.reactions.map((r) => ({ emoji: r.emoji, from: from(r), fromHere: r.server === linkId ? r.user : null, created: r.created })),
      comments: t.comments.map((c) => ({ id: c.id, emoji: '' as const, text: c.text, from: from(c), fromHere: c.server === linkId ? c.user : null, created: c.created })),
    }
  }

  router.get('/api/groups/peer/moments/social', async ({ req, res }) => {
    const link = groups.peerLink(req)
    const out: Record<string, PeerThread> = {}
    for (const m of store.list({ since: Date.now() - 60 * 86400e3, limit: 2000 })) {
      if (!(m.author_server === link.id || forLink(m.aud, link.id) !== null)) continue
      const t = peerThread(link.id, m.id)
      if (t.reactions.length || t.comments.length) out[m.id] = t
    }
    sendJson(res, 200, { threads: out })
  })

  const viewerOf = (body: { viewer?: unknown; name?: unknown }) => {
    const viewer = String(body.viewer ?? '').toLowerCase()
    if (!RAW.test(viewer)) throw new ApiError(400, 'Who?')
    return { viewer, name: cleanName(body.name) }
  }
  const taking = () => {
    if (settings.get().momentsFromFriends === false) throw new ApiError(403, 'That server isn’t taking moments from friends right now')
  }

  router.post('/api/groups/peer/moments/:id/react', async ({ req, res, params }) => {
    const link = groups.peerLink(req)
    taking()
    const body = await readJson<{ viewer?: unknown; name?: unknown; emoji?: unknown }>(req, 4096)
    const { viewer, name } = viewerOf(body)
    const emoji = body.emoji === null ? null : String(body.emoji ?? '')
    if (emoji !== null && !(REACTIONS as readonly string[]).includes(emoji)) throw new ApiError(400, 'Pick one of the reactions')
    const m = theirs(link.id, String(params.id ?? ''))
    limit(`lr:${link.id}`, 1200)
    social.react(m.id, link.id, viewer, name, emoji)
    sendJson(res, 200, { ok: true })
  })

  router.post('/api/groups/peer/moments/:id/comment', async ({ req, res, params }) => {
    const link = groups.peerLink(req)
    taking()
    const body = await readJson<{ viewer?: unknown; name?: unknown; text?: unknown }>(req, 8192)
    const { viewer, name } = viewerOf(body)
    const text = cleanComment(body.text)
    if (!text) throw new ApiError(400, 'Write something first')
    const m = theirs(link.id, String(params.id ?? ''))
    limit(`lc:${link.id}`, 300)
    const id = social.comment(m.id, link.id, viewer, name, text)
    log.info(`${name} (${link.name}) commented on a moment in ${m.title}`)
    sendJson(res, 201, { id })
  })

  router.post('/api/groups/peer/moments/:id/comment/:cid/delete', async ({ req, res, params }) => {
    const link = groups.peerLink(req)
    const body = await readJson<{ viewer?: unknown }>(req, 4096)
    const viewer = String(body.viewer ?? '').toLowerCase()
    const m = theirs(link.id, String(params.id ?? ''))
    const c = social.getComment(String(params.cid ?? ''))
    if (!c || c.moment !== m.id) throw new ApiError(404, 'That comment is gone')
    // Their own comment, or any comment on a moment their person flagged.
    const own = c.server === link.id && c.user === viewer
    const flagged = m.author_server === link.id && m.author_user === viewer
    if (!own && !flagged) throw new ApiError(403, 'Only whoever wrote it, or whoever flagged the moment, can delete it')
    social.removeComment(c.id)
    sendJson(res, 200, { ok: true })
  })

  return { social }
}
