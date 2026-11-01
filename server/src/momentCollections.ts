// Moments collections: keep favourite moments together ("Best openings", "Make Robin cry").
// An entry is a reference (a title, a start and end, a note, and who flagged it), never a
// copy of the video. Collections are private until their owner shares one with chosen people
// here; sharing hands over references only: whoever opens one plays it only if they can open
// the title themselves, and an entry they can't open shows without its title or note.
//
// Entries come from a moment sent to you (or one of yours), keeping who flagged it; from a
// spot in a title you can open; or from a collection shared with you (attribution kept).
// Stored in lists.db (step 3).

import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { groupUserIds, type Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import type { Access } from './access.ts'
import { cleanNote, cleanSpan } from './moments.ts'

export const MC_LIMITS = { owned: 50, entries: 200, shares: 20 }
const ITEM_ID = /^([0-9a-f]{32}|f-[a-z0-9]{8}-[0-9a-f]{32})$/

interface ColRow {
  id: string
  owner: string
  name: string
  created: number
  updated: number
}
interface EntryRow {
  collection: string
  key: string
  item: string
  title: string
  subtitle: string
  start: number | null
  end: number | null
  note: string
  from_name: string
  saved_at: number
}

const newId = (n = 9) => randomBytes(n).toString('base64url')
function cleanName(v: unknown): string {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!s) throw new ApiError(400, 'Give the collection a name, like “Best openings”')
  return s
}

type MomentFor = (uid: string, key: string) => { item: string; title: string; subtitle: string; start: number | null; end: number | null; note: string; from: string } | null

