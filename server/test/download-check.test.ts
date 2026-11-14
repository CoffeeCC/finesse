// Checking a game download against its checksum lists (downloadCheck.ts).

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { describeChecks, parseChecksumList, verifyDownload } from '../src/downloadCheck.ts'

const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

test('reads md5sum-style and BSD-style lists, skipping comments', () => {
  const h = md5('x')
  const list = `﻿; made by a checksum tool\r\n# another comment\r\n${h} *setup-1.bin\r\n${h}  data\\part 2.bin\r\nMD5 (setup.exe) = ${h.toUpperCase()}\r\nnot a line\r\n`
  assert.deepEqual(parseChecksumList(list), [
    { file: 'setup-1.bin', algo: 'md5', expected: h },
    { file: 'data/part 2.bin', algo: 'md5', expected: h },
    { file: 'setup.exe', algo: 'md5', expected: h },
  ])
  assert.equal(parseChecksumList(`${sha256('x')}  a.exe`)[0]!.algo, 'sha256')
  assert.equal(parseChecksumList(`${'a'.repeat(40)}  a.exe`)[0]!.algo, 'sha1')
})

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dl-'))
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), body)
  }
  return dir
}

test('checks files beside the list, and from a list in a subfolder', async () => {
  const dir = folder({
    'setup.exe': 'program',
    'setup-1.bin': 'one',
    'setup-2.bin': 'two (damaged)',
    'MD5/checksums.md5': `${md5('one')} *setup-1.bin\n${md5('two')} *setup-2.bin\n${md5('three')} *setup-3.bin\n`,
    'setup.exe.sha256': `${sha256('program')}  setup.exe\n`,
  })
  try {
    const checks = await verifyDownload(dir)
    const by = Object.fromEntries(checks.map((c) => [c.file, c.result]))
    assert.deepEqual(by, { 'setup-1.bin': 'ok', 'setup-2.bin': 'mismatch', 'setup-3.bin': 'missing', 'setup.exe': 'ok' })
    assert.equal(checks.find((c) => c.file === 'setup-1.bin')!.source, 'MD5/checksums.md5')
    const d = describeChecks(checks)
    assert.equal(d.ok, false)
    assert.match(d.text, /setup-2\.bin doesn’t match its checksum \(and 1 more\)/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('only a store checksum makes a download genuine', async () => {
  const dir = folder({ 'game.exe': 'g', 'game.exe.md5': `${md5('g')}  game.exe\n` })
  try {
    assert.deepEqual(describeChecks(await verifyDownload(dir)), { ok: true, genuine: false, text: 'Its checksum matches.' })
    const withStore = await verifyDownload(dir, { store: [{ file: 'game.exe', algo: 'sha256', expected: sha256('g') }] })
    assert.equal(describeChecks(withStore).genuine, true)
    assert.match(describeChecks(withStore).text, /including the store’s/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a list can’t point outside the download', async () => {
  const outside = folder({ 'secret.txt': 's' })
  const dir = folder({ 'x.md5': `${md5('s')}  ../${outside.split('/').pop()}/secret.txt\n` })
  try {
    const [c] = await verifyDownload(dir)
    assert.equal(c!.result, 'missing')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('nothing to check says so', () => {
  assert.equal(describeChecks([]).ok, true)
  assert.match(describeChecks([]).text, /No checksums came with this download/)
})
