// Browser play: a fake Docker (unix socket) and a fake Selkies (HTTP +
// WebSocket echo), with Finesse in front. Checks that a session's container is
// made from the emulator settings (folders by path, saves per profile, nothing
// secret in it), that only its owner reaches it, video WebSocket included, and
// that it goes away when stopped.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { readTar } from '../src/tar.ts'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

const ROMM_PASS = 'romm-secret-pass'

async function fakeSelkies() {
  const server = createServer((req, res) => {
    if (/^\/play\/[0-9a-f]{12}\/(index\.html)?$/.test(req.url ?? '')) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end('<title>selkies</title>')
    }
    res.writeHead(404)
    res.end()
  })
  const upgrades: string[] = []
  server.on('upgrade', (req, socket) => {
    upgrades.push(`${req.url} cookie=${req.headers.cookie ?? ''}`)
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    socket.pipe(socket)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { server, port: (server.address() as AddressInfo).port, upgrades }
}

async function fakeDocker(socket: string) {
  const created: { name: string; config: any }[] = []
  const archives: { name: string; files: { path: string; data: Buffer }[] }[] = []
  const removed: string[] = []
  const running = new Set<string>()
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://docker')
    const p = url.pathname.replace(/^\/v[\d.]+/, '')
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks)
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    if (p === '/_ping') return void res.end('OK')
    if (p === '/info') return json(200, { Runtimes: { runc: {} } })
    if (p === '/containers/json') return json(200, [])
    if (p.startsWith('/images/')) return json(200, { Id: 'sha256:x' })
    if (p === '/containers/create') {
      const name = url.searchParams.get('name')!
      created.push({ name, config: JSON.parse(body.toString()) })
      return json(201, { Id: name })
    }
    const m = /^\/containers\/([^/]+)(\/.*)?$/.exec(p)
    if (m) {
      const [, name, rest] = m as unknown as [string, string, string | undefined]
      if (req.method === 'PUT' && rest === '/archive') {
        archives.push({ name, files: readTar(body, { gzip: false }) })
        return void res.end()
      }
      if (req.method === 'POST' && rest === '/start') {
        running.add(name)
        res.writeHead(204)
        return void res.end()
      }
      if (req.method === 'DELETE') {
        removed.push(name)
        running.delete(name)
        res.writeHead(204)
        return void res.end()
      }
      if (rest === '/logs') {
        const line = Buffer.from('selkies: started\n')
        const head = Buffer.alloc(8)
        head[0] = 1
        head.writeUInt32BE(line.length, 4)
        return void res.end(Buffer.concat([head, line]))
      }
      if (rest === '/json' && created.some((c) => c.name === name))
        return json(200, { Id: name, State: { Running: running.has(name), ExitCode: 0 }, NetworkSettings: { Networks: { finesse: { IPAddress: '127.0.0.1' } } } })
    }
    json(404, { message: 'No such container' })
  })
  await new Promise<void>((r) => server.listen(socket, r))
  return { server, created, archives, removed }
}

let jf: FakeJellyfin
let selkies: Awaited<ReturnType<typeof fakeSelkies>>
let docker: Awaited<ReturnType<typeof fakeDocker>>
let romm: Server
let finesse: { url: string; app: Server }
let folders: Record<string, string>

