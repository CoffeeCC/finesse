// Emulators as Wolf apps: a fake Wolf (with Wolf UI's profiles) and a fake
// RomM, and a Finesse in front of both. Checks that the apps land in Wolf once
// and only once, that folders go in by path (read-only, saves per profile),
// that the readiness check goes by file names only, and that starting a game
// never hands the browser Wolf's session ids or keys.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { emulatorCatalog, launchScript, readiness, validateEmulators, wolfApp, type EmulatorSettings } from '../src/emulators.ts'
import { gamePath, pickGame } from '../src/streaming.ts'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

const BASE = { h264_gst_pipeline: 'h264 ! sink', hevc_gst_pipeline: 'h265 ! sink', av1_gst_pipeline: 'av1 ! sink', render_node: '/dev/dri/renderD128', opus_gst_pipeline: 'opus ! sink' }
// Stand-ins for what a real install has: never real firmware, keys or games.
const SECRET_KEY_TEXT = 'not-a-real-key-0123456789abcdef'

async function fakeWolf(socket: string) {
  const calls: string[] = []
  const bodies: { path: string; body: any }[] = []
  const app = (title: string, id: string) => ({ title, id, support_hdr: false, ...BASE, start_virtual_compositor: true, start_audio_server: true, runner: { type: 'docker', name: `Wolf${title}`, image: 'x', mounts: [], env: [], devices: [], ports: [], base_create_json: '{}' } })
  let profiles: any[] = [
    { id: 'user', name: 'User', icon_png_path: '', pin: [4, 3, 2, 1], apps: [app('Steam', '10')] },
    { id: 'kids', name: 'Kids', icon_png_path: '', apps: [app('RetroArch', '20')] },
  ]
  const sessions = [{ client_id: '987654321', client_ip: '192.168.1.70', app_id: '5', aes_key: 'AESKEY-SHOULD-NOT-LEAK', aes_iv: 'IV', rtsp_fake_ip: '1.2.3.4', video_width: 1920, video_height: 1080, video_refresh_rate: 60, audio_channel_count: 2 }]
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
    if (req.method === 'GET' && url.pathname === '/api/v1/apps') return send(res, 200, { success: true, apps: [app('Wolf UI', '5')] })
    if (req.method === 'GET' && url.pathname === '/api/v1/profiles') return send(res, 200, { success: true, profiles })
    if (req.method === 'GET' && url.pathname === '/api/v1/sessions') return send(res, 200, { success: true, sessions })
    if (req.method === 'POST') {
      const body = await read(req)
      bodies.push({ path: url.pathname, body })
      if (url.pathname === '/api/v1/profiles/remove') {
        profiles = profiles.filter((p) => p.id !== body.id)
        return send(res, 200, { success: true })
      }
      if (url.pathname === '/api/v1/profiles/add') {
        // Like Wolf (rfl): every field of an app is required.
        for (const a of body.apps) for (const k of ['title', 'id', 'support_hdr', 'h264_gst_pipeline', 'render_node', 'start_virtual_compositor', 'runner']) if (!(k in a)) return send(res, 500, { success: false, error: `Field named '${k}' not found` })
        profiles.push(body)
        return send(res, 200, { success: true })
      }
      // Like Wolf: starts the runner and never answers.
      if (url.pathname === '/api/v1/runners/start') return
    }
    send(res, 404, { success: false, error: 'not in the fake' })
  })
  await new Promise<void>((r) => server.listen(socket, r))
  return { server, calls, bodies, profiles: () => profiles }
}

