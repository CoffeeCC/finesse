// Watch party sync (src/lib/partySync.ts): the shared clock, control from anyone, buffering,
// late joiners, people dropping out, the host leaving, and how a player follows the clock.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clockOffset, control, GONE_MS, STUCK_WINDOW_MS, join, leave, positionAt, report, steer, STUCK_MS, tick, waitingFor, type Party } from '../../src/lib/partySync.ts'

function party(now = 0): Party {
  return { id: 'p', item: 'i', title: 'T', host: 'alex', invited: ['kim', 'lee'], members: [], clock: { playing: false, position: 0, at: now, waiting: false, rev: 0 }, created: now, ended: false }
}

test('the clock: position moves only while playing; anyone can play, pause and seek', () => {
  const p = party()
  join(p, { id: 'alex', name: 'Alex' }, 0)
  join(p, { id: 'kim', name: 'Kim' }, 0)
  control(p, { action: 'play' }, 1000)
  assert.equal(positionAt(p.clock, 11_000), 10)
  control(p, { action: 'pause' }, 11_000) // Kim pauses
  assert.equal(positionAt(p.clock, 99_000), 10)
  control(p, { action: 'seek', position: 300 }, 12_000)
  assert.equal(p.clock.playing, false, 'a seek while paused stays paused')
  control(p, { action: 'play' }, 13_000)
  control(p, { action: 'seek', position: 60 }, 15_000)
  assert.equal(p.clock.playing, true, 'a seek while playing keeps playing')
  assert.equal(positionAt(p.clock, 16_000), 61)
  assert.ok(p.clock.rev >= 5)
})

test('someone in step who stalls pauses everyone, and it plays on once they’re back', () => {
  const p = party()
  join(p, { id: 'alex', name: 'Alex' }, 0)
  join(p, { id: 'kim', name: 'Kim' }, 0)
  control(p, { action: 'play' }, 0)
  report(p, 'kim', { position: 5, buffering: false }, 5000)
  report(p, 'alex', { position: 5, buffering: false }, 5000)
  report(p, 'kim', { position: 6, buffering: true }, 6000)
  tick(p, 6000)
  assert.equal(p.clock.playing, false)
  assert.equal(p.clock.waiting, true)
  assert.deepEqual(waitingFor(p, 6500).map((m) => m.name), ['Kim'])
  assert.equal(positionAt(p.clock, 9000), 6, 'held where it was')
  report(p, 'kim', { position: 6, buffering: false }, 8000)
  tick(p, 8000)
  assert.equal(p.clock.playing, true)
  assert.equal(p.clock.waiting, false)
  assert.equal(positionAt(p.clock, 9000), 7)
})

test('a manual pause while waiting stays paused; someone stuck too long is left to catch up', () => {
  const p = party()
  join(p, { id: 'alex', name: 'Alex' }, 0)
  join(p, { id: 'kim', name: 'Kim' }, 0)
  control(p, { action: 'play' }, 0)
  report(p, 'kim', { position: 1, buffering: false }, 1000)
  report(p, 'kim', { position: 2, buffering: true }, 2000)
  tick(p, 2000)
  control(p, { action: 'pause' }, 3000)
  report(p, 'kim', { position: 2, buffering: false }, 4000)
  tick(p, 4000)
  assert.equal(p.clock.playing, false, 'nobody asked to play again')
  // Stuck: past the limit the party plays on without them.
  control(p, { action: 'play' }, 5000)
  report(p, 'kim', { position: 2, buffering: true }, 5000)
  tick(p, 5000)
  assert.equal(p.clock.waiting, true)
  report(p, 'alex', { position: 2, buffering: false }, 5000 + STUCK_MS)
  report(p, 'kim', { position: 2, buffering: true }, 5000 + STUCK_MS)
  tick(p, 5000 + STUCK_MS)
  assert.equal(p.clock.playing, true, 'Kim is left to catch up')
})

