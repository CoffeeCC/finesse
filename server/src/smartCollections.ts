// Smart collections: rules a person saves ("unwatched films under 100 minutes"); the app picks
// the titles from the library with their own sign-in each time, so a collection stays up to
// date and only ever shows what that profile can open. The rules are the only thing stored
// here (lists.db), and each person sees only their own (shared collections are for later).

import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Auth } from './auth.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { cleanName, cleanRules, type SmartRules } from '../../src/lib/smartRules.ts'

export const SMART_MAX = 50

interface Row {
  id: string
  owner: string
  name: string
  rules: string
  created: number
  updated: number
}

const out = (r: Row) => ({ id: r.id, name: r.name, rules: JSON.parse(r.rules) as SmartRules, created: r.created, updated: r.updated })

function checked<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    throw new ApiError(400, (e as Error).message)
  }
}

export function registerSmartCollections(router: Router, deps: { auth: Auth; db: DatabaseSync }) {
  const { auth, db } = deps
  const mine = (owner: string) => db.prepare('SELECT * FROM smart_collections WHERE owner = ? ORDER BY created').all(owner) as unknown as Row[]
  /** Someone else's collection is "not found", the same as one that doesn't exist. */
  const own = (id: string, owner: string): Row => {
    const r = db.prepare('SELECT * FROM smart_collections WHERE id = ?').get(id) as Row | undefined
    if (!r || r.owner !== owner) throw new ApiError(404, 'That collection is gone')
    return r
  }

  router.get('/api/smart-collections', async ({ req, res }) => {
    const me = await auth.requirePerson(req)
    sendJson(res, 200, { collections: mine(me.id).map(out) })
  })

  router.post('/api/smart-collections', async ({ req, res }) => {
    const me = await auth.requirePerson(req)
    const body = await readJson<{ name?: unknown; rules?: unknown }>(req, 16384)
    const name = checked(() => cleanName(body.name))
    const rules = checked(() => cleanRules(body.rules))
    if (mine(me.id).length >= SMART_MAX) throw new ApiError(400, `You have ${SMART_MAX} smart collections already. Remove one to make another.`)
    const now = Date.now()
    const row: Row = { id: randomBytes(9).toString('base64url'), owner: me.id, name, rules: JSON.stringify(rules), created: now, updated: now }
    db.prepare('INSERT INTO smart_collections (id, owner, name, rules, created, updated) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.owner, row.name, row.rules, row.created, row.updated)
    sendJson(res, 201, out(row))
  })

  router.put('/api/smart-collections/:id', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const r = own(String(params.id), me.id)
    const body = await readJson<{ name?: unknown; rules?: unknown }>(req, 16384)
    const name = body.name === undefined ? r.name : checked(() => cleanName(body.name))
    const rules = body.rules === undefined ? r.rules : JSON.stringify(checked(() => cleanRules(body.rules)))
    const updated = Date.now()
    db.prepare('UPDATE smart_collections SET name = ?, rules = ?, updated = ? WHERE id = ?').run(name, rules, updated, r.id)
    sendJson(res, 200, out({ ...r, name, rules, updated }))
  })

  router.delete('/api/smart-collections/:id', async ({ req, res, params }) => {
    const me = await auth.requirePerson(req)
    const r = own(String(params.id), me.id)
    db.prepare('DELETE FROM smart_collections WHERE id = ?').run(r.id)
    sendJson(res, 200, { ok: true })
  })
}
