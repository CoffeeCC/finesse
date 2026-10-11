// Whole-app updates on Windows: the new build lands next to the running one,
// the service is told which to start (and which to go back to), and a bundle
// that's missing something is never switched to.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { RESTART_ON_NEW_VERSION, windowsAsset, windowsUpdater } from '../src/stack/winupdate.ts'
import { tmp } from './helpers.ts'

function fakeReleases(names: string[]) {
  return {
    latest: async () => ({ version: '3.0.1', notes: '', publishedAt: null, asset: null, assets: names.map((name) => ({ name, size: 3 })) }),
    download: async () => Buffer.from('zip'),
  }
}

const unpack = (files: string[]) => (_file: string, dest: string) => {
  for (const f of files) {
    mkdirSync(join(dest, f, '..'), { recursive: true })
    writeFileSync(join(dest, f), 'x')
  }
}

test('only offered when the release has a Windows build', async () => {
  assert.equal(await windowsUpdater(fakeReleases([windowsAsset('3.0.1')]), tmp(), async () => {}).plan('3.0.1'), '3.0.1')
  assert.equal(await windowsUpdater(fakeReleases(['finesse-web-3.0.1.tar.gz']), tmp(), async () => {}).plan('3.0.1'), null)
})

test('installs next to the running version, then restarts on it', async () => {
  const dir = tmp()
  writeFileSync(join(dir, 'current.txt'), '3.0.0')
  const exits: number[] = []
  const steps: string[] = []
  let backedUp = false
  const u = windowsUpdater(fakeReleases([windowsAsset('3.0.1')]), dir, async () => void (backedUp = true), {
    unzip: unpack(['node.exe', 'server/finesse-server.mjs', 'web/index.html']),
    exit: (c) => exits.push(c),
  })
  await u.run('3.0.1', (s) => steps.push(s))
  assert.ok(backedUp)
  assert.deepEqual(steps, ['backing up', 'downloading', 'installing', 'restarting'])
  assert.equal(readFileSync(join(dir, 'current.txt'), 'utf8'), '3.0.1')
  assert.equal(readFileSync(join(dir, 'previous.txt'), 'utf8'), '3.0.0')
  assert.ok(existsSync(join(dir, 'app', '3.0.1', 'node.exe')))
  await new Promise((r) => setTimeout(r, 1700))
  assert.deepEqual(exits, [RESTART_ON_NEW_VERSION])
})

test('a bundle missing a part is never switched to', async () => {
  const dir = tmp()
  writeFileSync(join(dir, 'current.txt'), '3.0.0')
  const u = windowsUpdater(fakeReleases([windowsAsset('3.0.1')]), dir, async () => {}, { unzip: unpack(['node.exe']), exit: () => assert.fail('must not restart') })
  await assert.rejects(u.run('3.0.1', () => {}), /missing/)
  assert.equal(readFileSync(join(dir, 'current.txt'), 'utf8'), '3.0.0')
  assert.equal(existsSync(join(dir, 'app', '3.0.1')), false)
})
