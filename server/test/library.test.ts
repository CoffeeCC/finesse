// The game library around Wolf: Lutris games as tiles (read from Lutris's own
// database), what's running, play history, Wolf's graphics memory (a warning
// for administrators, and a restart when it's full and nothing plays), the
// stream quality for games in Finesse's page, and the setup check for it.
// A fake Wolf and a fake Docker stand in for the real ones.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { lutrisShortcut, lutrisShortcutId, parseLutrisRows } from '../src/lutris.ts'
import { appKind } from '../src/steam.ts'
import { fakeDocker, type FakeDocker } from './fakeDocker.ts'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

process.env.FINESSE_WATCH_MS = '150'
process.env.FINESSE_HTTPS_PORT = '30543'

const BASE = { h264_gst_pipeline: 'video/x-raw(memory:CUDAMemory) ! nvh264enc', render_node: '/dev/dri/renderD128', support_hdr: false, start_virtual_compositor: true }
const lutrisApp = { title: 'Lutris', id: '30', ...BASE, runner: { type: 'docker', name: 'WolfLutris', image: 'ghcr.io/games-on-whales/lutris:edge', env: ['RUN_SWAY=1', 'WOLF_LUTRIS_GAMEPAD_UI_ENABLE=1'], mounts: [], devices: [], ports: [], base_create_json: '{}' } }
const kodi = { title: 'Kodi', id: '31', ...BASE, runner: { type: 'docker', name: 'WolfKodi', image: 'ghcr.io/games-on-whales/kodi:edge', env: [], mounts: [], devices: [], ports: [], base_create_json: '{}' } }

let profiles: any[] = [{ id: 'user', name: 'User', apps: [lutrisApp, kodi] }]
let lobbies: any[] = []
let sessions: any[] = []
let gpu = { used: 2000, wolf: 300 }
let pga: unknown[] = [
  { id: 7, name: 'Diablo II', slug: 'diablo-ii', lastplayed: 1792000000, playtime: 12.5, installed: 1, hidden: 0 },
  { id: 8, name: 'Not installed', slug: 'x', lastplayed: 0, playtime: 0, installed: 0, hidden: 0 },
]

async function fakeWolf(socket: string) {
  const send = (res: ServerResponse, data: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  const read = async (req: IncomingMessage) => {
    const c: Buffer[] = []
    for await (const x of req) c.push(x as Buffer)
    return JSON.parse(Buffer.concat(c).toString() || '{}')
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://wolf')
    if (url.pathname === '/api/v1/apps') return send(res, { success: true, apps: [{ title: 'Wolf UI', id: '5', ...BASE, runner: { type: 'docker', name: 'WolfUI', image: 'x', env: [] } }] })
    if (url.pathname === '/api/v1/profiles') return send(res, { success: true, profiles })
    if (url.pathname === '/api/v1/lobbies') return send(res, { success: true, lobbies })
    if (url.pathname === '/api/v1/sessions') return send(res, { success: true, sessions })
    if (url.pathname === '/api/v1/clients') return send(res, { success: true, clients: [] })
    const body = await read(req)
    if (url.pathname === '/api/v1/profiles/remove') profiles = profiles.filter((p) => p.id !== body.id)
    if (url.pathname === '/api/v1/profiles/add') profiles.push(body)
    send(res, { success: true })
  })
  await new Promise<void>((r) => server.listen(socket, r))
  return server
}

let jf: FakeJellyfin
let wolf: Server
let docker: FakeDocker
let finesse: { url: string; app: Server }
let settingsFile = ''

