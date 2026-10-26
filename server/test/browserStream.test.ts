// Playing a Wolf game in Finesse's own page: Moonlight-Web behind Finesse's
// stream port. Only a ticket from a signed-in Finesse page gets in; the page
// gets Finesse's sign-in script and frame rules that allow Finesse alone;
// Moonlight-Web never sees Finesse's cookies or forwarded addresses; and the
// game starts in the session that page's stream opened. A fake Wolf, a fake
// Docker (Moonlight-Web's container, its access PIN) and a fake Moonlight-Web
// (https) stand in for the real ones.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { selfSignedCert } from '../src/tls.ts'
import { fakeDocker, type FakeDocker } from './fakeDocker.ts'
import { API_KEY, USER_TOKEN, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

process.env.FINESSE_HTTPS_PORT = '30543'
process.env.FINESSE_STREAM_PORT = '30544'
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const BASE = { h264_gst_pipeline: 'cudaupload ! video/x-raw(memory:CUDAMemory),format=NV12 ! nvh264enc ! sink', hevc_gst_pipeline: 'h265 ! sink', render_node: '/dev/dri/renderD128' }
const app = (title: string, id: string, env: string[] = []) => ({ title, id, ...BASE, runner: { type: 'docker', name: `Wolf${title.replace(/\W/g, '')}`, image: 'x', env } })

let sessions: any[] = [{ client_id: 'tv', client_ip: '192.168.1.80', app_id: '5', aes_key: 'k1' }, { client_id: 'mw', client_ip: '192.168.1.2', app_id: '5', aes_key: 'old' }]
const bodies: { path: string; body: any }[] = []
let lobbies: any[] = []

async function fakeWolf(socket: string) {
  const send = (res: ServerResponse, data: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://wolf')
    if (url.pathname === '/api/v1/apps') return send(res, { success: true, apps: [app('Wolf UI', '5'), app('Desktop', '6')] })
    if (url.pathname === '/api/v1/profiles') return send(res, { success: true, profiles: [{ id: 'user', name: 'User', apps: [app('Path of Exile 2', 'finesse-steam-2694490', ['FINESSE_STEAM_APPID=2694490'])] }] })
    if (url.pathname === '/api/v1/sessions') return send(res, { success: true, sessions })
    if (url.pathname === '/api/v1/lobbies') return send(res, { success: true, lobbies })
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    bodies.push({ path: url.pathname, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') })
    if (url.pathname === '/api/v1/lobbies/create') {
      lobbies.push({ id: 'lobby-1', name: bodies.at(-1)!.body.name, started_by_profile_id: bodies.at(-1)!.body.profile_id, connected_sessions: [] })
      return send(res, { success: true, lobby_id: 'lobby-1' })
    }
    send(res, { success: true })
  })
  await new Promise<void>((r) => server.listen(socket, r))
  return server
}

/** What reached Moonlight-Web. */
const seen: IncomingMessage[] = []
async function fakeMoonlightWeb() {
  const server = createHttpsServer(selfSignedCert(['127.0.0.1']), (req, res) => {
    seen.push(req)
    if (req.url === '/' || req.url?.startsWith('/?')) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'" })
      return res.end('<html><body><script type="module" src="/js/app.js?v=0.4.0"></script></body></html>')
    }
    res.writeHead(200, { 'Content-Type': 'text/javascript' })
    res.end('export {}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return server
}

let jf: FakeJellyfin
let wolf: Server
let mw: HttpsServer
let docker: FakeDocker
let finesse: { url: string; app: Server }
let stream: { url: string; server: HttpsServer }

before(async () => {
  jf = await fakeJellyfin()
  const dir = tmp('finesse-bstream-')
  wolf = await fakeWolf(join(dir, 'wolf.sock'))
  mw = await fakeMoonlightWeb()
  docker = await fakeDocker([{ id: 'm', name: 'moonlightweb', image: 'ghcr.io/linckosz/moonlight-web:0.4.0', env: ['MW_HTTPS_PORT=30600'], networkMode: 'host' }], {
    exec: (c, cmd) => (c === 'moonlightweb' && cmd.join(' ') === 'moonlightweb --new-pin' ? 'Moonlight-Web\n  Access PIN   482913\n  valid 5 min\n' : ''),
  })
  process.env.FINESSE_MOONLIGHT_WEB = `https://127.0.0.1:${(mw.address() as AddressInfo).port}`
  process.env.FINESSE_MOONLIGHT_WEB_CONTAINER = 'moonlightweb'
  const config = join(dir, 'config')
  mkdirSync(config, { recursive: true })
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(dir, 'web', rel, '..'), { recursive: true })
    writeFileSync(join(dir, 'web', rel), c)
  }
  const settingsFile = join(config, 'finesse.json')
  writeFileSync(settingsFile, JSON.stringify({ version: 1, instanceId: 'bstream-test', mode: 'adopt', setup: { state: 'ready' }, jellyfin: { url: jf.url, apiKey: API_KEY, basePath: '' }, services: {} }))
  process.env.WOLF_SOCKET = join(dir, 'wolf.sock')
  process.env.DOCKER_SOCKET = docker.socket
  const paths = { configDir: config, settingsFile, invitesDb: join(config, 'invites.db'), bakedWeb: join(dir, 'web'), updatedWeb: join(config, 'web'), previews: join(config, 'previews'), backups: join(config, 'backups') }
  const { createApp } = await import('../src/app.ts')
  const created = createApp({ paths })
  finesse = { url: await listen(created.server), app: created.server }
  const bs = created.deps.browserStream!
  const server = createHttpsServer(selfSignedCert(['127.0.0.1']), (req, res) => bs.handle(req, res))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  stream = { url: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, server }
})

after(async () => {
  for (const s of [finesse.app, wolf, mw, stream.server] as Server[]) {
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  }
  await docker.close()
  await jf.close()
})

const H = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="test", Device="t", DeviceId="t", Version="1", Token="${token}"` })
async function api(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(`${finesse.url}${path}`, { method, headers: token ? H(token) : {}, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, any> }
}

describe('Wolf games in Finesse’s page', () => {
  let cookie = ''
  let play = ''

  test('a ticket needs a Finesse sign-in, and says to stream Wolf UI for a profile’s game', async () => {
    assert.equal((await api('POST', '/api/streaming/browser', undefined, { app: 'finesse-steam-2694490' })).status, 401)
    const r = await api('POST', '/api/streaming/browser', USER_TOKEN, { app: 'finesse-steam-2694490' })
    assert.equal(r.status, 200)
    assert.equal(r.data.port, 30544)
    assert.equal(r.data.join, true)
    play = r.data.play
    // Without the ticket, the stream port is closed; the ticket works once.
    assert.equal((await fetch(`${stream.url}/`)).status, 403)
    const enter = await fetch(`${stream.url}/__finesse/enter?t=${r.data.ticket}`, { redirect: 'manual' })
    assert.equal(enter.status, 302)
    assert.equal(enter.headers.get('location'), '/?app=Wolf%20UI')
    const set = enter.headers.get('set-cookie') ?? ''
    assert.match(set, /^finesse_stream=[0-9a-f]{48}; Path=\/; Secure; HttpOnly; SameSite=Strict/)
    cookie = set.split(';')[0]!
    assert.equal((await fetch(`${stream.url}/__finesse/enter?t=${r.data.ticket}`, { redirect: 'manual' })).status, 403)
    // A top-level app streams itself: nothing to join.
    assert.equal((await api('POST', '/api/streaming/browser', USER_TOKEN, { app: '6' })).data.join, false)
  })

  test('Moonlight-Web’s page: Finesse’s script in it, framed by Finesse’s https page only, none of Finesse’s cookies passed on', async () => {
    seen.length = 0
    const r = await fetch(`${stream.url}/?app=Wolf%20UI`, { headers: { cookie: `${cookie}; finesse_media_token=jellyfin-secret; mw_session=abc`, 'x-forwarded-for': '127.0.0.1' } })
    assert.equal(r.status, 200)
    const html = await r.text()
    assert.match(html, /<script type="module" src="\/__finesse\/boot\.js"><\/script><\/body>/)
    assert.equal(r.headers.get('x-frame-options'), null)
    assert.equal(r.headers.get('content-security-policy'), "default-src 'self'; frame-ancestors https://127.0.0.1:30543; object-src 'none'")
    const up = seen[0]!
    assert.equal(up.headers.cookie, 'mw_session=abc')
    assert.equal(up.headers['x-forwarded-for'], undefined)
    assert.equal(up.headers.host, new URL(process.env.FINESSE_MOONLIGHT_WEB!).host)
    const boot = await fetch(`${stream.url}/__finesse/boot.js`, { headers: { cookie } })
    assert.match(await boot.text(), /skipSelfStreamWarn: true/)
  })

  test('the access PIN comes from Moonlight-Web’s container, for the page with the cookie only', async () => {
    assert.equal((await fetch(`${stream.url}/__finesse/pin`, { method: 'POST' })).status, 403)
    const r = await fetch(`${stream.url}/__finesse/pin`, { method: 'POST', headers: { cookie } })
    assert.equal(await r.text(), '482913')
    assert.ok(docker.calls.includes('exec moonlightweb moonlightweb --new-pin'))
  })

  test('the game starts in the session this page’s stream opened, not the TV’s', async () => {
    // Before the stream opens: nothing to start it in.
    assert.equal((await api('POST', '/api/streaming/launch', USER_TOKEN, { app: 'finesse-steam-2694490', session: `browser:${play}` })).status, 404)
    // Moonlight-Web's stream from before, picked up again with new keys.
    sessions = [sessions[0], { client_id: 'mw', client_ip: '192.168.1.2', app_id: '5', aes_key: 'new', video_width: 1920, video_height: 1080 }]
    const r = await api('POST', '/api/streaming/launch', USER_TOKEN, { app: 'finesse-steam-2694490', session: `browser:${play}` })
    assert.equal(r.status, 202)
    const join = bodies.find((b) => b.path === '/api/v1/lobbies/join')!
    assert.equal(join.body.moonlight_session_id, 'mw')
    // Next time Moonlight-Web picks up the session it already had: still the right one (remembered).
    const again = await api('POST', '/api/streaming/browser', USER_TOKEN, { app: 'finesse-steam-2694490' })
    bodies.length = 0
    assert.equal((await api('POST', '/api/streaming/launch', USER_TOKEN, { app: 'finesse-steam-2694490', session: `browser:${again.data.play}` })).status, 202)
    assert.equal(bodies.find((b) => b.path === '/api/v1/lobbies/join')!.body.moonlight_session_id, 'mw')
    // …and back into the game that's still running, not a second copy of it.
    assert.equal(bodies.filter((b) => b.path === '/api/v1/lobbies/create').length, 0)
    assert.equal(bodies.find((b) => b.path === '/api/v1/lobbies/join')!.body.lobby_id, 'lobby-1')
    // Someone else's play id gets nothing.
    assert.equal((await api('POST', '/api/streaming/launch', USER_TOKEN, { app: 'finesse-steam-2694490', session: 'browser:nope' })).status, 404)
  })
})
