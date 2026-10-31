// A controller's LB/RB (src/lib/tabStep.ts, used by lib/gamepad): step through the tabs and
// wrap round; from a page that isn't a tab, RB starts at the first and LB at the last.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextTabIndex } from '../../src/lib/tabStep.ts'

test('LB and RB step through the tabs and wrap round', () => {
  assert.equal(nextTabIndex(0, 1, 4), 1)
  assert.equal(nextTabIndex(3, 1, 4), 0)
  assert.equal(nextTabIndex(0, -1, 4), 3)
  assert.equal(nextTabIndex(2, -1, 4), 1)
})

test('from a page that isn’t a tab: RB goes to the first, LB to the last', () => {
  assert.equal(nextTabIndex(-1, 1, 4), 0)
  assert.equal(nextTabIndex(-1, -1, 4), 3)
})

test('no tabs: nowhere to go', () => {
  assert.equal(nextTabIndex(-1, 1, 0), -1)
  assert.equal(nextTabIndex(0, -1, 0), -1)
})
