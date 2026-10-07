// Setup's samples: the Lo-Finessa album lands in Music, without touching someone's own folders.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { addSamples, samplesDir } from '../src/stack/samples.ts'
import { tmp } from './helpers.ts'

test('the repository carries the album and its licence', () => {
  const dir = samplesDir()
  assert.ok(dir)
  const album = join(dir!, 'music', 'Nessa', 'Lo-Finessa')
  assert.deepEqual(readdirSync(album).filter((n) => n.endsWith('.mp3')).length, 4)
  assert.ok(existsSync(join(album, 'cover.jpg')))
  assert.ok(existsSync(join(dir!, 'LICENSE.md')))
})

test('copied into Music when it is on; an artist folder someone already has is left alone', () => {
  const data = tmp('finesse-samples-')
  assert.deepEqual(addSamples(data, { music: false }, { uid: 1000, gid: 1000 }), [])
  assert.deepEqual(addSamples(data, { music: true }, { uid: 1000, gid: 1000 }), ['music/Nessa'])
  assert.equal(readdirSync(join(data, 'media/music/Nessa/Lo-Finessa')).filter((n) => n.endsWith('.mp3')).length, 4)
  const mine = tmp('finesse-samples-')
  mkdirSync(join(mine, 'media/music/Nessa'), { recursive: true })
  writeFileSync(join(mine, 'media/music/Nessa/mine.flac'), 'x')
  assert.deepEqual(addSamples(mine, { music: true }, { uid: 1000, gid: 1000 }), [])
  assert.deepEqual(readdirSync(join(mine, 'media/music/Nessa')), ['mine.flac'])
})
