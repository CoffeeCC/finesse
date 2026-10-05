// Add media: resumable uploads into the library folders.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import type { SettingsStore } from '../src/config.ts'
import { cleanPath, sameFolder, Uploads } from '../src/uploads.ts'
import { tmp } from './helpers.ts'

function setup(extra: Record<string, unknown> = {}) {
  const data = tmp('finesse-uploads-')
  const scans: string[] = []
  const s = { mode: 'bundle', setup: { state: 'ready' }, stack: { hostData: data, puid: 1000, pgid: 1000 }, services: {}, jellyfin: { url: 'http://jf', apiKey: 'k' }, ...extra }
  const settings = { get: () => s } as unknown as SettingsStore
  const api = { list: async () => [], count: async () => 0, scan: async (base: string) => void scans.push(base) }
  return { data, scans, up: new Uploads(settings, api) }
}
const chunk = (b: Buffer) => Readable.from([b])

test('paths are cleaned: no climbing out, no hidden parts, no characters shares refuse', () => {
  assert.equal(cleanPath('Show/Season 1/ep.mkv'), 'Show/Season 1/ep.mkv')
  assert.equal(cleanPath('a\\b\\c.mkv'), 'a/b/c.mkv')
  assert.equal(cleanPath('What? Film: "Cut".mkv'), 'What Film Cut.mkv')
  assert.equal(cleanPath('../../etc/passwd'), null)
  assert.equal(cleanPath('ok/.hidden/x'), null)
  assert.equal(cleanPath('/'), null)
  assert.equal(cleanPath(42), null)
})

test('a file arrives in chunks, lands in its library, and Jellyfin is asked to scan', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { data, scans, up } = setup()
  const bytes = Buffer.from('0123456789abcdefghij')
  const b = up.begin({ kind: 'movies', path: 'Big Buck Bunny (2008)/Big Buck Bunny.mkv', size: bytes.length })
  assert.equal(b.offset, 0)
  assert.equal(b.done, false)
  const r1 = await up.write(b.id!, 0, 8, chunk(bytes.subarray(0, 8)))
  assert.deepEqual([r1.offset, r1.done], [8, false])
  // Coming back later (page reloaded): the same file finds its place.
  assert.equal(up.begin({ kind: 'movies', path: 'Big Buck Bunny (2008)/Big Buck Bunny.mkv', size: bytes.length }).offset, 8)
  // A chunk out of step says where to carry on.
  await assert.rejects(up.write(b.id!, 0, 8, chunk(bytes.subarray(0, 8))), (e: { status: number; details: { offset: number } }) => e.status === 409 && e.details.offset === 8)
  const r2 = await up.write(b.id!, 8, 12, chunk(bytes.subarray(8)))
  assert.deepEqual([r2.offset, r2.done, r2.path], [20, true, 'Big Buck Bunny (2008)/Big Buck Bunny.mkv'])
  assert.equal(readFileSync(join(data, 'media/movies/Big Buck Bunny (2008)/Big Buck Bunny.mkv'), 'utf8'), bytes.toString())
  assert.deepEqual(readdirSync(join(data, 'media/.finesse-uploads')), [])
  t.mock.timers.tick(8000)
  assert.deepEqual(scans, ['http://jf'])
})

test('the same file again is skipped; a different one with that name gets " (2)"', async () => {
  const { data, up } = setup()
  mkdirSync(join(data, 'media/music/Artist'), { recursive: true })
  writeFileSync(join(data, 'media/music/Artist/song.flac'), 'abc')
  assert.equal(up.begin({ kind: 'music', path: 'Artist/song.flac', size: 3 }).skipped, true)
  const b = up.begin({ kind: 'music', path: 'Artist/song.flac', size: 5 })
  const r = await up.write(b.id!, 0, 5, chunk(Buffer.from('hello')))
  assert.equal(r.path, 'Artist/song (2).flac')
  assert.ok(existsSync(join(data, 'media/music/Artist/song (2).flac')))
})

test('chunks must say their size truthfully and fit the file', async () => {
  const { up } = setup()
  const b = up.begin({ kind: 'tv', path: 'Show/S01E01.mkv', size: 4 })
  await assert.rejects(up.write(b.id!, 0, 9, chunk(Buffer.from('123456789'))), /more than the file/)
  await assert.rejects(up.write(b.id!, 0, 2, chunk(Buffer.from('1234'))), /bigger than it said/)
})

test('games need a console folder and Games switched on; cancelling forgets the upload', () => {
  const off = setup()
  assert.throws(() => off.up.begin({ kind: 'games', path: 'snes/game.sfc', size: 1 }), /Games isn’t switched on/)
  const on = setup({ services: { romm: { url: 'http://romm' } } })
  assert.throws(() => on.up.begin({ kind: 'games', path: 'game.sfc', size: 1 }), /which console/)
  const b = on.up.begin({ kind: 'games', path: 'snes/game.sfc', size: 1 })
  on.up.cancel(b.id!)
  assert.deepEqual(readdirSync(join(on.data, 'media/.finesse-uploads')), [])
})

test('only on servers Finesse set up', () => {
  const { up } = setup({ mode: 'adopt' })
  assert.equal(up.info().available, false)
  assert.throws(() => up.begin({ kind: 'movies', path: 'a.mkv', size: 1 }), /servers Finesse set up/)
})

test('a show, artist or movie already on disk keeps its folder, whatever the drop called it', () => {
  const { data } = setup()
  const tv = join(data, 'media/tv')
  mkdirSync(join(tv, 'Pioneer One (2010)'), { recursive: true })
  mkdirSync(join(tv, 'The Office (US)'), { recursive: true })
  assert.equal(sameFolder(tv, 'Pioneer One/Season 1/e.mkv'), 'Pioneer One (2010)/Season 1/e.mkv')
  assert.equal(sameFolder(tv, 'the office us/Season 2/e.mkv'), 'The Office (US)/Season 2/e.mkv')
  assert.equal(sameFolder(tv, 'Brand New Show/Season 1/e.mkv'), 'Brand New Show/Season 1/e.mkv')
  const movies = join(data, 'media/movies')
  mkdirSync(join(movies, 'Heat (1995)'), { recursive: true })
  assert.equal(sameFolder(movies, 'Heat/Heat.mkv'), 'Heat (1995)/Heat.mkv')
  assert.equal(sameFolder(movies, 'Heat (2023)/Heat.mkv'), 'Heat (2023)/Heat.mkv')
})