test('stalling on and off adds up: one member can’t keep everyone paused by toggling', () => {
  const p = party()
  join(p, { id: 'alex', name: 'Alex' }, 0)
  join(p, { id: 'kim', name: 'Kim' }, 0)
  control(p, { action: 'play' }, 0)
  report(p, 'kim', { position: 0, buffering: false }, 0)
  // Kim stalls 4 s, plays 0.1 s, stalls again… each stall shorter than STUCK_MS.
  let t = 1000
  let held = 0
  while (t < 1000 + 2 * STUCK_MS) {
    report(p, 'kim', { position: positionAt(p.clock, t), buffering: true }, t)
    report(p, 'alex', { position: positionAt(p.clock, t), buffering: false }, t)
    tick(p, t)
    if (waitingFor(p, t).length) held += 1000
    t += 1000
    if ((t / 1000) % 4 === 0) {
      report(p, 'kim', { position: positionAt(p.clock, t), buffering: false }, t)
      t += 100
    }
  }
  assert.ok(held <= STUCK_MS, `held the party ${held} ms`)
  assert.equal(p.clock.playing, true, 'the party plays on without Kim')
  // A new minute: Kim may hold it again (briefly).
  t = 1000 + STUCK_WINDOW_MS + 1
  report(p, 'kim', { position: positionAt(p.clock, t), buffering: false }, t)
  report(p, 'kim', { position: positionAt(p.clock, t), buffering: true }, t + 1)
  assert.equal(waitingFor(p, t + 2).length, 1)
})

test('a late joiner starts where the party is and doesn’t hold it up until in step', () => {
  const p = party()
  join(p, { id: 'alex', name: 'Alex' }, 0)
  control(p, { action: 'play' }, 0)
  const lee = join(p, { id: 'lee', name: 'Lee' }, 600_000)
  assert.equal(lee.position, 600)
  report(p, 'lee', { position: 0, buffering: true }, 601_000)
  report(p, 'alex', { position: 601, buffering: false }, 601_000)
  tick(p, 601_000)
  assert.equal(p.clock.playing, true, 'still loading: nobody waits')
  report(p, 'lee', { position: 602, buffering: false }, 602_000)
  report(p, 'lee', { position: 603, buffering: true }, 603_000)
  tick(p, 603_000)
  assert.equal(p.clock.waiting, true, 'in step now, so a stall holds the party')
})

test('people who go quiet leave; the host leaving hands it on; nobody left ends it', () => {
  const p = party()
  join(p, { id: 'alex', name: 'Alex' }, 0)
  join(p, { id: 'kim', name: 'Kim' }, 1000)
  join(p, { id: 'lee', name: 'Lee' }, 2000)
  for (const id of ['kim', 'lee']) report(p, id, { position: 0, buffering: false }, GONE_MS)
  tick(p, GONE_MS + 1) // Alex said nothing for 15 s
  assert.deepEqual(p.members.map((m) => m.id), ['kim', 'lee'])
  assert.equal(p.host, 'kim', 'the longest-present member hosts')
  leave(p, 'kim')
  assert.equal(p.host, 'lee')
  leave(p, 'lee')
  assert.equal(p.ended, true)
})

test('following the clock: play/pause to match, jump when far, nudge the speed when close', () => {
  const c = { playing: true, position: 100, at: 0, waiting: false, rev: 1 }
  assert.deepEqual(steer({ position: 100, playing: true }, c, 0), { seek: null, play: null, rate: 1 })
  assert.deepEqual(steer({ position: 99, playing: true }, c, 0), { seek: null, play: null, rate: 1.05 }, 'a second behind: a little faster')
  assert.deepEqual(steer({ position: 101.5, playing: true }, c, 0), { seek: null, play: null, rate: 0.95 })
  assert.deepEqual(steer({ position: 50, playing: false }, c, 10_000), { seek: 110, play: true, rate: 1 })
  assert.deepEqual(steer({ position: 110, playing: true }, { ...c, playing: false, position: 110 }, 99_000), { seek: null, play: false, rate: 1 })
  // The server's clock seen from here: halfway through the exchange.
  assert.equal(clockOffset(1000, 1200, 5100), 4000)
})
