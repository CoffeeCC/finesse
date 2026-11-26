// Streaming game transfer (server/src/gamestore/transfer.ts): creates a signed 2-hour link and
// streams an installed or downloaded game folder as an uncompressed PAX/ustar tar over HTTP.

import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { readTar } from '../src/tar.ts'
import { GameTransferStore, safeTransferName, streamDirAsTar } from '../src/gamestore/transfer.ts'
import type { StoredRequest } from '../src/gamestore/db.ts'
import { listen, tmp } from './helpers.ts'

const servers: Server[] = []
after(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

function reqFixture(extra: Partial<StoredRequest> = {}): StoredRequest {
  return {
    id: 'req1',
    gameId: 'feed-game',
    title: 'Celeste: Deluxe / Edition',
    sourceId: 's1',
    platform: 'linux',
    installer: 'portable',
    state: 'ready',
    sizeBytes: 1000,
    requestedBy: 'Alex',
    userId: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  }
}

test('safeTransferName strips characters unsafe for Windows/Linux paths', () => {
  assert.equal(safeTransferName('Celeste: Deluxe / Edition?'), 'Celeste Deluxe Edition')
  assert.equal(safeTransferName('   ...   '), 'Game')
})

test('transfer streams installed folder as a valid tar (nested, long path, skips symlinks) and enforces expiry', async () => {
  const dir = tmp('finesse-transfer-')
  const outside = tmp('finesse-transfer-outside-')
  writeFileSync(join(outside, 'secret.txt'), 'nope')
  const longDir = join(dir, 'very-long-directory-segment-for-pax-testing', 'another-long-folder-name-exceeding-ustar', 'deep-assets-folder')
  mkdirSync(longDir, { recursive: true })
  writeFileSync(join(dir, 'game.sh'), '#!/bin/sh\necho hi\n')
  chmodSync(join(dir, 'game.sh'), 0o755)
  const longFile = join(longDir, 'extremely-long-asset-filename-that-must-use-pax-extended-header-to-survive.dat')
  writeFileSync(longFile, 'hello-game-data')
  symlinkSync(join(outside, 'secret.txt'), join(dir, 'escape.txt'))

  let now = 1_000_000
  const store = new GameTransferStore(() => now)

  // Request with no files on disk yet is refused cleanly.
  assert.throws(() => store.create(reqFixture()), /doesn’t have files on the server yet/)

  const ticket = store.create(reqFixture({ installDir: dir }))
  assert.equal(ticket.kind, 'installed')
  assert.equal(ticket.files, 2)
  assert.equal(ticket.folderName, 'Celeste Deluxe Edition')
  assert.equal(ticket.fileName, 'Celeste-Deluxe-Edition.tar')
  assert.ok(ticket.bytes > 0)

  const srv = createServer(async (req, res) => {
    const tok = new URL(req.url!, 'http://x').pathname.split('/').pop()
    const found = store.get(tok)
    if (!found) {
      res.statusCode = 404
      return res.end('expired')
    }
    await streamDirAsTar(found.dir, found.fileName, res)
  })
  servers.push(srv)
  const base = await listen(srv)

  const r = await fetch(`${base}${ticket.url}`)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'application/x-tar')
  assert.match(r.headers.get('content-disposition') ?? '', /Celeste-Deluxe-Edition\.tar/)
  const buf = Buffer.from(await r.arrayBuffer())
  const extracted = readTar(buf, { gzip: false })
  const byPath = new Map(extracted.map((f) => [f.path, f.data.toString('utf8')]))
  assert.equal(byPath.get('game.sh'), '#!/bin/sh\necho hi\n')
  assert.equal(
    byPath.get('very-long-directory-segment-for-pax-testing/another-long-folder-name-exceeding-ustar/deep-assets-folder/extremely-long-asset-filename-that-must-use-pax-extended-header-to-survive.dat'),
    'hello-game-data',
  )
  assert.equal(byPath.has('escape.txt'), false, 'symlinks outside the game folder are skipped')

  // Works for downloaded-only folder too (when installDir isn't set yet).
  const dlTicket = store.create(reqFixture({ state: 'failed', folder: dir }))
  assert.equal(dlTicket.kind, 'download')

  // Expires cleanly after TTL.
  now += 3 * 60 * 60 * 1000
  assert.equal(store.get(ticket.token), null)
  const expired = await fetch(`${base}${ticket.url}`)
  assert.equal(expired.status, 404)
})
