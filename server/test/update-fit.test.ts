// Web-only updates (a server that can't update itself): never past the server's own x.y, and the
// status says when the server is behind, and whether it's a local build that can't swap itself.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { webFits, WebUpdater, type GitHubReleases } from '../src/update.ts'
import type { WebRoot } from '../src/http/static.ts'

test('a web build fits a server of the same or newer x.y; a dev server takes any', () => {
  assert.equal(webFits('2.5.17', '2.5.16'), true)
  assert.equal(webFits('2.5.3', '2.5.16'), true)
  assert.equal(webFits('2.6.0', '2.5.16'), false)
  assert.equal(webFits('3.2.0', '2.5.16'), false)
  assert.equal(webFits('9.9.9', '0.0.0-dev'), true)
})

function updater(server: string, web: string, latest: string) {
  const gh = { latest: async () => ({ version: latest, notes: '', publishedAt: null, asset: { name: `finesse-web-${latest}.tar.gz`, version: latest, size: 1 }, assets: [] }) } as unknown as GitHubReleases
  const root = { current: () => ({ version: web }) } as unknown as WebRoot
  return new WebUpdater(root, gh, server)
}

test('a 2.5.16 server is told it’s behind, and isn’t offered 3.2.0 screens', async () => {
  const before = process.env.FINESSE_IN_DOCKER
  process.env.FINESSE_IN_DOCKER = '1'
  try {
    const s = await updater('2.5.16', '2.5.16', '3.2.0').status()
    assert.equal(s.kind, 'web')
    assert.equal(s.available, false)
    assert.equal(s.serverBehind, true)
    assert.equal(s.stuck, true)
    // Screens already ahead of the server (installed before this check existed): still behind.
    assert.equal((await updater('2.5.16', '3.2.0', '3.2.0').status()).serverBehind, true)
    // A patch for the same x.y is fine.
    const ok = await updater('3.2.0', '3.2.0', '3.2.1').status()
    assert.equal(ok.available, true)
    assert.equal(ok.serverBehind, false)
  } finally {
    if (before === undefined) delete process.env.FINESSE_IN_DOCKER
    else process.env.FINESSE_IN_DOCKER = before
  }
})
