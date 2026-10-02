// Game streaming through Wolf: a fake Wolf on a real unix socket, and a
// Finesse in front of it. Checks what everyone at home and administrators can
// do, and that nothing else of Wolf's API is reachable or leaks out.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex')

/** Just enough of Wolf's API (src/moonlight-server/api in games-on-whales/wolf). */
async function fakeWolf(socket: string) {
  const calls: string[] = []
  const pending = new Map<string, string>([['secret-living-room', '192.168.1.50']])
  const clients = new Set<string>(['111'])
  const apps = [
    { title: 'Steam', id: '1', support_hdr: true, icon_png_path: '/etc/wolf/icons/steam.png', h264_gst_pipeline: 'x', runner: { type: 'docker', image: 'steam', env: ['SECRET_TOKEN=hunter2'], mounts: ['/mnt/private:/data'] } },
    { title: 'Firefox', id: '2', support_hdr: false, icon_png_path: 'https://example.com/ff.png?size=big' },
    { title: 'Desktop', id: '3', support_hdr: false },
  ]
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  }
  const send = (res: ServerResponse, status: number, data: unknown) => {
    const body = JSON.stringify(data)
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) })
    res.end(body)
  }
  const server = createServer(async (req, res) => {
    calls.push(`${req.method} ${req.url}`)
    const url = new URL(req.url ?? '/', 'http://wolf')
    if (req.method === 'GET' && url.pathname === '/api/v1/apps') return send(res, 200, { success: true, apps })
    if (req.method === 'GET' && url.pathname === '/api/v1/utils/get-icon') {
      if (url.search === '?icon_path=/etc/wolf/icons/steam.png') {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(PNG.length) })
        return res.end(PNG)
      }
      return send(res, 404, { success: false, error: 'Icon not found' })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/pair/pending')
      return send(res, 200, { success: true, requests: [...pending].map(([pair_secret, client_ip]) => ({ pair_secret, client_ip })) })
    if (req.method === 'GET' && url.pathname === '/api/v1/clients')
      return send(res, 200, { success: true, clients: [...clients].map((client_id) => ({ client_id, app_state_folder: `/var/wolf/${client_id}`, settings: {} })) })
    if (req.method === 'POST' && url.pathname === '/api/v1/pair/client') {
      const b = await read(req)
      if (!pending.has(b.pair_secret)) return send(res, 500, { success: false, error: 'Invalid pair secret' })
      pending.delete(b.pair_secret)
      // Like Wolf: the PIN goes to Moonlight's handshake; the client appears only when it was right.
      if (b.pin === '1234') setTimeout(() => clients.add('222'), 300)
      return send(res, 200, { success: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/unpair/client') {
      const b = await read(req)
      clients.delete(String(b.client_id))
      return send(res, 200, { success: true })
    }
    send(res, 404, { success: false, error: 'not in the fake' })
  })
  await new Promise<void>((r) => server.listen(socket, r))
  return { server, calls, pending, clients }
}

let jf: FakeJellyfin
let wolf: Awaited<ReturnType<typeof fakeWolf>>
let finesse: { url: string; app: Server; settingsFile: string }
let socket: string

before(async () => {
  jf = await fakeJellyfin()
  const dir = tmp('finesse-wolf-')
  socket = join(dir, 'wolf.sock')
  wolf = await fakeWolf(socket)
  const config = join(dir, 'config')
  mkdirSync(config, { recursive: true })
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(dir, 'web', rel, '..'), { recursive: true })
    writeFileSync(join(dir, 'web', rel), c)
  }
  const settingsFile = join(config, 'finesse.json')
  writeFileSync(settingsFile, JSON.stringify({ version: 1, instanceId: 'wolf-test', mode: 'adopt', setup: { state: 'ready' }, jellyfin: { url: jf.url, apiKey: API_KEY, basePath: '' } }))
  process.env.WOLF_SOCKET = socket
  const paths = { configDir: config, settingsFile, invitesDb: join(config, 'invites.db'), bakedWeb: join(dir, 'web'), updatedWeb: join(config, 'web'), previews: join(config, 'previews'), backups: join(config, 'backups') }
  const { createApp } = await import('../src/app.ts')
  const app = createApp({ paths })
  finesse = { url: await listen(app.server), app: app.server, settingsFile }
})

after(async () => {
  delete process.env.WOLF_SOCKET
  for (const s of [finesse.app, wolf.server]) {
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  }
  await jf.close()
})

