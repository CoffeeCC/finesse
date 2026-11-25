// Regression & performance tests for streaming PIN enforcement, batched Access lookups, and grouped queue listings.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { Access } from '../src/access.ts'
import type { SettingsStore } from '../src/config.ts'
import type { Jellyfin } from '../src/jellyfin.ts'
import type { GroupsApi } from '../src/moments.ts'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'
import { call as peerCall, fakeJellyfin as peerFakeJellyfin, finesse as peerFinesse } from './peers.ts'

const BASE_PIPELINE = {
  h264_gst_pipeline: 'h264',
  hevc_gst_pipeline: 'hevc',
  av1_gst_pipeline: 'av1',
  render_node: '/dev/dri/renderD128',
  opus_gst_pipeline: 'opus',
}

test('POST /api/streaming/play enforces Wolf profile PINs for non-admins (explicit and single-profile auto-select)', async () => {
  const jf: FakeJellyfin = await fakeJellyfin()
  const dir = tmp('finesse-play-pin-')
  const socket = join(dir, 'wolf.sock')
  let profiles = [
    { id: 'locked', name: 'Parent', pin: [1, 2, 3, 4], apps: [{ id: '1', title: 'Steam', ...BASE_PIPELINE }] },
    { id: 'open', name: 'Guest', pin: null as number[] | null, apps: [{ id: '2', title: 'Desktop', ...BASE_PIPELINE }] },
  ]
  const started: unknown[] = []
  const wolf = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://wolf')
    const send = (out: ServerResponse, status: number, data: unknown) => {
      const body = JSON.stringify(data)
      out.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) })
      out.end(body)
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/apps') return send(res, 200, { success: true, apps: [{ id: '1', title: 'Steam', ...BASE_PIPELINE }] })
    if (req.method === 'GET' && url.pathname === '/api/v1/profiles') return send(res, 200, { success: true, profiles })
    if (req.method === 'GET' && url.pathname === '/api/v1/sessions') return send(res, 200, { success: true, sessions: [{ client_id: '111', client_ip: '192.168.1.70', app_id: '5' }] })
    if (req.method === 'POST' && url.pathname === '/api/v1/runners/start') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      started.push(JSON.parse(Buffer.concat(chunks).toString() || '{}'))
      return send(res, 200, { success: true })
    }
    send(res, 404, { success: false })
  })
  await new Promise<void>((r) => wolf.listen(socket, r))

  const romm = createServer((req, res) => {
    if (req.url === '/api/roms/7') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ id: 7, name: 'Test PS2', platform_slug: 'ps2', fs_path: 'roms/ps2', fs_name: 'test.iso' }))
    }
    res.writeHead(404)
    res.end('{}')
  })
  const rommUrl = await listen(romm)

  const folders = { roms: join(dir, 'romm'), emulators: join(dir, 'emu'), firmware: join(dir, 'fw'), keys: join(dir, 'keys'), saves: join(dir, 'saves') }
  for (const d of Object.values(folders)) mkdirSync(d, { recursive: true })
  const config = join(dir, 'config')
  mkdirSync(config, { recursive: true })
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(dir, 'web', rel, '..'), { recursive: true })
    writeFileSync(join(dir, 'web', rel), c)
  }
  const settingsFile = join(config, 'finesse.json')
  writeFileSync(
    settingsFile,
    JSON.stringify({
      version: 1,
      instanceId: 'pin-test',
      mode: 'adopt',
      setup: { state: 'ready' },
      jellyfin: { url: jf.url, apiKey: API_KEY, basePath: '' },
      services: { romm: { url: rommUrl, username: 'finesse', password: 'pw' } },
      emulators: { apps: ['pcsx2'], paths: folders },
      streaming: { socket },
    }),
  )
  const paths = { configDir: config, settingsFile, invitesDb: join(config, 'invites.db'), bakedWeb: join(dir, 'web'), updatedWeb: join(config, 'web'), previews: join(dir, 'previews'), backups: join(dir, 'backups') }
  const { createApp } = await import('../src/app.ts')
  const app = createApp({ paths })
  const url = await listen(app.server)

  const H = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="t", Device="t", DeviceId="t", Version="1", Token="${token}"` })
  try {
    const sessRes = await fetch(`${url}/api/streaming/sessions`, { headers: H(USER_TOKEN) })
    const sessBody = (await sessRes.json()) as { sessions: { id: string }[] }
    const sid = sessBody.sessions[0]!.id

    // Non-admin targeting a PIN-locked profile explicitly -> 403, runner never started.
    const blocked = await fetch(`${url}/api/streaming/play`, {
      method: 'POST',
      headers: H(USER_TOKEN),
      body: JSON.stringify({ rom: 7, session: sid, profile: 'locked' }),
    })
    assert.equal(blocked.status, 403)
    assert.match(await blocked.text(), /Parent has a PIN/)
    assert.equal(started.length, 0)

    // Non-admin targeting unlocked profile -> 202.
    const allowedOpen = await fetch(`${url}/api/streaming/play`, {
      method: 'POST',
      headers: H(USER_TOKEN),
      body: JSON.stringify({ rom: 7, session: sid, profile: 'open' }),
    })
    assert.equal(allowedOpen.status, 202)
    assert.equal(started.length, 1)

    // Single-profile auto-select when the sole profile has a PIN -> still 403 for non-admin.
    profiles = [profiles[0]!]
    const autoBlocked = await fetch(`${url}/api/streaming/play`, {
      method: 'POST',
      headers: H(USER_TOKEN),
      body: JSON.stringify({ rom: 7, session: sid }),
    })
    assert.equal(autoBlocked.status, 403)
    assert.equal(started.length, 1)

    // Admin on PIN-locked profile -> 202.
    const adminAllowed = await fetch(`${url}/api/streaming/play`, {
      method: 'POST',
      headers: H(ADMIN_TOKEN),
      body: JSON.stringify({ rom: 7, session: sid, profile: 'locked' }),
    })
    assert.equal(adminAllowed.status, 202)
    assert.equal(started.length, 2)
  } finally {
    for (const s of [app.server, wolf, romm]) {
      s.closeAllConnections()
      await new Promise((r) => s.close(r))
    }
    await jf.close()
  }
})

test('Access.availabilityMany batches local ids per user, caches hits, enforces ratingAllows, and Access.people caches /Users', async () => {
  const requests: string[] = []
  const allowedIds = new Set(['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)])
  const fakeJf = {
    async request<T>(path: string): Promise<T> {
      requests.push(path)
      if (path === '/Users') {
        return [
          { Id: '1'.repeat(32), Name: 'Robin', Policy: { IsDisabled: false } },
          { Id: '2'.repeat(32), Name: 'Kim', Policy: { IsDisabled: false } },
          { Id: '3'.repeat(32), Name: 'Disabled', Policy: { IsDisabled: true } },
        ] as unknown as T
      }
      const m = /^\/Users\/[^/]+\/Items\?Ids=([^&]+)/.exec(path)
      if (m) {
        const wanted = m[1]!.split(',')
        return { Items: wanted.filter((id) => allowedIds.has(id)).map((Id) => ({ Id })) } as unknown as T
      }
      throw new Error(`unexpected path: ${path}`)
    },
  } as unknown as Jellyfin

  const groups = { friends: () => [{ id: '1234abcd', name: 'Sam' }] } as unknown as GroupsApi
  const access = new Access({ jf: fakeJf, groups, settings: {} as SettingsStore })
  access.ratingAllows = async (_u, raw) => raw !== 'c'.repeat(32)

  const ids = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32), 'd'.repeat(32), `f-1234abcd-${'e'.repeat(32)}`, 'not-an-id']
  const first = await access.availabilityMany('u1', ids)
  assert.equal(first.get('a'.repeat(32)), 'yes')
  assert.equal(first.get('b'.repeat(32)), 'yes')
  assert.equal(first.get('c'.repeat(32)), 'no', 'blocked by ratingAllows')
  assert.equal(first.get('d'.repeat(32)), 'no', 'missing from Jellyfin response')
  assert.equal(first.get(`f-1234abcd-${'e'.repeat(32)}`), 'unknown')
  assert.equal(first.get('not-an-id'), 'no')

  // All 4 local IDs must have been queried in a single batched Jellyfin request.
  const itemCalls = requests.filter((r) => r.startsWith('/Users/u1/Items'))
  assert.equal(itemCalls.length, 1)

  // Second call for the same user + IDs uses the cache (0 additional Jellyfin requests).
  const second = await access.availabilityMany('u1', ids)
  assert.equal(second.get('a'.repeat(32)), 'yes')
  assert.equal(second.get('c'.repeat(32)), 'no')
  assert.equal(requests.filter((r) => r.startsWith('/Users/u1/Items')).length, 1)

  // people() caches /Users across calls and excludes disabled + excluded IDs.
  const p1 = await access.people(new Set(['2'.repeat(32)]))
  const p2 = await access.people(new Set())
  assert.deepEqual(p1.map((p) => p.name), ['Robin'])
  assert.deepEqual(p2.map((p) => p.name), ['Kim', 'Robin'])
  assert.equal(requests.filter((r) => r === '/Users').length, 1)
})

test('GET /api/queues returns accurate member and item counts via single grouped query', async () => {
  const jf = await peerFakeJellyfin(
    'Home',
    [
      { name: 'alex', token: 'alex', admin: true },
      { name: 'robin', token: 'robin', admin: false },
      { name: 'kim', token: 'kim', admin: false },
    ],
    'service',
  )
  const A = await peerFinesse('qperf', jf, 'service')
  const servers: Server[] = [jf.server, A.app]
  const uid = (name: string) => [...jf.users.values()].find((u) => u.Name === name)!.Id.toLowerCase()
  try {
    const q1 = await peerCall(A.url, 'POST', '/api/queues', 'robin', { name: 'Alpha', members: [uid('kim')] })
    const q2 = await peerCall(A.url, 'POST', '/api/queues', 'robin', { name: 'Beta', members: [uid('kim'), uid('alex')] })
    assert.equal(q1.status, 201)
    assert.equal(q2.status, 201)
    const id1 = String(q1.data.id)
    const id2 = String(q2.data.id)
    assert.equal((await peerCall(A.url, 'POST', `/api/queues/${id1}/items`, 'robin', { item: jf.movie })).status, 201)
    assert.equal((await peerCall(A.url, 'POST', `/api/queues/${id1}/items`, 'robin', { item: jf.privateMovie })).status, 201)
    assert.equal((await peerCall(A.url, 'POST', `/api/queues/${id2}/items`, 'robin', { item: jf.movie })).status, 201)

    const list = await peerCall(A.url, 'GET', '/api/queues', 'robin')
    assert.equal(list.status, 200)
    const byName = new Map((list.data.queues as { name: string; members: number; items: number }[]).map((q) => [q.name, q]))
    assert.equal(byName.get('Alpha')?.members, 2)
    assert.equal(byName.get('Alpha')?.items, 2)
    assert.equal(byName.get('Beta')?.members, 3)
    assert.equal(byName.get('Beta')?.items, 1)
  } finally {
    for (const s of servers) {
      s.closeAllConnections()
      s.close()
    }
  }
})