before(async () => {
  jf = await fakeJellyfin()
  const dir = tmp('finesse-library-')
  wolf = await fakeWolf(join(dir, 'wolf.sock'))
  docker = await fakeDocker([{ id: 'w', name: 'wolf', image: 'ghcr.io/games-on-whales/wolf:stable', env: ['HOST_APPS_STATE_FOLDER=/etc/wolf'], mounts: [{ Source: '/mnt/NVME/wolf', Destination: '/etc/wolf' }] }], {
    run: (body) => (body.HostConfig.Binds.includes('/mnt/NVME/wolf/profile-data/user/WolfLutris:/lutris:ro') ? JSON.stringify(pga) + '\n' : ''),
    exec: (c, cmd) => {
      if (c !== 'w') return ''
      const line = cmd.join(' ')
      if (line.includes('query-compute-apps')) return `GPU-a, /wolf/wolf, ${gpu.wolf}\n`
      if (line.includes('query-gpu')) return `GPU-a, NVIDIA GeForce RTX 3060, ${gpu.used}, 12288\n`
      return ''
    },
  })
  const config = join(dir, 'config')
  mkdirSync(config, { recursive: true })
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(dir, 'web', rel, '..'), { recursive: true })
    writeFileSync(join(dir, 'web', rel), c)
  }
  settingsFile = join(config, 'finesse.json')
  writeFileSync(settingsFile, JSON.stringify({ version: 1, instanceId: 'library-test', mode: 'adopt', setup: { state: 'ready' }, jellyfin: { url: jf.url, apiKey: API_KEY, basePath: '' }, services: {} }))
  process.env.WOLF_SOCKET = join(dir, 'wolf.sock')
  process.env.DOCKER_SOCKET = docker.socket
  process.env.FINESSE_IMAGE = 'finesse:test'
  const paths = { configDir: config, settingsFile, invitesDb: join(config, 'invites.db'), bakedWeb: join(dir, 'web'), updatedWeb: join(config, 'web'), previews: join(config, 'previews'), backups: join(config, 'backups') }
  const { createApp } = await import('../src/app.ts')
  const app = createApp({ paths })
  finesse = { url: await listen(app.server), app: app.server }
})

after(async () => {
  for (const s of [finesse.app, wolf]) {
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  }
  await docker.close()
  await jf.close()
})

