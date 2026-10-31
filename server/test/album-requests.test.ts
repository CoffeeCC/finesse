// Album and EP requests (server/src/albumRequests.ts) against a fake Lidarr: see an artist's
// releases, request one EP for a new artist, and for an artist already followed under the
// albums-only Standard profile (only that artist's profile changes, only on request).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { after, before, test } from 'node:test'
import { profileFor } from '../src/albumRequests.ts'
import { listen } from './helpers.ts'
import { call, fakeJellyfin, finesse } from './peers.ts'

const SLEEP = 'aaaaaaaa-0000-4000-8000-000000000001' // an artist with only an EP (the Zombie EP case)
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002' // already followed, under Standard
const ZOMBIE = 'bbbbbbbb-0000-4000-8000-000000000001'
const OTHER_EP = 'bbbbbbbb-0000-4000-8000-000000000002'
const OTHER_LP = 'bbbbbbbb-0000-4000-8000-000000000003'

const types = (ep: boolean) => [
  { albumType: { name: 'Album' }, allowed: true },
  { albumType: { name: 'EP' }, allowed: ep },
  { albumType: { name: 'Single' }, allowed: false },
]

interface Lidarr {
  server: Server
  url: string
  calls: { method: string; path: string; body?: unknown }[]
  artists: Record<string, unknown>[]
  albums: Record<string, unknown>[]
}
let L: Lidarr
let jf: Awaited<ReturnType<typeof fakeJellyfin>>
let F: Awaited<ReturnType<typeof finesse>>

before(async () => {
  const state = {
    calls: [] as Lidarr['calls'],
    artists: [
      { id: 7, foreignArtistId: OTHER, artistName: 'Other Band', metadataProfileId: 1, qualityProfileId: 2, rootFolderPath: '/music' },
      { id: 8, foreignArtistId: 'aaaaaaaa-0000-4000-8000-00000000000f', artistName: 'Someone Else', metadataProfileId: 1 },
    ] as Record<string, unknown>[],
    albums: [{ id: 70, artistId: 7, foreignAlbumId: OTHER_LP, title: 'First LP', albumType: 'Album', monitored: true, statistics: { trackFileCount: 9 } }] as Record<string, unknown>[],
  }
  const lookup = [
    { foreignAlbumId: ZOMBIE, title: 'Zombie EP', albumType: 'EP', releaseDate: '2020-05-01T00:00:00Z', artist: { foreignArtistId: SLEEP, artistName: 'Sleep Token' } },
    { foreignAlbumId: OTHER_EP, title: 'Side B', albumType: 'EP', releaseDate: '2022-01-01T00:00:00Z', artist: { foreignArtistId: OTHER, artistName: 'Other Band' } },
    { foreignAlbumId: OTHER_LP, title: 'First LP', albumType: 'Album', releaseDate: '2019-01-01T00:00:00Z', artist: { foreignArtistId: OTHER, artistName: 'Other Band' } },
  ]
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
    const u = new URL(req.url ?? '/', 'http://x')
    const p = u.pathname.replace(/^\/api\/v1/, '')
    state.calls.push({ method: req.method ?? '', path: `${p}${u.search}`, body })
    const send = (data: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    if (req.headers['x-api-key'] !== 'lidarr-key') return send({ message: 'Unauthorized' }, 401)
    if (p === '/qualityprofile') return send([{ id: 2, name: 'Standard' }])
    if (p === '/rootfolder') return send([{ path: '/music' }])
    if (p === '/metadataprofile') return send([{ id: 1, name: 'Standard', primaryAlbumTypes: types(false) }, { id: 3, name: 'Albums & EPs', primaryAlbumTypes: types(true) }, { id: 4, name: 'None', primaryAlbumTypes: [] }])
    if (p === '/artist' && req.method === 'GET') return send(state.artists)
    if (p === '/album/lookup') return send(lookup)
    if (p === '/album' && req.method === 'GET') return send(state.albums.filter((a) => String(a.artistId) === u.searchParams.get('artistId')))
    if (p.startsWith('/artist/') && req.method === 'PUT') {
      const i = state.artists.findIndex((a) => a.id === Number(p.split('/')[2]))
      state.artists[i] = body
      return send(body)
    }
    if (p === '/album' && req.method === 'POST') return send({ ...body, id: 99 })
    if (p === '/album/monitor' || p === '/command') return send({})
    send({ message: 'not here' }, 404)
  })
  L = Object.assign(state, { server, url: await listen(server) })
  jf = await fakeJellyfin('Home', [{ name: 'alex', token: 'a-admin', admin: true }, { name: 'robin', token: 'a-robin', admin: false }], 'a-service')
  F = await finesse('albums', jf, 'a-service')
  F.settings.update((s) => void (s.services.lidarr = { url: L.url, apiKey: 'lidarr-key' }))
})
after(() => {
  for (const s of [F.app, jf.server, L.server]) {
    s.closeAllConnections()
    s.close()
  }
})

