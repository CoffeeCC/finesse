// The TV's over-the-air bundle (src/lib/otaVersion.ts): a release already downloaded and waiting
// isn't offered again, so a TV can't keep downloading the same bundle.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cmpVersion, offersRelease } from '../../src/lib/otaVersion.ts'

test('the TV isn’t offered a release it has already downloaded (three or four parts)', () => {
  assert.equal(offersRelease('3.2.7', '3.2.6', null), true)
  assert.equal(offersRelease('3.2.7', '3.2.6', '3.2.7'), false)
  assert.equal(offersRelease('3.2.6.1', '3.2.6', '3.2.6.1'), false)
  assert.equal(offersRelease('3.2.7', '3.2.6', '3.2.6.1'), true)
  assert.equal(offersRelease('3.2.6', '3.2.6', null), false)
})

test('versions compare with three or four parts', () => {
  assert.equal(cmpVersion('3.2.6.1', '3.2.6'), 1)
  assert.equal(cmpVersion('v3.2.7', '3.2.6.1'), 1)
  assert.equal(cmpVersion('3.2.6', '3.2.6.0'), 0)
})
