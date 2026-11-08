// The retro player's in-game saves (server/src/gameSaves.ts): kept per person, per game and
// per core, bytes in and out unchanged, never someone else's, never overwritten blind, and
// never more than the caps.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import { openSaves, registerGameSaves, saveFingerprint } from '../src/gameSaves.ts'
import { ApiError, Router, sendError } from '../src/http/core.ts'
import { openLists } from '../src/lists.ts'
import { saveFingerprint as browserFingerprint } from '../../src/lib/saveSync.ts'
import { listen } from './helpers.ts'
import { H, fakeJellyfin, finesse } from './peers.ts'

let jf: Awaited<ReturnType<typeof fakeJellyfin>>
let A: Awaited<ReturnType<typeof finesse>>
const servers: Server[] = []

before(async () => {
  jf = await fakeJellyfin('Home', [{ name: 'alex', token: 'alex', admin: true }, { name: 'robin', token: 'robin', admin: false }], 'service')
  A = await finesse('a', jf, 'service')
  servers.push(jf.server, A.app)
})
after(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

const tag = (b: Uint8Array) => `"${saveFingerprint(b)}"`
const put = (token: string | undefined, path: string, body: Uint8Array, cond: Record<string, string> = { 'If-None-Match': '*' }, base = A.url) =>
  fetch(`${base}/api/game-saves/${path}`, { method: 'PUT', headers: { ...H(token), 'Content-Type': 'application/octet-stream', ...cond }, body })
const get = (token: string | undefined, path: string, base = A.url) => fetch(`${base}/api/game-saves/${path}`, { headers: H(token) })

// A GBA flash save: 128 KB, mostly 0xFF, with some progress in it.
const sram = new Uint8Array(128 * 1024).fill(0xff)
sram.set([1, 2, 3, 4, 0, 0, 255, 7], 4096)
const later = (b: Uint8Array, v: number) => {
  const c = b.slice()
  c[4096] = v
  return c
}

test('no save yet: 404', async () => {
  assert.equal((await get('robin', '12/mgba')).status, 404)
})

test('a save goes up and comes back byte for byte; its ETag is the browser’s own fingerprint', async () => {
  const r = await put('robin', '12/mgba', sram)
  assert.equal(r.status, 200, await r.clone().text())
  const j = (await r.json()) as { savedAt: number; size: number; hash: string }
  assert.equal(j.size, sram.length)
  assert.equal(j.hash, browserFingerprint(sram))
  const back = await get('robin', '12/mgba')
  assert.equal(back.status, 200)
  assert.equal(back.headers.get('content-type'), 'application/octet-stream')
  assert.equal(back.headers.get('x-saved-at'), String(j.savedAt))
  assert.equal(back.headers.get('etag'), `"${browserFingerprint(sram)}"`)
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), sram)
})

test('the server’s fingerprint matches the browser’s, whatever the bytes', () => {
  for (const n of [0, 1, 7, 512, 8192, 131072]) {
    const b = new Uint8Array(n)
    for (let i = 0; i < n; i++) b[i] = (i * 2654435761) >>> 24
    assert.equal(saveFingerprint(b), browserFingerprint(b))
  }
})

test('the TV app (another origin) can read the save’s version and time, and send its own', async () => {
  const r = await get('robin', '12/mgba')
  const exposed = (r.headers.get('access-control-expose-headers') ?? '').toLowerCase()
  assert.match(exposed, /\betag\b/)
  assert.match(exposed, /\bx-saved-at\b/)
  const pre = await fetch(`${A.url}/api/game-saves/12/mgba`, { method: 'OPTIONS' })
  const allowed = (pre.headers.get('access-control-allow-headers') ?? '').toLowerCase()
  assert.match(allowed, /\bif-match\b/)
  assert.match(allowed, /\bif-none-match\b/)
})

