// Steam games as their own Wolf apps: reading Steam's manifests (installed
// games only, not Steam's own tools), and adding/removing shortcuts in Wolf's
// profiles without touching anything else there. A fake Wolf (with Wolf UI's
// profiles) and a fake Docker (Wolf's container, and the one-off container
// that reads Steam's folder) stand in for the real ones.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { isSteamApp, parseManifest, shortcutAppId, steamShortcut, vdfPairs } from '../src/steam.ts'
import { fakeDocker, type FakeDocker } from './fakeDocker.ts'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

const BASE = { h264_gst_pipeline: 'h264 ! sink', hevc_gst_pipeline: 'h265 ! sink', av1_gst_pipeline: 'av1 ! sink', render_node: '/dev/dri/renderD128', opus_gst_pipeline: 'opus ! sink' }
const STEAM_ENV = ['PROTON_LOG=1', 'RUN_SWAY=true', 'GOW_REQUIRED_DEVICES=/dev/input/* /dev/dri/* /dev/nvidia*']
const steamApp = (id: string) => ({
  title: 'Steam',
  id,
  support_hdr: false,
  icon_png_path: 'https://example/steam.png',
  ...BASE,
  start_virtual_compositor: true,
  start_audio_server: true,
  runner: { type: 'docker', name: 'WolfSteam', image: 'ghcr.io/games-on-whales/steam:edge', mounts: [], env: STEAM_ENV, devices: [], ports: [], base_create_json: '{"HostConfig":{}}' },
})
const otherApp = (title: string, id: string) => ({ title, id, support_hdr: false, ...BASE, start_virtual_compositor: true, start_audio_server: true, runner: { type: 'docker', name: `Wolf${title}`, image: 'x', mounts: [], env: [], devices: [], ports: [], base_create_json: '{}' } })

const manifest = (appid: number, name: string, flags = 4, size = 0) => `"AppState"\n{\n\t"appid"\t\t"${appid}"\n\t"name"\t\t"${name}"\n\t"StateFlags"\t\t"${flags}"\n\t"SizeOnDisk"\t\t"${size}"\n}\n`

async function fakeWolf(socket: string) {
  const bodies: { path: string; body: any }[] = []
  let profiles: any[] = [
    { id: 'user', name: 'User', icon_png_path: '', apps: [steamApp('10'), otherApp('RetroArch', '11')] },
    { id: 'kids', name: 'Kids', icon_png_path: '', apps: [otherApp('Kodi', '20')] },
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
    const url = new URL(req.url ?? '/', 'http://wolf')
    if (req.method === 'GET' && url.pathname === '/api/v1/apps') return send(res, 200, { success: true, apps: [otherApp('Wolf UI', '5')] })
    if (req.method === 'GET' && url.pathname === '/api/v1/profiles') return send(res, 200, { success: true, profiles })
    if (req.method === 'POST') {
      const body = await read(req)
      bodies.push({ path: url.pathname, body })
      if (url.pathname === '/api/v1/profiles/remove') {
        profiles = profiles.filter((p) => p.id !== body.id)
        return send(res, 200, { success: true })
      }
      if (url.pathname === '/api/v1/profiles/add') {
        for (const a of body.apps) for (const k of ['title', 'id', 'support_hdr', 'h264_gst_pipeline', 'render_node', 'start_virtual_compositor', 'runner']) if (!(k in a)) return send(res, 500, { success: false, error: `Field named '${k}' not found` })
        profiles.push(body)
        return send(res, 200, { success: true })
      }
    }
    send(res, 404, { success: false, error: 'not in the fake' })
  })
  await new Promise<void>((r) => server.listen(socket, r))
  return { server, bodies, profiles: () => profiles }
}