before(async () => {
  jf = await fakeJellyfin()
  selkies = await fakeSelkies()
  const dir = tmp('finesse-play-')
  docker = await fakeDocker(join(dir, 'docker.sock'))
  romm = createServer((req, res) => {
    const roms: Record<string, unknown> = {
      '7': { id: 7, name: 'A PS2 Game', platform_slug: 'ps2', fs_path: 'roms/ps2', fs_name: 'A PS2 Game (USA).iso' },
      '8': { id: 8, name: 'An NES Game', platform_slug: 'nes', fs_path: 'roms/nes', fs_name: 'a.nes' },
    }
    const rom = roms[(/^\/api\/roms\/(\d+)$/.exec(req.url ?? '') ?? [])[1] ?? '']
    res.writeHead(rom ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(rom ?? {}))
  })
  const rommUrl = await listen(romm)
  folders = { roms: join(dir, 'romm'), emulators: join(dir, 'emu'), firmware: join(dir, 'fw'), keys: join(dir, 'keys'), saves: join(dir, 'saves') }
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
      instanceId: 'play-test',
      mode: 'adopt',
      setup: { state: 'ready' },
      jellyfin: { url: jf.url, apiKey: API_KEY, basePath: '' },
      services: { romm: { url: rommUrl, username: 'finesse', password: ROMM_PASS } },
      emulators: { apps: ['pcsx2', 'switch'], switchEmulator: 'eden', paths: folders },
    }),
  )
  process.env.DOCKER_SOCKET = join(dir, 'docker.sock')
  process.env.FINESSE_PLAY_PORT = String(selkies.port)
  const paths = { configDir: config, settingsFile, invitesDb: join(config, 'invites.db'), bakedWeb: join(dir, 'web'), updatedWeb: join(config, 'web'), previews: join(config, 'previews'), backups: join(config, 'backups') }
  const { createApp } = await import('../src/app.ts')
  const app = createApp({ paths })
  finesse = { url: await listen(app.server), app: app.server }
  await new Promise((r) => setTimeout(r, 200))
})

after(async () => {
  delete process.env.DOCKER_SOCKET
  delete process.env.FINESSE_PLAY_PORT
  for (const s of [finesse.app, selkies.server, docker.server, romm]) {
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  }
  await jf.close()
})

const auth = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="t", Device="t", DeviceId="t", Version="1", Token="${token}"` })
async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${finesse.url}${path}`, { method, headers: { ...(token ? auth(token) : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })
  const text = await r.text()
  let data: Record<string, any> = {}
  try {
    data = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  return { status: r.status, data, text }
}
async function ready(id: string, token: string) {
  for (let i = 0; i < 50; i++) {
    const r = await call('GET', `/api/play/${id}`, token)
    if (r.data.state !== 'starting') return r
    await new Promise((res) => setTimeout(res, 100))
  }
  throw new Error('never ready')
}
/** A WebSocket handshake through Finesse; resolves with what the far end echoes, or null when refused. */
function ws(path: string, cookie?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const u = new URL(finesse.url)
    const req = request({ host: u.hostname, port: u.port, path, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...(cookie ? { Cookie: cookie } : {}) } })
    req.on('upgrade', (_res, socket) => {
      socket.once('data', (d) => {
        resolve(d.toString())
        socket.destroy()
      })
      socket.write('ping')
    })
    req.on('response', () => resolve(null))
    req.on('error', () => resolve(null))
    req.end()
  })
}

let id = ''

test('discovery says browser play is on when the emulators are set up and Docker answers', async () => {
  const r = await call('GET', '/api/finesse')
  assert.equal(r.data.features.play, true)
})

test('only signed-in people start a game, and only consoles an emulator plays', async () => {
  assert.equal((await call('POST', '/api/play', undefined, { rom: 7 })).status, 401)
  assert.equal((await call('POST', '/api/play', USER_TOKEN, { rom: 8 })).status, 400)
  assert.equal((await call('POST', '/api/play', USER_TOKEN, { rom: 'x' })).status, 400)
})

