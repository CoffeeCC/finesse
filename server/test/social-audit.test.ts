import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'
import { friendPlaybackToken, PEER_TOKEN, withoutPaths } from '../src/groups.ts'
import { listen } from './helpers.ts'
import { call, fakeJellyfin, finesse, H } from './peers.ts'

async function household(t: TestContext) {
  const jf = await fakeJellyfin('Home', [
    { name: 'alex', token: 'admin', admin: true },
    { name: 'robin', token: 'owner', admin: false },
    { name: 'kim', token: 'viewer', admin: false },
  ], 'service')
  const f = await finesse('audit', jf, 'service')
  t.after(async () => {
    for (const s of [f.app, jf.server]) {
      s.closeAllConnections()
      await new Promise<void>((resolve) => s.close(() => resolve()))
    }
  })
  return { f, jf }
}

test('moments enforce Jellyfin library access when posting, reading timelines and reading inboxes', async (t) => {
  const { f, jf } = await household(t)
  const viewer = [...jf.users.values()].find((u) => u.Name === 'kim')!
  viewer.Policy.EnableAllFolders = false
  viewer.Policy.EnabledFolders = [jf.libs[0]!.Id]
  const body = { item: jf.privateMovie, note: 'Private note', to: ['home'] }
  assert.equal((await call(f.url, 'POST', '/api/moments', 'admin', body)).status, 201)
  assert.equal((await call(f.url, 'POST', '/api/moments', 'viewer', body)).status, 403)
  assert.equal((await call(f.url, 'GET', `/api/moments/item/${jf.privateMovie}`, 'viewer')).status, 403)
  const inbox = await call(f.url, 'GET', '/api/moments/inbox', 'viewer')
  assert.equal(inbox.status, 200)
  assert.deepEqual(inbox.data.moments, [])
  assert.doesNotMatch(inbox.text, /Private note/)
})

test('collection updates are atomic when sharing input is invalid', async (t) => {
  const { f } = await household(t)
  const created = await call(f.url, 'POST', '/api/moment-collections', 'owner', { name: 'Before' })
  assert.equal(created.status, 201)
  const path = `/api/moment-collections/${created.data.id}`
  assert.equal((await call(f.url, 'PUT', path, 'owner', { name: 'After', sharedWith: 'invalid' })).status, 400)
  const got = await call(f.url, 'GET', path, 'owner')
  assert.equal(got.data.name, 'Before')
  assert.equal((await call(f.url, 'GET', path, 'viewer')).status, 404)
})

test('party creation limits hold under parallel invitations', async (t) => {
  const { f, jf } = await household(t)
  const viewer = [...jf.users.values()].find((u) => u.Name === 'kim')!
  const responses = await Promise.all(Array.from({ length: 7 }, () =>
    call(f.url, 'POST', '/api/parties', 'owner', { item: jf.movie, invite: [viewer.Id] })))
  assert.equal(responses.filter((r) => r.status === 201).length, 3)
  assert.equal(responses.filter((r) => r.status === 429).length, 4)
  const path = `/api/parties/${responses.find((r) => r.status === 201)!.data.id}`
  assert.equal((await call(f.url, 'POST', `${path}/beat`, 'owner', { position: null })).status, 400)
  assert.equal((await call(f.url, 'POST', `${path}/control`, 'owner', { action: 'seek', position: null })).status, 400)
})

test('a broken smart collection row does not hide healthy collections', async (t) => {
  const { f } = await household(t)
  const endpoint = '/api/smart-collections'
  const body = { name: 'Films', rules: { kind: 'Movie' } }
  const a = await call(f.url, 'POST', endpoint, 'owner', body)
  const b = await call(f.url, 'POST', endpoint, 'owner', { ...body, name: 'Broken' })
  assert.equal(a.status, 201, a.text)
  assert.equal(b.status, 201, b.text)
  const db = new DatabaseSync(join(f.settings.paths.configDir, 'lists.db'))
  try { db.prepare('UPDATE smart_collections SET rules = ? WHERE id = ?').run('{', String(b.data.id)) }
  finally { db.close() }
  const list = await call(f.url, 'GET', endpoint, 'owner')
  assert.equal(list.status, 200)
  assert.deepEqual((list.data.collections as { name: string }[]).map((row) => row.name), ['Films'])
  const path = `${endpoint}/${b.data.id}`
  assert.equal((await call(f.url, 'PUT', path, 'owner', { name: 'Retry' })).status, 409)
  assert.equal((await call(f.url, 'PUT', path, 'viewer', body)).status, 404)
  assert.equal((await call(f.url, 'PUT', path, 'owner', body)).status, 200)
})

test('a Groups peer can stream media data but cannot set browser state or serve a document', async (t) => {
  const { f, jf } = await household(t)
  let html = true
  const peer = createServer((_req, res) => {
    res.setHeader('Content-Type', html ? 'text/html' : 'application/json')
    res.setHeader('Set-Cookie', 'state=peer')
    res.setHeader('Refresh', '0; url=/')
    res.end(html ? '<!doctype html><title>Peer page</title>' : JSON.stringify({
      MediaSources: [
        { TranscodingUrl: `https://example.invalid/video?ApiKey=${PEER_TOKEN}` },
        { TranscodingUrl: `/videos/${jf.movie}/master.m3u8?ApiKey=${PEER_TOKEN}` },
      ],
    }))
  })
  const url = await listen(peer)
  t.after(() => { peer.closeAllConnections(); return new Promise<void>((resolve) => peer.close(() => resolve())) })
  f.settings.update((s) => { s.groups = {
    links: [], codes: [], offers: [],
    friends: [{ id: 'abcdefgh', linkId: 'ijklmnop', secret: 'fixture', url, name: 'Peer', addedAt: new Date().toISOString() }],
  } })
  const endpoint = `${f.url}/api/groups/friends/abcdefgh/jellyfin/Items/${jf.movie}/PlaybackInfo`
  const request = () => fetch(endpoint, { method: 'POST', headers: H('owner'), body: '{}' })
  assert.equal((await request()).status, 502)
  html = false
  const data = await request()
  assert.equal(data.status, 200)
  assert.equal(data.headers.get('set-cookie'), null)
  assert.equal(data.headers.get('refresh'), null)
  assert.equal(data.headers.get('x-content-type-options'), 'nosniff')
  const result = await data.json() as { MediaSources: { TranscodingUrl: string }[] }
  assert.match(result.MediaSources[0]!.TranscodingUrl, new RegExp(PEER_TOKEN))
  assert.match(result.MediaSources[1]!.TranscodingUrl, /ApiKey=owner$/)
  assert.match(friendPlaybackToken(`#EXTM3U\nhttps://example.invalid/s?ApiKey=${PEER_TOKEN}\nsegment.ts?ApiKey=${PEER_TOKEN}`, 'token'), /segment\.ts\?ApiKey=token/)
  const indirect = `/videos/${jf.movie}/master.m3u8?other=${PEER_TOKEN}`
  assert.equal(friendPlaybackToken(JSON.stringify(indirect), 'local-token'), JSON.stringify(indirect))
  assert.equal(withoutPaths('{"pAtH":"/private","items":[{"path":"/other","Id":"x"}]}'), '{"items":[{"Id":"x"}]}')
})