const H = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="test", Device="t", DeviceId="t", Version="1", Token="${token}"` })
async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(`${finesse.url}${path}`, { method, headers: token ? H(token) : {}, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, any> }
}
const userApps = () => profiles.find((p) => p.id === 'user')!.apps as any[]
const userTiles = async (token = USER_TOKEN) => ((await call('GET', '/api/streaming', token)).data.profiles as any[]).find((p) => p.id === 'user').apps as any[]
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('Lutris games', () => {
  test('from Lutris’s database: installed and not hidden there', () => {
    assert.deepEqual(
      parseLutrisRows([...pga, { id: 9, name: 'Hidden in Lutris', installed: 1, hidden: 1 }, { id: 0, name: 'bad', installed: 1 }]),
      [{ id: 7, name: 'Diablo II', slug: 'diablo-ii', lastPlayed: 1792000000, playtime: 12.5 }],
    )
  })

  test('a shortcut opens Lutris straight into the game, without its gamepad front end', () => {
    const s = lutrisShortcut(lutrisApp, { id: 7, name: 'Diablo II' }) as any
    assert.equal(s.id, 'finesse-lutris-7')
    assert.equal(s.runner.name, 'WolfLutris')
    assert.deepEqual(s.runner.env, ['RUN_SWAY=1', 'WOLF_LUTRIS_GAMEPAD_UI_ENABLE=0', 'LUTRIS_ARGS=lutris:rungameid/7', 'FINESSE_LUTRIS_ID=7'])
    assert.equal(lutrisShortcutId(s), 7)
    assert.equal(appKind(s), 'lutris')
  })

  test('administrators list and add them; the tile knows when it was played and for how long', async () => {
    assert.equal((await call('GET', '/api/streaming/lutris', USER_TOKEN)).status, 403)
    const list = await call('GET', '/api/streaming/lutris', ADMIN_TOKEN)
    assert.deepEqual(list.data.games.map((g: any) => [g.name, g.added]), [['Diablo II', false]])
    assert.equal((await call('POST', '/api/streaming/lutris/shortcuts', ADMIN_TOKEN, { all: true })).data.added, 1)
    assert.deepEqual(userApps().map((a) => a.title), ['Lutris', 'Kodi', 'Diablo II'])
    const tile = (await userTiles()).find((a) => a.title === 'Diablo II')
    assert.equal(tile.kind, 'lutris')
    assert.equal(tile.lutris, 7)
    assert.equal(tile.lastPlayed, 1792000000)
    assert.equal(tile.playtime, 45000)
    // Its cover can come from Lutris's own folder (no SteamGridDB key here).
    assert.equal(tile.art, true)
    assert.equal((await userTiles()).find((a) => a.title === 'Kodi').art, undefined)
  })

  test('keep in sync covers Lutris too', async () => {
    pga = [{ id: 11, name: 'Hades', slug: 'hades', lastplayed: 0, playtime: 0, installed: 1, hidden: 0 }]
    const r = await call('PUT', '/api/streaming/steam/sync', ADMIN_TOKEN, { on: true })
    assert.deepEqual([r.data.added, r.data.removed], [1, 1])
    assert.deepEqual(userApps().map((a) => a.title), ['Lutris', 'Kodi', 'Hades'])
    await call('PUT', '/api/streaming/steam/sync', ADMIN_TOKEN, { on: false })
  })
})

describe('what’s running, and play history', () => {
  test('a game waiting in Wolf shows as running; time in it is counted', async () => {
    lobbies = [{ id: 'l1', name: 'Hades', started_by_profile_id: 'user', connected_sessions: ['s1'] }]
    assert.equal((await userTiles()).find((a) => a.title === 'Hades').running, true)
    assert.equal((await userTiles()).find((a) => a.title === 'Kodi').running, undefined)
    await wait(700)
    const h = JSON.parse(readFileSync(settingsFile, 'utf8')).streaming.history['user|hades']
    assert.ok(h.s > 0 && h.last > 1_700_000_000)
    // Nobody in it: still running, but no more time counted.
    lobbies = [{ id: 'l1', name: 'Hades', started_by_profile_id: 'user', connected_sessions: [] }]
    await wait(400)
    const before = JSON.parse(readFileSync(settingsFile, 'utf8')).streaming.history['user|hades'].s
    await wait(500)
    assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).streaming.history['user|hades'].s, before)
  })
})

describe('Wolf’s graphics memory', () => {
  test('nearly full: administrators are told; nobody else', async () => {
    gpu = { used: 11800, wolf: 11000 }
    await wait(800)
    const admin = await call('GET', '/api/streaming', ADMIN_TOKEN)
    assert.deepEqual(admin.data.gpuWarning, { used: 11800, total: 12288, wolf: 11000 })
    assert.equal((await call('GET', '/api/streaming', USER_TOKEN)).data.gpuWarning, undefined)
    // A game is still in Wolf: no restart.
    assert.ok(!docker.calls.includes('restart w'))
  })

  test('full with nothing playing: Wolf is restarted, once; never when turned off', async () => {
    lobbies = []
    sessions = []
    await wait(800)
    assert.equal(docker.calls.filter((c) => c === 'restart w').length, 1)
    assert.equal((await call('PUT', '/api/streaming/settings', ADMIN_TOKEN, { autoRestartWolf: false })).data.autoRestartWolf, false)
    gpu = { used: 2000, wolf: 300 }
  })
})

describe('playing in Finesse’s page', () => {
  test('the stream quality: administrators pick one from the list', async () => {
    assert.equal((await call('PUT', '/api/streaming/settings', USER_TOKEN, { quality: '1080p60' })).status, 403)
    assert.equal((await call('PUT', '/api/streaming/settings', ADMIN_TOKEN, { quality: '8k' })).status, 400)
    const r = await call('PUT', '/api/streaming/settings', ADMIN_TOKEN, { quality: '1440p60' })
    assert.equal(r.data.quality, '1440p60')
    assert.equal((await call('GET', '/api/streaming/settings', ADMIN_TOKEN)).data.quality, '1440p60')
  })

  test('the setup check says what’s there and what to do about the rest', async () => {
    assert.equal((await call('GET', '/api/streaming/browser/check', USER_TOKEN)).status, 403)
    const r = await call('GET', '/api/streaming/browser/check', ADMIN_TOKEN)
    const by = Object.fromEntries(r.data.items.map((i: any) => [i.id, i]))
    assert.equal(r.data.ready, false)
    assert.equal(by.https.ok, true)
    assert.equal(by.port.ok, false)
    assert.match(by.port.fix[0], /FINESSE_STREAM_PORT/)
    assert.equal(by.mw.ok, false)
    assert.equal(by.paired.ok, true, 'unknown until the first game: not shown as a problem')
  })
})
