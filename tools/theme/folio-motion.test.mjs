import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
const module = { exports: {} }
vm.runInNewContext(transformSync(readFileSync(new URL('../../src/lib/folioMotion.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports })
const angle = module.exports.folioLeafAngle
test('writing surfaces rise above the binding rather than folding through the book', () => {
  for (const side of [-1,1]) for (let age=0;age<2;age+=.04) for (let turn=0;turn<1;turn+=.05) {
    const rotation=angle(age,turn,side,false), writingPoint=side*1.3
    assert.ok(writingPoint*Math.sin(rotation)>=0)
    assert.ok(Math.abs(rotation)<=.2150001)
  }
})
test('settled and reduced-motion leaves remain flat', () => {
  assert.equal(angle(3,2,1,false),0);assert.equal(angle(0,.3,-1,true),0)
  assert.equal(angle(NaN,.3,1,false),0)
})
