import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { withHandDeadline } from '../../src/lib/tableDeal.ts'

test('a completed deal clears its deadline and returns the actual result', async () => {
  let transportSignal
  const hand = await withHandDeadline(async (signal) => {
    transportSignal = signal
    return ['film-a', 'film-b']
  }, new AbortController().signal, 15)
  assert.deepEqual(hand, ['film-a', 'film-b'])
  await delay(30)
  assert.equal(transportSignal.aborted, false)
})

test('a hung transport is aborted and reports a distinct timeout', async () => {
  let transportSignal
  await assert.rejects(withHandDeadline((signal) => {
    transportSignal = signal
    return new Promise(() => {})
  }, new AbortController().signal, 10), { name: 'TimeoutError' })
  assert.equal(transportSignal.aborted, true)
})

test('leaving the table cancels a pending request without waiting for the deadline', async () => {
  const parent = new AbortController()
  let transportSignal
  const pending = withHandDeadline((signal) => {
    transportSignal = signal
    parent.abort()
    return new Promise(() => {})
  }, parent.signal, 1000)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(transportSignal.aborted, true)
})

test('an already cancelled deal never starts its transport', async () => {
  const parent = new AbortController()
  parent.abort()
  let called = false
  await assert.rejects(withHandDeadline(async () => { called = true }, parent.signal), { name: 'AbortError' })
  assert.equal(called, false)
})

test('a late response from an abort-ignoring transport cannot revive the deal', async () => {
  let finish
  const pending = withHandDeadline(() => new Promise((resolve) => { finish = resolve }), new AbortController().signal, 10)
  await assert.rejects(pending, { name: 'TimeoutError' })
  finish(['stale-film'])
  await assert.rejects(pending, { name: 'TimeoutError' })
})

test('synchronous transport failures remain real failures, not timeouts', async () => {
  await assert.rejects(withHandDeadline(() => { throw new Error('Not connected') }, new AbortController().signal, 100), /Not connected/)
})