async function fakeRomm() {
  const roms: Record<string, unknown> = {
    '7': { id: 7, name: 'A PS2 Game', platform_slug: 'ps2', fs_path: 'roms/ps2', fs_name: 'A PS2 Game (USA).iso' },
    '8': { id: 8, name: 'An NES Game', platform_slug: 'nes', fs_path: 'roms/nes', fs_name: 'a.nes' },
    '9': { id: 9, name: 'Sneaky', platform_slug: 'ps2', fs_path: 'roms/../../etc', fs_name: 'passwd' },
  }
  let auth = ''
  const server = createServer((req, res) => {
    auth = String(req.headers.authorization ?? '')
    const m = /^\/api\/roms\/(\d+)$/.exec(req.url ?? '')
    const rom = m && roms[m[1]!]
    res.writeHead(rom ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(rom ?? { detail: 'not found' }))
  })
  return { url: await listen(server), server, auth: () => auth }
}

let jf: FakeJellyfin
let wolf: Awaited<ReturnType<typeof fakeWolf>>
let romm: Awaited<ReturnType<typeof fakeRomm>>
let finesse: { url: string; app: Server; settingsFile: string }
let folders: { roms: string; emulators: string; firmware: string; keys: string; saves: string }

before(async () => {
  jf = await fakeJellyfin()
  romm = await fakeRomm()
  const dir = tmp('finesse-emu-')
  wolf = await fakeWolf(join(dir, 'wolf.sock'))
  // The NAS's folders: empty stand-in files, named like the real ones.
  folders = { roms: join(dir, 'romm'), emulators: join(dir, 'emulators'), firmware: join(dir, 'firmware'), keys: join(dir, 'keys'), saves: join(dir, 'saves') }
  for (const d of ['romm/roms/ps2', 'romm/roms/ngc', 'romm/roms/switch', 'emulators', 'firmware/pcsx2', 'firmware/rpcs3', 'keys/switch', 'keys/cemu', 'saves']) mkdirSync(join(dir, d), { recursive: true })
  writeFileSync(join(folders.emulators, 'pcsx2-v2.2.0-linux-appimage-x64-Qt.AppImage'), '', { mode: 0o755 })
  writeFileSync(join(folders.emulators, 'Cemu-2.6-x86_64.AppImage'), '', { mode: 0o644 })
  writeFileSync(join(folders.emulators, 'ryujinx-1.3.3-x64.AppImage'), '', { mode: 0o755 })
  writeFileSync(join(folders.firmware, 'pcsx2', 'SCPH-70012.bin'), '')
  writeFileSync(join(folders.keys, 'switch', 'prod.keys'), SECRET_KEY_TEXT)
  const config = join(dir, 'config')
  mkdirSync(config, { recursive: true })
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(dir, 'web', rel, '..'), { recursive: true })
    writeFileSync(join(dir, 'web', rel), c)
  }
  const settingsFile = join(config, 'finesse.json')
  writeFileSync(
    settingsFile,
    JSON.stringify({ version: 1, instanceId: 'emu-test', mode: 'adopt', setup: { state: 'ready' }, jellyfin: { url: jf.url, apiKey: API_KEY, basePath: '' }, services: { romm: { url: romm.url, username: 'finesse', password: 'romm-pass' } } }),
  )
  process.env.WOLF_SOCKET = join(dir, 'wolf.sock')
  const paths = { configDir: config, settingsFile, invitesDb: join(config, 'invites.db'), bakedWeb: join(dir, 'web'), updatedWeb: join(config, 'web'), previews: join(config, 'previews'), backups: join(config, 'backups') }
  const { createApp } = await import('../src/app.ts')
  const app = createApp({ paths })
  finesse = { url: await listen(app.server), app: app.server, settingsFile }
})