describe('Steam manifests', () => {
  test('installed games only; Steam’s own tools and unfinished downloads are left out', () => {
    assert.deepEqual(parseManifest(manifest(2694490, 'Path of Exile 2', 4, 123)), { appId: 2694490, name: 'Path of Exile 2', size: 123 })
    // Updating still plays: other bits next to "installed".
    assert.equal(parseManifest(manifest(2050650, 'Resident Evil 4', 6))?.name, 'Resident Evil 4')
    assert.equal(parseManifest(manifest(10, 'Half-Life', 1026)), null)
    assert.equal(parseManifest(manifest(2805730, 'Proton 9.0')), null)
    assert.equal(parseManifest(manifest(99999999, 'Proton - Experimental')), null)
    assert.equal(parseManifest(manifest(1628350, 'Steam Linux Runtime 3.0 (sniper)')), null)
    assert.equal(parseManifest('"AppState" { "name" "no id" }'), null)
    assert.deepEqual(vdfPairs('"name"\t"A \\"quoted\\" game"'), [['name', 'A "quoted" game']])
  })

  test('a shortcut is the Steam app opening one game, sharing its home folder', () => {
    const s = steamShortcut(steamApp('10'), { appId: 2694490, name: 'Path of Exile 2' }) as any
    assert.equal(s.id, 'finesse-steam-2694490')
    assert.equal(s.title, 'Path of Exile 2')
    assert.equal(s.runner.name, 'WolfSteam')
    assert.equal(s.runner.image, 'ghcr.io/games-on-whales/steam:edge')
    assert.deepEqual(s.runner.env, [...STEAM_ENV, 'STEAM_STARTUP_FLAGS=-bigpicture steam://rungameid/2694490', 'FINESSE_STEAM_APPID=2694490'])
    assert.equal(shortcutAppId(s), 2694490)
    assert.equal(isSteamApp(s), false)
    assert.equal(isSteamApp(steamApp('10')), true)
    assert.equal(isSteamApp(otherApp('Kodi', '1')), false)
  })
})

let jf: FakeJellyfin
let wolf: Awaited<ReturnType<typeof fakeWolf>>
let docker: FakeDocker
let finesse: { url: string; app: Server }
const env = { ...process.env }

before(async () => {
  jf = await fakeJellyfin()
  const dir = tmp('finesse-steam-')
  wolf = await fakeWolf(join(dir, 'wolf.sock'))
  docker = await fakeDocker(
    [{ id: 'w', name: 'wolf', image: 'ghcr.io/games-on-whales/wolf:stable', env: ['HOST_APPS_STATE_FOLDER=/etc/wolf'], mounts: [{ Source: '/mnt/NVME/wolf', Destination: '/etc/wolf' }] }],
    {
      run: (body) =>
        body.HostConfig.Binds.includes('/mnt/NVME/wolf/profile-data/user/WolfSteam:/steam:ro')
          ? JSON.stringify([manifest(2694490, 'Path of Exile 2', 4, 60e9), manifest(2050650, 'Resident Evil 4', 4, 70e9), manifest(2805730, 'Proton 9.0'), manifest(730, 'Counter-Strike 2', 1026)]) + '\n'
          : 'nothing here\n',
    },
  )
  const config = join(dir, 'config')
  mkdirSync(config, { recursive: true })
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(dir, 'web', rel, '..'), { recursive: true })
    writeFileSync(join(dir, 'web', rel), c)
  }
  const settingsFile = join(config, 'finesse.json')
  writeFileSync(settingsFile, JSON.stringify({ version: 1, instanceId: 'steam-test', mode: 'adopt', setup: { state: 'ready' }, jellyfin: { url: jf.url, apiKey: API_KEY, basePath: '' }, services: {} }))
  process.env.WOLF_SOCKET = join(dir, 'wolf.sock')
  process.env.DOCKER_SOCKET = docker.socket
  process.env.FINESSE_IMAGE = 'finesse:test'
  const paths = { configDir: config, settingsFile, invitesDb: join(config, 'invites.db'), bakedWeb: join(dir, 'web'), updatedWeb: join(config, 'web'), previews: join(config, 'previews'), backups: join(config, 'backups') }
  const { createApp } = await import('../src/app.ts')
  const app = createApp({ paths })
  finesse = { url: await listen(app.server), app: app.server }
})

after(async () => {
  for (const k of ['WOLF_SOCKET', 'DOCKER_SOCKET', 'FINESSE_IMAGE']) if (env[k] === undefined) delete process.env[k]
  for (const s of [finesse.app, wolf.server]) {
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  }
  await docker.close()
  await jf.close()
})