test('saving again replaces it when it says which copy it replaces', async () => {
  const next = later(sram, 9)
  assert.equal((await put('robin', '12/mgba', next, { 'If-Match': tag(sram) })).status, 200)
  assert.equal(new Uint8Array(await (await get('robin', '12/mgba')).arrayBuffer())[4096], 9)
})

test('no blind overwrites: a save based on an old copy, or on none, gets 409 and changes nothing', async () => {
  const now = later(sram, 9) // what the server has (the test above)
  const stale = await put('robin', '12/mgba', later(sram, 5), { 'If-Match': tag(sram) })
  assert.equal(stale.status, 409)
  assert.equal(stale.headers.get('etag'), tag(now), 'says which copy it has')
  assert.match(((await stale.json()) as { error: string }).error, /another device/)
  const blind = await put('robin', '12/mgba', later(sram, 6), { 'If-None-Match': '*' })
  assert.equal(blind.status, 409)
  const none = await fetch(`${A.url}/api/game-saves/12/mgba`, { method: 'PUT', headers: { ...H('robin'), 'Content-Type': 'application/octet-stream' }, body: later(sram, 6) })
  assert.equal(none.status, 428)
  assert.deepEqual(new Uint8Array(await (await get('robin', '12/mgba')).arrayBuffer()), now)
  // The same bytes again (a retry whose answer was lost) is fine, whatever it says.
  assert.equal((await put('robin', '12/mgba', now, { 'If-Match': tag(sram) })).status, 200)
  // A save for a slot that's empty, sent as if replacing something: 409 too.
  assert.equal((await put('robin', '99/mgba', sram, { 'If-Match': tag(sram) })).status, 409)
})

test('each person, game and core has its own save', async () => {
  assert.equal((await get('alex', '12/mgba')).status, 404)
  assert.equal((await get('robin', '13/mgba')).status, 404)
  assert.equal((await get('robin', '12/gpsp')).status, 404)
})

test('game ids and systems are one slot however they’re written', async () => {
  assert.equal((await get('robin', '0012/mgba')).status, 200)
  assert.equal((await get('robin', '12/MGBA')).status, 200)
  assert.equal((await put('robin', '0012/MGBA', later(sram, 9), { 'If-Match': tag(later(sram, 9)) })).status, 200)
  assert.equal((await get('robin', '0/mgba')).status, 400)
})

test('signed out, odd paths and empty saves are refused', async () => {
  assert.equal((await get(undefined, '12/mgba')).status, 401)
  assert.equal((await put(undefined, '12/mgba', sram)).status, 401)
  assert.equal((await get('robin', '12/..%2Fx')).status, 400)
  assert.equal((await get('robin', 'abc/mgba')).status, 400)
  assert.equal((await put('robin', '12/mgba', new Uint8Array(0))).status, 400)
})

test('too big: a plain 413, not a cut connection', async () => {
  const r = await put('robin', '14/mgba', new Uint8Array((8 << 20) + 1))
  assert.equal(r.status, 413)
  assert.match(((await r.json()) as { error: string }).error, /too big.*8 MB/)
  assert.equal((await get('robin', '14/mgba')).status, 404)
})

test('only you can delete your save, and only that one', async () => {
  assert.equal((await put('alex', '12/mgba', sram)).status, 200)
  assert.equal((await fetch(`${A.url}/api/game-saves/12/mgba`, { method: 'DELETE', headers: H(undefined) })).status, 401)
  // Not the copy you think: nothing deleted.
  assert.equal((await fetch(`${A.url}/api/game-saves/12/mgba`, { method: 'DELETE', headers: { ...H('alex'), 'If-Match': tag(later(sram, 42)) } })).status, 409)
  const d = await fetch(`${A.url}/api/game-saves/12/mgba`, { method: 'DELETE', headers: H('alex') })
  assert.equal(d.status, 200)
  assert.equal((await get('alex', '12/mgba')).status, 404)
  assert.equal((await get('robin', '12/mgba')).status, 200, 'robin’s save of the same game stays')
  assert.equal((await fetch(`${A.url}/api/game-saves/12/mgba`, { method: 'DELETE', headers: H('alex') })).status, 404)
})

