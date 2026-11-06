import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const compiled = transformSync(readFileSync(new URL('../../src/lib/sound.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code
function fixture(prefs = {}, media = [], hidden = false) {
  let contexts = 0
  const starts = [], stops = [], gains = [], listeners = {}, cancellations=[]
  const parameter = (gain = false) => ({ value: 0, setValueAtTime() {}, cancelScheduledValues(time){cancellations.push(time)},setTargetAtTime(value){assert.ok(value>0)},exponentialRampToValueAtTime(value) { assert.ok(Number.isFinite(value) && value > 0); if (gain) gains.push(value) } })
  const node = () => ({ connect(other) { return other }, disconnect() {}, gain: parameter(true), frequency: parameter(), Q: parameter(),
    start(time) { starts.push(time) }, stop(time) { assert.ok(Number.isFinite(time)); stops.push(time) } })
  class AudioContext {
    currentTime = 0; sampleRate = 48000; state = 'running'; destination = {}
    constructor() { contexts++ }
    createOscillator = node; createGain = node; createBufferSource = node; createBiquadFilter = node
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) } }
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name) => name === './settings'
    ? { getPrefs: () => ({ uiSounds: true, uiSoundsVolume: .6, ...prefs }) } : { moodHue: () => null },
    window: { AudioContext, addEventListener: (name, fn, capture) => { listeners[name + (capture === true ? ':capture' : '')] = fn }, setTimeout() {} },
    document: { hidden, querySelectorAll: () => media, documentElement: { dataset: { theme: 'card-table' } } }, performance: { now: () => 1000 } })
  return { api: module.exports, starts, stops, gains, listeners, cancellations, contexts: () => contexts }
}
test('theme sounds obey mute, zero volume, hidden tabs and active unmuted media', () => {
  for (const f of [fixture({ uiSounds: false }), fixture({ uiSoundsVolume: 0 }), fixture({ uiSoundsVolume: NaN }), fixture({ uiSoundsVolume: Infinity }), fixture({}, [], true),
    fixture({}, [{ paused: false, muted: false, currentTime: 1 }])]) {
    f.api.playArcaneSound('coin-land'); assert.equal(f.contexts(), 0); assert.equal(f.starts.length, 0)
  }
})
test('every object sound is bounded and quiet; muted previews do not suppress it', () => {
  const f = fixture({}, [{ paused: false, muted: true, currentTime: 1 }])
  for (const kind of ['orb', 'deck', 'cards', 'card-land', 'flame', 'coin-flip', 'coin-land', 'key-lift', 'key-insert', 'key-turn', 'lock-release', 'lock-latch', 'desk-open', 'desk-close', 'drawer-open', 'drawer-close', 'tuning-fork', 'quill', 'vials', 'lantern', 'sextant', 'eraser', 'courier-horn', 'escapement', 'shears-open', 'shears-cut', 'lots']) {
    const before = f.starts.length; f.api.playArcaneSound(kind); assert.ok(f.starts.length > before)
  }
  assert.equal(f.contexts(), 1); assert.equal(f.starts.length, f.stops.length)
  assert.ok(f.stops.every((time) => time < 1)); assert.ok(f.gains.every((value) => value <= .06))
})
test('reversing a mechanism can fade and stop its active hardware voices',()=>{
  const f=fixture(),cancel=f.api.playArcaneSound('desk-open'),started=f.starts.length
  assert.equal(typeof cancel,'function');cancel()
  assert.equal(f.cancellations.length,started);assert.equal(f.stops.length,started*2)
})
test('coin-owned sounds are not doubled by the global click confirmation', () => {
  const f = fixture(); f.api.initUiSounds()
  f.listeners.click({ target: { closest: () => ({ disabled: false, getAttribute: () => 'handled' }) } })
  assert.equal(f.contexts(), 0)
})
test('collection instruments use their object sound instead of the generic select note', () => {
  for (const tool of ['query','genres','watch','sort','erase']) {
    const f=fixture();f.api.initUiSounds()
    const button={disabled:false,getAttribute:(name)=>name==='data-collection-tool'?tool:null,matches:()=>false}
    f.listeners.click({target:{closest:()=>button}})
    assert.equal(f.contexts(),1);assert.ok(f.starts.length>=2,tool)
  }
})
test('a deck click sounds once even when its request immediately disables the button', () => {
  const f = fixture(); f.api.initUiSounds()
  const button = { disabled: false, getAttribute: () => null, matches: (selector) => selector.split(',').map((s) => s.trim()).includes('.deck-box-object') }
  const event = { target: { closest: () => button } }
  f.listeners.click(event); const starts = f.starts.length; assert.ok(starts > 0)
  button.disabled = true; f.listeners.click(event); assert.equal(f.starts.length, starts)
})
