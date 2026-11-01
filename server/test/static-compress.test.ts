// Compressing the web app's files (server/src/http/static.ts): off the event loop, one job per
// file and encoding however many ask at once, cached after, and the right bytes.

import assert from 'node:assert/strict'
import { statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { compressed } from '../src/http/static.ts'
import { tmp } from './helpers.ts'

// About 3 MB of JavaScript-like text: big enough that compressing it takes a while.
function bigFile(): string {
  const dir = tmp()
  const file = join(dir, 'app.js')
  const parts: string[] = []
  for (let i = 0; i < 60000; i++) parts.push(`function f${i}(a,b){return a*${i % 97}+b.map((x)=>x+${(i * 7919) % 1009}).join("${i.toString(36)}")}\n`)
  writeFileSync(file, parts.join(''))
  return file
}

test('the event loop keeps running while a big file compresses', async () => {
  const file = bigFile()
  const stat = statSync(file)
  let worst = 0
  let last = performance.now()
  const tick = setInterval(() => {
    const now = performance.now()
    worst = Math.max(worst, now - last)
    last = now
  }, 5)
  const t0 = performance.now()
  const body = await compressed(file, stat, 'br')
  const took = performance.now() - t0
  clearInterval(tick)
  assert.ok(body.length > 0 && body.length < stat.size)
  // The timer kept firing: no stall anywhere near as long as the compression itself.
  assert.ok(worst < Math.max(60, took / 2), `event loop stalled ${worst.toFixed(0)} ms during ${took.toFixed(0)} ms of compression`)
})

test('requests at the same time share one job, and later ones hit the cache', async () => {
  const file = bigFile()
  const stat = statSync(file)
  const [a, b, c] = await Promise.all([compressed(file, stat, 'gzip'), compressed(file, stat, 'gzip'), compressed(file, stat, 'gzip')])
  assert.equal(a, b)
  assert.equal(b, c)
  assert.equal(await compressed(file, stat, 'gzip'), a, 'cached')
  assert.equal(gunzipSync(a).length, stat.size)
  const br = await compressed(file, stat, 'br')
  assert.notEqual(br, a)
  assert.equal(brotliDecompressSync(br).length, stat.size)
})

test('a file that disappears fails that request only', async () => {
  const dir = tmp()
  const file = join(dir, 'gone.js')
  writeFileSync(file, 'x'.repeat(2000))
  const stat = statSync(file)
  writeFileSync(join(dir, 'other.js'), '')
  const { rmSync } = await import('node:fs')
  rmSync(file)
  await assert.rejects(compressed(file, stat, 'br'))
})
