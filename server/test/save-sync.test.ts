// What the retro player does with a game's save as it starts (src/lib/saveSync.ts): this
// browser's copy against the Finesse server's, by fingerprints only (no clocks).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planSync, precondition, refusal, saveFingerprint } from '../../src/lib/saveSync.ts'

test('one side only', () => {
  assert.equal(planSync(null, null, null), 'none')
  // A new device, or this browser's data was cleared: come down.
  assert.equal(planSync(null, 'b', null), 'server')
  assert.equal(planSync(null, 'b', 'a'), 'server')
  // Nothing on the server: goes up (and only into an empty slot: see precondition).
  assert.equal(planSync('a', null, null), 'upload')
})

test('the same save on both sides: nothing to do', () => {
  assert.equal(planSync('a', 'a', null), 'same')
})

test('the side that moved since the last sync wins, without asking a clock', () => {
  // Played on another device: the server moved, this browser didn't.
  assert.equal(planSync('a', 'b', 'a'), 'server')
  // Played here while the server couldn't be reached.
  assert.equal(planSync('b', 'a', 'a'), 'upload')
})

test('both moved, or never synced here: ask, never pick one silently', () => {
  assert.equal(planSync('a', 'b', 'z'), 'conflict')
  assert.equal(planSync('a', 'b', null), 'conflict')
})

test('uploads name the server copy they replace; none means "only if there isn’t one"', () => {
  assert.deepEqual(precondition('1-2-3'), { 'If-Match': '"1-2-3"' })
  assert.deepEqual(precondition(null), { 'If-None-Match': '*' })
})

test('a refused save is explained, not retried as if offline', () => {
  assert.match(refusal(401, 'Sign in first'), /sign-in.*stays on this device/i)
  assert.equal(refusal(413, 'That’s too big to send here (the most is 8 MB)'), 'That’s too big to send here (the most is 8 MB). It stays on this device.')
  assert.equal(refusal(400, undefined), 'Finesse wouldn’t take this save. It stays on this device.')
})

test('fingerprints tell saves apart, and the same bytes always match', () => {
  const s = new Uint8Array(128 * 1024).fill(0xff)
  const t = s.slice()
  t[70000] = 0xfe
  assert.equal(saveFingerprint(s), saveFingerprint(s.slice()))
  assert.notEqual(saveFingerprint(s), saveFingerprint(t))
  assert.notEqual(saveFingerprint(new Uint8Array(8)), saveFingerprint(new Uint8Array(16)))
})
