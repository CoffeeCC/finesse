// Smart collections: the rules (src/lib/smartRules.ts) and the routes that keep each person's
// own (server/src/smartCollections.ts), stored in lists.db.

import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { checkedHere, cleanName, cleanRules, describe, emptyRules, jellyfinQuery, matches, reasons, sortItems } from '../../src/lib/smartRules.ts'
import { openLists, LISTS_VERSION } from '../src/lists.ts'
import { tmp } from './helpers.ts'
import { call, fakeJellyfin, finesse } from './peers.ts'

const NOW = Date.parse('2026-10-31T12:00:00Z')
const day = (n: number) => new Date(NOW - n * 86400e3).toISOString()
const film = (o: Record<string, unknown> = {}) => ({ Type: 'Movie', Name: 'Sintel', ProductionYear: 2010, Genres: ['Animation', 'Fantasy'], RunTimeTicks: 15 * 6e8, DateCreated: day(3), UserData: { Played: false, PlaybackPositionTicks: 0 }, ...o })

test('rules are checked and tidied; fields a kind doesn’t have are dropped', () => {
  const r = cleanRules({ kind: 'Movie', genres: [' Comedy ', 'comedy|x', '', 'Comedy'], yearFrom: '1990', yearTo: 1999, maxMinutes: 100, watched: 'unwatched', sort: 'nope' })
  assert.deepEqual(r.genres, ['Comedy', 'comedyx'])
  assert.equal(r.yearFrom, 1990)
  assert.equal(r.sort, 'added')
  // Albums: no running time, no watched state.
  const a = cleanRules({ kind: 'MusicAlbum', maxMinutes: 40, sort: 'runtime' })
  assert.equal(a.maxMinutes, null)
  assert.equal(a.sort, 'added')
  assert.throws(() => cleanRules({ kind: 'MusicAlbum', watched: 'watched' }), /Albums can’t/)
  assert.throws(() => cleanRules({ kind: 'Series', watched: 'in-progress' }), /watched state/)
  assert.throws(() => cleanRules({ kind: 'Game' }), /movies, shows or albums/)
  assert.throws(() => cleanRules({ kind: 'Movie', yearFrom: 2000, yearTo: 1990 }), /comes after/)
  assert.throws(() => cleanRules({ kind: 'Movie', maxMinutes: 1.5 }), /whole number/)
  assert.throws(() => cleanRules({ kind: 'Movie', genres: Array.from({ length: 13 }, (_, i) => `g${i}`) }), /at most 12/)
  assert.throws(() => cleanRules(null), /what the collection holds/)
  assert.equal(cleanName('  Tonight\n  please '), 'Tonight please')
  assert.throws(() => cleanName('   '), /a name/)
})

test('a title matches when every rule holds, and says why', () => {
  const r = cleanRules({ kind: 'Movie', genres: ['fantasy'], yearFrom: 2000, maxMinutes: 100, addedWithinDays: 7, watched: 'unwatched' })
  assert.ok(matches(film(), r, NOW))
  assert.deepEqual(reasons(film(), r, NOW), ['Not watched yet', 'Fantasy', '2010', '15 min', 'Added 3 days ago'])
  assert.ok(!matches(film({ Type: 'Series' }), r, NOW), 'another kind')
  assert.ok(!matches(film({ Genres: ['Drama'] }), r, NOW), 'no genre in common')
  assert.ok(!matches(film({ ProductionYear: 1999 }), r, NOW), 'too old')
  assert.ok(!matches(film({ ProductionYear: undefined }), r, NOW), 'no year never matches a year rule')
  assert.ok(!matches(film({ RunTimeTicks: 120 * 6e8 }), r, NOW), 'too long')
  assert.ok(!matches(film({ RunTimeTicks: undefined }), r, NOW), 'no running time never matches a running-time rule')
  assert.ok(!matches(film({ DateCreated: day(8) }), r, NOW), 'added too long ago')
  assert.ok(!matches(film({ UserData: { Played: true } }), r, NOW), 'watched')
  // "Unwatched" keeps a film that's started; "in progress" wants one.
  assert.ok(matches(film({ UserData: { PlaybackPositionTicks: 5 } }), r, NOW))
  const started = cleanRules({ kind: 'Movie', watched: 'in-progress' })
  assert.ok(matches(film({ UserData: { PlaybackPositionTicks: 5 } }), started, NOW))
  assert.ok(!matches(film(), started, NOW))
  // A show is "not finished" until every episode is watched.
  const shows = cleanRules({ kind: 'Series', watched: 'unwatched' })
  assert.ok(matches({ Type: 'Series', UserData: { Played: false, UnplayedItemCount: 3 } }, shows, NOW))
  assert.ok(!matches({ Type: 'Series', UserData: { Played: true } }, shows, NOW))
  assert.equal(describe(r), 'Movies · fantasy · 2000 or later · 100 min or shorter · added in the last 7 days · not watched yet')
})

