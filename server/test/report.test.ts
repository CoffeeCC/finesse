// "Report a problem": what a server adds to a bug report, with anything private taken out first,
// and only for administrators.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, auth, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

test('redact takes out keys, tokens, addresses, emails and names in paths', async () => {
  const { redact } = await import('../src/report.ts')
  const line = [
    'GET https://media.example.com:8443/finesse/x failed',
    'api_key=0123456789abcdef0123456789abcdef',
    'Authorization: MediaBrowser Token="abc123secret"',
    'from 203.0.113.9 and 8.8.8.8',
    'mail alex@example.org',
    'peer FinessePeer ab12:cdEF_34',
    'nas truenas-scale.taild65e2.ts.net',
    'key tskey-auth-kAbCdEf-123',
    'file C:\\Users\\Paulw\\Media\\x.mkv and /home/paul/media',
    'password: hunter2',
  ].join('\n')
  const out = redact(line, { publicUrl: 'https://media.example.com:8443' })
  for (const secret of ['media.example.com', '0123456789abcdef', 'abc123secret', '203.0.113.9', '8.8.8.8', 'alex@example.org', 'ab12:cdEF_34', 'taild65e2', 'tskey-auth', 'Paulw', '/home/paul', 'hunter2']) {
    assert.ok(!out.includes(secret), `still in the report: ${secret}\n${out}`)
  }
  assert.match(out, /<your address>\/finesse\/x failed/)
  assert.match(out, /C:\\Users\\<you>\\Media/)
})

test('redact keeps home and Tailscale addresses, which help and identify nobody', async () => {
  const { redact } = await import('../src/report.ts')
  const out = redact('jellyfin at 192.168.1.20:8096, 10.0.0.5, 127.0.0.1, 100.101.102.103')
  assert.equal(out, 'jellyfin at 192.168.1.20:8096, 10.0.0.5, 127.0.0.1, 100.101.102.103')
})

let base = ''
let jf: FakeJellyfin
let app: Server

before(async () => {
  jf = await fakeJellyfin()
  const work = tmp()
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(work, 'baked', rel, '..'), { recursive: true })
    writeFileSync(join(work, 'baked', rel), c)
  }
  Object.assign(process.env, { FINESSE_CONFIG_DIR: join(work, 'config'), FINESSE_WEB_DIR: join(work, 'baked'), JELLYFIN_URL: jf.url, JELLYFIN_API_KEY: API_KEY })
  const { createApp } = await import('../src/app.ts')
  app = createApp().server
  base = await listen(app)
})
after(() => {
  for (const s of [app, jf?.server]) {
    s?.closeAllConnections()
    s?.close()
  }
})

test('the server report is for administrators only', async () => {
  assert.equal((await fetch(`${base}/api/report`)).status, 401)
  assert.equal((await fetch(`${base}/api/report`, { headers: auth(USER_TOKEN) })).status, 403)
})

test('the server report has versions, how it runs, and recent problems with secrets taken out', async () => {
  const { logger } = await import('../src/log.ts')
  logger('test').error('could not reach https://example.net with api_key=deadbeefdeadbeefdeadbeefdeadbeef from 198.51.100.7')
  const r = await fetch(`${base}/api/report`, { headers: auth(ADMIN_TOKEN) })
  assert.equal(r.status, 200)
  const body = (await r.json()) as { version: string; web: string; platform: string; node: string; features: string[]; problems: string[] }
  assert.ok(body.version && body.web && body.platform && body.node)
  assert.ok(Array.isArray(body.features))
  const last = body.problems.at(-1) ?? ''
  assert.match(last, /\[test\] could not reach/)
  assert.ok(!last.includes('deadbeef') && !last.includes('198.51.100.7'), last)
})
