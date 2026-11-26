import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
const module = { exports: {} }
vm.runInNewContext(transformSync(readFileSync(new URL('../../src/lib/deskSequence.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports })
const { deskPose: pose, deskSoundCrossings: sounds, drawerPose, drawerSoundCrossings } = module.exports
test('late renderer readiness cannot restart running or completed transitions',()=>{
  let plays=0
  const animation={playState:'paused',updatePlaybackRate(){},play(){plays++;this.playState='running'}}
  const resume=module.exports.resumePreparedMechanism
  assert.equal(resume(animation),true);assert.equal(resume(animation),false)
  animation.playState='finished';assert.equal(resume(animation),false);assert.equal(plays,1)
})
test('the key and bolt release before the desk lid moves', () => {
  for (let p = 0; p <= 1; p += .005) {
    const s = pose(p)
    assert.ok(s.lid === 0 || (s.keyTravel === 1 && s.keyTurn === 1 && s.bolt === 1))
    for (const key of ['keyTravel','keyTurn','bolt','lid','camera','contents']) assert.ok(s[key] >= 0 && s[key] <= 1)
  }
  assert.equal(pose(0).lid, 0); assert.equal(pose(1).lid, 1)
})
test('drawers use runner travel and a separate camera/sound envelope', () => {
  assert.equal(drawerPose(0).travel,0); assert.equal(drawerPose(1).travel,1)
  assert.ok(drawerPose(.3).travel>0); assert.equal(pose(.3).lid,0)
  assert.ok(drawerPose(.6).camera>drawerPose(.2).camera)
  assert.deepEqual([...drawerSoundCrossings(0,1)],['drawer-open'])
  assert.deepEqual([...drawerSoundCrossings(1,0)],['drawer-close'])
  assert.equal(drawerSoundCrossings(.5,.5).length,0)
})
test('reversing a partly open mechanism still produces the correct closing cue',()=>{
  const cue=module.exports.partialCloseCue
  assert.equal(cue(.6,'desk'),'desk-close');assert.equal(cue(.3,'desk'),'key-turn')
  assert.equal(cue(.5,'lighting'),'drawer-close');assert.equal(cue(1,'desk'),null)
  assert.equal(cue(0,'lighting'),null)
  assert.equal(module.exports.partialOpenCue(.6,'desk'),'desk-open')
  assert.equal(module.exports.partialOpenCue(.5,'lighting'),'drawer-open')
  assert.equal(module.exports.partialOpenCue(0,'desk'),null)
})
test('sound events follow crossings in both directions, without delayed repeats', () => {
  assert.deepEqual([...sounds(0, 1)], ['key-insert','key-turn','lock-release','desk-open'])
  assert.deepEqual([...sounds(1, 0)], ['desk-close','key-turn','lock-latch'])
  assert.equal(sounds(.6, .6).length, 0)
  assert.deepEqual([...sounds(.42, .30)], ['key-turn','lock-latch'])
  assert.equal(pose(NaN).progress, 0); assert.equal(pose(99).progress, 1)
})
