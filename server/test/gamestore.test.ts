// The game store's skeleton: off until an administrator turns it on, browsing answered from the
// catalogue the way the demo store did, requests refused in plain words until the server can
// install, and where a download comes from never sent to a browser.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { facets, genreSlug, home, search } from '../src/gamestore/catalogue.ts'
import { GameStoreDb, type StoredRequest } from '../src/gamestore/db.ts'
import { REQUEST_STATES, type CatalogueGame, type CatalogueSource } from '../src/gamestore/types.ts'
import { call, fakeJellyfin, finesse } from './peers.ts'

const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'

const game = (id: string, title: string, more: Partial<CatalogueGame> = {}): CatalogueGame => ({
  id,
  title,
  summary: `${title}, a free game.`,
  genres: ['Strategy'],
  modes: ['single'],
  platforms: ['windows'],
  addedAt: '2026-01-01T00:00:00.000Z',
  popularity: 1,
  provider: 'test',
  ...more,
})
const source = (id: string, gameId: string, more: Partial<CatalogueSource> = {}): CatalogueSource => ({ id, gameId, platform: 'windows', installer: 'inno', sizeBytes: 1000, magnet: MAGNET, ...more })

// Free, open-source games (the only kind the tests and examples use).
const GAMES = [
  game('wz2100', 'Warzone 2100', { genres: ['Strategy', 'Sci-fi'], modes: ['single', 'online'], platforms: ['windows', 'linux'], popularity: 90, year: 1999, developer: 'Warzone 2100 Project' }),
  game('supertux', 'SuperTux', { genres: ['Platformer'], modes: ['single'], platforms: ['windows', 'linux'], popularity: 80, year: 2003, addedAt: '2026-03-01T00:00:00.000Z' }),
  game('0ad', '0 A.D.', { genres: ['Strategy', 'History'], modes: ['single', 'online'], popularity: 95, year: 2024 }),
  game('stk', 'SuperTuxKart', { genres: ['Racing'], modes: ['single', 'local', 'online'], platforms: ['linux'], popularity: 70, year: 2007 }),
  game('wesnoth', 'The Battle for Wesnoth', { genres: ['Strategy', 'Role-playing & Fantasy'], modes: ['single', 'local', 'online'], popularity: 60, year: 2005 }),
]

