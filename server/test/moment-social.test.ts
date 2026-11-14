// Reactions and comments on moments (server/src/momentSocial.ts). Two Finesse servers that share
// with each other: a thread is seen by exactly who can see the moment, lives on the server that
// has the video, and a friend's server can't speak for anyone here.

import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
import { call, fakeJellyfin, finesse } from './peers.ts'

let jfA: Awaited<ReturnType<typeof fakeJellyfin>>
let jfB: Awaited<ReturnType<typeof fakeJellyfin>>
let A: Awaited<ReturnType<typeof finesse>>
let B: Awaited<ReturnType<typeof finesse>>
const servers: Server[] = []
let samsOnA = ''
let alexLinkOnB = ''

type Thread = { reactions: { emoji: string; count: number; mine: boolean; who: string[] }[]; comments: { id: string; from: string; text: string; mine: boolean; canDelete: boolean }[] }
const threads = async (base: string, token: string, keys: string[]) => (await call(base, 'GET', `/api/moments/social?keys=${keys.map(encodeURIComponent).join(',')}`, token)).data.threads as Record<string, Thread>
const settle = () => new Promise((r) => setTimeout(r, 3100))
const inboxKeys = async (base: string, token: string) => ((await call(base, 'GET', '/api/moments/inbox?fresh=1', token)).data.moments as { key: string; note: string }[])

let local = '' // a moment of Alex's film, for everyone at Alex's and for Sam's server
let justRobin = '' // a moment only for Robin

