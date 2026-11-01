// Shortlists ("shared queues"): pick something to watch together. Someone starts a shortlist
// and names who's in it (people on this server); members add titles, each member has one
// vote (they can move it), and whoever started it picks the winner. Picking doesn't start
// anything: each person plays it on their own device (a watch party is separate).
//
// Who sees what: only members see a shortlist. A title someone can't open (a library they're
// not in, their profile's limits) shows to them without its name or id, and they can't vote
// for it. Each title says whether the viewer can open it ("yes"), can't ("no"), or it's on a
// friend's server Finesse can't check for them ("unknown"), and how many members can: never
// who can't (that would tell members about each other's libraries and limits).
//
// Stored in lists.db (step 2). Friends' servers can't be members yet; their titles can be added.

import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { groupUserIds, type Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import type { Access, Availability } from './access.ts'
import { logger } from './log.ts'

const log = logger('queues')

export const QUEUE_LIMITS = { hosted: 30, members: 20, items: 100 }
const NAME_MAX = 60
const ITEM_ID = /^([0-9a-f]{32}|f-[a-z0-9]{8}-[0-9a-f]{32})$/

interface QueueRow {
  id: string
  name: string
  host: string
  created: number
  updated: number
  archived: number
  picked: string | null
}
interface ItemRow {
  queue: string
  key: string
  item: string
  title: string
  subtitle: string
  added_by: string
  added_at: number
}

const newId = (n = 9) => randomBytes(n).toString('base64url')

/** Availability lookups at once, for one shortlist (members × titles can be 20 × 100). */
export const LOOKUPS_AT_ONCE = 6

/** Runs fn over every entry, at most `at` at a time. */
export async function pooled<T, R>(list: T[], at: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(list.length)
  let next = 0
  const worker = async () => {
    while (next < list.length) {
      const i = next++
      out[i] = await fn(list[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(at, list.length) }, worker))
  return out
}

export function cleanQueueName(v: unknown): string {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
  if (!s) throw new ApiError(400, 'Give the shortlist a name, like “Friday film”')
  return s
}

export function registerQueues(router: Router, deps: { auth: Auth; settings: SettingsStore; db: DatabaseSync; access: Access }) {
  const { auth, settings, db, access } = deps
  const viewers = () => new Set([...groupUserIds(settings.get())].map((u) => u.toLowerCase()))
  const people = async () => access.people(viewers())

  const members = (q: string) => (db.prepare('SELECT user FROM queue_members WHERE queue = ?').all(q) as { user: string }[]).map((r) => r.user)
  const queue = (id: string, me: string): QueueRow => {
    const q = db.prepare('SELECT * FROM queues WHERE id = ?').get(id) as QueueRow | undefined
    // Not a member: the same as no such shortlist.
    if (!q || !members(q.id).includes(me)) throw new ApiError(404, 'That shortlist is gone, or you’re not in it')
    return q
  }
  const hostOnly = (q: QueueRow, me: string) => {
    if (q.host !== me) throw new ApiError(403, 'Only whoever started the shortlist can do that')
  }
  const touch = (id: string) => db.prepare('UPDATE queues SET updated = ? WHERE id = ?').run(Date.now(), id)

  /** The shortlist as one member sees it. */
  async function view(q: QueueRow, me: string) {
    const who = members(q.id)
    const names = new Map((await people()).map((p) => [p.id, p.name]))
    const items = db.prepare('SELECT * FROM queue_items WHERE queue = ? ORDER BY added_at').all(q.id) as unknown as ItemRow[]
    const votes = db.prepare('SELECT user, key FROM queue_votes WHERE queue = ?').all(q.id) as { user: string; key: string }[]
    const mine = votes.find((v) => v.user === me)?.key ?? null
    const avail = new Map<string, Availability>()
    await pooled(
      items.flatMap((it) => who.map((u) => [it.item, u] as const)),
      LOOKUPS_AT_ONCE,
      async ([item, u]) => void avail.set(`${item}/${u}`, await access.availability(u, item)),
    )
    const out = await Promise.all(
      items.map(async (it) => {
        const state = (u: string) => avail.get(`${it.item}/${u}`) ?? 'no'
        const open = state(me) !== 'no'
        const base = { key: it.key, votes: votes.filter((v) => v.key === it.key).length, mine: mine === it.key, canRemove: it.added_by === me || q.host === me }
        // Someone who can't open it doesn't learn what it is.
        if (!open) return { ...base, hidden: true as const, item: null, title: 'A title you can’t open', subtitle: '', addedBy: null, availability: null }
        return {
          ...base,
          hidden: false as const,
          item: it.item,
          title: it.title,
          subtitle: it.subtitle,
          addedBy: names.get(it.added_by) ?? 'Someone',
          // Only the viewer's own answer, and a count: not who can't.
          availability: { state: state(me), canOpen: who.filter((u) => state(u) === 'yes').length, members: who.length },
        }
      }),
    )
    const picked = q.picked ? out.find((i) => i.key === q.picked) ?? null : null
    return {
      id: q.id,
      name: q.name,
      host: { id: q.host, name: names.get(q.host) ?? 'Someone' },
      isHost: q.host === me,
      archived: q.archived === 1,
      members: who.map((u) => ({ id: u, name: names.get(u) ?? 'Someone' })),
      items: out,
      myVote: mine,
      picked: picked ? picked.key : null,
      updated: q.updated,
    }
  }

  /** Who a host may add: people here (never friends' viewer accounts). */
  async function cleanMembers(raw: unknown, host: string): Promise<string[]> {
    const ok = new Set((await people()).map((p) => p.id))
    const list = Array.isArray(raw) ? raw.map((x) => String(x).toLowerCase()).filter((x) => ok.has(x) && x !== host) : []
    const uniq = [...new Set(list)]
    if (uniq.length + 1 > QUEUE_LIMITS.members) throw new ApiError(400, `A shortlist can have up to ${QUEUE_LIMITS.members} people`)
    return uniq
  }

  // People here to pick from (shortlists, shared Moments collections): never friends' viewer accounts.
  router.get('/api/people', async ({ req, res }) => {
    const me = await auth.requirePerson(req)
    sendJson(res, 200, { people: (await people()).filter((p) => p.id !== me.id) })
  })

  router.get('/api/queues', async ({ req, res }) => {
    const me = await auth.requirePerson(req)
    const rows = db.prepare('SELECT q.* FROM queues q JOIN queue_members m ON m.queue = q.id WHERE m.user = ? ORDER BY q.archived, q.updated DESC').all(me.id) as unknown as QueueRow[]
    const names = new Map((await people()).map((p) => [p.id, p.name]))
    sendJson(res, 200, {
      queues: rows.map((q) => ({
        id: q.id,
        name: q.name,
        host: names.get(q.host) ?? 'Someone',
        isHost: q.host === me.id,
        archived: q.archived === 1,
        members: members(q.id).length,
        items: (db.prepare('SELECT COUNT(*) AS n FROM queue_items WHERE queue = ?').get(q.id) as { n: number }).n,
        picked: q.picked !== null,
        updated: q.updated,
      })),
    })
  })

  router.post('/api/queues', async ({ req, res }) => {
    const me = await auth.requirePerson(req)
    const body = await readJson<{ name?: unknown; members?: unknown }>(req, 16384)
    const name = cleanQueueName(body.name)
    const hosted = (db.prepare('SELECT COUNT(*) AS n FROM queues WHERE host = ?').get(me.id) as { n: number }).n
    if (hosted >= QUEUE_LIMITS.hosted) throw new ApiError(400, `You’ve started ${QUEUE_LIMITS.hosted} shortlists. Remove an old one first.`)
    const who = await cleanMembers(body.members, me.id)
    const id = newId()
    const now = Date.now()
    db.exec('BEGIN')
    try {
      db.prepare('INSERT INTO queues (id, name, host, created, updated, archived, picked) VALUES (?, ?, ?, ?, ?, 0, NULL)').run(id, name, me.id, now, now)
      const add = db.prepare('INSERT INTO queue_members (queue, user) VALUES (?, ?)')
      for (const u of [me.id, ...who]) add.run(id, u)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
    log.info(`${me.Name} started a shortlist with ${who.length} other(s)`)
    sendJson(res, 201, await view(queue(id, me.id), me.id))
  })

  router.get('/api/queues/:id', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    sendJson(res, 200, await view(queue(String(params.id), me.id), me.id))
  })

  router.put('/api/queues/:id', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const q = queue(String(params.id), me.id)
    hostOnly(q, me.id)
    const body = await readJson<{ name?: unknown; members?: unknown; archived?: unknown }>(req, 16384)
    if (body.name !== undefined) db.prepare('UPDATE queues SET name = ? WHERE id = ?').run(cleanQueueName(body.name), q.id)
    if (body.archived !== undefined) {
      if (typeof body.archived !== 'boolean') throw new ApiError(400, 'archived must be true or false')
      db.prepare('UPDATE queues SET archived = ? WHERE id = ?').run(body.archived ? 1 : 0, q.id)
    }
    if (body.members !== undefined) {
      const who = await cleanMembers(body.members, me.id)
      db.exec('BEGIN')
      try {
        // Someone taken off loses their vote too.
        db.prepare('DELETE FROM queue_members WHERE queue = ? AND user != ?').run(q.id, me.id)
        const add = db.prepare('INSERT OR IGNORE INTO queue_members (queue, user) VALUES (?, ?)')
        for (const u of who) add.run(q.id, u)
        db.prepare('DELETE FROM queue_votes WHERE queue = ? AND user NOT IN (SELECT user FROM queue_members WHERE queue = ?)').run(q.id, q.id)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    }
    touch(q.id)
    sendJson(res, 200, await view(queue(q.id, me.id), me.id))
  })

  router.delete('/api/queues/:id', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const q = queue(String(params.id), me.id)
    hostOnly(q, me.id)
    db.prepare('DELETE FROM queues WHERE id = ?').run(q.id)
    sendJson(res, 200, { ok: true })
  })

  router.post('/api/queues/:id/leave', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const q = queue(String(params.id), me.id)
    if (q.host === me.id) throw new ApiError(400, 'You started it, so you can’t leave it. Remove it instead.')
    db.prepare('DELETE FROM queue_votes WHERE queue = ? AND user = ?').run(q.id, me.id)
    db.prepare('DELETE FROM queue_members WHERE queue = ? AND user = ?').run(q.id, me.id)
    touch(q.id)
    sendJson(res, 200, { ok: true })
  })

  router.post('/api/queues/:id/items', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const q = queue(String(params.id), me.id)
    if (q.archived) throw new ApiError(400, 'That shortlist is archived. Bring it back first.')
    const body = await readJson<{ item?: unknown }>(req)
    const item = String(body.item ?? '').toLowerCase()
    if (!ITEM_ID.test(item)) throw new ApiError(400, 'Which title?')
    const have = db.prepare('SELECT key FROM queue_items WHERE queue = ? AND item = ?').get(q.id, item) as { key: string } | undefined
    if (have) return sendJson(res, 200, await view(q, me.id))
    if ((db.prepare('SELECT COUNT(*) AS n FROM queue_items WHERE queue = ?').get(q.id) as { n: number }).n >= QUEUE_LIMITS.items) throw new ApiError(400, `A shortlist holds up to ${QUEUE_LIMITS.items} titles`)
    // Read as the person adding it: proof they can open it, and its name.
    const t = await access.titleFor({ id: me.id, name: me.Name }, item)
    if (!t) throw new ApiError(404, 'You can’t open that title, so it can’t go on the shortlist')
    db.prepare('INSERT INTO queue_items (queue, key, item, title, subtitle, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(q.id, newId(6), item, t.title, t.subtitle, me.id, Date.now())
    touch(q.id)
    sendJson(res, 201, await view(q, me.id))
  })

  router.delete('/api/queues/:id/items/:key', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const q = queue(String(params.id), me.id)
    const it = db.prepare('SELECT * FROM queue_items WHERE queue = ? AND key = ?').get(q.id, String(params.key)) as ItemRow | undefined
    if (!it) throw new ApiError(404, 'That title is already off the shortlist')
    if (it.added_by !== me.id && q.host !== me.id) throw new ApiError(403, 'Only whoever added it, or whoever started the shortlist, can take it off')
    db.prepare('DELETE FROM queue_items WHERE queue = ? AND key = ?').run(q.id, it.key)
    db.prepare('DELETE FROM queue_votes WHERE queue = ? AND key = ?').run(q.id, it.key)
    if (q.picked === it.key) db.prepare('UPDATE queues SET picked = NULL WHERE id = ?').run(q.id)
    touch(q.id)
    sendJson(res, 200, await view(queue(q.id, me.id), me.id))
  })

  // One vote per member: voting again moves it; null takes it back.
  router.put('/api/queues/:id/vote', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const q = queue(String(params.id), me.id)
    if (q.archived) throw new ApiError(400, 'That shortlist is archived')
    const body = await readJson<{ key?: unknown }>(req)
    if (body.key === null) db.prepare('DELETE FROM queue_votes WHERE queue = ? AND user = ?').run(q.id, me.id)
    else {
      const it = db.prepare('SELECT * FROM queue_items WHERE queue = ? AND key = ?').get(q.id, String(body.key ?? '')) as ItemRow | undefined
      if (!it) throw new ApiError(404, 'That title is off the shortlist now')
      if ((await access.availability(me.id, it.item)) === 'no') throw new ApiError(403, 'You can’t open that title, so you can’t vote for it')
      db.prepare('INSERT INTO queue_votes (queue, user, key) VALUES (?, ?, ?) ON CONFLICT(queue, user) DO UPDATE SET key = excluded.key').run(q.id, me.id, it.key)
    }
    touch(q.id)
    sendJson(res, 200, await view(queue(q.id, me.id), me.id))
  })

  // The host's final say (null: undecided again).
  router.post('/api/queues/:id/pick', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const q = queue(String(params.id), me.id)
    hostOnly(q, me.id)
    const body = await readJson<{ key?: unknown }>(req)
    let key: string | null = null
    if (body.key !== null) {
      const it = db.prepare('SELECT key FROM queue_items WHERE queue = ? AND key = ?').get(q.id, String(body.key ?? '')) as { key: string } | undefined
      if (!it) throw new ApiError(404, 'That title is off the shortlist now')
      key = it.key
    }
    db.prepare('UPDATE queues SET picked = ? WHERE id = ?').run(key, q.id)
    touch(q.id)
    sendJson(res, 200, await view(queue(q.id, me.id), me.id))
  })

}
