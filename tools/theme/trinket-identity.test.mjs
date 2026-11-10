import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
const module = { exports: {} }
vm.runInNewContext(transformSync(readFileSync(new URL('../../src/lib/arcaneTrinkets.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports, require: (file) => file })
const { arcaneTrinkets, destinationTrinket } = module.exports
test('unrelated navigation functions cannot share a trinket asset', () => {
  const art = Object.values(arcaneTrinkets)
  assert.equal(new Set(art).size, art.length)
  for (const asset of art) assert.ok(readFileSync(new URL('../../src/lib/' + asset, import.meta.url)).length > 0)
})
test('every desk destination has an identity and unknown routes do not borrow one', () => {
  const routes = ['/', '/libraries', '/mylist', '/search', '/browse?tags=anime', '/browse?includeItemTypes=BoxSet', '/music', '/games', '/friends', '/together', '/moments', '/smart', '/request', '/activity', '/settings', '/remote']
  const ids = routes.map(destinationTrinket)
  assert.ok(ids.every((id) => id && arcaneTrinkets[id]))
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(destinationTrinket('/unknown'), null)
})
