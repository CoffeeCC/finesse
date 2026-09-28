// The first movie on a new server: Jellyfin is asked to scan when files arrive
// in a library it still shows as empty, once per change, and never again after.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { folderSignature, LibraryNudger, type JellyfinLibrary } from '../src/stack/libraries.ts'
import { tmp } from './helpers.ts'

function setup(extra: Partial<{ mode: string; state: string }> = {}) {
  const data = tmp()
  for (const d of ['movies', 'tv', 'music']) mkdirSync(join(data, 'media', d), { recursive: true })
  const settings = {
    get: () => ({
      mode: extra.mode ?? 'bundle',
      setup: { state: extra.state ?? 'ready' },
      jellyfin: { url: 'http://jellyfin:8096', basePath: '/jellyfin', apiKey: 'k' },
      stack: { hostData: data, hostRoot: data, services: ['jellyfin'] },
    }),
  } as never
  const libs: (JellyfinLibrary & { count: number })[] = [
    { id: 'm', name: 'Movies', locations: ['/data/media/movies'], count: 0 },
    { id: 't', name: 'Shows', locations: ['/data/media/tv'], count: 0 },
    { id: 'x', name: 'Elsewhere', locations: ['/etc', '/data/media/../../etc'], count: 0 },
  ]
  const calls = { scans: 0, lists: 0, counts: 0, base: '' }
  const api = {
    list: async (base: string) => {
      calls.lists++
      calls.base = base
      return libs.map(({ count: _, ...l }) => l)
    },
    count: async (_b: string, _k: string, id: string) => {
      calls.counts++
      return libs.find((l) => l.id === id)!.count
    },
    scan: async () => void calls.scans++,
  }
  return { data, libs, calls, nudger: new LibraryNudger(settings, api) }
}

test('empty folders: nothing to do, and Jellyfin isn’t asked for counts', async () => {
  const f = setup()
  await f.nudger.tick()
  assert.equal(f.calls.scans, 0)
  assert.equal(f.calls.counts, 0)
  assert.equal(f.calls.base, 'http://jellyfin:8096/jellyfin')
})

test('the first movie arrives: one scan, and not again for the same files', async () => {
  const f = setup()
  mkdirSync(join(f.data, 'media/movies/Big Buck Bunny (2008)'))
  writeFileSync(join(f.data, 'media/movies/Big Buck Bunny (2008)/Big Buck Bunny (2008).mkv'), 'x')
  await f.nudger.tick()
  assert.equal(f.calls.scans, 1)
  await f.nudger.tick()
  assert.equal(f.calls.scans, 1, 'same files, no second scan')
  // Something else arrives while Jellyfin still shows nothing (say, only a sample): scan again.
  mkdirSync(join(f.data, 'media/movies/Sintel (2010)'))
  await f.nudger.tick()
  assert.equal(f.calls.scans, 2)
})

test('once Jellyfin has items in a library, it is left alone', async () => {
  const f = setup()
  f.libs[0]!.count = 1
  mkdirSync(join(f.data, 'media/movies/New (2024)'))
  await f.nudger.tick()
  assert.equal(f.calls.scans, 0)
  f.libs[0]!.count = 0 // even if it looked empty again later
  mkdirSync(join(f.data, 'media/movies/Newer (2025)'))
  const counted = f.calls.counts
  await f.nudger.tick()
  assert.equal(f.calls.scans, 0)
  assert.equal(f.calls.counts, counted, 'a filled library is never counted again')
})

test('hidden files don’t count, and only the media folder is ever read', async () => {
  const f = setup()
  writeFileSync(join(f.data, 'media/movies/.DS_Store'), 'x')
  await f.nudger.tick()
  assert.equal(f.calls.scans, 0)
  assert.equal(folderSignature(join(f.data, 'nope')), '')
})

test('not before setup is done, and not in adopt mode', async () => {
  for (const extra of [{ state: 'applying' }, { mode: 'adopt' }]) {
    const f = setup(extra)
    mkdirSync(join(f.data, 'media/tv/Some Show'))
    await f.nudger.tick()
    assert.equal(f.calls.lists, 0)
  }
})
