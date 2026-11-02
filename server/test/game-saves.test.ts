// The retro player's in-game saves (server/src/gameSaves.ts): kept per person, per game and
// per core, bytes in and out unchanged, and never someone else's.

import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
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

const put = (token: string | undefined, path: string, body: Uint8Array) =>
  fetch(`${A.url}/api/game-saves/${path}`, { method: 'PUT', headers: { ...H(token), 'Content-Type': 'application/octet-stream' }, body })
const get = (token: string | undefined, path: string) => fetch(`${A.url}/api/game-saves/${path}`, { headers: H(token) })

// A GBA flash save: 128 KB, mostly 0xFF, with some progress in it.
const sram = new Uint8Array(128 * 1024).fill(0xff)
sram.set([1, 2, 3, 4, 0, 0, 255, 7], 4096)

test('no save yet: 404', async () => {
  assert.equal((await get('robin', '12/mgba')).status, 404)
})

test('a save goes up and comes back byte for byte, with when it was saved', async () => {
  const r = await put('robin', '12/mgba', sram)
  assert.equal(r.status, 200, await r.clone().text())
  const j = (await r.json()) as { savedAt: number; size: number; hash: string }
  assert.equal(j.size, sram.length)
  const back = await get('robin', '12/mgba')
  assert.equal(back.status, 200)
  assert.equal(back.headers.get('content-type'), 'application/octet-stream')
  assert.equal(back.headers.get('x-saved-at'), String(j.savedAt))
  assert.equal(back.headers.get('etag'), `"${j.hash}"`)
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), sram)
})

test('saving again replaces it', async () => {
  const next = sram.slice()
  next[4096] = 9
  assert.equal((await put('robin', '12/mgba', next)).status, 200)
  assert.equal(new Uint8Array(await (await get('robin', '12/mgba')).arrayBuffer())[4096], 9)
})

test('each person, game and core has its own save', async () => {
  assert.equal((await get('alex', '12/mgba')).status, 404)
  assert.equal((await get('robin', '13/mgba')).status, 404)
  assert.equal((await get('robin', '12/gpsp')).status, 404)
})

test('signed out, odd paths and empty saves are refused', async () => {
  assert.equal((await get(undefined, '12/mgba')).status, 401)
  assert.equal((await put(undefined, '12/mgba', sram)).status, 401)
  assert.equal((await get('robin', '12/..%2Fx')).status, 400)
  assert.equal((await get('robin', 'abc/mgba')).status, 400)
  assert.equal((await put('robin', '12/mgba', new Uint8Array(0))).status, 400)
})
