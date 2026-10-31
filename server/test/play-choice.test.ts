// Play, Resume or Start over (src/lib/playChoice.ts): the item page, the Now stage and search
// all read it, so they offer the same choices with the same saved position.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clockTime, playChoice } from '../../src/lib/playChoice.ts'

const T = 10_000_000 // ticks per second

test('a position reads as a clock', () => {
  assert.equal(clockTime(0), '0:00')
  assert.equal(clockTime(9 * T), '0:09')
  assert.equal(clockTime((42 * 60 + 10) * T), '42:10')
  assert.equal(clockTime((3600 + 2 * 60 + 5) * T + 4_999_999), '1:02:05')
  assert.equal(clockTime(-5), '0:00')
})

test('never watched: just Play, from the start, no Start over', () => {
  const c = playChoice({ Id: 'm1' })
  assert.deepEqual(c, { resuming: false, at: '', href: '/play/m1', label: 'Play', startOver: null })
  assert.equal(playChoice({ Id: 'm1', UserData: { PlaybackPositionTicks: 0, Played: false } }).href, '/play/m1')
})

test('part-watched: Resume names the position, Start over is separate', () => {
  const pos = (42 * 60 + 10) * T
  const c = playChoice({ Id: 'm1', UserData: { PlaybackPositionTicks: pos, Played: false } })
  assert.equal(c.resuming, true)
  assert.equal(c.label, 'Resume from 42:10')
  assert.equal(c.at, '42:10')
  assert.equal(c.href, `/play/m1?t=${pos}`)
  assert.equal(c.startOver, '/play/m1')
})

test('finished: plays from the start even if an old position lingers', () => {
  const c = playChoice({ Id: 'e1', UserData: { PlaybackPositionTicks: 600 * T, Played: true } }, 'Play again')
  assert.equal(c.resuming, false)
  assert.equal(c.href, '/play/e1')
  assert.equal(c.label, 'Play again')
  assert.equal(c.startOver, null)
})
