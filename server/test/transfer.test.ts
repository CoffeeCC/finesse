// Moving playback between devices (src/lib/transfer.ts): where the other device is now, which
// device "Continue here" takes over from, and waiting for the device told to play to start.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { continueHereHref, otherPlaying, positionNow, waitForStart, type SessionLike } from '../../src/lib/transfer.ts'

const NOW = Date.parse('2026-10-31T20:00:00Z')
const tv = (o: Partial<SessionLike> = {}): SessionLike => ({
  Id: 's-tv',
  DeviceId: 'tv',
  UserId: 'u1',
  NowPlayingItem: { Id: 'm1', Type: 'Movie', RunTimeTicks: 600e7 },
  PlayState: { PositionTicks: 100e7, IsPaused: false },
  LastActivityDate: '2026-10-31T19:59:50Z',
  LastPlaybackCheckIn: new Date(NOW - 8000).toISOString(),
  ...o,
})

test('the other device’s position now: its last report plus the time since, while playing', () => {
  assert.equal(positionNow(tv(), NOW), 108e7)
  assert.equal(positionNow(tv({ PlayState: { PositionTicks: 100e7, IsPaused: true } }), NOW), 100e7, 'paused: as reported')
  assert.equal(positionNow(tv({ LastPlaybackCheckIn: new Date(NOW - 600e3).toISOString() }), NOW), 130e7, 'a stale report adds at most 30 s')
  assert.equal(positionNow(tv({ LastPlaybackCheckIn: '0001-01-01T00:00:00Z' }), NOW), 100e7, 'never checked in')
  assert.equal(positionNow(tv({ PlayState: { PositionTicks: 599e7 } }), NOW), 599e7, 'never past the end')
  assert.equal(positionNow(tv({ PlayState: null }), NOW), 0)
})

test('which device to take over from: ours, not this one, a video, the most recent', () => {
  const me = { userId: 'u1', deviceId: 'phone' }
  const list = [
    tv({ Id: 'old', LastActivityDate: '2026-10-31T10:00:00Z' }),
    tv({ Id: 'new', LastActivityDate: '2026-10-31T19:00:00Z' }),
    tv({ Id: 'mine', DeviceId: 'phone' }),
    tv({ Id: 'music', NowPlayingItem: { Id: 'a', Type: 'Audio' } }),
    tv({ Id: 'sam', UserId: 'u2' }),
    tv({ Id: 'idle', NowPlayingItem: null }),
  ]
  assert.equal(otherPlaying(list, me)?.Id, 'new')
  assert.equal(otherPlaying(list.slice(2), me), null)
})

function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

test('waiting for the device told to play: started, never started, or gone', async () => {
  // Starts on the third look.
  let n = 0
  const c1 = clock()
  const started = await waitForStart({ ...c1, sessionId: 's-tv', itemId: 'm2', poll: async () => [tv({ NowPlayingItem: ++n >= 3 ? { Id: 'm2' } : { Id: 'm1' } })] })
  assert.equal(started, 'started')
  assert.equal(n, 3)
  // There, but still playing something else after the time allowed: this device carries on.
  const c2 = clock()
  assert.equal(await waitForStart({ ...c2, sessionId: 's-tv', itemId: 'm2', timeoutMs: 10_000, poll: async () => [tv()] }), 'timeout')
  assert.ok(c2.now() >= 10_000)
  // Closed (missing three times running), or never there.
  const c3 = clock()
  let k = 0
  assert.equal(await waitForStart({ ...c3, sessionId: 's-tv', itemId: 'm2', poll: async () => (++k === 1 ? [tv()] : []) }), 'gone')
  assert.equal(await waitForStart({ ...clock(), sessionId: 's-tv', itemId: 'm2', timeoutMs: 3000, poll: async () => [] }), 'gone')
  // A failed ask is "not yet", not "gone".
  let j = 0
  const c4 = clock()
  assert.equal(await waitForStart({ ...c4, sessionId: 's-tv', itemId: 'm2', poll: async () => { if (++j < 5) throw new Error('offline'); return [tv({ NowPlayingItem: { Id: 'm2' } })] } }), 'started')
})

test('Continue here: the position, and which device to stop once this one plays', () => {
  assert.equal(continueHereHref('m1', 108e7, { sessionId: 's-tv', name: 'Living Room TV' }), '/play/m1?t=1080000000&from=s-tv&fromName=Living+Room+TV')
  assert.equal(continueHereHref('m1', 0, { sessionId: 's', name: 'TV' }), '/play/m1?from=s&fromName=TV')
})