after(async () => {
  delete process.env.WOLF_SOCKET
  for (const s of [finesse.app, wolf.server, romm.server]) {
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  }
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
  return { status: r.status, data, text }
}

const settingsFor = (apps: EmulatorSettings['apps']): EmulatorSettings => ({ apps, paths: { ...folders } })

describe('emulator settings', () => {
  test('folders are full paths Wolf can mount, and nothing else', () => {
    assert.deepEqual(validateEmulators(settingsFor(['pcsx2'])), [])
    for (const bad of ['relative/path', '/a/../etc', '/a:b', '/with,comma', "/quote'd", '/dollar$HOME', '/new\nline'])
      assert.notDeepEqual(validateEmulators({ apps: ['pcsx2'], paths: { ...folders, firmware: bad } }), [], bad)
    assert.notDeepEqual(validateEmulators({ apps: ['n64'], paths: folders }), [])
    assert.notDeepEqual(validateEmulators({ apps: ['pcsx2'], paths: { ...folders, saves: undefined } }), [], 'saves are required with apps')
    assert.notDeepEqual(validateEmulators({ apps: [], paths: {}, profiles: ['a b'] }), [])
    assert.notDeepEqual(validateEmulators({ apps: [], paths: {}, switchEmulator: 'yuzu' }), [])
  })

  test('each app gets its folders by path: games, firmware and keys read-only, saves per profile read-write', () => {
    const s = settingsFor(['pcsx2', 'switch', 'esde'])
    const a = wolfApp('pcsx2', { settings: s, profile: 'user', base: BASE })
    const mounts = (a.runner as { mounts: string[] }).mounts
    assert.ok(mounts.includes(`${folders.roms}:/finesse/roms:ro`))
    assert.ok(mounts.includes(`${folders.emulators}:/finesse/emulators:ro`))
    assert.ok(mounts.includes(`${folders.firmware}/pcsx2:/finesse/firmware/pcsx2:ro`))
    assert.ok(mounts.includes(`${folders.saves}/user/pcsx2/memcards:/home/retro/.config/PCSX2/memcards:rw`))
    for (const m of mounts) assert.match(m, /:(ro|rw)$/)
    for (const m of mounts.filter((x) => !x.startsWith(folders.saves))) assert.match(m, /:ro$/, 'only saves are writable')
    assert.equal(a.h264_gst_pipeline, BASE.h264_gst_pipeline, 'Wolf’s own encoder settings')
    const sw = wolfApp('switch', { settings: s, profile: 'kids', base: BASE })
    assert.equal(sw.title, 'Ryujinx (Switch)')
    assert.ok((sw.runner as { mounts: string[] }).mounts.includes(`${folders.keys}/switch:/finesse/keys/switch:ro`))
    assert.ok((sw.runner as { mounts: string[] }).mounts.some((m) => m.startsWith(`${folders.saves}/kids/switch/`)))
    assert.equal(wolfApp('switch', { settings: { ...s, switchEmulator: 'eden' }, profile: 'kids', base: BASE }).title, 'Eden (Switch)')
    // ES-DE shares every emulator's folders and saves.
    const es = (wolfApp('esde', { settings: s, profile: 'user', base: BASE }).runner as { mounts: string[] }).mounts
    assert.ok(es.includes(`${folders.firmware}/pcsx2:/finesse/firmware/pcsx2:ro`) && es.includes(`${folders.keys}/switch:/finesse/keys/switch:ro`))
  })

  test('a per-emulator folder wins over <root>/<emulator>', () => {
    const s = { ...settingsFor(['cemu']), folders: { cemu: { keys: '/elsewhere/wiiu-keys' } } }
    assert.ok((wolfApp('cemu', { settings: s, profile: 'user', base: BASE }).runner as { mounts: string[] }).mounts.includes('/elsewhere/wiiu-keys:/finesse/keys/cemu:ro'))
  })

  test('the start script finds the program by name and passes a game as one argument', () => {
    const cat = emulatorCatalog()
    const script = launchScript(cat.pcsx2, Object.values(cat))
    assert.match(script, /find_emu 'pcsx2\*\.appimage'/)
    assert.match(script, /printf 'BIN=%q\\nGAME=%q\\n'/, 'quoted with %q, so spaces and quotes stay one argument')
    assert.match(script, /launcher \/tmp\/finesse-run\.sh$/)
    assert.doesNotMatch(script, /(^|[\s;|])(cat|base64|xxd|od|head -c) /m, 'never reads a file')
    // Eden opens its firmware read-write, so it gets its own copy (a link to the read-only folder can't open).
    const eden = launchScript(emulatorCatalog('eden').switch, Object.values(emulatorCatalog('eden')))
    assert.match(eden, /copyin \/finesse\/firmware\/switch '\/home\/retro\/\.local\/share\/eden\/nand\/system\/Contents\/registered' '\*\.nca'/)
    assert.match(eden, /link \/finesse\/keys\/switch/)
  })

  test('readiness goes by file names: what’s there, what’s missing, what Finesse can’t see', () => {
    const r = readiness({ ...settingsFor(['pcsx2', 'cemu', 'switch', 'rpcs3', 'dolphin']), paths: { ...folders } })
    const item = (id: string, label: string) => r.find((x) => x.id === id)!.items.find((i) => i.label === label)!
    assert.equal(item('pcsx2', 'PCSX2').state, 'ok')
    assert.equal(item('pcsx2', 'PS2 BIOS').state, 'ok')
    assert.equal(r.find((x) => x.id === 'pcsx2')!.ready, true)
    assert.equal(item('cemu', 'Cemu').state, 'ok')
    assert.match(item('cemu', 'Cemu').detail, /executable/)
    assert.equal(item('cemu', 'keys.txt').state, 'missing')
    assert.equal(item('switch', 'prod.keys').state, 'ok')
    assert.equal(item('switch', 'Switch firmware').state, 'unseen', 'no switch firmware folder')
    assert.equal(item('rpcs3', 'PS3UPDAT.PUP').state, 'missing')
    assert.equal(item('rpcs3', 'RPCS3').state, 'missing')
    assert.equal(item('dolphin', 'Games').state, 'ok', 'RomM’s ngc folder')
    assert.ok(emulatorCatalog().dolphin.consoles.includes('gc'), 'GameCube games in a gc folder play too')
    assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET_KEY_TEXT), 'contents are never read')
    const unseen = readiness({ apps: ['pcsx2'], paths: { ...folders, emulators: '/nowhere/emulators' } })
    assert.match(unseen[0]!.items.find((i) => i.label === 'Emulators')!.detail, /can’t see \/nowhere\/emulators/)
  })

  test('a folder game opens the disc image inside it, or says there isn’t one', () => {
    const f = (file_path: string, file_name: string) => ({ file_path, file_name })
    assert.deepEqual(pickGame({ fs_path: 'roms/ps2', fs_name: 'Tekken 4 .iso', files: [f('roms/ps2', 'Tekken 4 .iso')] }, 'pcsx2'), { path: '/finesse/roms/roms/ps2/Tekken 4 .iso' })
    const dbz = 'Dragon Ball Z - Budokai Tenkaichi 3 (USA) (En,Ja)'
    assert.deepEqual(pickGame({ fs_path: 'roms/ps2', fs_name: dbz, files: [f(`roms/ps2/${dbz}`, `${dbz}.iso`), f(`roms/ps2/${dbz}`, "Vimm's Lair.txt")] }, 'pcsx2'), { path: `/finesse/roms/roms/ps2/${dbz}/${dbz}.iso` })
    // A download's wrapper: index files without their image, covers and a Windows program.
    const dc = 'Dark Cloud 1 & 2 (NTSC) PS2'
    const wrapper = { fs_path: 'roms/ps2', fs_name: dc, files: [f(`roms/ps2/${dc}/Dark Cloud`, 'Dark Cloud PS2.MDS'), f(`roms/ps2/${dc}/Dark Cloud`, 'Back Cover.jpg'), f(`roms/ps2/${dc}/Dvd Decrypter (App)`, 'DVD Decrypter v3.5.4.0.exe')] }
    const none = pickGame(wrapper, 'pcsx2', 'PCSX2')
    assert.ok('error' in none)
    assert.match(none.error, /no game file here that PCSX2 can open \(it has \.mds, \.jpg, \.exe\)\..*\.mdf/)
    assert.deepEqual(pickGame({ fs_path: 'roms/ps3', fs_name: 'Demon’s Souls (USA).ps3', files: [f('roms/ps3/Demon’s Souls (USA).ps3/PS3_GAME/USRDIR', 'EBOOT.BIN')] }, 'rpcs3'), { path: '/finesse/roms/roms/ps3/Demon’s Souls (USA).ps3' }, 'RPCS3 opens the game folder')
    assert.deepEqual(pickGame({ fs_path: 'roms/ps3', fs_name: 'Skate 3 (USA)', files: [f('roms/ps3/Skate 3 (USA)/PS3_GAME/USRDIR', 'EBOOT.BIN')] }, 'rpcs3'), { path: '/finesse/roms/roms/ps3/Skate 3 (USA)' })
    assert.deepEqual(pickGame({ fs_path: 'roms/switch', fs_name: 'Game [XCI]', files: [f('roms/switch/Game [XCI]', 'game.xci'), f('roms/switch/Game [XCI]/bios', 'x.txt')] }, 'switch'), { path: '/finesse/roms/roms/switch/Game [XCI]/game.xci' })
  })

  test('RomM paths that climb out of the library are refused', () => {
    assert.equal(gamePath('roms/ps2', 'A Game (USA).iso'), '/finesse/roms/roms/ps2/A Game (USA).iso')
    assert.equal(gamePath('/romm/library/roms/ps2', 'x.iso'), '/finesse/roms/roms/ps2/x.iso')
    assert.equal(gamePath('roms/../../etc', 'passwd'), null)
    assert.equal(gamePath('roms/ps2', '../x'), null)
    assert.equal(gamePath('roms/ps2', ''), null)
  })
})

