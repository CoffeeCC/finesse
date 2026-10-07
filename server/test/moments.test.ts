// Moments: flag a stretch of a title and send it to people at home or to a
// friend's server. Two Finesse servers that share with each other: who gets
// what, what a friend's server can and can't see, deleting, and the switch.

import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
import { cleanNote, cleanSpan } from '../src/moments.ts'
import { call, fakeJellyfin, finesse } from './peers.ts'

let jfA: Awaited<ReturnType<typeof fakeJellyfin>>
let jfB: Awaited<ReturnType<typeof fakeJellyfin>>
let A: Awaited<ReturnType<typeof finesse>>
let B: Awaited<ReturnType<typeof finesse>>
const servers: Server[] = []
let samsOnA = '' // Sam's server, as Alex's server knows it
let alexLinkOnB = '' // Alex's server, as Sam's server knows it
const id = (jf: typeof jfA, name: string) => [...jf.users.values()].find((u) => u.Name === name)!.Id

type Moment = { key: string; item: string; title: string; start: number | null; end: number | null; note: string; spoiler: boolean; from: string; read: boolean; mine?: boolean }
const settle = () => new Promise((r) => setTimeout(r, 3100)) // past the refresh floor
const inbox = async (base: string, token: string) => (await call(base, 'GET', '/api/moments/inbox?fresh=1', token)).data as unknown as { moments: Moment[]; unread: number }
const timeline = async (base: string, token: string, item: string) => ((await call(base, 'GET', `/api/moments/item/${item}`, token)).data.moments ?? []) as Moment[]