const H = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="test", Device="t", DeviceId="t", Version="1", Token="${token}"` })
async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(`${finesse.url}${path}`, { method, headers: token ? H(token) : {}, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let data: Record<string, any> = {}
  try {
    data = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: r.status, data }
}
const userApps = () => wolf.profiles().find((p) => p.id === 'user')!.apps as any[]

describe('Steam shortcuts in Wolf', () => {
  test('everyone sees that Steam is there; only administrators see the games', async () => {
    const all = await call('GET', '/api/streaming', USER_TOKEN)
    assert.equal(all.data.steam, true)
    assert.equal((await call('GET', '/api/streaming/steam', USER_TOKEN)).status, 403)
    const r = await call('GET', '/api/streaming/steam', ADMIN_TOKEN)
    assert.equal(r.data.ok, true)
    assert.deepEqual(
      r.data.games.map((g: any) => [g.appId, g.name, g.added]),
      [
        [2694490, 'Path of Exile 2', false],
        [2050650, 'Resident Evil 4', false],
      ],
    )
    // Read with Finesse's own image, Steam's folder read-only, nothing else mounted.
    const probe = Object.values(docker.created).find((b: any) => b.Image === 'finesse:test') as any
    assert.deepEqual(probe.HostConfig.Binds, ['/mnt/NVME/wolf/profile-data/user/WolfSteam:/steam:ro'])
    assert.equal(probe.HostConfig.NetworkMode, 'none')
  })

  test('adding a game puts it next to Steam, once, and leaves the other profile alone', async () => {
    const r = await call('POST', '/api/streaming/steam/shortcuts', ADMIN_TOKEN, { appId: 2694490 })
    assert.equal(r.status, 201)
    const added = userApps().find((a) => a.id === 'finesse-steam-2694490')
    assert.equal(added.title, 'Path of Exile 2')
    assert.ok(added.runner.env.includes('STEAM_STARTUP_FLAGS=-bigpicture steam://rungameid/2694490'))
    assert.deepEqual(userApps().map((a) => a.title), ['Steam', 'RetroArch', 'Path of Exile 2'])
    assert.ok(!wolf.bodies.some((b) => b.path === '/api/v1/profiles/add' && b.body.id === 'kids'))
    const adds = wolf.bodies.length
    assert.equal((await call('POST', '/api/streaming/steam/shortcuts', ADMIN_TOKEN, { appId: 2694490 })).status, 201)
    assert.equal(wolf.bodies.length, adds, 'already there: Wolf untouched')
    // Not installed, or not a game: refused.
    assert.equal((await call('POST', '/api/streaming/steam/shortcuts', ADMIN_TOKEN, { appId: 730 })).status, 404)
    assert.equal((await call('POST', '/api/streaming/steam/shortcuts', ADMIN_TOKEN, { appId: 'x' })).status, 400)
    assert.equal((await call('POST', '/api/streaming/steam/shortcuts', USER_TOKEN, { appId: 2050650 })).status, 403)
  })

  test('the Games page gets the shortcut with its Steam id (for the cover); the list marks it added', async () => {
    const all = await call('GET', '/api/streaming', USER_TOKEN)
    const user = all.data.profiles.find((p: any) => p.id === 'user')
    assert.deepEqual(user.apps.find((a: any) => a.title === 'Path of Exile 2'), { id: 'finesse-steam-2694490', title: 'Path of Exile 2', hdr: false, icon: true, steam: 2694490 })
    const list = await call('GET', '/api/streaming/steam', ADMIN_TOKEN)
    assert.equal(list.data.games.find((g: any) => g.appId === 2694490).added, true)
  })

  test('removing it takes out only the shortcut', async () => {
    const r = await call('DELETE', '/api/streaming/steam/shortcuts/2694490', ADMIN_TOKEN)
    assert.equal(r.status, 200)
    assert.equal(r.data.removed, 1)
    assert.deepEqual(userApps().map((a) => a.title), ['Steam', 'RetroArch'])
    assert.deepEqual(userApps()[0].runner.env, STEAM_ENV)
  })

  test('artwork needs a sign-in and a real app id', async () => {
    assert.equal((await call('GET', '/api/streaming/steam/art/2694490')).status, 401)
    assert.equal((await call('GET', '/api/streaming/steam/art/abc', USER_TOKEN)).status, 400)
  })
})
