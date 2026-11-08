// Which "gamepad" is the controller (src/lib/padPick.ts, used by lib/gamepad and the retro
// player): microphones, headsets and keyboards the browser lists as gamepads never count.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { choosePad, isRealPad, needsPick, padKey, padName, padNames, realPads, type PadLike } from '../../src/lib/padPick.ts'

const pad = (index: number, id: string, mapping = '', buttons = 0, axes = 0): PadLike => ({ index, id, mapping, buttons: new Array(buttons).fill(0), axes: new Array(axes).fill(0) })

const yeti = pad(0, 'Yeti Stereo Microphone (Vendor: b58e Product: 9e84)', '', 4, 1)
const yetiByVendor = pad(0, 'b58e-9e84-Blue Microphones', '', 8, 2)
const headset = pad(2, 'HyperX Cloud Alpha Wireless Headset (Vendor: 0951 Product: 1743)', '', 7, 2)
const xbox = pad(1, 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'standard', 17, 4)
const xboxFirefox = pad(1, '045e-0b13-Xbox Wireless Controller', '', 16, 6)
const dualsense = pad(3, 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'standard', 18, 4)
const snesUsb = pad(4, 'USB Gamepad (Vendor: 0079 Product: 0011)', '', 10, 2)
const mediaKeys = pad(5, 'Some Keyboard Consumer Control', '', 3, 0)

test('microphones, headsets and keyboards are not controllers', () => {
  assert.equal(isRealPad(yeti), false)
  assert.equal(isRealPad(yetiByVendor), false)
  assert.equal(isRealPad(headset), false)
  assert.equal(isRealPad(mediaKeys), false)
})

test('real controllers are, mapped or not', () => {
  assert.equal(isRealPad(xbox), true)
  assert.equal(isRealPad(xboxFirefox), true)
  assert.equal(isRealPad(dualsense), true)
  // A cheap USB pad the browser doesn't map: a D-pad and enough buttons.
  assert.equal(isRealPad(snesUsb), true)
  // Too few buttons or no axes and unmapped: not a controller.
  assert.equal(isRealPad(pad(6, 'Mystery HID', '', 2, 0)), false)
  assert.equal(isRealPad(pad(6, 'Mystery HID', '', 12, 0)), false)
})

test('the Xbox pad is picked over the Yeti that connected first', () => {
  assert.equal(choosePad([yeti, xbox], null), xbox)
  assert.equal(choosePad([yeti, null, xbox], null), xbox)
  assert.equal(choosePad([yeti], null), null)
  assert.deepEqual(realPads([yeti, xbox, headset]), [xbox])
})

test('a mapped console pad beats an unmapped generic one; ties go to the first connected', () => {
  assert.equal(choosePad([snesUsb, xbox], null), xbox)
  assert.equal(choosePad([dualsense, xbox], null), xbox) // both mapped console pads: index 1 before 3
})

test('the controller this device chose wins while it is connected', () => {
  assert.equal(choosePad([xbox, dualsense], dualsense.id), dualsense)
  // Not here (or a microphone remembered by an older version): the best one.
  assert.equal(choosePad([xbox, snesUsb], dualsense.id), xbox)
  assert.equal(choosePad([yeti, xbox], yeti.id), xbox)
})

test('asks which one only with two real controllers and no choice among them', () => {
  assert.equal(needsPick([yeti, xbox], null), false)
  assert.equal(needsPick([xbox, dualsense], null), true)
  assert.equal(needsPick([xbox, dualsense], xbox.id), false)
  assert.equal(needsPick([xbox, dualsense], 'gone'), true)
})

test('names read like a controller, not a USB descriptor', () => {
  assert.equal(padName(xbox.id), 'Xbox Wireless Controller')
  assert.equal(padName(xboxFirefox.id), 'Xbox Wireless Controller')
  assert.equal(padName('Pro Controller'), 'Pro Controller')
  assert.equal(padName('(STANDARD GAMEPAD Vendor: 1234 Product: 5678)'), 'Controller')
})

test('two identical controllers: picked by slot for the session, asked again next time, told apart by name', () => {
  const one = pad(0, xbox.id, 'standard', 17, 4)
  const two = pad(1, xbox.id, 'standard', 17, 4)
  // The device remembers the name only: with two of that name, it can't know which is in your hands.
  assert.equal(needsPick([one, two], xbox.id), true)
  // Picked the second one this session: it plays, even though the first has the same name.
  assert.equal(choosePad([one, two], xbox.id, { id: xbox.id, index: 1 }), two)
  assert.equal(needsPick([one, two], xbox.id, { id: xbox.id, index: 1 }), false)
  // The picked slot gone: the remembered name, then the best.
  assert.equal(choosePad([one], xbox.id, { id: xbox.id, index: 1 }), one)
  // Distinct rows and keys.
  assert.deepEqual(padNames([two, one]), ['Xbox Wireless Controller (2)', 'Xbox Wireless Controller (1)'])
  assert.deepEqual(padNames([one, dualsense]), ['Xbox Wireless Controller', 'DualSense Wireless Controller'])
  assert.notEqual(padKey(one), padKey(two))
})
