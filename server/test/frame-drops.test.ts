// The player's "is this screen keeping up?" check (src/lib/frameDrops.ts), which turns the
// ambient glow off on devices that drop frames with it on (some TV browsers in full screen).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { struggling, type FrameSample } from '../../src/lib/frameDrops.ts'

/** Feeds samples every `every` ms at `fps`, dropping `dropShare` of them; returns the verdicts. */
function play(samples: FrameSample[], seconds: number, fps: number, dropShare: number, start = { at: 0, dropped: 0, total: 0 }, every = 1000) {
  const verdicts: boolean[] = []
  let s = start
  for (let t = every; t <= seconds * 1000; t += every) {
    const frames = (fps * every) / 1000
    s = { at: s.at + every, dropped: s.dropped + Math.round(frames * dropShare), total: s.total + frames }
    verdicts.push(struggling(samples, s))
  }
  return { verdicts, last: s }
}

test('smooth playback, or a few dropped frames at a scene change, is fine', () => {
  const samples: FrameSample[] = []
  assert.ok(!play(samples, 30, 24, 0).verdicts.some(Boolean))
  const blip = play(samples, 2, 24, 0.25, { at: 30_000, dropped: 0, total: 720 })
  assert.ok(!blip.verdicts.some(Boolean), 'a 2-second blip')
  assert.ok(!play(samples, 20, 24, 0, blip.last).verdicts.some(Boolean))
})

test('steadily dropping frames is struggling, within a few seconds', () => {
  const samples: FrameSample[] = []
  const { verdicts } = play(samples, 10, 24, 0.2)
  const firstBad = verdicts.indexOf(true)
  assert.ok(firstBad >= 1 && firstBad <= 6, `judged after ${firstBad + 1} s`)
})

test('the counters starting over (a new stream) starts the window over', () => {
  const samples: FrameSample[] = []
  play(samples, 10, 24, 0.2)
  // New stream: counters back near zero, playing smoothly.
  assert.ok(!play(samples, 10, 24, 0, { at: 20_000, dropped: 0, total: 0 }).verdicts.some(Boolean))
})

test('very short windows are never judged', () => {
  const samples: FrameSample[] = []
  assert.equal(struggling(samples, { at: 0, dropped: 0, total: 0 }), false)
  assert.equal(struggling(samples, { at: 500, dropped: 10, total: 12 }), false)
})