before(async () => {
  jfA = await fakeJellyfin('Alex’s server', [{ name: 'alex', token: 'a-admin', admin: true }, { name: 'robin', token: 'a-robin', admin: false }], 'a-service')
  jfB = await fakeJellyfin('Sam’s server', [{ name: 'sam', token: 'b-admin', admin: true }, { name: 'kim', token: 'b-kim', admin: false }], 'b-service')
  B = await finesse('b', jfB, 'b-service')
  A = await finesse('a', jfA, 'a-service')
  servers.push(jfA.server, jfB.server, A.app, B.app)
  // Sam shares Movies with Alex's server, and Alex shares Movies back.
  const code = await call(B.url, 'POST', '/api/groups/codes', 'b-admin', { libraries: [jfB.libs[0]!.Id] })
  samsOnA = String((await call(A.url, 'POST', '/api/groups/friends', 'a-admin', { url: B.url, code: code.data.code })).data.id)
  const back = await call(A.url, 'POST', '/api/groups/codes', 'a-admin', { libraries: [jfA.libs[0]!.Id] })
  assert.equal((await call(B.url, 'POST', '/api/groups/friends', 'b-admin', { url: A.url, code: back.data.code })).status, 201)
  alexLinkOnB = String(((await call(B.url, 'GET', '/api/groups', 'b-admin')).data.links as { id: string }[])[0]!.id)
})
after(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

test('notes and spans are cleaned up', () => {
  assert.equal(cleanNote('  hi\u0000 there‮  '), 'hi there')
  assert.equal(cleanNote('x'.repeat(500)).length, 200)
  assert.deepEqual(cleanSpan(10, 25.04), { start: 10, end: 25 })
  assert.deepEqual(cleanSpan(null, null), { start: null, end: null })
  assert.throws(() => cleanSpan(30, 20), /at least a second/)
  assert.throws(() => cleanSpan(0, 700), /at most 10 minutes/)
  assert.throws(() => cleanSpan(-1, 5), /starts and ends/)
  assert.throws(() => cleanSpan('x', 5), /starts and ends/)
})

test('who you can send to: people here, and the friends who can watch it', async () => {
  const mine = await call(B.url, 'GET', `/api/moments/targets?item=${jfB.movie}`, 'b-admin')
  assert.equal(mine.status, 200, mine.text)
  assert.deepEqual((mine.data.people as { name: string }[]).map((p) => p.name), ['kim'])
  assert.deepEqual(mine.data.friends, [{ id: `link:${alexLinkOnB}`, name: 'Alex’s server' }])
  // A friend's title: Sam's household, and people here.
  const theirs = await call(A.url, 'GET', `/api/moments/targets?item=f-${samsOnA}-${jfB.movie}`, 'a-robin')
  assert.deepEqual(theirs.data.friends, [{ id: 'owner', name: 'Sam’s server' }])
  assert.deepEqual((theirs.data.people as { name: string }[]).map((p) => p.name), ['alex'])
  // Friends' hidden viewer accounts never show up as people.
  assert.doesNotMatch((await call(B.url, 'GET', `/api/moments/targets?item=${jfB.movie}`, 'b-kim')).text, /@/)
})

test('Robin flags a moment in Sam’s film for Sam’s household and her own', async () => {
  const item = `f-${samsOnA}-${jfB.movie}`
  const r = await call(A.url, 'POST', '/api/moments', 'a-robin', { item, start: 61.2, end: 75, note: 'this scene 😭', to: ['owner', 'home'] })
  assert.equal(r.status, 201, r.text)
  assert.match(String(r.data.key), new RegExp(`^r:${samsOnA}:`))

  // On Sam's server: everyone there gets it, from Robin at Alex's.
  for (const token of ['b-admin', 'b-kim']) {
    const box = await inbox(B.url, token)
    const m = box.moments.find((x) => x.note === 'this scene 😭')!
    assert.ok(m, token)
    assert.equal(m.from, 'robin · Alex’s server')
    assert.equal(m.item, jfB.movie)
    assert.equal(m.title, 'Sintel')
    assert.deepEqual([m.start, m.end], [61.2, 75])
    assert.equal(m.read, false)
  }
  // At home: Alex gets it (it's Sam's title, so it opens through Sam's server); Robin doesn't notify herself.
  const alex = (await inbox(A.url, 'a-admin')).moments.find((x) => x.note === 'this scene 😭')!
  assert.equal(alex.from, 'robin')
  assert.equal(alex.item, item)
  assert.equal((await inbox(A.url, 'a-robin')).moments.length, 0)
  // Both timelines show it; it's Robin's own on hers.
  const hers = await timeline(A.url, 'a-robin', item)
  assert.equal(hers.length, 1)
  assert.equal(hers[0]!.mine, true)
  assert.equal((await timeline(B.url, 'b-kim', jfB.movie)).length, 1)
  // Read.
  await call(B.url, 'POST', '/api/moments/read', 'b-kim', { keys: [(await inbox(B.url, 'b-kim')).moments[0]!.key] })
  assert.equal((await inbox(B.url, 'b-kim')).unread, 0)
  assert.equal((await inbox(B.url, 'b-admin')).unread, 1)
})

test('Sam sends a spoiler moment of his film to Alex’s server; Kim’s private one stays on Sam’s', async () => {
  const r = await call(B.url, 'POST', '/api/moments', 'b-admin', { item: jfB.movie, start: 300, end: 320, note: 'the twist', spoiler: true, to: [`link:${alexLinkOnB}`] })
  assert.equal(r.status, 201, r.text)
  const kim = id(jfB, 'sam')
  assert.equal((await call(B.url, 'POST', '/api/moments', 'b-kim', { item: jfB.movie, start: 10, end: 20, note: 'only for sam', to: [`user:${kim}`] })).status, 201)
  // A whole-title recommendation, no times.
  assert.equal((await call(B.url, 'POST', '/api/moments', 'b-admin', { item: jfB.movie, note: 'watch this!', to: [`link:${alexLinkOnB}`] })).status, 201)

  await settle()
  for (const token of ['a-robin', 'a-admin']) {
    const box = await inbox(A.url, token)
    const twist = box.moments.find((m) => m.note === 'the twist')!
    assert.ok(twist, token)
    assert.equal(twist.spoiler, true)
    assert.equal(twist.from, 'sam · Sam’s server')
    assert.equal(twist.item, `f-${samsOnA}-${jfB.movie}`)
    const rec = box.moments.find((m) => m.note === 'watch this!')!
    assert.deepEqual([rec.start, rec.end], [null, null])
    assert.ok(!box.moments.some((m) => m.note === 'only for sam'), 'Kim’s note to Sam stays on Sam’s server')
  }
  // Sam got Kim's; Kim didn't get Sam's (it went to Alex's server only).
  assert.ok((await inbox(B.url, 'b-admin')).moments.some((m) => m.note === 'only for sam'))
  assert.ok(!(await inbox(B.url, 'b-kim')).moments.some((m) => m.note === 'the twist'))
  // What Sam's server tells Alex's about this film is only what's meant for it.
  const robinsView = await timeline(A.url, 'a-robin', `f-${samsOnA}-${jfB.movie}`)
  assert.deepEqual(robinsView.map((m) => m.note).sort(), ['the twist', 'this scene 😭', 'watch this!'])
})

test('only people: not the service key, not a friend’s viewer account', async () => {
  assert.equal((await call(A.url, 'GET', '/api/moments/inbox', 'a-service')).status, 403)
  assert.equal((await call(A.url, 'GET', '/api/moments/inbox')).status, 401)
  // Peer routes need the pairing secret.
  assert.equal((await call(B.url, 'GET', '/api/groups/peer/moments')).status, 401)
  assert.equal((await call(B.url, 'POST', '/api/groups/peer/moments', 'b-kim', { item: jfB.movie, start: 1, end: 5 })).status, 401)
})

test('bad moments are turned away', async () => {
  for (const body of [
    { item: jfB.movie, start: 0, end: 900, to: [] },
    { item: jfB.movie, start: 50, end: 40, to: [] },
    { item: 'not-an-id', start: 1, end: 5, to: [] },
    { item: '9'.repeat(32), start: 1, end: 5, to: [] },
  ]) {
    const r = await call(B.url, 'POST', '/api/moments', 'b-admin', body)
    assert.ok(r.status >= 400 && r.status < 500, `${JSON.stringify(body)} → ${r.status}`)
  }
  // A friend server that isn't paired with this one is ignored, not an error that leaks anything.
  const r = await call(B.url, 'POST', '/api/moments', 'b-admin', { item: jfB.movie, start: 1, end: 5, to: ['link:zzzzzzzz'] })
  assert.equal(r.status, 201)
})

test('deleting: your own anywhere, anything on your server if you’re its admin', async () => {
  const item = `f-${samsOnA}-${jfB.movie}`
  const robins = (await timeline(A.url, 'a-robin', item)).find((m) => m.note === 'this scene 😭')!
  // Alex (not the author) can't delete Robin's moment on Sam's server.
  const alexView = (await timeline(A.url, 'a-admin', item)).find((m) => m.note === 'this scene 😭')!
  assert.equal((await call(A.url, 'DELETE', `/api/moments/${encodeURIComponent(alexView.key)}`, 'a-admin')).status, 403)
  // Kim can't delete Sam's.
  const twist = (await timeline(B.url, 'b-kim', jfB.movie)).find((m) => m.note === 'the twist')
  assert.equal(twist, undefined, 'Kim never saw the twist')
  const samsTwist = (await timeline(B.url, 'b-admin', jfB.movie)).find((m) => m.note === 'the twist')!
  assert.equal((await call(B.url, 'DELETE', `/api/moments/${encodeURIComponent(samsTwist.key)}`, 'b-kim')).status, 403)
  // Robin deletes hers: gone on both servers.
  assert.equal((await call(A.url, 'DELETE', `/api/moments/${encodeURIComponent(robins.key)}`, 'a-robin')).status, 200)
  assert.ok(!(await inbox(B.url, 'b-admin')).moments.some((m) => m.note === 'this scene 😭'))
  await settle()
  assert.ok(!(await timeline(A.url, 'a-admin', item)).some((m) => m.note === 'this scene 😭'))
  // Sam, admin of his server, deletes his twist; Alex's server drops it on the next fetch.
  assert.equal((await call(B.url, 'DELETE', `/api/moments/${encodeURIComponent(samsTwist.key)}`, 'b-admin')).status, 200)
  await settle()
  assert.ok(!(await inbox(A.url, 'a-robin')).moments.some((m) => m.note === 'the twist'))
})

test('Sam’s admin can stop friends sending moments in', async () => {
  assert.equal((await call(B.url, 'PUT', '/api/moments/settings', 'b-kim', { fromFriends: false })).status, 403)
  assert.equal((await call(B.url, 'PUT', '/api/moments/settings', 'b-admin', { fromFriends: false })).status, 200)
  const r = await call(A.url, 'POST', '/api/moments', 'a-robin', { item: `f-${samsOnA}-${jfB.movie}`, start: 1, end: 5, to: ['owner'] })
  assert.ok(r.status >= 400)
  assert.match(String(r.data.error), /isn’t taking moments/)
  assert.equal((await call(B.url, 'PUT', '/api/moments/settings', 'b-admin', { fromFriends: true })).status, 200)
})

test('when Alex stops watching Sam’s server, Sam’s moments go from Alex’s inboxes', async () => {
  assert.ok((await inbox(A.url, 'a-robin')).moments.some((m) => m.note === 'watch this!'))
  assert.equal((await call(A.url, 'DELETE', `/api/groups/friends/${samsOnA}`, 'a-admin')).status, 200)
  assert.ok(!(await inbox(A.url, 'a-robin')).moments.some((m) => m.note === 'watch this!'))
})