// The caps, on a small server of their own (the real ones are hundreds of MB).
async function capped(limits: { perPerson: number; total: number; count: number }) {
  const router = new Router()
  const db = openSaves(':memory:')
  registerGameSaves(router, { auth: { requirePerson: async (req) => ({ id: String(req.headers['x-who']), admin: false }) as never }, db, limits })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    try {
      if (!(await router.dispatch({ req, res, path: url.pathname, url }))) throw new ApiError(404, 'Not found')
    } catch (e) {
      sendError(res, e)
    }
  })
  servers.push(server)
  const base = await listen(server)
  return (who: string, path: string, body: Uint8Array, cond: Record<string, string> = { 'If-None-Match': '*' }) =>
    fetch(`${base}/api/game-saves/${path}`, { method: 'PUT', headers: { 'X-Who': who, ...cond }, body })
}

test('one person can’t fill the disk: a cap per person, and one for everyone', async () => {
  const up = await capped({ perPerson: 1000, total: 1500, count: 3 })
  assert.equal((await up('robin', '1/mgba', new Uint8Array(600).fill(1))).status, 200)
  const full = await up('robin', '2/mgba', new Uint8Array(500).fill(2))
  assert.equal(full.status, 413)
  assert.match(((await full.json()) as { error: string }).error, /for one person/)
  // Replacing a save counts only what it adds.
  assert.equal((await up('robin', '1/mgba', new Uint8Array(900).fill(3), { 'If-Match': `"${saveFingerprint(new Uint8Array(600).fill(1))}"` })).status, 200)
  assert.equal((await up('alex', '1/mgba', new Uint8Array(700).fill(4))).status, 413, 'everyone’s together')
  assert.equal((await up('alex', '1/mgba', new Uint8Array(400).fill(4))).status, 200)
  // And a count.
  const few = await capped({ perPerson: 1 << 20, total: 1 << 20, count: 2 })
  assert.equal((await few('robin', '1/mgba', new Uint8Array(1).fill(1))).status, 200)
  assert.equal((await few('robin', '2/mgba', new Uint8Array(1).fill(1))).status, 200)
  assert.equal((await few('robin', '3/mgba', new Uint8Array(1).fill(1))).status, 413)
})

test('saves an earlier build kept in lists.db move to saves.db, and lists.db lets go of them', () => {
  const lists = new DatabaseSync(':memory:')
  // lists.db as that build left it (version 4, game_saves in it).
  lists.exec(`CREATE TABLE game_saves (owner TEXT NOT NULL, rom INTEGER NOT NULL, core TEXT NOT NULL, data BLOB NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY (owner, rom, core)); PRAGMA user_version = 4;`)
  lists.prepare('INSERT INTO game_saves VALUES (?, ?, ?, ?, ?, ?, ?)').run('robin', 12, 'mgba', sram, 'sha', sram.length, 1234)
  const saves = openSaves(':memory:', lists)
  const row = saves.prepare('SELECT * FROM game_saves').get() as { owner: string; rom: number; core: string; data: Uint8Array; fp: string; saved_at: number }
  assert.equal(row.owner, 'robin')
  assert.equal(row.fp, saveFingerprint(sram))
  assert.equal(row.saved_at, 1234)
  assert.deepEqual(new Uint8Array(row.data), sram)
  assert.equal(lists.prepare("SELECT 1 FROM sqlite_master WHERE name = 'game_saves'").get(), undefined)
  // Opening again finds nothing more to move.
  openSaves(':memory:', lists)
  // A new lists.db never has the table, and steps still number on.
  const fresh = openLists(':memory:')
  assert.equal(fresh.prepare("SELECT 1 FROM sqlite_master WHERE name = 'game_saves'").get(), undefined)
})
