// QR codes for the terminal: the shape a phone looks for. (Every version was also checked by decoding
// the output with OpenCV; see the commit that added this.)

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { qrMatrix, qrTerminal } from '../src/qr.ts'

test('sizes follow the version, and the three finder squares are where phones look', () => {
  const m = qrMatrix('http://192.168.1.50:8080/finesse/setup?code=K7QM-3XPD')
  assert.equal(m.length, 33) // version 4
  const finder = (x: number, y: number) =>
    [0, 1, 2, 3, 4, 5, 6].every((i) => m[y]![x + i] && m[y + 6]![x + i] && m[y + i]![x] && m[y + i]![x + 6]) && m[y + 3]![x + 3] && !m[y + 1]![x + 1]
  assert.ok(finder(0, 0) && finder(m.length - 7, 0) && finder(0, m.length - 7))
  assert.equal(qrMatrix('hi').length, 21)
  assert.throws(() => qrMatrix('z'.repeat(400)), /Too long/)
})

test('in the terminal: dark on light whatever the theme, two rows a line', () => {
  const t = qrTerminal('hi')
  const lines = t.split('\n')
  assert.equal(lines.length, Math.ceil((21 + 4) / 2))
  assert.ok(lines.every((l) => l.startsWith('\u001b[38;5;16;48;5;231m') && l.endsWith('\u001b[0m')))
})
