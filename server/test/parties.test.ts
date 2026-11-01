// Watch parties (server/src/parties.ts): who can see and join one (checked for each person,
// limits included), control from any member, reporting in, the host ending it.

import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
import { call, fakeJellyfin, finesse } from './peers.ts'

let jf: Awaited<ReturnType<typeof fakeJellyfin>>
let A: Awaited<ReturnType<typeof finesse>>
const servers: Server[] = []
const id = (name: string) => [...jf.users.values()].find((u) => u.Name === name)!.Id.toLowerCase()
type View = { id: string; joined: boolean; isHost: boolean; clock: { playing: boolean; position: number }; members: { name: string }[]; host: { name: string }; waitingFor: string[] }

before(async () => {
  jf = await fakeJellyfin('Home', [{ name: 'alex', token: 'alex', admin: true }, { name: 'robin', token: 'robin', admin: false }, { name: 'kim', token: 'kim', admin: false }, { name: 'lee', token: 'lee', admin: false }], 'service')
  A = await finesse('a', jf, 'service')
  servers.push(jf.server, A.app)
  const kim = [...jf.users.values()].find((u) => u.Name === 'kim')!
  kim.Policy = { ...kim.Policy, EnableAllFolders: false, EnabledFolders: [jf.libs[0]!.Id] }
})
after(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

let pid = ''
test('Robin starts a party for Kim and Lee; nobody else sees it', async () => {
  const r = await call(A.url, 'POST', '/api/parties', 'robin', { item: jf.movie, invite: [id('kim'), id('lee'), 'nobody'], position: 120 })
  assert.equal(r.status, 201, r.text)
  const v = r.data as unknown as View
  pid = v.id
  assert.equal(v.isHost, true)
  assert.equal(v.clock.position, 120)
  assert.equal(v.clock.playing, false)
  const invites = await call(A.url, 'GET', '/api/parties', 'lee')
  assert.deepEqual((invites.data.parties as { title: string; host: string; joined: boolean }[]).map((p) => [p.title, p.host, p.joined]), [['Sintel · 2010', 'robin', false]])
  assert.equal(((await call(A.url, 'GET', '/api/parties', 'alex')).data.parties as unknown[]).length, 0)
  assert.equal((await call(A.url, 'GET', `/api/parties/${pid}`, 'alex')).status, 404)
  assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/join`, 'alex')).status, 404)
})

test('joining, then any member plays, pauses and seeks for everyone', async () => {
  assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/beat`, 'lee', { position: 1 })).status, 409, 'join first')
  assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/control`, 'kim', { action: 'play' })).status, 409)
  for (const t of ['kim', 'lee']) assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/join`, t)).status, 200)
  assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/control`, 'kim', { action: 'play' })).status, 200)
  let v = (await call(A.url, 'GET', `/api/parties/${pid}`, 'robin')).data as unknown as View
  assert.equal(v.clock.playing, true)
  assert.deepEqual(v.members.map((m) => m.name), ['robin', 'kim', 'lee'])
  assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/control`, 'lee', { action: 'seek', position: 600 })).status, 200)
  v = (await call(A.url, 'POST', `/api/parties/${pid}/beat`, 'robin', { position: 600, buffering: false })).data as unknown as View
  assert.ok(v.clock.position >= 600 && v.clock.position < 602)
  assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/control`, 'lee', { action: 'pause' })).status, 200)
  v = (await call(A.url, 'GET', `/api/parties/${pid}`, 'kim')).data as unknown as View
  assert.equal(v.clock.playing, false)
  assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/control`, 'lee', { action: 'rewind' })).status, 400)
  assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/beat`, 'lee', { position: -4 })).status, 400)
})

test('access is checked for each person, not taken from the host', async () => {
  // Kim isn't in the Private library: invited, but can't join.
  const r = await call(A.url, 'POST', '/api/parties', 'robin', { item: jf.privateMovie, invite: [id('kim')] })
  assert.equal(r.status, 201, r.text)
  const j = await call(A.url, 'POST', `/api/parties/${r.data.id}/join`, 'kim')
  assert.equal(j.status, 403)
  assert.match(String(j.data.error), /can’t open this title/)
  // A parental limit: the R-rated film is out for Kim, whoever invites her.
  A.settings.update((s) => void (s.parental = { [id('kim')]: { maxAge: 14, blockUnrated: false, requests: false } }))
  const rated = await call(A.url, 'POST', '/api/parties', 'robin', { item: jf.rated, invite: [id('kim')] })
  assert.equal((await call(A.url, 'POST', `/api/parties/${rated.data.id}/join`, 'kim')).status, 403)
  A.settings.update((s) => void delete s.parental)
  // Starting one needs a title the host can open, of ours, and someone to invite.
  assert.equal((await call(A.url, 'POST', '/api/parties', 'kim', { item: jf.privateMovie, invite: [id('robin')] })).status, 404)
  assert.equal((await call(A.url, 'POST', '/api/parties', 'robin', { item: `f-abcdefgh-${jf.movie}`, invite: [id('kim')] })).status, 400)
  assert.equal((await call(A.url, 'POST', '/api/parties', 'robin', { item: jf.movie, invite: [] })).status, 400)
  assert.equal((await call(A.url, 'POST', '/api/parties', 'service', { item: jf.movie, invite: [id('kim')] })).status, 403)
})

test('the host ends it; others can only leave', async () => {
  assert.equal((await call(A.url, 'DELETE', `/api/parties/${pid}`, 'lee')).status, 403)
  assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/leave`, 'lee')).status, 200)
  let v = (await call(A.url, 'GET', `/api/parties/${pid}`, 'robin')).data as unknown as View
  assert.deepEqual(v.members.map((m) => m.name), ['robin', 'kim'])
  // The host leaving hands it on.
  assert.equal((await call(A.url, 'POST', `/api/parties/${pid}/leave`, 'robin')).status, 200)
  v = (await call(A.url, 'GET', `/api/parties/${pid}`, 'kim')).data as unknown as View
  assert.equal(v.host.name, 'kim')
  assert.equal(v.isHost, true)
  assert.equal((await call(A.url, 'DELETE', `/api/parties/${pid}`, 'kim')).status, 200)
  assert.equal((await call(A.url, 'GET', `/api/parties/${pid}`, 'kim')).status, 404)
})