test('the server’s request states and installer kinds are the app’s', () => {
  const app = readFileSync(join(import.meta.dirname, '../../src/api/gameStore.ts'), 'utf8')
  const union = (name: string) => {
    const body = app.slice(app.indexOf(`export type ${name} =`)).split(/\n\n/)[0]!
    return [...body.replace(/\/\/.*$/gm, '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
  }
  assert.deepEqual(union('GameRequestState'), [...REQUEST_STATES])
  const sniff = readFileSync(join(import.meta.dirname, '../src/installerSniff.ts'), 'utf8')
  const kinds = [...sniff.slice(sniff.indexOf('export type InstallerKind =')).split('\n')[0]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
  assert.deepEqual(union('InstallerKind'), kinds)
})

test('search: words, filters, sorting and pages', () => {
  assert.deepEqual(search(GAMES, {}).items.map((g) => g.id), ['0ad', 'wz2100', 'supertux', 'stk', 'wesnoth'])
  assert.deepEqual(search(GAMES, { q: 'tux' }).items.map((g) => g.id), ['supertux', 'stk'])
  assert.deepEqual(search(GAMES, { q: 'warzone 2100 project' }).items.map((g) => g.id), ['wz2100'], 'the developer counts')
  assert.deepEqual(search(GAMES, { genres: ['strategy'], platform: 'linux' }).items.map((g) => g.id), ['wz2100'])
  assert.deepEqual(search(GAMES, { genres: ['role-playing-and-fantasy'] }).items.map((g) => g.id), ['wesnoth'])
  assert.deepEqual(search(GAMES, { mode: 'local', sort: 'name' }).items.map((g) => g.id), ['stk', 'wesnoth'])
  assert.equal(search(GAMES, { sort: 'new' }).items[0]!.id, 'supertux')
  assert.equal(search(GAMES, { sort: 'year' }).items[0]!.id, '0ad')
  const first = search(GAMES, { limit: 2 })
  assert.deepEqual([first.items.length, first.total, first.nextOffset], [2, 5, 2])
  assert.equal(search(GAMES, { limit: 2, offset: 4 }).nextOffset, undefined)
  assert.equal('popularity' in first.items[0]!, false, 'the catalogue’s own fields stay on the server')
  assert.equal(genreSlug('Role-playing & Fantasy'), 'role-playing-and-fantasy')
})

test('facets count with every other filter applied; the front page leaves out empty shelves', () => {
  const f = facets(GAMES, { genres: ['racing'], platform: 'linux' })
  // Genres are counted among Linux games (whatever genre is picked) …
  assert.deepEqual(f.genres.map((g) => [g.value, g.count]), [['platformer', 1], ['racing', 1], ['sci-fi', 1], ['strategy', 1]])
  // … and platforms among racing games.
  assert.deepEqual(f.platforms, [{ value: 'linux', label: 'Linux', count: 1 }])
  const h = home(GAMES)
  assert.deepEqual(h.featured.map((g) => g.id), ['0ad', 'wz2100', 'supertux', 'stk', 'wesnoth'])
  assert.deepEqual(h.shelves.map((s) => s.id), ['popular', 'new', 'friends', 'couch', 'genre-strategy', 'genre-history', 'linux'])
  assert.deepEqual(home([]).shelves, [])
})

test('the catalogue: a sync replaces a provider’s games and keeps the day each first turned up', () => {
  const db = new GameStoreDb(':memory:')
  db.replaceProvider('test', [{ game: GAMES[0]!, sources: [source('wz-win', 'wz2100'), source('wz-linux', 'wz2100', { platform: 'linux', installer: 'linux' })] }, { game: GAMES[1]!, sources: [] }])
  db.replaceProvider('other', [{ game: { ...GAMES[2]!, provider: 'other' }, sources: [] }])
  assert.equal(db.games().length, 3)
  assert.equal(db.sources('wz2100').length, 2)
  db.replaceProvider('test', [{ game: { ...GAMES[0]!, addedAt: '2026-09-09T00:00:00.000Z', summary: 'New words.' }, sources: [source('wz-win', 'wz2100')] }])
  assert.deepEqual(db.games().map((g) => g.id).sort(), ['0ad', 'wz2100'], 'a game its provider dropped leaves; another provider’s stays')
  assert.equal(db.game('wz2100')!.addedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(db.game('wz2100')!.summary, 'New words.')
  assert.equal(db.sources('wz2100').length, 1)
  assert.equal(db.source('wz-linux'), null)
})

test('requests are kept with their history', () => {
  const db = new GameStoreDb(':memory:')
  const r: StoredRequest = { id: 'r1', gameId: 'wz2100', title: 'Warzone 2100', sourceId: 'wz-win', platform: 'windows', installer: 'inno', state: 'queued', userId: 'u1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  db.saveRequest(r)
  db.advance('r1', 'downloading', { progress: 10 })
  db.advance('r1', 'downloading', { progress: 60 })
  db.advance('r1', 'failed', { detail: 'The download didn’t match its checksums.' })
  assert.equal(db.request('r1')!.state, 'failed')
  assert.equal(db.request('r1')!.progress, 60)
  assert.deepEqual(db.events('r1').map((e) => [e.state, e.text]), [['downloading', ''], ['failed', 'The download didn’t match its checksums.']])
  assert.equal(db.advance('nope', 'ready'), null)
  db.removeRequest('r1')
  assert.deepEqual([db.requests().length, db.events('r1').length], [0, 0])
})

// ---------- over HTTP ----------

let jf: Awaited<ReturnType<typeof fakeJellyfin>>
let F: Awaited<ReturnType<typeof finesse>>
let db: GameStoreDb
const servers: Server[] = []
const S = '/api/games/store'

before(async () => {
  jf = await fakeJellyfin('Home', [{ name: 'alex', token: 't-admin', admin: true }, { name: 'robin', token: 't-robin', admin: false }], 'service')
  F = await finesse('store', jf, 'service')
  servers.push(jf.server, F.app)
  // The same file the server opened: what a provider's sync would have written.
  db = new GameStoreDb(join(F.settings.paths.configDir, 'gamestore.db'))
  db.replaceProvider('test', GAMES.map((g) => ({ game: g, sources: g.id === 'wz2100' ? [source('wz-win', 'wz2100', { checksums: [{ file: 'setup.exe', algo: 'sha256', expected: 'ab'.repeat(32) }], version: '4.5.5' }), source('wz-linux', 'wz2100', { platform: 'linux', installer: 'linux' })] : [source(`${g.id}-win`, g.id)] })))
})
after(() => {
  for (const s of servers) s.close()
})

test('off by default: nothing to browse, and the app isn’t told there’s a store', async () => {
  assert.equal(((await call(F.url, 'GET', '/api/finesse')).data.features as Record<string, boolean>).gameStore, false)
  assert.equal((await call(F.url, 'GET', `${S}/home`)).status, 401)
  const off = await call(F.url, 'GET', `${S}/home`, 't-robin')
  assert.equal(off.status, 404)
  assert.match(off.data.error!, /isn’t turned on/)
  assert.equal((await call(F.url, 'PUT', `${S}/settings`, 't-robin', { enabled: true })).status, 403)
  assert.equal((await call(F.url, 'PUT', `${S}/settings`, 't-admin', { enabled: 'yes' })).status, 400)
})

test('turned on: the front page, search, filters and a game, with nothing about where it comes from', async () => {
  const on = await call(F.url, 'PUT', `${S}/settings`, 't-admin', { enabled: true })
  assert.deepEqual(on.data, { enabled: true, canInstall: false, games: 5 })
  assert.equal(((await call(F.url, 'GET', '/api/finesse')).data.features as Record<string, boolean>).gameStore, true)

  const h = await call(F.url, 'GET', `${S}/home`, 't-robin')
  assert.equal(h.status, 200)
  assert.equal((h.data.featured as unknown[]).length, 5)

  const found = await call(F.url, 'GET', `${S}/search?q=tux&sort=name&limit=1`, 't-robin')
  assert.deepEqual([(found.data.items as { id: string }[]).map((g) => g.id), found.data.total, found.data.nextOffset], [['supertux'], 2, 1])
  assert.equal((await call(F.url, 'GET', `${S}/search?sort=best`, 't-robin')).status, 400)
  assert.equal((await call(F.url, 'GET', `${S}/search?limit=-1`, 't-robin')).status, 400)

  const f = await call(F.url, 'GET', `${S}/facets?genres=strategy`, 't-robin')
  assert.deepEqual((f.data.platforms as { value: string; count: number }[]).map((p) => [p.value, p.count]), [['windows', 3], ['linux', 1]])

  const d = await call(F.url, 'GET', `${S}/games/wz2100`, 't-robin')
  assert.deepEqual(d.data.sources, [
    { id: 'wz-win', platform: 'windows', installer: 'inno', sizeBytes: 1000, version: '4.5.5', verified: true },
    { id: 'wz-linux', platform: 'linux', installer: 'linux', sizeBytes: 1000 },
  ])
  assert.deepEqual((d.data.similar as { id: string }[]).map((g) => g.id), ['0ad', 'wesnoth'])
  assert.equal((await call(F.url, 'GET', `${S}/games/nope`, 't-robin')).status, 404)

  for (const path of ['home', 'search', 'facets', 'games/wz2100', 'requests']) {
    const r = await call(F.url, 'GET', `${S}/${path}`, 't-robin')
    assert.equal(/magnet|btih|checksums|popularity/.test(r.text), false, path)
  }
})

test('requests: refused in plain words until the server can install; then one per game, changed only by whoever asked', async () => {
  assert.deepEqual((await call(F.url, 'GET', `${S}/requests`, 't-robin')).data, [])
  const none = await call(F.url, 'POST', `${S}/requests`, 't-robin', { gameId: 'wz2100', sourceId: 'wz-win' })
  assert.equal(none.status, 501)
  assert.match(none.data.error!, /can’t download and install games yet/)
  assert.equal((await call(F.url, 'POST', `${S}/requests`, 't-robin', { gameId: 'wz2100', sourceId: '0ad-win' })).status, 404, 'a download of another game')
  assert.equal((await call(F.url, 'POST', `${S}/requests`, 't-robin', { gameId: 'wz2100' })).status, 400)

  // A request the pipeline would have made (robin's).
  const robin = [...jf.users.values()].find((u) => u.Name === 'robin')!.Id.toLowerCase()
  const now = new Date().toISOString()
  db.saveRequest({ id: 'r1', gameId: 'wz2100', title: 'Warzone 2100', sourceId: 'wz-win', platform: 'windows', installer: 'inno', state: 'failed', detail: 'Didn’t work.', requestedBy: 'robin', userId: robin, installDir: '/games/wz2100', createdAt: now, updatedAt: now })
  const list = await call(F.url, 'GET', `${S}/requests`, 't-admin')
  assert.deepEqual(Object.keys((list.data as unknown as Record<string, unknown>[])[0]!).sort(), ['createdAt', 'detail', 'gameId', 'id', 'installer', 'platform', 'requestedBy', 'sourceId', 'state', 'title', 'updatedAt'])

  assert.equal((await call(F.url, 'POST', `${S}/requests/r1/retry`, 't-robin')).status, 501)
  assert.equal((await call(F.url, 'POST', `${S}/requests/r1/installer-done`, 't-robin')).status, 409)
  assert.equal((await call(F.url, 'GET', `${S}/requests/r1/screen`, 't-robin')).status, 501)
  assert.equal((await call(F.url, 'DELETE', `${S}/requests/nope`, 't-robin')).status, 404)

  db.saveRequest({ ...db.request('r1')!, userId: 'f'.repeat(32) })
  assert.equal((await call(F.url, 'POST', `${S}/requests/r1/retry`, 't-robin')).status, 403)
  assert.equal((await call(F.url, 'POST', `${S}/requests/r1/retry`, 't-admin')).status, 501, 'an administrator may')
})