const H = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="test", Device="t", DeviceId="t", Version="1", Token="${token}"` })
async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(`${finesse.url}${path}`, { method, headers: token ? H(token) : {}, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: r.status, data, text, type: r.headers.get('content-type') ?? '' }
}

test('discovery says streaming is on when WOLF_SOCKET is set', async () => {
  const r = await call('GET', '/api/finesse')
  assert.equal((r.data.features as Record<string, boolean>).streaming, true)
})

test('everyone at home sees the apps, and nothing of their settings', async () => {
  assert.equal((await call('GET', '/api/streaming')).status, 401)
  const r = await call('GET', '/api/streaming', USER_TOKEN)
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.apps, [
    { id: '1', title: 'Steam', hdr: true, icon: true },
    { id: '2', title: 'Firefox', hdr: false, icon: false },
    { id: '3', title: 'Desktop', hdr: false, icon: false },
  ])
  assert.doesNotMatch(r.text, /SECRET_TOKEN|hunter2|mnt\/private|gst|runner|icon_png_path/)
})

test('icons come by app, never by a path from the browser', async () => {
  const ok = await fetch(`${finesse.url}/api/streaming/apps/1/icon?ApiKey=${USER_TOKEN}`)
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), PNG)
  assert.equal((await fetch(`${finesse.url}/api/streaming/apps/2/icon?ApiKey=${USER_TOKEN}`)).status, 404, 'a path Wolf can’t take as it is')
  assert.equal((await fetch(`${finesse.url}/api/streaming/apps/9/icon?ApiKey=${USER_TOKEN}`)).status, 404)
  assert.equal((await fetch(`${finesse.url}/api/streaming/apps/1/icon?icon_path=/etc/passwd&ApiKey=${USER_TOKEN}`)).status, 200)
  assert.ok(!wolf.calls.some((c) => c.includes('passwd')), 'the browser’s path is never passed on')
  assert.equal((await fetch(`${finesse.url}/api/streaming/apps/1/icon`)).status, 401)
})

test('only administrators see waiting devices, and never Wolf’s pairing secret', async () => {
  assert.equal((await call('GET', '/api/streaming/admin', USER_TOKEN)).status, 403)
  assert.equal((await call('POST', '/api/streaming/pair', USER_TOKEN, { request: 'x', pin: '1234' })).status, 403)
  assert.equal((await call('DELETE', '/api/streaming/devices/111', USER_TOKEN)).status, 403)
  const r = await call('GET', '/api/streaming/admin', ADMIN_TOKEN)
  assert.equal(r.status, 200)
  const pending = r.data.pending as { id: string; ip: string }[]
  assert.equal(pending.length, 1)
  assert.equal(pending[0]!.ip, '192.168.1.50')
  assert.match(pending[0]!.id, /^[0-9a-f]{16}$/)
  assert.doesNotMatch(r.text, /secret-living-room/)
  assert.deepEqual(r.data.devices, [{ id: '111', name: null, pairedAt: null }])
})

test('pairing: checks the PIN, finds the new device and names it', async () => {
  const { data } = await call('GET', '/api/streaming/admin', ADMIN_TOKEN)
  const id = (data.pending as { id: string }[])[0]!.id
  assert.equal((await call('POST', '/api/streaming/pair', ADMIN_TOKEN, { request: id, pin: '12a4' })).status, 400)
  assert.equal((await call('POST', '/api/streaming/pair', ADMIN_TOKEN, { request: 'not-a-request', pin: '1234' })).status, 404)
  const paired = await call('POST', '/api/streaming/pair', ADMIN_TOKEN, { request: id, pin: '1234', name: '  Living   room TV ' })
  assert.equal(paired.status, 201, paired.text)
  assert.deepEqual(paired.data.device, { id: '222', name: 'Living room TV' })
  const after = await call('GET', '/api/streaming/admin', ADMIN_TOKEN)
  assert.deepEqual((after.data.devices as { id: string; name: string | null }[]).map((d) => [d.id, d.name]), [
    ['111', null],
    ['222', 'Living room TV'],
  ])
  assert.deepEqual(after.data.pending, [])
})

test('a wrong PIN says so instead of pretending it worked', async () => {
  wolf.pending.set('secret-phone', '192.168.1.60')
  const { data } = await call('GET', '/api/streaming/admin', ADMIN_TOKEN)
  const id = (data.pending as { id: string; ip: string }[]).find((p) => p.ip === '192.168.1.60')!.id
  const r = await call('POST', '/api/streaming/pair', ADMIN_TOKEN, { request: id, pin: '9999' })
  assert.equal(r.status, 200)
  assert.equal(r.data.ok, false)
  assert.match(String(r.data.error), /start pairing again/)
})

test('removing a device unpairs it in Wolf, and only devices Wolf knows', async () => {
  assert.equal((await call('DELETE', '/api/streaming/devices/999', ADMIN_TOKEN)).status, 404)
  assert.equal((await call('DELETE', `/api/streaming/devices/${encodeURIComponent('../../api/v1/apps')}`, ADMIN_TOKEN)).status, 404)
  const r = await call('DELETE', '/api/streaming/devices/222', ADMIN_TOKEN)
  assert.equal(r.status, 200)
  assert.ok(!wolf.clients.has('222'))
  const after = await call('GET', '/api/streaming/admin', ADMIN_TOKEN)
  assert.deepEqual((after.data.devices as { id: string }[]).map((d) => d.id), ['111'])
})

test('Finesse only ever makes its own calls to Wolf', () => {
  const allowed = /^(GET \/api\/v1\/(apps|clients|pair\/pending|utils\/get-icon\?icon_path=\/etc\/wolf\/icons\/steam\.png)|POST \/api\/v1\/(pair|unpair)\/client)$/
  for (const c of wolf.calls) assert.match(c, allowed)
})

test('with Wolf gone: a calm message for everyone, the reason for administrators', async () => {
  wolf.server.close()
  wolf.server.closeAllConnections()
  await new Promise((r) => setTimeout(r, 50))
  // The app list is cached briefly, so ask what only a live Wolf can answer.
  const admin = await call('GET', '/api/streaming/admin', ADMIN_TOKEN)
  assert.equal(admin.status, 200)
  assert.equal(admin.data.ok, false)
  assert.match(String(admin.data.error), /Can’t find Wolf’s socket|isn’t running/)
})
