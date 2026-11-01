// Moments collections (server/src/momentCollections.ts): saving moments sent to you (with who
// flagged them), spots in titles you can open, sharing a collection with chosen people (as
// references: a title they can't open stays hidden), copying from a shared one, and a
// friend's title that stops being reachable.

import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
import { call, fakeJellyfin, finesse } from './peers.ts'

let jf: Awaited<ReturnType<typeof fakeJellyfin>>
let jfB: Awaited<ReturnType<typeof fakeJellyfin>>
let A: Awaited<ReturnType<typeof finesse>>
let B: Awaited<ReturnType<typeof finesse>>
let sams = ''
let linkOnB = ''
const servers: Server[] = []
const id = (name: string) => [...jf.users.values()].find((u) => u.Name === name)!.Id.toLowerCase()

type Entry = { key: string; available: boolean; item: string | null; title: string; note: string; from: string; start: number | null }
type Col = { id: string; name: string; mine: boolean; entries: Entry[]; sharedWith?: { name: string }[] }

before(async () => {
  jf = await fakeJellyfin('Home', [{ name: 'alex', token: 'alex', admin: true }, { name: 'robin', token: 'robin', admin: false }, { name: 'kim', token: 'kim', admin: false }, { name: 'lee', token: 'lee', admin: false }], 'service')
  jfB = await fakeJellyfin('Sam’s server', [{ name: 'sam', token: 'sam', admin: true }], 'b-service')
  A = await finesse('a', jf, 'service')
  B = await finesse('b', jfB, 'b-service')
  servers.push(jf.server, jfB.server, A.app, B.app)
  const kim = [...jf.users.values()].find((u) => u.Name === 'kim')!
  kim.Policy = { ...kim.Policy, EnableAllFolders: false, EnabledFolders: [jf.libs[0]!.Id] }
  const code = await call(B.url, 'POST', '/api/groups/codes', 'sam', { libraries: [jfB.libs[0]!.Id] })
  sams = String((await call(A.url, 'POST', '/api/groups/friends', 'alex', { url: B.url, code: code.data.code })).data.id)
  const back = await call(A.url, 'POST', '/api/groups/codes', 'alex', { libraries: [jf.libs[0]!.Id] })
  assert.equal((await call(B.url, 'POST', '/api/groups/friends', 'sam', { url: A.url, code: back.data.code })).status, 201)
  linkOnB = String(((await call(B.url, 'GET', '/api/groups', 'sam')).data.links as { id: string }[])[0]!.id)
})
after(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

const inbox = async (token: string) => ((await call(A.url, 'GET', '/api/moments/inbox?fresh=1', token)).data.moments ?? []) as { key: string; note: string }[]
const make = async (token: string, name: string) => (await call(A.url, 'POST', '/api/moment-collections', token, { name })).data as unknown as Col
const add = (token: string, col: string, body: unknown) => call(A.url, 'POST', `/api/moment-collections/${col}/entries`, token, body)
const get = async (token: string, col: string) => (await call(A.url, 'GET', `/api/moment-collections/${col}`, token)).data as unknown as Col

let kims = ''
let robins = ''

test('Kim saves a moment Robin sent her, keeping who flagged it; not ones that weren’t sent to her', async () => {
  assert.equal((await call(A.url, 'POST', '/api/moments', 'robin', { item: jf.movie, start: 61, end: 75, note: 'the dragon!', to: [`user:${id('kim')}`] })).status, 201)
  assert.equal((await call(A.url, 'POST', '/api/moments', 'alex', { item: jf.movie, start: 5, end: 9, note: 'just for robin', to: [`user:${id('robin')}`] })).status, 201)
  const kimsBox = await inbox('kim')
  const sent = kimsBox.find((m) => m.note === 'the dragon!')!
  kims = (await make('kim', '  Best   bits ')).id
  const r = await add('kim', kims, { moment: sent.key })
  assert.equal(r.status, 201, r.text)
  const col = r.data as unknown as Col
  assert.equal(col.name, 'Best bits')
  assert.deepEqual(col.entries.map((e) => [e.title, e.from, e.note, e.start, e.available]), [['Sintel', 'robin', 'the dragon!', 61, true]])
  // Saving it twice keeps one.
  assert.equal((await add('kim', kims, { moment: sent.key })).status, 200)
  assert.equal((await get('kim', kims)).entries.length, 1)
  // Alex's note to Robin isn't Kim's to save, even with its key.
  const robinsKey = (await inbox('robin')).find((m) => m.note === 'just for robin')!.key
  assert.equal((await add('kim', kims, { moment: robinsKey })).status, 404)
  assert.equal((await add('kim', kims, { moment: 'l:nonsense-key' })).status, 404)
})

test('a spot in a title: only one you can open', async () => {
  assert.equal((await add('kim', kims, { item: jf.privateMovie, start: 1, end: 5 })).status, 404, 'Kim can’t open the Private library')
  robins = (await make('robin', 'Home videos')).id
  const r = await add('robin', robins, { item: jf.privateMovie, start: 10, end: 20, note: 'grandma' })
  assert.equal(r.status, 201, r.text)
  assert.equal((r.data as unknown as Col).entries[0]!.from, 'robin')
  assert.equal((await add('robin', robins, { item: jf.movie, start: 30, end: 31 })).status, 201)
  assert.equal((await add('robin', robins, { item: jf.movie, start: 30, end: 900 })).status, 400, 'a moment is at most 10 minutes')
})

test('sharing: chosen people read it; a title they can’t open shows without its name or note', async () => {
  // Only the owner sees it until shared.
  assert.equal((await call(A.url, 'GET', `/api/moment-collections/${robins}`, 'kim')).status, 404)
  const shared = await call(A.url, 'PUT', `/api/moment-collections/${robins}`, 'robin', { sharedWith: [id('kim'), 'nobody'] })
  assert.equal(shared.status, 200, shared.text)
  assert.deepEqual((shared.data as unknown as Col).sharedWith!.map((p) => p.name), ['kim'])
  const list = await call(A.url, 'GET', '/api/moment-collections', 'kim')
  assert.deepEqual((list.data.shared as { name: string; owner: string }[]).map((c) => `${c.name} by ${c.owner}`), ['Home videos by robin'])
  const view = await get('kim', robins)
  assert.equal(view.mine, false)
  assert.equal(view.sharedWith, undefined, 'who else it’s shared with is the owner’s business')
  const hidden = view.entries.find((e) => !e.available)!
  assert.equal(hidden.item, null)
  assert.equal(hidden.title, 'A title you can’t open')
  assert.equal(hidden.note, '')
  assert.doesNotMatch(JSON.stringify(view), /grandma|Home Video|6{32}/)
  // Lee isn't in it.
  assert.equal((await call(A.url, 'GET', `/api/moment-collections/${robins}`, 'lee')).status, 404)
  // Read-only for Kim.
  assert.equal((await call(A.url, 'PUT', `/api/moment-collections/${robins}`, 'kim', { name: 'mine' })).status, 403)
  assert.equal((await add('kim', robins, { item: jf.movie, start: 1, end: 2 })).status, 403)
  assert.equal((await call(A.url, 'DELETE', `/api/moment-collections/${robins}`, 'kim')).status, 403)
  // Kim copies the one she can open into her own, attribution kept; not the one she can't.
  const open = view.entries.find((e) => e.available)!
  assert.equal((await add('kim', kims, { from: { collection: robins, key: open.key } })).status, 201)
  assert.equal((await add('kim', kims, { from: { collection: robins, key: hidden.key } })).status, 403)
  const mine = await get('kim', kims)
  assert.deepEqual(mine.entries.map((e) => `${e.start}:${e.from}`), ['61:robin', '30:robin'])
  // Unsharing takes it away.
  await call(A.url, 'PUT', `/api/moment-collections/${robins}`, 'robin', { sharedWith: [] })
  assert.equal((await call(A.url, 'GET', `/api/moment-collections/${robins}`, 'kim')).status, 404)
})

test('a friend’s moment, saved with its attribution, then the friend’s server goes away', async () => {
  assert.equal((await call(B.url, 'POST', '/api/moments', 'sam', { item: jfB.movie, start: 300, end: 320, note: 'the twist', to: [`link:${linkOnB}`] })).status, 201)
  await new Promise((r) => setTimeout(r, 3100))
  const m = (await inbox('robin')).find((x) => x.note === 'the twist')!
  assert.ok(m)
  const r = await add('robin', robins, { moment: m.key })
  assert.equal(r.status, 201, r.text)
  const e = (r.data as unknown as Col).entries.find((x) => x.note === 'the twist')!
  assert.equal(e.item, `f-${sams}-${jfB.movie}`)
  assert.equal(e.from, 'sam · Sam’s server')
  // Unpaired: the owner still sees what it was, marked unavailable.
  assert.equal((await call(A.url, 'DELETE', `/api/groups/friends/${sams}`, 'alex')).status, 200)
  const after = (await get('robin', robins)).entries.find((x) => x.note === 'the twist')!
  assert.equal(after.available, false)
  assert.equal(after.title, 'Sintel')
  assert.equal(after.item, null)
})

test('removing entries and collections; only people', async () => {
  const col = await get('kim', kims)
  const r = await call(A.url, 'DELETE', `/api/moment-collections/${kims}/entries/${col.entries[0]!.key}`, 'kim')
  assert.equal((r.data as unknown as Col).entries.length, 1)
  assert.equal((await call(A.url, 'DELETE', `/api/moment-collections/${kims}`, 'kim')).status, 200)
  assert.equal((await call(A.url, 'GET', `/api/moment-collections/${kims}`, 'kim')).status, 404)
  assert.equal((await call(A.url, 'GET', '/api/moment-collections')).status, 401)
  assert.equal((await call(A.url, 'GET', '/api/moment-collections', 'service')).status, 403)
  assert.equal((await call(A.url, 'POST', '/api/moment-collections', 'kim', { name: '' })).status, 400)
})
