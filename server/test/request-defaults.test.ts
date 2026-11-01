// Settings → Downloads (server/src/requestDefaults.ts): the quality profile and folder new
// requests use, chosen by the app's own ids and checked against the live app, alongside
// setup's quality. A fake Radarr stands in; nothing here talks to a real one.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { after, before, test } from 'node:test'
import { pickArrConfig } from '../../src/lib/arrProfiles.ts'
import type { Settings } from '../src/config.ts'
import { keepDefaultsAfterSetup, requestConfig, validateDefault } from '../src/requestDefaults.ts'
import { listen } from './helpers.ts'
import { call, fakeJellyfin, finesse } from './peers.ts'

let radarr: { url: string; server: Server; profiles: { id: number; name: string }[]; roots: { path: string }[]; keys: string[] }
let jf: Awaited<ReturnType<typeof fakeJellyfin>>
let F: Awaited<ReturnType<typeof finesse>>

before(async () => {
  const state = { profiles: [{ id: 4, name: 'HD-1080p' }, { id: 5, name: 'Ultra-HD' }, { id: 9, name: 'My 4K' }], roots: [{ path: '/data/media/movies' }, { path: '/data/media/kids' }], keys: [] as string[] }
  const server = createServer((req, res) => {
    state.keys.push(String(req.headers['x-api-key'] ?? ''))
    const body = req.url === '/api/v3/qualityprofile' ? state.profiles : req.url === '/api/v3/rootfolder' ? state.roots : null
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body ?? {}))
  })
  radarr = Object.assign(state, { url: await listen(server), server })
  jf = await fakeJellyfin('Home', [{ name: 'alex', token: 'a-admin', admin: true }, { name: 'robin', token: 'a-robin', admin: false }], 'a-service')
  F = await finesse('rd', jf, 'a-service')
  F.settings.update((s) => {
    s.services.radarr = { url: radarr.url, apiKey: 'radarr-secret-key' }
    s.requests = { profiles: { radarr: 'HD-1080p', sonarr: 'HD-1080p', lidarr: 'Standard' } }
  })
})
after(() => {
  for (const s of [F.app, jf.server, radarr.server]) {
    s.closeAllConnections()
    s.close()
  }
})

test('before anything is chosen here, requests use setup’s quality', async () => {
  const r = await call(F.url, 'GET', '/api/requests/defaults', 'a-robin')
  assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.data.apps, [{ app: 'radarr', profileName: 'HD-1080p', source: 'setup' }])
  assert.equal((await call(F.url, 'GET', '/api/requests/defaults')).status, 401)
})

test('an administrator picks a profile and folder; it’s checked against Radarr and saved by id', async () => {
  assert.equal((await call(F.url, 'PUT', '/api/requests/defaults', 'a-robin', { app: 'radarr', profileId: 9 })).status, 403)
  const bad = await call(F.url, 'PUT', '/api/requests/defaults', 'a-admin', { app: 'radarr', profileId: 77 })
  assert.equal(bad.status, 400)
  assert.match(String(bad.data.error), /doesn’t have that quality profile any more/)
  const badRoot = await call(F.url, 'PUT', '/api/requests/defaults', 'a-admin', { app: 'radarr', profileId: 9, rootFolder: '/elsewhere' })
  assert.equal(badRoot.status, 400)
  assert.match(String(badRoot.data.error), /doesn’t have the folder “\/elsewhere”/)
  assert.equal((await call(F.url, 'PUT', '/api/requests/defaults', 'a-admin', { app: 'nzbget', profileId: 9 })).status, 400)

  const ok = await call(F.url, 'PUT', '/api/requests/defaults', 'a-admin', { app: 'radarr', profileId: 9, rootFolder: '/data/media/kids/' })
  assert.equal(ok.status, 200, ok.text)
  assert.deepEqual(ok.data.apps, [{ app: 'radarr', profileId: 9, profileName: 'My 4K', rootFolder: '/data/media/kids', source: 'settings' }])
  assert.doesNotMatch(ok.text, /radarr-secret-key/)
  // Finesse asked Radarr with Radarr's key (server side).
  assert.ok(radarr.keys.every((k) => k === 'radarr-secret-key'))
  // What a request then submits.
  const pick = pickArrConfig('movie', radarr.profiles, radarr.roots, (ok.data.apps as never[])[0])
  assert.ok(pick.ok)
  assert.equal(pick.profile.id, 9)
  assert.equal(pick.root.path, '/data/media/kids')
})

test('renamed: still the same profile (by id); deleted: the request stops and says where to fix it', () => {
  const saved = requestConfig(F.settings.get())[0]!
  const renamed = pickArrConfig('movie', [{ id: 9, name: 'Big screen' }], radarr.roots, saved)
  assert.ok(renamed.ok && renamed.profile.id === 9)
  const gone = pickArrConfig('movie', [{ id: 4, name: 'HD-1080p' }], radarr.roots, saved)
  assert.equal(gone.ok, false)
  if (!gone.ok) assert.match(gone.problem, /Radarr no longer has the “My 4K” quality chosen in Settings → Downloads/)
  const folderGone = pickArrConfig('movie', radarr.profiles, [{ path: '/data/media/movies' }], saved)
  assert.equal(folderGone.ok, false)
  if (!folderGone.ok) assert.match(folderGone.problem, /no longer has the folder chosen in Settings → Downloads/)
})

test('a different Radarr at a new address: the old choice is stale and requests say so', () => {
  const s = structuredClone(F.settings.get()) as Settings
  s.services.radarr = { url: 'http://radarr-new:7878', apiKey: 'k' }
  const [out] = requestConfig(s)
  assert.deepEqual(out, { app: 'radarr', profileName: 'HD-1080p', source: 'setup', stale: true })
  const pick = pickArrConfig('movie', radarr.profiles, radarr.roots, out)
  assert.equal(pick.ok, false)
  if (!pick.ok) assert.match(pick.problem, /Radarr has changed since its quality was chosen/)
})

test('re-running setup keeps choices for apps whose quality didn’t change, and drops the rest', () => {
  const before = F.settings.get().requests!
  assert.deepEqual(keepDefaultsAfterSetup(before, { radarr: 'HD-1080p', sonarr: 'HD-1080p', lidarr: 'Standard' }).defaults?.radarr?.profileId, 9)
  assert.equal(keepDefaultsAfterSetup(before, { radarr: 'Ultra-HD', sonarr: 'Ultra-HD', lidarr: 'Lossless' }).defaults, undefined)
})

test('going back to setup’s quality', async () => {
  const r = await call(F.url, 'PUT', '/api/requests/defaults', 'a-admin', { app: 'radarr', profileId: null })
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.apps, [{ app: 'radarr', profileName: 'HD-1080p', source: 'setup' }])
})

test('Radarr not answering: a message saying what to do, nothing saved', async () => {
  await assert.rejects(
    validateDefault('radarr', { url: 'http://x', apiKey: 'k' }, { profileId: 4 }, async () => {
      throw new Error('ECONNREFUSED')
    }),
    /Couldn’t reach Radarr to check that choice. Make sure it’s running/,
  )
  await assert.rejects(validateDefault('radarr', undefined, { profileId: 4 }), /Radarr isn’t set up/)
  await assert.rejects(validateDefault('radarr', { url: 'http://x' }, { profileId: 'x' }), /Pick a quality profile/)
})
