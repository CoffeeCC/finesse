// Contract tests for the invite + web-update API. The same suite runs against
// the original Python service and the Node port:
//   CONTRACT_TARGET=python node --test server/test/invites.contract.test.ts
//   node --test server/test/invites.contract.test.ts          (Node port)
// Identical results = the port is a drop-in replacement.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, auth, fakeGitHub, fakeJellyfin, makeTarball, startInviteTarget, webBuild, type FakeGitHub, type FakeJellyfin, type InviteTarget } from './helpers.ts'

let jf: FakeJellyfin
let gh: FakeGitHub
let t: InviteTarget

before(async () => {
  jf = await fakeJellyfin()
  gh = await fakeGitHub()
  t = await startInviteTarget(jf.url, gh.url)
})
after(async () => {
  await t?.stop()
  await jf?.close()
  await gh?.close()
})

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${t.base}${path}`, {
    method,
    headers: { ...(opts.token ? auth(opts.token) : {}), ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  return { status: res.status, json: text ? JSON.parse(text) : null }
}

describe(`invite service contract (${process.env.CONTRACT_TARGET === 'python' ? 'python' : 'node'})`, () => {
  test('health', async () => {
    const r = await call('GET', '/health')
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { status: 'ok' })
  })

  test('admin routes need an admin', async () => {
    assert.equal((await call('GET', '/v1/invites')).status, 401)
    assert.equal((await call('GET', '/v1/invites', { token: USER_TOKEN })).status, 403)
    assert.equal((await call('GET', '/v1/invites', { token: 'nope' })).status, 401)
    assert.equal((await call('GET', '/v1/invites', { token: ADMIN_TOKEN })).status, 200)
    // The service's own API key counts as admin (ops scripts).
    assert.equal((await call('GET', '/v1/invites', { token: API_KEY })).status, 200)
  })

  test('libraries', async () => {
    const r = await call('GET', '/v1/libraries', { token: ADMIN_TOKEN })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { libraries: [{ id: 'lib-movies', name: 'Movies' }, { id: 'lib-shows', name: 'Shows' }] })
  })

  let createdId = 0
  test('create invites', async () => {
    const auto = await call('POST', '/v1/invites', { token: ADMIN_TOKEN, body: { label: 'Mum', library_ids: ['lib-movies'], expires_in_days: 7 } })
    assert.equal(auto.status, 201)
    assert.match(auto.json.code, /^[A-Z0-9]{8}$/)
    assert.equal(auto.json.status, 'pending')
    assert.deepEqual(auto.json.libraries, ['Movies'])
    assert.deepEqual(auto.json.library_ids, ['lib-movies'])
    assert.equal(auto.json.label, 'Mum')
    assert.equal(auto.json.created_by, 'Admin')
    assert.equal(auto.json.allow_downloads, true)
    assert.ok(auto.json.expires_at)
    createdId = auto.json.id

    const fixed = await call('POST', '/v1/invites', { token: ADMIN_TOKEN, body: { code: 'family', unlimited: true, allow_downloads: false } })
    assert.equal(fixed.status, 201)
    assert.equal(fixed.json.code, 'FAMILY')
    assert.equal(fixed.json.unlimited, true)
    assert.equal(fixed.json.allow_downloads, false)
    assert.equal(fixed.json.expires_at, null)

    assert.equal((await call('POST', '/v1/invites', { token: ADMIN_TOKEN, body: { code: 'family' } })).status, 409)
    assert.equal((await call('POST', '/v1/invites', { token: ADMIN_TOKEN, body: { code: 'no!' } })).status, 400)
    assert.equal((await call('POST', '/v1/invites', { token: ADMIN_TOKEN, body: { expires_in_days: 'soon' } })).status, 400)
    assert.equal((await call('POST', '/v1/invites', { token: ADMIN_TOKEN, body: { library_ids: 'lib-movies' } })).status, 400)
    assert.equal((await call('POST', '/v1/invites', { token: USER_TOKEN, body: {} })).status, 403)
  })

  test('list + get', async () => {
    const list = await call('GET', '/v1/invites', { token: ADMIN_TOKEN })
    assert.equal(list.json.count, 2)
    assert.equal(list.json.invites[0].code, 'FAMILY') // newest first
    const byId = await call('GET', `/v1/invites/${createdId}`, { token: ADMIN_TOKEN })
    assert.equal(byId.status, 200)
    assert.equal(byId.json.id, createdId)
    assert.equal((await call('GET', `/v1/invites/${createdId}`)).status, 401)
    const pub = await call('GET', '/v1/invites/family')
    assert.equal(pub.status, 200)
    assert.deepEqual(Object.keys(pub.json).sort(), ['allow_downloads', 'allow_live_tv', 'code', 'expires_at', 'label', 'libraries', 'status'])
    assert.equal((await call('GET', '/v1/invites/NOPE1234')).status, 404)
  })

  test('join validates input', async () => {
    const good = { code: 'FAMILY', username: 'kid.one', password: 'Secret123' }
    assert.equal((await call('POST', '/v1/join', { body: { ...good, code: '' } })).status, 400)
    assert.equal((await call('POST', '/v1/join', { body: { ...good, username: 'x' } })).status, 400)
    assert.equal((await call('POST', '/v1/join', { body: { ...good, username: 'bad name' } })).status, 400)
    assert.equal((await call('POST', '/v1/join', { body: { ...good, password: 'short1A' } })).status, 400)
    assert.equal((await call('POST', '/v1/join', { body: { ...good, password: 'alllowercase1' } })).status, 400)
    assert.equal((await call('POST', '/v1/join', { body: { ...good, code: 'NOPE1234' } })).status, 404)
  })

  test('join creates a Jellyfin user with the invite policy', async () => {
    const r = await call('POST', '/v1/join', { body: { code: 'family', username: 'kid.one', password: 'Secret123' } })
    assert.equal(r.status, 201)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.username, 'kid.one')
    const u = jf.users.get(r.json.user_id)!
    assert.equal(u.Password, 'Secret123')
    assert.equal(u.Policy.IsAdministrator, false)
    assert.equal(u.Policy.IsHidden, false)
    assert.equal(u.Policy.EnableContentDownloading, false)
    assert.equal(u.Policy.EnableAllFolders, true)
    // Unlimited invites stay usable…
    assert.equal((await call('POST', '/v1/join', { body: { code: 'family', username: 'kid.two', password: 'Secret123' } })).status, 201)
    // …but a taken username is refused.
    assert.equal((await call('POST', '/v1/join', { body: { code: 'family', username: 'kid.two', password: 'Secret123' } })).status, 400)
  })

  test('single-use invites are used up; libraries are applied', async () => {
    const list = await call('GET', '/v1/invites', { token: ADMIN_TOKEN })
    const code = list.json.invites.find((i: { id: number }) => i.id === createdId).code
    const r = await call('POST', '/v1/join', { body: { code, username: 'grandma', password: 'Secret123' } })
    assert.equal(r.status, 201)
    const u = jf.users.get(r.json.user_id)!
    assert.equal(u.Policy.EnableAllFolders, false)
    assert.deepEqual(u.Policy.EnabledFolders, ['lib-movies'])
    const again = await call('POST', '/v1/join', { body: { code, username: 'grandpa', password: 'Secret123' } })
    assert.equal(again.status, 410)
    const after = await call('GET', `/v1/invites/${createdId}`, { token: ADMIN_TOKEN })
    assert.equal(after.json.status, 'used')
    assert.equal(after.json.used_by_username, 'grandma')
  })

  test('delete', async () => {
    assert.equal((await call('DELETE', '/v1/invites/999999', { token: ADMIN_TOKEN })).status, 404)
    assert.equal((await call('DELETE', `/v1/invites/${createdId}`, { token: USER_TOKEN })).status, 403)
    const r = await call('DELETE', `/v1/invites/${createdId}`, { token: ADMIN_TOKEN })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { ok: true })
    assert.equal((await call('GET', `/v1/invites/${createdId}`, { token: ADMIN_TOKEN })).status, 404)
  })
})

describe('web update contract', () => {
  async function waitDone() {
    for (let i = 0; i < 100; i++) {
      const s = await call('GET', '/v1/update', { token: ADMIN_TOKEN })
      if (s.json.state !== 'running') return s.json
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('update never finished')
  }

  test('status compares the served build with the latest release', async () => {
    gh.release('1.1.0', makeTarball(webBuild('1.1.0')))
    const s = await call('GET', '/v1/update', { token: ADMIN_TOKEN })
    assert.equal(s.status, 200)
    assert.equal(s.json.current, '1.0.0')
    assert.equal(s.json.latest, '1.1.0')
    assert.equal(s.json.available, true)
    assert.equal(s.json.state, 'idle')
    assert.equal((await call('GET', '/v1/update', { token: USER_TOKEN })).status, 403)
  })

  test('?check asks GitHub now instead of answering from the cache', async () => {
    gh.release('1.2.0', makeTarball(webBuild('1.2.0')))
    assert.equal((await call('GET', '/v1/update', { token: ADMIN_TOKEN })).json.latest, '1.1.0')
    assert.equal((await call('GET', '/v1/update?check=1', { token: ADMIN_TOKEN })).json.latest, '1.2.0')
    gh.release('1.1.0', makeTarball(webBuild('1.1.0')))
    assert.equal((await call('GET', '/v1/update?check=1', { token: ADMIN_TOKEN })).json.latest, '1.1.0')
  })

  test('install swaps in the new build', async () => {
    const start = await call('POST', '/v1/update', { token: ADMIN_TOKEN })
    assert.equal(start.status, 202)
    const done = await waitDone()
    assert.equal(done.state, 'done', done.message)
    assert.equal(JSON.parse(readFileSync(join(t.dist, 'version.json'), 'utf8')).version, '1.1.0')
    assert.ok(existsSync(join(t.dist, 'assets/app-1.1.0.js')))
    assert.ok(existsSync(join(t.dist, 'assets/app-1.0.0.js')), 'old assets stay for open tabs')
  })

  const bad: [string, () => void, RegExp][] = [
    ['path traversal', () => gh.release('1.2.0', makeTarball(webBuild('1.2.0'), { transform: 's,^\\./assets,../evil,' })), /unsafe path/i],
    ['symlink', () => gh.release('1.2.0', makeTarball(webBuild('1.2.0'), { symlink: ['assets/link.js', '/etc/passwd'] })), /non-file/i],
    ['version mismatch', () => gh.release('1.2.0', makeTarball(webBuild('1.3.0')), { assetVersion: '1.2.0' }), /says 1\.2\.0 but its build is 1\.3\.0/],
    ['bad checksum', () => gh.release('1.2.0', makeTarball(webBuild('1.2.0')), { digest: 'sha256:' + '0'.repeat(64) }), /checksum/i],
    ['missing index', () => gh.release('1.2.0', makeTarball({ 'version.json': JSON.stringify({ version: '1.2.0' }) })), /missing index\.html/i],
  ]
  for (const [name, setup, msg] of bad) {
    test(`refuses a bad release: ${name}`, async () => {
      setup()
      // The status cache (5 min) must not hide the new release from the install.
      assert.equal((await call('POST', '/v1/update', { token: ADMIN_TOKEN })).status, 202)
      const done = await waitDone()
      assert.equal(done.state, 'error')
      assert.match(done.message, msg)
      assert.equal(JSON.parse(readFileSync(join(t.dist, 'version.json'), 'utf8')).version, '1.1.0', 'served build untouched')
    })
  }
})
