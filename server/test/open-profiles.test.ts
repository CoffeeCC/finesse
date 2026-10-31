// Profiles with no password (src/lib/openProfiles.ts): Jellyfin 10.9+ reports HasPassword:
// true for every account, so the app remembers which ones open with no password.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isOpenProfile, pickAction, rememberOpenProfile, type KeyStore } from '../../src/lib/openProfiles.ts'

function store(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

const S = 'http://nas.local:8080/finesse/jellyfin'

test('a profile Jellyfin says has a password asks for it until it has opened without one', () => {
  const s = store()
  const u = { Id: 'ABC', HasPassword: true }
  assert.equal(pickAction(s, S, u), 'ask')
  rememberOpenProfile(s, S, 'abc', true)
  assert.equal(pickAction(s, S, u), 'sign-in')
  assert.equal(pickAction(s, `${S}/`, u), 'sign-in', 'a trailing slash is the same server')
  assert.equal(pickAction(s, 'http://other:8096', u), 'ask', 'another server is another account')
})

test('old Jellyfin that says HasPassword: false is believed', () => {
  assert.equal(pickAction(store(), S, { Id: 'x', HasPassword: false }), 'sign-in')
  assert.equal(pickAction(store(), S, { Id: 'x' }), 'ask')
})

test('a profile that gets a password is forgotten', () => {
  const s = store()
  rememberOpenProfile(s, S, 'a', true)
  rememberOpenProfile(s, S, 'b', true)
  rememberOpenProfile(s, S, 'a', false)
  assert.equal(isOpenProfile(s, S, 'a'), false)
  assert.equal(isOpenProfile(s, S, 'b'), true)
  rememberOpenProfile(s, S, 'b', true)
  assert.equal(JSON.parse(s.data.get('finesse.openProfiles')!).length, 1, 'no duplicates')
})

test('broken or blocked storage never throws', () => {
  const bad: KeyStore = { getItem: () => '{nope', setItem: () => { throw new Error('quota') } }
  assert.equal(isOpenProfile(bad, S, 'a'), false)
  assert.doesNotThrow(() => rememberOpenProfile(bad, S, 'a', true))
})
