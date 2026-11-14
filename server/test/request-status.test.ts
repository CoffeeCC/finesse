// Where a request stands (src/lib/requestStatus.ts): the Request page, search, a movie's page and
// the Requested list all show this, built only from what the *arr apps report.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { failuresByTitle, requestStatus } from '../../src/lib/requestStatus.ts'

const dl = (status: string, progress: number, extra: Partial<{ done: boolean; paused: boolean; reason: string }> = {}) => ({ status, progress, done: false, ...extra })

test('on disk is ready, whatever else is going on', () => {
  const s = requestStatus({ requested: true, hasFile: true, queue: dl('Downloading', 10), failure: { message: 'x' } })
  assert.equal(s.stage, 'ready')
  assert.equal(s.label, 'Ready to watch')
  assert.equal(s.tone, 'ok')
})

test('downloading shows the real percentage and a bar; queued and importing show none', () => {
  assert.deepEqual(requestStatus({ requested: true, hasFile: false, queue: dl('Downloading', 41.6) }), { stage: 'downloading', label: 'Downloading 42%', progress: 42, tone: 'busy' })
  assert.equal(requestStatus({ requested: true, hasFile: false, queue: dl('Paused', 30, { paused: true }) }).label, 'Paused at 30%')
  const queued = requestStatus({ requested: true, hasFile: false, queue: dl('Queued', 0) })
  assert.equal(queued.stage, 'queued')
  assert.equal(queued.progress, undefined)
  const importing = requestStatus({ requested: true, hasFile: false, queue: dl('Importing…', 100, { done: true }) })
  assert.equal(importing.stage, 'importing')
  assert.equal(importing.progress, undefined)
})

test('a stuck download says why, or who can help', () => {
  const s = requestStatus({ requested: true, hasFile: false, queue: dl('Needs attention', 100, { reason: 'No files found are eligible for import' }) })
  assert.equal(s.stage, 'stuck')
  assert.equal(s.tone, 'bad')
  assert.equal(s.detail, 'It downloaded, but it isn’t what it said it was.')
  assert.match(requestStatus({ requested: true, hasFile: false, queue: dl('Needs attention', 0) }).detail!, /whoever runs the server/)
})

test('nothing downloading: not out yet, searching again after a failure, or searching', () => {
  assert.equal(requestStatus({ requested: true, hasFile: false, available: false }).stage, 'not-out')
  const again = requestStatus({ requested: true, hasFile: false, failure: { message: 'Not enough repair blocks' } })
  assert.equal(again.stage, 'retrying')
  assert.equal(again.detail, 'The download was damaged or locked and couldn’t be opened. Finesse is looking for another.')
  assert.equal(requestStatus({ requested: true, hasFile: false, failure: {} }).detail, 'The last download failed. Finesse is looking for another.')
  assert.equal(requestStatus({ requested: true, hasFile: false }).label, 'Searching for a release')
  assert.equal(requestStatus({ requested: false, hasFile: false }).stage, 'none')
})

test('failed downloads are kept per title, newest first', () => {
  const m = failuresByTitle([
    { kind: 'movie', movieId: 7, date: '2026-10-01T00:00:00Z', message: 'old' },
    { kind: 'movie', movieId: 7, date: '2026-10-20T00:00:00Z', message: 'new' },
    { kind: 'movie', movieId: 7, message: 'no date' },
    { kind: 'series', seriesId: 3, date: '2026-10-02T00:00:00Z' },
    { kind: 'artist', movieId: 9 },
  ])
  assert.equal(m.get('movie-7')?.message, 'new')
  assert.ok(m.has('series-3'))
  assert.equal(m.size, 2, 'a record without its kind’s id is skipped')
})
