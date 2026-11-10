import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
const module = { exports: {} }
vm.runInNewContext(transformSync(readFileSync(new URL('../../src/lib/candleLight.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports })
const { candleLight } = module.exports
test('candlelight stays bounded and continuous through noise boundaries', () => {
  let previous = candleLight(0), minimum = 2, maximum = 0
  for (let i = 1; i <= 20000; i++) {
    const light = candleLight(i / 200)
    minimum = Math.min(minimum, light.intensity); maximum = Math.max(maximum, light.intensity)
    assert.ok(light.intensity >= .89 && light.intensity <= 1.11)
    assert.ok(Math.abs(light.intensity - previous.intensity) < .01)
    assert.ok(Math.abs(light.x) <= .035 && Math.abs(light.z) <= .022)
    assert.ok(light.warmth >= 0 && light.warmth <= 1)
    previous = light
  }
  assert.ok(maximum - minimum > .1, 'the live signal must visibly vary')
})
test('motion-off keeps flame, light position and intensity steady at any time', () => {
  for (const time of [0, .2, 100, 2700]) {
    const light = candleLight(time, true)
    assert.equal(light.intensity, 1); assert.equal(light.lean, 0); assert.equal(light.x, 0); assert.equal(light.z, 0); assert.equal(light.warmth, .5)
  }
})