before(async () => {
  jfA = await fakeJellyfin('Alex’s server', [{ name: 'alex', token: 'a-admin', admin: true }, { name: 'robin', token: 'a-robin', admin: false }, { name: 'jo', token: 'a-jo', admin: false }], 'a-service')
  jfB = await fakeJellyfin('Sam’s server', [{ name: 'sam', token: 'b-admin', admin: true }, { name: 'kim', token: 'b-kim', admin: false }], 'b-service')
  B = await finesse('sb', jfB, 'b-service')
  A = await finesse('sa', jfA, 'a-service')
  servers.push(jfA.server, jfB.server, A.app, B.app)
  const code = await call(B.url, 'POST', '/api/groups/codes', 'b-admin', { libraries: [jfB.libs[0]!.Id] })
  samsOnA = String((await call(A.url, 'POST', '/api/groups/friends', 'a-admin', { url: B.url, code: code.data.code })).data.id)
  const back = await call(A.url, 'POST', '/api/groups/codes', 'a-admin', { libraries: [jfA.libs[0]!.Id] })
  assert.equal((await call(B.url, 'POST', '/api/groups/friends', 'b-admin', { url: A.url, code: back.data.code })).status, 201)
  alexLinkOnB = String(((await call(B.url, 'GET', '/api/groups', 'b-admin')).data.links as { id: string }[])[0]!.id)
  const alexLinkOnA = String(((await call(A.url, 'GET', '/api/groups', 'a-admin')).data.links as { id: string }[])[0]!.id)

  const m = await call(A.url, 'POST', '/api/moments', 'a-admin', { item: jfA.movie, start: 10, end: 30, note: 'the landing', to: ['home', `link:${alexLinkOnA}`] })
  assert.equal(m.status, 201, m.text)
  local = String(m.data.key)
  const robinId = [...jfA.users.values()].find((u) => u.Name === 'robin')!.Id
  const p = await call(A.url, 'POST', '/api/moments', 'a-admin', { item: jfA.movie, start: 40, end: 50, note: 'for robin', to: [`user:${robinId}`] })
  justRobin = String(p.data.key)
})
after(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

test('people at home react and comment; one reaction each, changeable', async () => {
  assert.equal((await call(A.url, 'POST', '/api/moments/react', 'a-robin', { key: local, emoji: '🔥' })).status, 200)
  assert.equal((await call(A.url, 'POST', '/api/moments/react', 'a-jo', { key: local, emoji: '🔥' })).status, 200)
  assert.equal((await call(A.url, 'POST', '/api/moments/react', 'a-robin', { key: local, emoji: '😂' })).status, 200)
  const c = await call(A.url, 'POST', '/api/moments/comment', 'a-robin', { key: local, text: '  I gasped\u0000  ' })
  assert.equal(c.status, 201, c.text)

  const t = (await threads(A.url, 'a-robin', [local]))[local]!
  assert.deepEqual(t.reactions.map((r) => [r.emoji, r.count, r.mine]).sort(), [['😂', 1, true], ['🔥', 1, false]].sort())
  assert.deepEqual(t.comments.map((x) => [x.from, x.text, x.mine]), [['You', 'I gasped', true]])
  // Someone else sees her name, and can't delete her comment; the moment's author can.
  const jo = (await threads(A.url, 'a-jo', [local]))[local]!
  assert.deepEqual([jo.comments[0]!.from, jo.comments[0]!.canDelete], ['robin', false])
  assert.equal((await threads(A.url, 'a-admin', [local]))[local]!.comments[0]!.canDelete, true)
})

test('only the offered reactions, and no empty comments', async () => {
  assert.equal((await call(A.url, 'POST', '/api/moments/react', 'a-robin', { key: local, emoji: '🍕' })).status, 400)
  assert.equal((await call(A.url, 'POST', '/api/moments/comment', 'a-robin', { key: local, text: '   ' })).status, 400)
  assert.equal((await call(A.url, 'POST', '/api/moments/comment', 'a-robin', { key: local, text: 'x'.repeat(900) })).status, 201)
  const t = (await threads(A.url, 'a-robin', [local]))[local]!
  assert.equal(t.comments.at(-1)!.text.length, 300)
  assert.equal((await call(A.url, 'POST', '/api/moments/react', undefined, { key: local, emoji: '🔥' })).status, 401)
})

test('a thread is only for who can see the moment', async () => {
  assert.equal((await call(A.url, 'POST', '/api/moments/comment', 'a-robin', { key: justRobin, text: 'thanks' })).status, 201)
  // Jo wasn't sent it: no thread, no reacting, no commenting.
  assert.deepEqual(await threads(A.url, 'a-jo', [justRobin]), {})
  assert.equal((await call(A.url, 'POST', '/api/moments/react', 'a-jo', { key: justRobin, emoji: '🔥' })).status, 404)
  assert.equal((await call(A.url, 'POST', '/api/moments/comment', 'a-jo', { key: justRobin, text: 'hi' })).status, 404)
  assert.equal((await threads(A.url, 'a-robin', [justRobin]))[justRobin]!.comments.length, 1)
})

test('a friend’s people join the same thread, and each side sees who’s from where', async () => {
  await settle()
  const forKim = (await inboxKeys(B.url, 'b-kim')).find((m) => m.note === 'the landing')
  assert.ok(forKim, 'the moment reached Sam’s server')
  const key = forKim!.key
  assert.equal((await call(B.url, 'POST', '/api/moments/react', 'b-kim', { key, emoji: '😮' })).status, 200)
  const c = await call(B.url, 'POST', '/api/moments/comment', 'b-kim', { key, text: 'what a shot' })
  assert.equal(c.status, 201, c.text)

  // On Sam's server: Kim's own are hers; Robin's carry Alex's server's name.
  const kim = (c.data.thread as Thread)
  assert.ok(kim.comments.some((x) => x.mine && x.from === 'You' && x.text === 'what a shot'))
  assert.ok(kim.comments.some((x) => x.from === 'robin · Alex’s server' && x.text === 'I gasped'))
  assert.ok(kim.reactions.some((r) => r.emoji === '😮' && r.mine))
  // On Alex's server, where the moment lives: Kim's carry Sam's server's name.
  const robin = (await threads(A.url, 'a-robin', [local]))[local]!
  assert.ok(robin.comments.some((x) => x.from === 'kim · Sam’s server' && x.text === 'what a shot' && !x.mine))
  assert.ok(robin.reactions.some((r) => r.emoji === '😮' && r.who.includes('kim · Sam’s server')))

  // Kim takes her reaction back, and deletes her comment; she can't delete Robin's.
  assert.equal((await call(B.url, 'POST', '/api/moments/react', 'b-kim', { key, emoji: null })).status, 200)
  const mineId = kim.comments.find((x) => x.mine)!.id
  const robinsId = kim.comments.find((x) => x.text === 'I gasped')!.id
  assert.equal((await call(B.url, 'POST', '/api/moments/comment/delete', 'b-kim', { key, id: robinsId })).status, 403)
  assert.equal((await call(B.url, 'POST', '/api/moments/comment/delete', 'b-kim', { key, id: mineId })).status, 200)
  const after = (await threads(A.url, 'a-robin', [local]))[local]!
  assert.ok(!after.comments.some((x) => x.text === 'what a shot'))
  assert.ok(!after.reactions.some((r) => r.emoji === '😮'))
})

test('a friend’s server never hears about a moment it wasn’t sent', async () => {
  const id = justRobin.slice(2)
  // Sam's server asks Alex's, as itself, for every thread it may see: the private one isn't there.
  const friend = B.settings.get().groups!.friends[0]!
  const peer = (method: string, path: string, body?: unknown) =>
    fetch(`${A.url}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `FinessePeer ${friend.linkId}:${friend.secret}` }, body: body ? JSON.stringify(body) : undefined })
  const all = await peer('GET', '/api/groups/peer/moments/social')
  assert.equal(all.status, 200)
  const text = await all.text()
  assert.ok(text.includes(local.slice(2)), 'the shared moment’s thread is there')
  assert.ok(!text.includes(id), 'the private one is not')
  // Nor can it react or comment on it, or read it without being a paired server.
  const viewer = 'a'.repeat(32)
  assert.equal((await peer('POST', `/api/groups/peer/moments/${id}/react`, { viewer, name: 'x', emoji: '🔥' })).status, 404)
  assert.equal((await peer('POST', `/api/groups/peer/moments/${id}/comment`, { viewer, name: 'x', text: 'hi' })).status, 404)
  assert.equal((await call(A.url, 'GET', '/api/groups/peer/moments/social')).status, 401)
  void alexLinkOnB
})

test('a friend’s server can’t put words in the mouth of someone here', async () => {
  // Robin flags a moment in Sam's film; it lives on Sam's server.
  const item = `f-${samsOnA}-${jfB.movie}`
  const r = await call(A.url, 'POST', '/api/moments', 'a-robin', { item, start: 5, end: 20, note: 'yours', to: ['owner', 'home'] })
  assert.equal(r.status, 201, r.text)
  const key = String(r.data.key)
  assert.equal((await call(A.url, 'POST', '/api/moments/comment', 'a-admin', { key, text: 'agreed' })).status, 201)
  const t = (await threads(A.url, 'a-robin', [key]))[key]!
  assert.deepEqual(t.comments.map((c) => [c.from, c.text]), [['alex', 'agreed']])

  // Sam's server now claims a comment is by Robin (one of Alex's people) that Alex's server never sent.
  const robinId = [...jfA.users.values()].find((u) => u.Name === 'robin')!.Id.toLowerCase()
  const store = (await import('node:sqlite')).DatabaseSync
  const file = `${B.settings.paths.configDir}/moments.db`
  const raw = new store(file)
  const link = (raw.prepare('SELECT author_server AS s FROM moments WHERE note = ?').get('yours') as { s: string }).s
  const momentId = key.split(':')[2]!
  raw.prepare('INSERT INTO comments (id, moment, server, user, name, text, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run('forgedforged1', momentId, link, robinId, 'robin', 'I never said this', Date.now())
  raw.close()
  await new Promise((res) => setTimeout(res, 100))
  const seen = (await call(A.url, 'POST', '/api/moments/react', 'a-robin', { key, emoji: '❤️' })).data.thread as Thread
  const forged = seen.comments.find((c) => c.text === 'I never said this')!
  assert.ok(forged, 'the comment is shown')
  assert.equal(forged.mine, false)
  assert.equal(forged.from, 'robin · Sam’s server', 'but as Sam’s server’s word, not Robin’s own')
})

test('the bell: what other people did on your moments is news once, and your own isn’t', async () => {
  const m = await call(A.url, 'POST', '/api/moments', 'a-admin', { item: jfA.movie, start: 60, end: 70, note: 'bell', to: ['home'] })
  const key = String(m.data.key)
  type Act = { items: { kind: string; key: string; from: string; what: string; title: string; fresh: boolean }[]; unread: number }
  const activity = async (token: string) => (await call(A.url, 'GET', '/api/moments/activity', token)).data as unknown as Act
  const mine = async () => (await activity('a-admin')).items.filter((i) => i.key === key)

  await call(A.url, 'POST', '/api/moments/comment', 'a-admin', { key, text: 'my own note' })
  assert.deepEqual(await mine(), [])
  await call(A.url, 'POST', '/api/moments/comment', 'a-robin', { key, text: 'so good' })
  await call(A.url, 'POST', '/api/moments/react', 'a-jo', { key, emoji: '👏' })
  const now = await mine()
  assert.deepEqual(now.map((i) => [i.kind, i.from, i.what, i.title, i.fresh]).sort(), [['comment', 'robin', 'so good', 'Sintel', true], ['reaction', 'jo', '👏', 'Sintel', true]].sort())
  assert.ok((await activity('a-admin')).unread >= 2)
  // Robin commented; that's not news for robin.
  assert.equal((await activity('a-robin')).items.some((i) => i.key === key), false)

  assert.equal((await call(A.url, 'POST', '/api/moments/activity/seen', 'a-admin')).status, 200)
  const seen = await activity('a-admin')
  assert.deepEqual([seen.unread, seen.items.filter((i) => i.key === key).length], [0, 2])
  await new Promise((r) => setTimeout(r, 5))
  await call(A.url, 'POST', '/api/moments/comment', 'a-jo', { key, text: 'again!' })
  assert.equal((await activity('a-admin')).unread, 1)
  assert.equal((await call(A.url, 'GET', '/api/moments/activity')).status, 401)
})