describe('emulators in Wolf', () => {
  test('only administrators change them', async () => {
    assert.equal((await call('GET', '/api/streaming/emulators', USER_TOKEN)).status, 403)
    assert.equal((await call('PUT', '/api/streaming/emulators', USER_TOKEN, settingsFor(['pcsx2']))).status, 403)
    assert.equal((await call('PUT', '/api/streaming/emulators', ADMIN_TOKEN, { apps: ['pcsx2'], paths: { roms: 'relative' } })).status, 400)
  })

  test('saving adds the apps to every profile, keeps the profile’s own apps and PIN, and makes each profile’s saves', async () => {
    const r = await call('PUT', '/api/streaming/emulators', ADMIN_TOKEN, settingsFor(['pcsx2', 'switch', 'esde']))
    assert.equal(r.status, 200, r.text)
    assert.equal(r.data.ok, true, r.text)
    assert.deepEqual(r.data.profiles.sort(), ['Kids', 'User'])
    const user = wolf.profiles().find((p) => p.id === 'user')
    assert.deepEqual(user.pin, [4, 3, 2, 1])
    assert.deepEqual(user.apps.map((a: any) => a.title), ['Steam', 'PCSX2 (PS2)', 'Ryujinx (Switch)', 'ES-DE (all your games)'])
    assert.ok(statSync(join(folders.saves, 'user', 'pcsx2', 'memcards')).isDirectory())
    assert.ok(statSync(join(folders.saves, 'kids', 'switch', 'save')).isDirectory())
    assert.equal(JSON.parse(readFileSync(finesse.settingsFile, 'utf8')).emulators.apps.length, 3)
    assert.ok(r.data.readiness.some((x: any) => x.id === 'pcsx2' && x.ready))
  })

  test('saving the same again changes nothing in Wolf', async () => {
    const before = wolf.bodies.length
    const r = await call('PUT', '/api/streaming/emulators', ADMIN_TOKEN, settingsFor(['pcsx2', 'switch', 'esde']))
    assert.equal(r.data.changed, false)
    assert.equal(wolf.bodies.length, before)
    assert.equal((await call('POST', '/api/streaming/emulators/sync', ADMIN_TOKEN)).data.changed, false)
  })

  test('everyone sees which app plays each console, and where; never mounts or paths', async () => {
    const r = await call('GET', '/api/streaming', USER_TOKEN)
    assert.deepEqual(
      r.data.emulators.map((e: any) => [e.id, e.title, e.consoles, e.profiles.sort(), e.play]),
      [
        ['pcsx2', 'PCSX2 (PS2)', ['ps2'], ['Kids', 'User'], true],
        ['switch', 'Ryujinx (Switch)', ['switch'], ['Kids', 'User'], true],
        ['esde', 'ES-DE (all your games)', [], ['Kids', 'User'], false],
      ],
    )
    assert.doesNotMatch(r.text, /finesse\/roms|mounts|FINESSE_LAUNCH|\/saves|"pin"/)
  })

  test('only some profiles, then none: the apps move and go', async () => {
    let r = await call('PUT', '/api/streaming/emulators', ADMIN_TOKEN, { ...settingsFor(['pcsx2']), profiles: ['user'] })
    assert.deepEqual(r.data.profiles, ['User'])
    assert.deepEqual(wolf.profiles().find((p) => p.id === 'kids').apps.map((a: any) => a.title), ['RetroArch'])
    r = await call('PUT', '/api/streaming/emulators', ADMIN_TOKEN, { apps: [], paths: {} })
    assert.equal(r.data.ok, true)
    for (const p of wolf.profiles()) assert.ok(p.apps.every((a: any) => !String(a.runner?.name).startsWith('Finesse-')))
    r = await call('PUT', '/api/streaming/emulators', ADMIN_TOKEN, settingsFor(['pcsx2', 'switch', 'esde']))
    assert.equal(r.data.ok, true)
  })

  test('open Moonlight sessions show without Wolf’s ids or keys', async () => {
    const r = await call('GET', '/api/streaming/sessions', USER_TOKEN)
    assert.equal(r.status, 200)
    assert.equal(r.data.sessions.length, 1)
    assert.match(r.data.sessions[0].id, /^[0-9a-f]{16}$/)
    assert.equal(r.data.sessions[0].app, 'Wolf UI')
    assert.doesNotMatch(r.text, /987654321|AESKEY|rtsp/)
  })

  test('a RomM game starts in the session with its emulator, as one argument', async () => {
    const session = (await call('GET', '/api/streaming/sessions', USER_TOKEN)).data.sessions[0].id
    assert.equal((await call('POST', '/api/streaming/play', USER_TOKEN, { rom: 7, session: 'nope', profile: 'user' })).status, 404)
    assert.equal((await call('POST', '/api/streaming/play', USER_TOKEN, { rom: 8, session, profile: 'user' })).status, 400, 'no emulator app for NES')
    assert.equal((await call('POST', '/api/streaming/play', USER_TOKEN, { rom: 9, session, profile: 'user' })).status, 400, 'a path out of the library')
    assert.equal((await call('POST', '/api/streaming/play', USER_TOKEN, { rom: 7, session })).status, 400, 'two profiles: whose saves?')
    const r = await call('POST', '/api/streaming/play', USER_TOKEN, { rom: 7, session, profile: 'user' })
    assert.equal(r.status, 202, r.text)
    assert.equal(r.data.app, 'PCSX2 (PS2)')
    assert.equal(romm.auth(), `Basic ${Buffer.from('finesse:romm-pass').toString('base64')}`)
    const start = wolf.bodies.filter((b) => b.path === '/api/v1/runners/start').at(-1)!.body
    assert.equal(start.session_id, '987654321')
    assert.equal(start.runner.name, 'Finesse-pcsx2-play')
    assert.ok(start.runner.env.includes('FINESSE_GAME=/finesse/roms/roms/ps2/A PS2 Game (USA).iso'))
    assert.ok(start.runner.mounts.includes(`${folders.saves}/user/pcsx2/memcards:/home/retro/.config/PCSX2/memcards:rw`))
  })

  test('Finesse only makes its own calls to Wolf', () => {
    const allowed = /^(GET \/api\/v1\/(apps|profiles|sessions|clients|pair\/pending)|POST \/api\/v1\/(profiles\/(add|remove)|runners\/start))$/
    for (const c of wolf.calls) assert.match(c, allowed)
  })
})
