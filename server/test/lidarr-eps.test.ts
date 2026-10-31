// Music requests include EPs (server/src/stack/wire.ts): Lidarr's Standard metadata profile
// only follows albums, so an artist with just an EP (Zombie EP) had nothing to download.
// Finesse adds an "Albums & EPs" profile once, on servers it sets up; requests prefer it.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EP_PROFILE, epProfileFrom, wireLidarrMetadata } from '../src/stack/wire.ts'

// Lidarr's own Standard profile (trimmed).
const standard = {
  id: 1,
  name: 'Standard',
  primaryAlbumTypes: [
    { albumType: { id: 0, name: 'Album' }, allowed: true },
    { albumType: { id: 1, name: 'EP' }, allowed: false },
    { albumType: { id: 2, name: 'Single' }, allowed: false },
    { albumType: { id: 3, name: 'Broadcast' }, allowed: false },
  ],
  secondaryAlbumTypes: [{ albumType: { id: 0, name: 'Studio' }, allowed: true }],
  releaseStatuses: [{ releaseStatus: { id: 0, name: 'Official' }, allowed: true }],
}

test('Albums & EPs is Standard with EPs allowed (singles and the rest unchanged)', () => {
  const p = epProfileFrom(standard)
  assert.equal(p.name, EP_PROFILE)
  assert.equal(p.id, undefined)
  assert.deepEqual(
    p.primaryAlbumTypes!.map((t) => [t.albumType!.name, t.allowed]),
    [['Album', true], ['EP', true], ['Single', false], ['Broadcast', false]],
  )
  assert.deepEqual(p.secondaryAlbumTypes, standard.secondaryAlbumTypes)
  assert.equal(standard.primaryAlbumTypes[1]!.allowed, false, 'Standard itself is left alone')
})

test('added once: running setup again changes nothing, and an edited copy is kept', async () => {
  const profiles: Record<string, unknown>[] = [structuredClone(standard), { id: 2, name: 'None', primaryAlbumTypes: [] }]
  const calls: string[] = []
  const arr = {
    req: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      calls.push(`${method} ${path}`)
      if (method === 'GET' && path === '/metadataprofile') return structuredClone(profiles) as T
      if (method === 'POST' && path === '/metadataprofile') {
        const made = { ...(body as object), id: 3 }
        profiles.push(made)
        return made as T
      }
      throw new Error(`unexpected ${method} ${path}`)
    },
  }
  assert.equal(await wireLidarrMetadata(arr), 3)
  assert.equal(await wireLidarrMetadata(arr), 3)
  assert.deepEqual(calls, ['GET /metadataprofile', 'POST /metadataprofile', 'GET /metadataprofile'])
  // A Lidarr without EP types (very old) gets nothing new.
  const old = { req: async <T>() => [{ id: 1, name: 'Standard', primaryAlbumTypes: [{ albumType: { name: 'Album' }, allowed: true }] }] as T }
  assert.equal(await wireLidarrMetadata(old), undefined)
})
