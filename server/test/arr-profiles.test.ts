// New requests use the download quality chosen in setup (src/lib/arrProfiles.ts): setup saves a
// profile name per app (qualityProfiles), /api/finesse hands it to the app, and the request picks
// that profile from the live app. When it's gone, the request stops with a message saying what to do.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickArrConfig, PROFILE_KEY, type ArrKindName, type ArrProfile } from '../../src/lib/arrProfiles.ts'
import { qualityProfiles } from '../src/setup/doc.ts'
import { fakeJellyfin, finesse } from './peers.ts'

// What a fresh Radarr/Sonarr (and Lidarr) ship with.
const VIDEO: ArrProfile[] = [
  { id: 1, name: 'Any' },
  { id: 2, name: 'SD' },
  { id: 3, name: 'HD-720p' },
  { id: 4, name: 'HD-1080p' },
  { id: 5, name: 'Ultra-HD' },
  { id: 6, name: 'HD - 720p/1080p' },
]
const MUSIC: ArrProfile[] = [
  { id: 1, name: 'Any' },
  { id: 2, name: 'Lossless' },
  { id: 3, name: 'Standard' },
]
const ROOTS = [{ path: '/data/media/movies' }]
const profilesOf = (kind: ArrKindName) => (kind === 'artist' ? MUSIC : VIDEO)

test('each setup preset is the profile every request entry point submits', () => {
  const want: Record<string, Record<ArrKindName, number>> = {
    '720p': { movie: 3, series: 3, artist: 3 },
    '1080p': { movie: 4, series: 4, artist: 3 },
    '4k': { movie: 5, series: 5, artist: 2 },
    any: { movie: 1, series: 1, artist: 1 },
  }
  for (const [preset, ids] of Object.entries(want)) {
    const saved = qualityProfiles(preset as '720p')
    for (const kind of ['movie', 'series', 'artist'] as const) {
      const pick = pickArrConfig(kind, profilesOf(kind), ROOTS, saved[PROFILE_KEY[kind]])
      assert.ok(pick.ok, `${preset} ${kind}`)
      assert.equal(pick.profile.id, ids[kind], `${preset} ${kind}`)
      assert.equal(pick.saved, true)
      assert.equal(pick.root.path, ROOTS[0]!.path)
    }
  }
})

test('the saved name matches whatever its case or spacing', () => {
  const pick = pickArrConfig('movie', [{ id: 9, name: 'ultra-hd' }], ROOTS, ' Ultra-HD ')
  assert.ok(pick.ok)
  assert.equal(pick.profile.id, 9)
})

test('a renamed or deleted profile stops the request with what to do, never another quality', () => {
  const left = VIDEO.filter((p) => p.name !== 'Ultra-HD')
  const pick = pickArrConfig('movie', left, ROOTS, 'Ultra-HD')
  assert.equal(pick.ok, false)
  if (!pick.ok) {
    assert.match(pick.problem, /Radarr no longer has the “Ultra-HD” quality chosen in setup/)
    assert.match(pick.problem, /Add it back in Radarr, or pick a quality again in setup/)
    // The request pages show 180 characters.
    assert.ok(pick.problem.length <= 180, pick.problem)
  }
  const music = pickArrConfig('artist', [{ id: 7, name: 'Lossless (custom)' }], ROOTS, 'Lossless')
  assert.equal(music.ok, false)
  if (!music.ok) assert.match(music.problem, /^Lidarr /)
})

test('nothing chosen in setup (someone’s own apps): the usual guess', () => {
  const movie = pickArrConfig('movie', VIDEO, ROOTS, undefined)
  assert.ok(movie.ok)
  assert.equal(movie.profile.name, 'HD-1080p')
  assert.equal(movie.saved, false)
  const music = pickArrConfig('artist', MUSIC, ROOTS, '')
  assert.ok(music.ok)
  assert.equal(music.profile.name, 'Lossless')
  const custom = pickArrConfig('series', [{ id: 12, name: 'Mine' }], ROOTS, null)
  assert.ok(custom.ok)
  assert.equal(custom.profile.id, 12)
})

test('no root folder or no profiles at all: say so', () => {
  const noRoot = pickArrConfig('series', VIDEO, [], 'HD-1080p')
  assert.equal(noRoot.ok, false)
  if (!noRoot.ok) assert.match(noRoot.problem, /Sonarr has no folder to download to yet/)
  const none = pickArrConfig('movie', [], ROOTS, undefined)
  assert.equal(none.ok, false)
  if (!none.ok) assert.match(none.problem, /Radarr has no quality profiles/)
})

test('/api/finesse hands the saved choice to the app (names only, nothing secret)', async () => {
  const jf = await fakeJellyfin('Home', [{ name: 'alex', token: 'a-admin', admin: true }], 'a-service')
  const f = await finesse('q', jf, 'a-service')
  try {
    f.settings.update((s) => {
      s.services.radarr = { url: 'http://radarr:7878', apiKey: 'radarr-secret-key' }
      s.requests = { profiles: qualityProfiles('4k') }
    })
    const r = await fetch(`${f.url}/api/finesse`)
    const text = await r.text()
    const info = JSON.parse(text) as { requests?: { profiles?: Record<string, string> } }
    assert.deepEqual(info.requests?.profiles, { radarr: 'Ultra-HD', sonarr: 'Ultra-HD', lidarr: 'Lossless' })
    assert.doesNotMatch(text, /radarr-secret-key/)
  } finally {
    for (const s of [f.app, jf.server]) {
      s.closeAllConnections()
      s.close()
    }
  }
})
