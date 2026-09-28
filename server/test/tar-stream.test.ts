// Streaming .tar.gz for backups: what goes in comes out byte for byte, big files
// never need to fit in memory, and the result is a normal archive other tools read.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { readTar, readTarGz, writeTarGz } from '../src/tar.ts'
import { tmp } from './helpers.ts'

test('round trip: buffers, files on disk and long paths', async () => {
  const dir = tmp()
  const big = randomBytes(3 * 1024 * 1024 + 123)
  writeFileSync(join(dir, 'big.bin'), big)
  const long = `games/assets/${'saves/'.repeat(12)}Tobu Tobu Girl.srm`
  const out = join(dir, 'b.tar.gz')
  await writeTarGz(out, [
    { path: 'manifest.json', data: Buffer.from('{"ok":true}') },
    { path: 'db/sonarr/sonarr.db', file: join(dir, 'big.bin') },
    { path: long, data: Buffer.from('save data') },
    { path: 'empty.txt', data: Buffer.alloc(0) },
  ])
  const got = new Map<string, Buffer>()
  await readTarGz(out, async (path, size, body) => {
    const chunks: Buffer[] = []
    for await (const c of body) chunks.push(Buffer.from(c))
    const data = Buffer.concat(chunks)
    assert.equal(data.length, size)
    got.set(path, data)
  })
  assert.deepEqual([...got.keys()], ['manifest.json', 'db/sonarr/sonarr.db', long, 'empty.txt'])
  assert.ok(got.get('db/sonarr/sonarr.db')!.equals(big))
  assert.equal(got.get(long)!.toString(), 'save data')
  // The in-memory reader and GNU tar agree.
  assert.equal(readTar(readFileSync(out)).length, 4)
  assert.match(execFileSync('tar', ['-tzf', out]).toString(), /db\/sonarr\/sonarr\.db/)
})

test('a reader may skip entries it doesn’t want', async () => {
  const dir = tmp()
  const out = join(dir, 'b.tar.gz')
  await writeTarGz(out, [
    { path: 'a', data: randomBytes(70000) },
    { path: 'b', data: Buffer.from('keep me') },
  ])
  const seen: string[] = []
  await readTarGz(out, async (path, _size, body) => {
    if (path === 'a') return // not read at all
    const chunks: Buffer[] = []
    for await (const c of body) chunks.push(Buffer.from(c))
    seen.push(`${path}=${Buffer.concat(chunks).toString()}`)
  })
  assert.deepEqual(seen, ['b=keep me'])
})

test('unsafe paths and garbage are refused', async () => {
  const dir = tmp()
  const bad = join(dir, 'bad.tar.gz')
  // Hand-made archive with "../evil".
  execFileSync('sh', ['-c', `cd ${dir} && mkdir -p x && echo hi > x/f && tar --transform='s,x/f,../evil,' -P -czf bad.tar.gz x/f`])
  await assert.rejects(readTarGz(bad, async () => {}), /unsafe path/)
  writeFileSync(join(dir, 'junk.tar.gz'), 'not a backup')
  await assert.rejects(readTarGz(join(dir, 'junk.tar.gz'), async () => {}))
})