test('what Jellyfin is asked: kind, genres, years and watched state there; the rest checked here, fetched in the order that keeps them', () => {
  const q = jellyfinQuery(cleanRules({ kind: 'Movie', genres: ['Comedy', 'Drama'], yearFrom: 1990, yearTo: 1992, watched: 'unwatched', sort: 'title' }))
  assert.equal(q.includeItemTypes, 'Movie')
  assert.equal(q.genres, 'Comedy|Drama')
  assert.equal(q.years, '1990,1991,1992')
  assert.equal(q.filters, 'IsUnplayed')
  assert.equal(q.sortBy, 'SortName')
  assert.equal(jellyfinQuery(cleanRules({ kind: 'Movie', yearFrom: 1900 })).years, undefined, 'a wide span is checked here')
  assert.equal(jellyfinQuery(cleanRules({ kind: 'Movie', maxMinutes: 90, sort: 'title' })).sortBy, 'Runtime,SortName')
  assert.equal(jellyfinQuery(cleanRules({ kind: 'MusicAlbum', addedWithinDays: 30, sort: 'title' })).sortOrder, 'Descending')
  assert.equal(jellyfinQuery(cleanRules({ kind: 'Movie', watched: 'in-progress' })).filters, 'IsResumable')
  assert.ok(checkedHere(cleanRules({ kind: 'Movie', maxMinutes: 90 })))
  assert.ok(!checkedHere(emptyRules()))
  const sorted = sortItems([film({ Name: 'B', ProductionYear: 2001 }), film({ Name: 'A', ProductionYear: 2005 })], cleanRules({ kind: 'Movie', sort: 'title' }))
  assert.deepEqual(sorted.map((i) => i.Name), ['A', 'B'])
})

test('lists.db: steps run once, in order, on a new file and on one from before', () => {
  const file = join(tmp(), 'lists.db')
  const db = openLists(file)
  assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, LISTS_VERSION)
  db.prepare("INSERT INTO smart_collections VALUES ('x', 'o', 'n', '{}', 1, 1)").run()
  db.close()
  // Opening again keeps what's there.
  const again = openLists(file)
  assert.equal((again.prepare('SELECT COUNT(*) AS n FROM smart_collections').get() as { n: number }).n, 1)
  again.close()
  // A file made before versions existed (version 0, no tables) is brought up to date.
  const old = join(tmp(), 'lists.db')
  new DatabaseSync(old).close()
  assert.equal((openLists(old).prepare('PRAGMA user_version').get() as { user_version: number }).user_version, LISTS_VERSION)
})

let jf: Awaited<ReturnType<typeof fakeJellyfin>>
let A: Awaited<ReturnType<typeof finesse>>
const servers: Server[] = []
before(async () => {
  jf = await fakeJellyfin('Home', [{ name: 'alex', token: 'admin', admin: true }, { name: 'robin', token: 'robin', admin: false }, { name: 'kim', token: 'kim', admin: false }], 'service')
  A = await finesse('a', jf, 'service')
  servers.push(jf.server, A.app)
})
after(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

test('each person keeps their own: make, list, rename, change, remove', async () => {
  const made = await call(A.url, 'POST', '/api/smart-collections', 'robin', { name: 'Tonight', rules: { kind: 'Movie', maxMinutes: 100, watched: 'unwatched' } })
  assert.equal(made.status, 201, made.text)
  const id = String(made.data.id)
  assert.equal((made.data.rules as { maxMinutes: number }).maxMinutes, 100)
  assert.equal(((await call(A.url, 'GET', '/api/smart-collections', 'robin')).data.collections as unknown[]).length, 1)
  // Nobody else sees it, changes it or removes it (not even an administrator: they're private).
  assert.equal(((await call(A.url, 'GET', '/api/smart-collections', 'kim')).data.collections as unknown[]).length, 0)
  assert.equal((await call(A.url, 'PUT', `/api/smart-collections/${id}`, 'kim', { name: 'mine now' })).status, 404)
  assert.equal((await call(A.url, 'DELETE', `/api/smart-collections/${id}`, 'admin')).status, 404)
  const renamed = await call(A.url, 'PUT', `/api/smart-collections/${id}`, 'robin', { name: 'Short ones' })
  assert.equal(renamed.data.name, 'Short ones')
  assert.equal((renamed.data.rules as { maxMinutes: number }).maxMinutes, 100, 'rules kept')
  const changed = await call(A.url, 'PUT', `/api/smart-collections/${id}`, 'robin', { rules: { kind: 'Series', watched: 'unwatched' } })
  assert.equal((changed.data.rules as { kind: string }).kind, 'Series')
  assert.equal(changed.data.name, 'Short ones')
  assert.equal((await call(A.url, 'DELETE', `/api/smart-collections/${id}`, 'robin')).status, 200)
  assert.equal(((await call(A.url, 'GET', '/api/smart-collections', 'robin')).data.collections as unknown[]).length, 0)
})

test('bad rules are turned away with what to fix; only people, signed in', async () => {
  const bad = await call(A.url, 'POST', '/api/smart-collections', 'robin', { name: 'x', rules: { kind: 'MusicAlbum', watched: 'watched' } })
  assert.equal(bad.status, 400)
  assert.match(String(bad.data.error), /Albums can’t/)
  assert.equal((await call(A.url, 'POST', '/api/smart-collections', 'robin', { name: ' ', rules: { kind: 'Movie' } })).status, 400)
  assert.equal((await call(A.url, 'GET', '/api/smart-collections')).status, 401)
  assert.equal((await call(A.url, 'GET', '/api/smart-collections', 'service')).status, 403)
})
