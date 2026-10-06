// Invites under pressure: guessing codes is slowed down, and a single-use
// invite lets exactly one person in even when two join at the same moment.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { ADMIN_TOKEN, API_KEY, auth, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

let base = ''
let jf: FakeJellyfin
let app: Server

before(async () => {
  jf = await fakeJellyfin()
  const work = tmp()
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(work, 'baked', rel, '..'), { recursive: true })
    writeFileSync(join(work, 'baked', rel), c)
  }
  Object.assign(process.env, { FINESSE_CONFIG_DIR: join(work, 'config'), FINESSE_WEB_DIR: join(work, 'baked'), JELLYFIN_URL: jf.url, JELLYFIN_API_KEY: API_KEY })
  const { createApp } = await import('../src/app.ts')
  app = createApp().server
  base = await listen(app)
})
after(() => {
  for (const s of [app, jf?.server]) {
    s?.closeAllConnections()
    s?.close()
  }
})

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/invite-api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('a single-use invite lets exactly one of two simultaneous joiners in', async () => {
  const created = await post('/v1/invites', { code: 'RACE2026', libraries: ['lib-movies'] }, auth(ADMIN_TOKEN))
  assert.equal(created.status, 201)
  const join2 = (name: string) => post('/v1/join', { code: 'RACE2026', username: name, password: 'Passw0rd!' })
  const results = await Promise.all([join2('first'), join2('second')])
  const statuses = results.map((r) => r.status).sort()
  assert.deepEqual(statuses, [201, 410])
  assert.equal([...jf.users.values()].filter((u) => u.Name === 'first' || u.Name === 'second').length, 1)
})

test('an open invite makes a handful of accounts an hour from one address, not hundreds', async () => {
  assert.equal((await post('/v1/invites', { code: 'OPEN2026', unlimited: true, libraries: ['lib-movies'] }, auth(ADMIN_TOKEN))).status, 201)
  const statuses: number[] = []
  // The race test above already made one account from here.
  for (let i = 0; i < 5; i++) statuses.push((await post('/v1/join', { code: 'OPEN2026', username: `fan${i}`, password: 'Passw0rd!' })).status)
  assert.deepEqual(statuses, [201, 201, 201, 201, 429])
})

test('guessing invite codes is slowed down', async () => {
  let last = 0
  for (let i = 0; i < 21; i++) last = (await fetch(`${base}/invite-api/v1/invites/GUESS${i}`)).status
  assert.equal(last, 429)
  // …and joining with a guess is blocked the same way.
  assert.equal((await post('/v1/join', { code: 'ANOTHER1', username: 'someone', password: 'Passw0rd!' })).status, 429)
})
