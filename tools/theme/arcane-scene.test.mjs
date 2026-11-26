import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
const compiled = transformSync(readFileSync(new URL('../../src/lib/arcaneScene.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code
function fixture(saved, blocked = false) {
  const events = new EventTarget(), module = { exports: {} }; let value = saved, subscribe
  vm.runInNewContext(compiled, { module, exports: module.exports, Event,
    localStorage: { getItem() { if (blocked) throw Error('blocked'); return value }, setItem(key, next) { if (blocked) throw Error('blocked'); value = next } },
    window: events, require: () => ({ useSyncExternalStore(fn, snapshot) { subscribe = fn; return snapshot() } }) })
  return { api: module.exports, value: () => value, events, subscribe: (fn) => { module.exports.useArcaneScene(); return subscribe(fn) } }
}
test('scene lighting recovers malformed storage and bounds unsafe values', () => {
  const f = fixture('{broken')
  assert.equal(f.api.getArcaneScene().brightness, 1)
  f.api.setArcaneScene({ brightness: Infinity, lights: -100 })
  assert.equal(f.api.getArcaneScene().brightness, 1); assert.equal(f.api.getArcaneScene().lights, .5)
  f.api.setArcaneScene({ brightness: 99, lights: 99 })
  assert.deepEqual(JSON.parse(f.value()), { brightness: 1.4, lights: 1.5 })
})
test('lighting updates survive blocked storage and unsubscribe cleanly', () => {
  const f = fixture(null, true); let updates = 0
  const unsubscribe = f.subscribe(() => updates++)
  f.api.setArcaneScene({ brightness: 1.2 })
  assert.equal(f.api.getArcaneScene().brightness, 1.2); assert.equal(updates, 1)
  const clear = new Event('storage'); Object.defineProperty(clear, 'key', { value: null }); f.events.dispatchEvent(clear)
  assert.equal(f.api.getArcaneScene().brightness, 1); assert.equal(updates, 2)
  unsubscribe(); f.api.setArcaneScene({ lights: 1.3 }); assert.equal(updates, 2)
})