export function registerMomentCollections(router: Router, deps: { auth: Auth; settings: SettingsStore; db: DatabaseSync; access: Access; momentFor: MomentFor }) {
  const { auth, settings, db, access, momentFor } = deps
  const people = () => access.people(new Set([...groupUserIds(settings.get())].map((u) => u.toLowerCase())))
  const shares = (c: string) => (db.prepare('SELECT user FROM moment_collection_shares WHERE collection = ?').all(c) as { user: string }[]).map((r) => r.user)
  const count = (c: string) => (db.prepare('SELECT COUNT(*) AS n FROM moment_entries WHERE collection = ?').get(c) as { n: number }).n

  /** One the person owns or that's shared with them; anything else is "not found". */
  const readable = (id: string, me: string): ColRow => {
    const c = db.prepare('SELECT * FROM moment_collections WHERE id = ?').get(id) as ColRow | undefined
    if (!c || (c.owner !== me && !shares(c.id).includes(me))) throw new ApiError(404, 'That collection is gone, or it isn’t shared with you')
    return c
  }
  const owned = (id: string, me: string): ColRow => {
    const c = readable(id, me)
    if (c.owner !== me) throw new ApiError(403, 'Only whoever made the collection can change it')
    return c
  }

  async function view(c: ColRow, me: string) {
    const names = new Map((await people()).map((p) => [p.id, p.name]))
    const rows = db.prepare('SELECT * FROM moment_entries WHERE collection = ? ORDER BY saved_at').all(c.id) as unknown as EntryRow[]
    const entries = await Promise.all(
      rows.map(async (e) => {
        const open = await access.mayOpen(me, e.item)
        if (open) return { key: e.key, available: true, item: e.item, title: e.title, subtitle: e.subtitle, start: e.start, end: e.end, note: e.note, from: e.from_name, savedAt: e.saved_at }
        // Whoever saved it already knew what it was; anyone else doesn't learn it now.
        const own = c.owner === me
        return { key: e.key, available: false, item: null, title: own ? e.title : 'A title you can’t open', subtitle: own ? e.subtitle : '', start: e.start, end: e.end, note: own ? e.note : '', from: own ? e.from_name : '', savedAt: e.saved_at }
      }),
    )
    return {
      id: c.id,
      name: c.name,
      mine: c.owner === me,
      owner: { id: c.owner, name: names.get(c.owner) ?? 'Someone' },
      sharedWith: c.owner === me ? shares(c.id).map((u) => ({ id: u, name: names.get(u) ?? 'Someone' })) : undefined,
      entries,
      updated: c.updated,
    }
  }

  router.get('/api/moment-collections', async ({ req, res }) => {
    const me = await auth.requirePerson(req)
    const names = new Map((await people()).map((p) => [p.id, p.name]))
    const mine = db.prepare('SELECT * FROM moment_collections WHERE owner = ? ORDER BY updated DESC').all(me.id) as unknown as ColRow[]
    const shared = db.prepare('SELECT c.* FROM moment_collections c JOIN moment_collection_shares s ON s.collection = c.id WHERE s.user = ? ORDER BY c.updated DESC').all(me.id) as unknown as ColRow[]
    const sum = (c: ColRow) => ({ id: c.id, name: c.name, entries: count(c.id), owner: names.get(c.owner) ?? 'Someone', shared: c.owner === me.id ? shares(c.id).length : undefined, updated: c.updated })
    sendJson(res, 200, { mine: mine.map(sum), shared: shared.map(sum) })
  })

  router.post('/api/moment-collections', async ({ req, res }) => {
    const me = await auth.requirePerson(req)
    const body = await readJson<{ name?: unknown }>(req)
    const name = cleanName(body.name)
    if ((db.prepare('SELECT COUNT(*) AS n FROM moment_collections WHERE owner = ?').get(me.id) as { n: number }).n >= MC_LIMITS.owned)
      throw new ApiError(400, `You have ${MC_LIMITS.owned} collections already. Remove one to make another.`)
    const now = Date.now()
    const c: ColRow = { id: newId(), owner: me.id, name, created: now, updated: now }
    db.prepare('INSERT INTO moment_collections (id, owner, name, created, updated) VALUES (?, ?, ?, ?, ?)').run(c.id, c.owner, c.name, c.created, c.updated)
    sendJson(res, 201, await view(c, me.id))
  })

  router.get('/api/moment-collections/:id', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    sendJson(res, 200, await view(readable(String(params.id), me.id), me.id))
  })

  router.put('/api/moment-collections/:id', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const c = owned(String(params.id), me.id)
    const body = await readJson<{ name?: unknown; sharedWith?: unknown }>(req, 16384)
    if (body.name !== undefined) db.prepare('UPDATE moment_collections SET name = ? WHERE id = ?').run(cleanName(body.name), c.id)
    if (body.sharedWith !== undefined) {
      if (!Array.isArray(body.sharedWith)) throw new ApiError(400, 'sharedWith must be a list of people')
      const ok = new Set((await people()).map((p) => p.id))
      const who = [...new Set(body.sharedWith.map((x) => String(x).toLowerCase()).filter((x) => ok.has(x) && x !== me.id))]
      if (who.length > MC_LIMITS.shares) throw new ApiError(400, `A collection can be shared with up to ${MC_LIMITS.shares} people`)
      db.exec('BEGIN')
      try {
        db.prepare('DELETE FROM moment_collection_shares WHERE collection = ?').run(c.id)
        const add = db.prepare('INSERT INTO moment_collection_shares (collection, user) VALUES (?, ?)')
        for (const u of who) add.run(c.id, u)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    }
    db.prepare('UPDATE moment_collections SET updated = ? WHERE id = ?').run(Date.now(), c.id)
    sendJson(res, 200, await view(readable(c.id, me.id), me.id))
  })

  router.delete('/api/moment-collections/:id', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const c = owned(String(params.id), me.id)
    db.prepare('DELETE FROM moment_collections WHERE id = ?').run(c.id)
    sendJson(res, 200, { ok: true })
  })

  // Save a moment: one sent to you (or yours) by its key; a spot in a title you can open; or an entry of a collection shared with you.
  router.post('/api/moment-collections/:id/entries', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const c = owned(String(params.id), me.id)
    if (count(c.id) >= MC_LIMITS.entries) throw new ApiError(400, `A collection holds up to ${MC_LIMITS.entries} moments`)
    const body = await readJson<{ moment?: unknown; item?: unknown; start?: unknown; end?: unknown; note?: unknown; from?: unknown }>(req, 8192)
    let e: Omit<EntryRow, 'collection' | 'key' | 'saved_at'>
    if (typeof body.moment === 'string') {
      const m = momentFor(me.id, body.moment)
      if (!m) throw new ApiError(404, 'That moment is gone, or it wasn’t sent to you')
      if (!(await access.mayOpen(me.id, m.item))) throw new ApiError(403, 'You can’t open that title, so its moment can’t be saved')
      e = { item: m.item, title: m.title, subtitle: m.subtitle, start: m.start, end: m.end, note: m.note, from_name: m.from }
    } else if (body.from && typeof body.from === 'object') {
      const f = body.from as { collection?: unknown; key?: unknown }
      const src = readable(String(f.collection ?? ''), me.id)
      const row = db.prepare('SELECT * FROM moment_entries WHERE collection = ? AND key = ?').get(src.id, String(f.key ?? '')) as EntryRow | undefined
      if (!row) throw new ApiError(404, 'That moment isn’t in the collection any more')
      if (!(await access.mayOpen(me.id, row.item))) throw new ApiError(403, 'You can’t open that title, so its moment can’t be saved')
      e = { item: row.item, title: row.title, subtitle: row.subtitle, start: row.start, end: row.end, note: row.note, from_name: row.from_name }
    } else {
      const item = String(body.item ?? '').toLowerCase()
      if (!ITEM_ID.test(item)) throw new ApiError(400, 'Which title?')
      const span = cleanSpan(body.start, body.end)
      const t = await access.titleFor({ id: me.id, name: me.Name }, item)
      if (!t) throw new ApiError(404, 'You can’t open that title, so it can’t be saved')
      e = { item, title: t.title, subtitle: t.subtitle, start: span.start, end: span.end, note: cleanNote(body.note), from_name: me.Name }
    }
    const dup = db.prepare('SELECT key FROM moment_entries WHERE collection = ? AND item = ? AND start IS ? AND "end" IS ?').get(c.id, e.item, e.start, e.end)
    if (!dup) {
      db.prepare('INSERT INTO moment_entries (collection, key, item, title, subtitle, start, "end", note, from_name, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(c.id, newId(6), e.item, e.title, e.subtitle, e.start, e.end, e.note, e.from_name, Date.now())
      db.prepare('UPDATE moment_collections SET updated = ? WHERE id = ?').run(Date.now(), c.id)
    }
    sendJson(res, dup ? 200 : 201, await view(c, me.id))
  })

  router.delete('/api/moment-collections/:id/entries/:key', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const c = owned(String(params.id), me.id)
    db.prepare('DELETE FROM moment_entries WHERE collection = ? AND key = ?').run(c.id, String(params.key))
    db.prepare('UPDATE moment_collections SET updated = ? WHERE id = ?').run(Date.now(), c.id)
    sendJson(res, 200, await view(c, me.id))
  })
}