test('a game starts in its own container, made from the emulator settings', async () => {
  const r = await call('POST', '/api/play', USER_TOKEN, { rom: 7, profile: 'user' })
  assert.equal(r.status, 202, r.text)
  id = r.data.id
  assert.match(id, /^[0-9a-f]{12}$/)
  assert.equal(r.data.url, `/play/${id}/`)
  const done = await ready(id, USER_TOKEN)
  assert.equal(done.data.state, 'ready', done.text)
  const c = docker.created.find((x) => x.name === `finesse-play-${id}`)!.config
  assert.match(c.Image, /^ghcr\.io\/linuxserver\/baseimage-selkies@sha256:[0-9a-f]{64}$/)
  assert.equal(c.Labels['finesse.managed'], 'true')
  assert.equal(c.Labels['finesse.play'], '1')
  assert.ok(c.HostConfig.Binds.includes(`${folders.roms}:/finesse/roms:ro`))
  assert.ok(c.HostConfig.Binds.includes(`${folders.saves}/user/pcsx2/memcards:/config/.config/PCSX2/memcards:rw`), 'saves in the profile’s folder, where PCSX2 looks under /config')
  for (const b of c.HostConfig.Binds.filter((x: string) => !x.startsWith(folders.saves))) assert.match(b, /:ro$/)
  assert.deepEqual(c.HostConfig.Mounts, [{ Type: 'volume', Source: 'finesse-play-user-pcsx2', Target: '/config' }])
  assert.ok(c.Env.includes(`SUBFOLDER=/play/${id}/`))
  assert.ok(c.Env.includes('FINESSE_GAME=/finesse/roms/roms/ps2/A PS2 Game (USA).iso'))
  assert.ok(c.Env.includes('HARDEN_DESKTOP=true'))
  assert.ok(!c.Env.some((e: string) => /^PASSWORD=/.test(e)), 'no password of its own: Finesse is the door')
  assert.doesNotMatch(JSON.stringify(c), new RegExp(`${ROMM_PASS}|${API_KEY}`), 'no secrets go into the container')
  const files = docker.archives.find((a) => a.name === `finesse-play-${id}`)!.files
  assert.deepEqual(files.map((f) => f.path).sort(), ['custom-cont-init.d/50-finesse-home', 'defaults/autostart', 'defaults/autostart_wayland', 'finesse-launch.sh'])
  assert.match(files.find((f) => f.path.startsWith('custom-cont-init.d/'))!.data.toString(), /find \/config -xdev -type d -user root -exec chown abc:abc/)
  const script = files.find((f) => f.path === 'finesse-launch.sh')!.data.toString()
  assert.match(script, /launcher\(\) \{ exec "\$@"; \}/)
  assert.doesNotMatch(script, /\/opt\/gow/)
  assert.match(script, /find_emu 'pcsx2\*\.appimage'/)
})

test('the session is its owner’s: page and WebSocket need their sign-in', async () => {
  assert.equal((await call('GET', `/play/${id}/`)).status, 401)
  const page = await call('GET', `/play/${id}/`, undefined, undefined, { Cookie: `finesse_play_token=${USER_TOKEN}` })
  assert.equal(page.status, 200)
  assert.match(page.text, /selkies/)
  assert.equal((await call('GET', `/play/${id}`)).status, 302)
  assert.equal(await ws(`/play/${id}/websocket`), null, 'no sign-in, no stream')
  assert.equal(await ws(`/play/${id}/websocket`, `finesse_play_token=${USER_TOKEN}`), 'ping')
  assert.ok(selkies.upgrades.every((u) => !u.includes(USER_TOKEN)), 'the sign-in stays with Finesse')
})

test('someone else can’t see or reach another person’s game', async () => {
  const theirs = await call('POST', '/api/play', ADMIN_TOKEN, { rom: 7, profile: 'admin' })
  const other = (await ready(theirs.data.id, ADMIN_TOKEN)).data.id
  assert.equal((await call('GET', `/api/play/${other}`, USER_TOKEN)).status, 404)
  assert.equal((await call('GET', `/play/${other}/`, undefined, undefined, { Cookie: `finesse_play_token=${USER_TOKEN}` })).status, 404)
  assert.equal(await ws(`/play/${other}/websocket`, `finesse_play_token=${USER_TOKEN}`), null)
  assert.equal((await call('GET', `/api/play/${id}/log`, USER_TOKEN)).status, 403)
  assert.match((await call('GET', `/api/play/${id}/log`, ADMIN_TOKEN)).data.log, /selkies: started/)
  await call('DELETE', `/api/play/${other}`, ADMIN_TOKEN)
})

test('a new game replaces the person’s old one, and Stop removes it', async () => {
  const next = await call('POST', '/api/play', USER_TOKEN, { rom: 7 })
  assert.ok(docker.removed.includes(`finesse-play-${id}`), 'the old one went')
  assert.equal((await call('GET', `/api/play/${id}`, USER_TOKEN)).status, 404)
  const nid = (await ready(next.data.id, USER_TOKEN)).data.id
  assert.equal((await call('DELETE', `/api/play/${nid}`, USER_TOKEN)).status, 200)
  assert.ok(docker.removed.includes(`finesse-play-${nid}`))
  assert.equal((await call('GET', `/play/${nid}/`, undefined, undefined, { Cookie: `finesse_play_token=${USER_TOKEN}` })).status, 404)
})
