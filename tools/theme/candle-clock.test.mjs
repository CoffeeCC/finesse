import test from 'node:test'
import assert from 'node:assert/strict'
import { freshCandle, stepCandle, wakeCandle, CANDLE_BURN_MS } from '../../src/lib/candleClock.ts'

test('burnout waits for idle and playback/dialog eligibility', () => {
  let state = { ...freshCandle(), burned: CANDLE_BURN_MS - 100 }
  state = stepCandle(state, 1000, false)
  assert.equal(state.phase, 'burning')
  assert.equal(state.burned, CANDLE_BURN_MS)
  state = stepCandle(state, 250, true)
  assert.equal(state.phase, 'guttering')
  assert.equal(stepCandle(state, 250, false).phase, 'burning')
})
test('hidden or suspended time cannot fast-forward the candle', () => {
  assert.equal(stepCandle(freshCandle(), 45 * 60_000, false).burned, 1000)
  assert.equal(stepCandle(freshCandle(), -100, false).burned, 0)
})
test('gutter completes before moonlight and waking starts a fresh relight', () => {
  let state = { ...freshCandle(), burned: CANDLE_BURN_MS, phase: 'guttering' }
  for (let i = 0; i < 5; i++) state = stepCandle(state, 1000, true)
  assert.equal(state.phase, 'guttering')
  state = stepCandle(state, 1000, true)
  assert.equal(state.phase, 'moonlight')
  assert.equal(stepCandle(state, 1000, true), state)
  state = wakeCandle(state)
  assert.equal(state.phase, 'relighting')
  for (let i = 0; i < 3; i++) state = stepCandle(state, 1000, false)
  assert.deepEqual(state, freshCandle())
})
