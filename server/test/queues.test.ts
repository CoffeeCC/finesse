// Shortlists (server/src/queues.ts): who's in one, adding titles, one vote each, the host's
// pick, and what someone who can't open a title sees of it. Friends' titles: "unknown".

import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import { LISTS_VERSION, openLists } from '../src/lists.ts'
import { tmp } from './helpers.ts'
import { call, fakeJellyfin, finesse } from './peers.ts'

let jf: Awaited<ReturnType<typeof fakeJellyfin>>
let jfB: Awaited<ReturnType<typeof fakeJellyfin>>
let A: Awaited<ReturnType<typeof finesse>>
let B: Awaited<ReturnType<typeof finesse>>
let sams = ''
const servers: Server[] = []
const id = (name: string) => [...jf.users.values()].find((u) => u.Name === name)!.Id.toLowerCase()

type Item = { key: string; hidden: boolean; item: string | null; title: string; votes: number; mine: boolean; canRemove: boolean; availability: { name: string; state: string }[] | null }
type Q = { id: string; name: string; isHost: boolean; members: { id: string; name: string }[]; items: Item[]; myVote: string | null; picked: string | null; archived: boolean }

before(async () => {
  jf = await fakeJellyfin('Home', [{ name: 'alex', token: 'alex', admin: true }, { name: 'robin', token: 'robin', admin: false }, { name: 'kim', token: 'kim', admin: false }, { name: 'lee', token: 'lee', admin: false }], 'service')
  jfB = await fakeJellyfin('Sam’s', [{ name: 'sam', token: 'sam', admin: true }], 'b-service')
  A = await finesse('a', jf, 'service')
  B = await finesse('b', jfB, 'b-service')
  servers.push(jf.server, jfB.server, A.app, B.app)
  // Kim only sees Movies (not Private).
  const kim = [...jf.users.values()].find((u) => u.Name === 'kim')!
  kim.Policy = { ...kim.Policy, EnableAllFolders: false, EnabledFolders: [jf.libs[0]!.Id] }
  // Sam's server shares Movies with this one.
  const code = await call(B.url, 'POST', '/api/groups/codes', 'sam', { libraries: [jfB.libs[0]!.Id] })
  sams = String((await call(A.url, 'POST', '/api/groups/friends', 'alex', { url: B.url, code: code.data.code })).data.id)
})
after(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

let qid = ''
const get = async (token: string) => (await call(A.url, 'GET', `/api/queues/${qid}`, token)).data as unknown as Q

test('Robin starts a shortlist with Kim; Lee isn’t in it and can’t see it', async () => {
  const people = await call(A.url, 'GET', '/api/people', 'robin')
  assert.deepEqual((people.data.people as { name: string }[]).map((p) => p.name), ['alex', 'kim', 'lee'])
  const r = await call(A.url, 'POST', '/api/queues', 'robin', { name: '  Friday   film ', members: [id('kim'), 'not-a-person', id('robin')] })
  assert.equal(r.status, 201, r.text)
  const q = r.data as unknown as Q
  qid = q.id
  assert.equal(q.name, 'Friday film')
  assert.deepEqual(q.members.map((m) => m.name).sort(), ['kim', 'robin'])
  assert.equal(q.isHost, true)
  assert.equal(((await call(A.url, 'GET', '/api/queues', 'kim')).data.queues as unknown[]).length, 1)
  assert.equal(((await call(A.url, 'GET', '/api/queues', 'lee')).data.queues as unknown[]).length, 0)
  assert.equal((await call(A.url, 'GET', `/api/queues/${qid}`, 'lee')).status, 404)
  assert.equal((await call(A.url, 'PUT', `/api/queues/${qid}/vote`, 'lee', { key: null })).status, 404)
  // Even an administrator who isn't in it.
  assert.equal((await call(A.url, 'GET', `/api/queues/${qid}`, 'alex')).status, 404)
})

test('adding titles: only ones the adder can open; each says who can open it', async () => {
  assert.equal((await call(A.url, 'POST', `/api/queues/${qid}/items`, 'robin', { item: jf.movie })).status, 201)
  // Robin sees Private; Kim doesn't.
  assert.equal((await call(A.url, 'POST', `/api/queues/${qid}/items`, 'robin', { item: jf.privateMovie })).status, 201)
  // Kim can't add what she can't open, or something that isn't there.
  assert.equal((await call(A.url, 'POST', `/api/queues/${qid}/items`, 'kim', { item: jf.privateMovie })).status, 200, 'already on it: no change, no error')
  assert.equal((await call(A.url, 'POST', `/api/queues/${qid}/items`, 'kim', { item: '7'.repeat(32) })).status, 404)
  assert.equal((await call(A.url, 'POST', `/api/queues/${qid}/items`, 'kim', { item: '../etc' })).status, 400)
  // A friend's title, added through Sam's server as Kim.
  const f = await call(A.url, 'POST', `/api/queues/${qid}/items`, 'kim', { item: `f-${sams}-${jfB.movie}` })
  assert.equal(f.status, 201, f.text)

  const robin = await get('robin')
  assert.equal(robin.items.length, 3)
  const sintel = robin.items.find((i) => i.item === jf.movie)!
  assert.equal(sintel.title, 'Sintel')
  assert.deepEqual(sintel.availability!.map((a) => `${a.name}:${a.state}`).sort(), ['kim:yes', 'robin:yes'])
  const home = robin.items.find((i) => i.item === jf.privateMovie)!
  assert.deepEqual(home.availability!.map((a) => `${a.name}:${a.state}`).sort(), ['kim:no', 'robin:yes'])
  const friends = robin.items.find((i) => i.item?.startsWith('f-'))!
  assert.equal(friends.title, 'Sintel')
  assert.deepEqual(friends.availability!.map((a) => a.state), ['unknown', 'unknown'])

  // Kim sees that something's there, but not what.
  const kim = await get('kim')
  const hidden = kim.items.find((i) => i.hidden)!
  assert.ok(hidden)
  assert.equal(hidden.item, null)
  assert.equal(hidden.availability, null)
  assert.doesNotMatch(JSON.stringify(kim), /Home Video|6{32}/)
})

test('one vote each, moved by voting again; not for a title you can’t open', async () => {
  const robin = await get('robin')
  const sintel = robin.items.find((i) => i.item === jf.movie)!.key
  const home = robin.items.find((i) => i.item === jf.privateMovie)!.key
  const friend = robin.items.find((i) => i.item?.startsWith('f-'))!.key
  assert.equal((await call(A.url, 'PUT', `/api/queues/${qid}/vote`, 'robin', { key: home })).status, 200)
  assert.equal((await call(A.url, 'PUT', `/api/queues/${qid}/vote`, 'robin', { key: sintel })).status, 200)
  assert.equal((await call(A.url, 'PUT', `/api/queues/${qid}/vote`, 'kim', { key: sintel })).status, 200)
  assert.equal((await call(A.url, 'PUT', `/api/queues/${qid}/vote`, 'kim', { key: home })).status, 403)
  let q = await get('kim')
  assert.equal(q.items.find((i) => i.key === sintel)!.votes, 2)
  assert.equal(q.items.find((i) => i.key === home)!.votes, 0, 'Robin’s vote moved')
  assert.equal(q.myVote, sintel)
  // Still the same after "refresh" (another read), and taken back with null.
  assert.equal((await call(A.url, 'PUT', `/api/queues/${qid}/vote`, 'kim', { key: friend })).status, 200)
  q = await get('kim')
  assert.equal(q.items.find((i) => i.key === sintel)!.votes, 1)
  assert.equal((await call(A.url, 'PUT', `/api/queues/${qid}/vote`, 'kim', { key: null })).status, 200)
  assert.equal((await get('kim')).myVote, null)
})

test('the host picks, renames, archives; members can leave; removing titles', async () => {
  const robin = await get('robin')
  const sintel = robin.items.find((i) => i.item === jf.movie)!.key
  const friend = robin.items.find((i) => i.item?.startsWith('f-'))!.key
  assert.equal((await call(A.url, 'POST', `/api/queues/${qid}/pick`, 'kim', { key: sintel })).status, 403)
  assert.equal((await call(A.url, 'POST', `/api/queues/${qid}/pick`, 'robin', { key: sintel })).status, 200)
  assert.equal((await get('kim')).picked, sintel)
  // Kim added the friend's title, so she can take it off; she can't take off Robin's.
  assert.equal((await call(A.url, 'DELETE', `/api/queues/${qid}/items/${sintel}`, 'kim')).status, 403)
  assert.equal((await call(A.url, 'DELETE', `/api/queues/${qid}/items/${friend}`, 'kim')).status, 200)
  // The host takes off the picked one: nothing's picked any more.
  assert.equal((await call(A.url, 'DELETE', `/api/queues/${qid}/items/${sintel}`, 'robin')).status, 200)
  assert.equal((await get('robin')).picked, null)
  assert.equal((await call(A.url, 'PUT', `/api/queues/${qid}`, 'kim', { name: 'mine' })).status, 403)
  assert.equal((await call(A.url, 'PUT', `/api/queues/${qid}`, 'robin', { archived: true })).status, 200)
  assert.equal((await call(A.url, 'POST', `/api/queues/${qid}/items`, 'robin', { item: jf.movie })).status, 400, 'archived: nothing new')
  // Lee joins, Kim leaves.
  assert.equal((await call(A.url, 'PUT', `/api/queues/${qid}`, 'robin', { members: [id('kim'), id('lee')] })).status, 200)
  assert.equal((await call(A.url, 'GET', `/api/queues/${qid}`, 'lee')).status, 200)
  assert.equal((await call(A.url, 'POST', `/api/queues/${qid}/leave`, 'kim')).status, 200)
  assert.equal((await call(A.url, 'GET', `/api/queues/${qid}`, 'kim')).status, 404)
  assert.equal((await call(A.url, 'POST', `/api/queues/${qid}/leave`, 'robin')).status, 400, 'the host removes it instead')
  assert.equal((await call(A.url, 'DELETE', `/api/queues/${qid}`, 'lee')).status, 403)
  assert.equal((await call(A.url, 'DELETE', `/api/queues/${qid}`, 'robin')).status, 200)
  assert.equal((await call(A.url, 'GET', `/api/queues/${qid}`, 'lee')).status, 404)
})

test('only people: no service key, no sign-in, no friends’ viewers', async () => {
  assert.equal((await call(A.url, 'GET', '/api/queues')).status, 401)
  assert.equal((await call(A.url, 'GET', '/api/queues', 'service')).status, 403)
  assert.equal((await call(A.url, 'POST', '/api/queues', 'robin', { name: ' ' })).status, 400)
})

test('lists.db from the smart-collections release (version 1) gains shortlists and keeps its collections', () => {
  const file = join(tmp(), 'lists.db')
  const old = new DatabaseSync(file)
  old.exec("CREATE TABLE smart_collections (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, rules TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL); INSERT INTO smart_collections VALUES ('s', 'o', 'Mine', '{}', 1, 1); PRAGMA user_version = 1;")
  old.close()
  const db = openLists(file)
  assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, LISTS_VERSION)
  assert.equal((db.prepare('SELECT name FROM smart_collections').get() as { name: string }).name, 'Mine')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM queues').get() as { n: number }).n, 0)
})
