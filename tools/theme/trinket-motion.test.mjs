import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
const module = { exports: {} }
vm.runInNewContext(transformSync(readFileSync(new URL('../../src/lib/trinketMotion.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports })
const { stepTrinketMotion: step } = module.exports
test('trinkets settle without frame-rate dependent paths', () => {
  const advance = (fps) => { let s = { value: 0, velocity: 0 }; for (let i = 0; i < fps; i++) s = step(s, true, 1 / fps); return s }
  const a = advance(30), b = advance(144)
  assert.ok(Math.abs(a.value - b.value) < 1e-10)
  assert.ok(Math.abs(a.velocity - b.velocity) < 1e-10)
  assert.ok(Math.abs(a.value - 1) < .001)
})
test('leaving and re-entering a trinket preserves momentum and returns to rest', () => {
  let s = { value: 0, velocity: 0 }
  for (let i = 0; i < 8; i++) s = step(s, true, 1 / 60)
  const interrupted = step(s, false, 0)
  assert.equal(interrupted.value, s.value); assert.equal(interrupted.velocity, s.velocity)
  for (let i = 0; i < 180; i++) { s = step(s, false, 1 / 60); assert.ok(s.value > -.1 && s.value < 1.1) }
  assert.ok(Math.abs(s.value) < 1e-10)
  const quiet = step({ value: .8, velocity: 5 }, true, 1 / 60, true)
  assert.equal(quiet.value, 0); assert.equal(quiet.velocity, 0)
})
