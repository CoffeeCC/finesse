// Which copy of an in-game save the retro player starts from (src/lib/saveSync.ts): this
// browser's or the Finesse server's.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickSave, saveFingerprint } from '../../src/lib/saveSync.ts'

const A = { hash: 'a', at: 1000 }
const B = { hash: 'b', at: 2000 }

test('one side only: that one', () => {
  assert.equal(pickSave(null, null, null), 'none')
  // Saves from before Finesse kept them, or a server that lost its own: go up.
  assert.equal(pickSave(A, null, null), 'local')
  // A new device, or this browser's data was cleared: come down.
  assert.equal(pickSave(null, B, null), 'server')
})

test('the same save on both sides: nothing to do', () => {
  assert.equal(pickSave(A, { hash: 'a', at: 5 }, null), 'same')
})

test('the side that moved since the last sync wins', () => {
  // Played on another device: the server moved, this browser didn't.
  assert.equal(pickSave({ hash: 'a', at: 9999 }, { hash: 'b', at: 1 }, 'a'), 'server')
  // Played here while the server couldn't be reached.
  assert.equal(pickSave({ hash: 'b', at: 1 }, { hash: 'a', at: 9999 }, 'a'), 'local')
})

test('both moved, or never synced: the one written last', () => {
  assert.equal(pickSave(A, B, 'z'), 'server')
  assert.equal(pickSave(B, A, null), 'local')
})

test('fingerprints tell saves apart, and the same bytes always match', () => {
  const s = new Uint8Array(128 * 1024).fill(0xff)
  const t = s.slice()
  t[70000] = 0xfe
  assert.equal(saveFingerprint(s), saveFingerprint(s.slice()))
  assert.notEqual(saveFingerprint(s), saveFingerprint(t))
  assert.notEqual(saveFingerprint(new Uint8Array(8)), saveFingerprint(new Uint8Array(16)))
})