const ask = (album: string, artistName: string, extra: Record<string, unknown> = {}) =>
  call(F.url, 'POST', '/api/requests/album', 'a-robin', { foreignAlbumId: album, artistName, qualityProfileId: 2, rootFolderPath: '/music', ...extra })

test('an artist’s albums and EPs, with what Lidarr already has', async () => {
  assert.equal((await call(F.url, 'GET', `/api/requests/artist-albums?artist=${OTHER}&name=Other%20Band`)).status, 401)
  const r = await call(F.url, 'GET', `/api/requests/artist-albums?artist=${OTHER}&name=Other%20Band`, 'a-robin')
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.data.albums, [
    { foreignAlbumId: OTHER_LP, title: 'First LP', type: 'Album', year: 2019, inLidarr: true, monitored: true, downloaded: true },
    { foreignAlbumId: OTHER_EP, title: 'Side B', type: 'EP', year: 2022, inLidarr: false, monitored: false, downloaded: false },
  ])
  assert.doesNotMatch(r.text, /lidarr-key/)
  assert.equal((await call(F.url, 'GET', '/api/requests/artist-albums?artist=nope&name=x', 'a-robin')).status, 400)
})

test('an EP by a new artist: just that EP is added, the artist follows nothing else', async () => {
  L.calls.length = 0
  const r = await ask(ZOMBIE, 'Sleep Token')
  assert.equal(r.status, 200, r.text)
  assert.equal(r.data.state, 'added')
  assert.match(String(r.data.message), /Requested “Zombie EP”/)
  const add = L.calls.find((c) => c.method === 'POST' && c.path === '/album')!.body as Record<string, any>
  assert.equal(add.foreignAlbumId, ZOMBIE)
  assert.equal(add.monitored, true)
  assert.deepEqual(add.addOptions, { searchForNewAlbum: true })
  assert.equal(add.artist.metadataProfileId, 3, 'a profile that includes EPs')
  assert.deepEqual(add.artist.addOptions, { monitor: 'none', searchForMissingAlbums: false })
  assert.equal(add.artist.rootFolderPath, '/music')
  assert.ok(!L.calls.some((c) => c.method === 'PUT'), 'no existing artist touched')
})

test('an EP by an artist followed under Standard: only that artist gets EPs, and only now', async () => {
  L.calls.length = 0
  const r = await ask(OTHER_EP, 'Other Band')
  assert.equal(r.status, 200, r.text)
  assert.equal(r.data.profileChanged, true)
  const puts = L.calls.filter((c) => c.method === 'PUT')
  assert.deepEqual(puts.map((c) => c.path), ['/artist/7'])
  assert.equal((puts[0]!.body as { metadataProfileId: number }).metadataProfileId, 3)
  assert.equal(L.artists.find((a) => a.id === 8)!.metadataProfileId, 1, 'other artists are left alone')
})

test('an album Lidarr already has: followed and searched for, or "already in your music"', async () => {
  L.albums.push({ id: 71, artistId: 7, foreignAlbumId: OTHER_EP, title: 'Side B', albumType: 'EP', monitored: false, statistics: { trackFileCount: 0 } })
  L.calls.length = 0
  const r = await ask(OTHER_EP, 'Other Band')
  assert.equal(r.data.state, 'searching')
  assert.deepEqual(L.calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.body]), [
    ['PUT', '/album/monitor', { albumIds: [71], monitored: true }],
    ['POST', '/command', { name: 'AlbumSearch', albumIds: [71] }],
  ])
  const have = await ask(OTHER_LP, 'Other Band')
  assert.equal(have.data.state, 'have')
  assert.match(String(have.data.message), /already in your music/)
})

test('a folder or quality Lidarr doesn’t have is refused, with what to do', async () => {
  const bad = await ask(ZOMBIE, 'Sleep Token', { rootFolderPath: '/etc' })
  assert.equal(bad.status, 400)
  assert.match(String(bad.data.error), /doesn’t have that music folder/)
  const gone = await ask('bbbbbbbb-0000-4000-8000-0000000000ff', 'Sleep Token')
  assert.equal(gone.status, 404)
  assert.match(String(gone.data.error), /couldn’t find that release any more/)
})

test('which metadata profile: Albums & EPs first, never None', () => {
  const ps = [{ id: 4, name: 'None', primaryAlbumTypes: [] }, { id: 1, name: 'Standard', primaryAlbumTypes: types(false) }, { id: 3, name: 'Albums & EPs', primaryAlbumTypes: types(true) }]
  assert.equal(profileFor('EP', ps)?.id, 3)
  assert.equal(profileFor('Album', ps)?.id, 3)
  assert.equal(profileFor('Album', ps.filter((p) => p.id !== 3))?.id, 1)
  assert.equal(profileFor('Single', ps), undefined)
})
