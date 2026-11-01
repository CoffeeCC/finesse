// The Activity page's list (src/lib/activity.ts): playing and downloads now, then requests and
// new titles newest first; what's new since the last visit; a request downloading shows once.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agoLabel, buildActivity } from '../../src/lib/activity.ts'

const src = {
  playing: [{ id: 's1', itemId: 'm1', title: 'Dune', who: 'you', device: 'Living room TV', paused: false }],
  downloads: [
    { key: 'movie-7', title: 'Arrival', status: 'Downloading', progress: 41.6, done: false },
    { key: 'movie-8', title: 'Heat', status: 'Needs attention', progress: 0, done: false, reason: 'No files found' },
  ],
  requested: [
    { key: 'movie-7', title: 'Arrival', year: 2016, added: '2026-10-30T10:00:00Z', status: 'Searching for a release' },
    { key: 'series-3', title: 'Severance', added: '2026-10-29T10:00:00Z', status: 'Not out yet' },
  ],
  added: [
    { id: 'a1', title: 'Old film', at: '2026-10-01T10:00:00Z', kind: 'Movie' },
    { id: 'a2', title: 'New show', at: '2026-10-31T08:00:00Z', kind: 'Show' },
    { id: 'a3', title: 'No date' },
  ],
}

test('now: playing, then downloads, with a real percentage and stuck ones said plainly', () => {
  const { now } = buildActivity(src, null)
  assert.deepEqual(now.map((e) => e.type), ['playing', 'downloading', 'downloading'])
  assert.equal(now[0]!.detail, 'Playing by you on Living room TV')
  assert.equal(now[0]!.to, '/item/m1')
  assert.equal(now[1]!.progress, 42)
  assert.equal(now[1]!.detail, 'Downloading 42%')
  assert.equal(now[2]!.tone, 'bad')
  assert.equal(now[2]!.progress, undefined)
  assert.match(now[2]!.detail, /stuck: No files found/)
})

test('recently: newest first, a downloading request only once, undated last', () => {
  const { recent } = buildActivity(src, null)
  assert.deepEqual(recent.map((e) => e.key), ['add-a2', 'req-series-3', 'add-a1', 'add-a3'])
  assert.equal(recent[1]!.detail, 'Requested · Not out yet')
  assert.ok(recent.every((e) => e.isNew === undefined), 'first visit: nothing marked new')
})

test('new since the last visit', () => {
  const { recent } = buildActivity(src, Date.parse('2026-10-30T00:00:00Z'))
  assert.deepEqual(recent.filter((e) => e.isNew).map((e) => e.key), ['add-a2'])
})

test('missing sources leave an empty list, never an error', () => {
  assert.deepEqual(buildActivity({}, null), { now: [], recent: [] })
})

test('times read as plain words', () => {
  const now = Date.parse('2026-10-31T12:00:00Z')
  assert.equal(agoLabel('2026-10-31T11:59:50Z', now), 'just now')
  assert.equal(agoLabel('2026-10-31T11:55:00Z', now), '5 min ago')
  assert.equal(agoLabel('2026-10-31T09:00:00Z', now), '3 h ago')
  assert.equal(agoLabel('2026-10-30T10:00:00Z', now), 'yesterday')
  assert.equal(agoLabel('2026-10-27T12:00:00Z', now), '4 days ago')
  assert.equal(agoLabel(undefined, now), '')
})
