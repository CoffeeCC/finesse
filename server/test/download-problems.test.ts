// Stuck downloads in plain words (src/lib/downloadProblems.ts): each of the download apps' own
// messages gets a sentence a person would say, and the right answer to "who fixes this?".

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bytes, explainProblem, roughly, speed } from '../../src/lib/downloadProblems.ts'
import { diagnose } from '../src/downloadRescue.ts'

const CASES: [string, 'auto' | 'clear' | 'person'][] = [
  ['The download is stalled with no connections', 'auto'],
  ['qBittorrent is downloading metadata', 'auto'],
  ['One or more episodes expected in this release were not imported or missing from the release', 'auto'],
  ['No files found are eligible for import in /downloads/x', 'auto'],
  ['Sample', 'auto'],
  ['Unpacking failed, password required', 'auto'],
  ['Aborted, cannot be completed - https://sabnzbd.org/not-complete', 'auto'],
  ['Not an upgrade for existing movie file(s)', 'clear'],
  ['Not enough free space', 'person'],
  ['Access to the path "/data/media/tv" is denied', 'person'],
  ['Import failed, path does not exist or is not accessible by Sonarr: /downloads/x', 'person'],
]

test('each known message is explained, with who fixes it', () => {
  for (const [msg, fix] of CASES) {
    const e = explainProblem(msg, true)
    assert.equal(e.fix, fix, msg)
    assert.ok(e.what.length > 10 && !/\b(import|release|metadata)\b/i.test(e.what.replace('library', '')) || fix !== 'person', msg)
    if (fix === 'person') assert.ok(e.todo, `${msg}: says what to do`)
  }
})

test('the page and the server agree on what only a person can fix', () => {
  for (const [msg, fix] of CASES) {
    const d = diagnose({ id: 1, status: 'completed', trackedDownloadStatus: 'warning', trackedDownloadState: 'importFailed', statusMessages: [{ messages: [msg] }] })
    assert.equal(d?.action === 'report', fix === 'person', msg)
    assert.equal(d?.action === 'drop', fix === 'clear', msg)
  }
})

test('an unknown reason still gets a sentence', () => {
  assert.equal(explainProblem(undefined).fix, 'auto')
  assert.match(explainProblem('Xyzzy', true).what, /couldn’t be added/)
})

test('times, sizes and speeds read the way people say them', () => {
  assert.equal(roughly(20_000), 'under a minute')
  assert.equal(roughly(25 * 60_000), 'about 25 min')
  assert.equal(roughly(100 * 60_000), 'about 1 h 45 min')
  assert.equal(roughly(7 * 3600_000), 'about 7 h')
  assert.equal(roughly(30 * 3600_000), 'about a day')
  assert.equal(bytes(1_500_000_000), '1.5 GB')
  assert.equal(bytes(42_000_000_000), '42 GB')
  assert.equal(bytes(730_000_000), '730 MB')
  assert.equal(speed(8_400_000), '8.4 MB/s')
  assert.equal(speed(350_000), '350 KB/s')
  assert.equal(speed(0), '')
})
