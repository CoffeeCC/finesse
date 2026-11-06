import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
const module = { exports: {} }
vm.runInNewContext(transformSync(readFileSync(new URL('../../src/lib/arcaneRouteOrigin.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports })
const origin = module.exports.arcaneRouteOrigin
test('routed scrying retains a collection leaf and its query without accepting unrelated surfaces', () => {
  const result = origin({ arcaneTableOrigin: { pathname: '/library/f-peer-abc', search: '?q=moon&g=Drama&leaf=7&s=SortName', hash: '#old' } })
  assert.equal(result.pathname, '/library/f-peer-abc')
  assert.equal(result.search, '?q=moon&g=Drama&leaf=7&s=SortName')
  assert.equal(result.hash, '')
  for (const pathname of ['/', '/dashboard', '/mylist', '/libraries']) assert.equal(origin({ arcaneTableOrigin: { pathname } }).pathname, pathname)
  for (const pathname of ['/item/title', '/play/title', '/settings', '/library/', '//outside', 'https://example.com', '/library/a/../../settings']) {
    assert.equal(origin({ arcaneTableOrigin: { pathname } }), null)
  }
})
test('direct links and malformed history state safely fall back to the home mat', () => {
  for (const state of [undefined, null, 42, {}, { arcaneTableOrigin: null }, { arcaneTableOrigin: '/' }, { arcaneTableOrigin: { pathname: 42 } }]) assert.equal(origin(state), null)
  assert.equal(origin({ arcaneTableOrigin: { pathname: '/mylist', search: 'https://example.com' } }).search, '')
})
test('related-title return depth accepts only bounded whole history steps', () => {
  const depth = module.exports.arcaneProjectionDepth
  assert.equal(depth({ arcaneProjectionDepth: 3 }), 3)
  for (const value of [undefined, null, -1, 0, 1.5, Infinity, '3', 1001]) assert.equal(depth({ arcaneProjectionDepth: value }), 1)
})
