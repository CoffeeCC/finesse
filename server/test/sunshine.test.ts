// Game streaming on Windows: Sunshine instead of Wolf. Its installer (checked, silent), Finesse's
// own account in it, the PC check, and pairing Moonlight devices through Finesse's routes with a
// stand-in for Sunshine's API.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { createHash } from 'node:crypto'
import { SUNSHINE, Sunshine, SunshineError, setConf, windowsStreamingCheck, type SunshineApi, type SunshineLogin } from '../src/stack/sunshine.ts'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, auth, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

const MSI = Buffer.from('pretend Sunshine installer')

function host(opts: { msi?: Buffer; installCode?: number } = {}) {
  const root = tmp()
  const dir = join(tmp(), 'Sunshine')
  const ran: string[] = []
  const api: string[] = []
  let ready = false
  const sunshine = new Sunshine(root, {
    dir,
    fetchTo: async (_url, file) => writeFileSync(file, opts.msi ?? MSI),
    run: (exe, args) => {
      const name = exe.split(/[\\/]/).pop()
      ran.push(`${name} ${args.join(' ')}`)
      if (name === 'msiexec.exe' && args[0] === '/i') {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'sunshine.exe'), '')
        return { code: opts.installCode ?? 0, out: '' }
      }
      if (name === 'sc.exe' && args[0] === 'start') ready = true
      return { code: 0, out: '' }
    },
    api: async (method, path, login) => {
      api.push(`${method} ${path} as ${login.username}`)
      return ready ? { status: 200, json: { apps: [] } } : Promise.reject(new Error('connect ECONNREFUSED'))
    },
    sleep: async () => {},
  })
  return { root, dir, ran, api, sunshine }
}

describe('installing and setting up Sunshine', () => {
  before(() => {
    SUNSHINE.sha256 = createHash('sha256').update(MSI).digest('hex')
  })

  test('the tested installer, run silently; kept for uninstalling; not run twice', async () => {
    const h = host()
    const said: string[] = []
    await h.sunshine.install((m) => said.push(m))
    assert.ok(h.ran.some((r) => r.startsWith('msiexec.exe /i ') && r.includes(' /qn /norestart ')), h.ran.join('\n'))
    assert.ok(existsSync(join(h.root, 'apps', 'sunshine', `Sunshine-${SUNSHINE.version}.msi`)))
    assert.ok(said.some((m) => m.startsWith('Installing Sunshine')))
    const n = h.ran.length
    await h.sunshine.install(() => {})
    assert.equal(h.ran.length, n, 'already in')
    assert.equal(h.sunshine.foreign(), false)
  })

  test('a download that isn’t the tested installer never runs', async () => {
    const h = host({ msi: Buffer.from('something else') })
    await assert.rejects(h.sunshine.install(() => {}), /didn’t match the version Finesse was tested with/)
    assert.ok(!h.ran.some((r) => r.startsWith('msiexec')))
  })

  test('someone’s own Sunshine is left alone', async () => {
    const h = host()
    mkdirSync(h.dir, { recursive: true })
    writeFileSync(join(h.dir, 'sunshine.exe'), '')
    assert.equal(h.sunshine.foreign(), true)
    await assert.rejects(h.sunshine.install(() => {}), (e: Error) => e instanceof SunshineError && /already installed/.test(e.message))
    assert.deepEqual(h.ran, [])
  })

  test('an installer that wants a restart still counts; one that fails says where its log is', async () => {
    await host({ installCode: 3010 }).sunshine.install(() => {})
    await assert.rejects(host({ installCode: 1603 }).sunshine.install(() => {}), /code 1603.*sunshine-install\.log/)
  })

  test('Finesse’s account, the web page kept to this PC, the PC’s name, then it starts', async () => {
    const h = host()
    await h.sunshine.install(() => {})
    mkdirSync(join(h.dir, 'config'), { recursive: true })
    writeFileSync(join(h.dir, 'config', 'sunshine.conf'), 'encoder = nvenc\norigin_web_ui_allowed = lan\n')
    const login: SunshineLogin = { username: 'finesse', password: 'p4ss' }
    await h.sunshine.configure(login, 'Den PC')
    const order = h.ran.filter((r) => !r.startsWith('msiexec')).map((r) => r.replace(/ p4ss$/, ' ***'))
    assert.deepEqual(order, ['sc.exe stop SunshineService', 'sunshine.exe --creds finesse ***', 'sc.exe config SunshineService start= auto', 'sc.exe start SunshineService'])
    assert.equal(readFileSync(join(h.dir, 'config', 'sunshine.conf'), 'utf8'), 'encoder = nvenc\norigin_web_ui_allowed = pc\nsunshine_name = Den PC\n')
    assert.ok(h.api.includes('GET /api/apps as finesse'), 'waited for its API')
    h.sunshine.stop()
    assert.deepEqual(h.ran.slice(-2), ['sc.exe stop SunshineService', 'sc.exe config SunshineService start= demand'])
  })

  test('sunshine.conf: keys set in place, others kept', () => {
    assert.equal(setConf('', { a: '1' }), 'a = 1\n')
    assert.equal(setConf('# mine\nb=2\r\na = 0\n', { a: '1', c: '3' }), '# mine\nb=2\na = 1\nc = 3\n')
  })
})

describe('the PC check', () => {
  test('a real graphics card is ready; Microsoft’s basic driver is not', () => {
    const ok = windowsStreamingCheck(['Microsoft Remote Display Adapter', 'NVIDIA GeForce RTX 4070'], { foreignSunshine: false })
    assert.equal(ok.gpu, 'nvidia')
    assert.equal(ok.allGood, true)
    assert.match(ok.items[0]!.title, /RTX 4070/)
    const amd = windowsStreamingCheck(['AMD Radeon RX 7800 XT'], { foreignSunshine: false })
    assert.equal(amd.gpu, 'intel-amd')
    const none = windowsStreamingCheck(['Microsoft Basic Display Adapter'], { foreignSunshine: false })
    assert.equal(none.gpu, null)
    assert.equal(none.allGood, false)
    assert.match(none.items[0]!.detail, /Microsoft Basic Display Adapter/)
    assert.equal(none.blocked, undefined)
    assert.match(windowsStreamingCheck(['Intel(R) Arc(TM) Graphics'], { foreignSunshine: true }).blocked ?? '', /already installed/)
  })
})

describe('pairing through Finesse', () => {
  let base = ''
  let app: Server
  let jf: FakeJellyfin
  const calls: string[] = []
  const pending = [{ id: 'a'.repeat(32), name: 'Living room TV', address: '192.168.1.50' }]
  const clients = [{ uuid: 'old-uuid', name: 'Laptop', enabled: true }]
  const fake: SunshineApi = async (method, path, login, body) => {
    calls.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`)
    if (login.password !== 'sunshine-secret') return { status: 401, json: null }
    if (method === 'GET' && path === '/api/apps') return { status: 200, json: { env: {}, apps: [{ name: 'Desktop', 'image-path': 'desktop.png' }, { name: 'Steam Big Picture', cmd: 'steam://open/bigpicture' }] } }
    if (method === 'GET' && path === '/api/pin') return { status: 200, json: { pairings: pending } }
    if (method === 'GET' && path === '/api/clients/list') return { status: 200, json: { status: true, named_certs: clients } }
    if (method === 'POST' && path === '/api/pin') {
      const b = body as { pairing_id: string; pin: string; name: string }
      const i = pending.findIndex((p) => p.id === b.pairing_id)
      if (i < 0) return { status: 200, json: { status: false } }
      pending.splice(i, 1)
      if (b.pin !== '1234') return { status: 200, json: { status: false } }
      clients.push({ uuid: 'new-uuid', name: b.name, enabled: true })
      return { status: 200, json: { status: true } }
    }
    if (method === 'POST' && path === '/api/clients/unpair') {
      const i = clients.findIndex((c) => c.uuid === (body as { uuid: string }).uuid)
      if (i >= 0) clients.splice(i, 1)
      return { status: 200, json: { status: i >= 0 } }
    }
    return { status: 404, json: null }
  }

  before(async () => {
    jf = await fakeJellyfin()
    const work = tmp()
    mkdirSync(join(work, 'baked'), { recursive: true })
    for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
      mkdirSync(join(work, 'baked', rel, '..'), { recursive: true })
      writeFileSync(join(work, 'baked', rel), c)
    }
    mkdirSync(join(work, 'config'), { recursive: true })
    writeFileSync(join(work, 'config', 'finesse.json'), JSON.stringify({ streaming: { sunshine: { username: 'finesse', password: 'sunshine-secret' } } }))
    Object.assign(process.env, { FINESSE_CONFIG_DIR: join(work, 'config'), FINESSE_WEB_DIR: join(work, 'baked'), JELLYFIN_URL: jf.url, JELLYFIN_API_KEY: API_KEY, FINESSE_MAINTENANCE: 'off' })
    const { createApp } = await import('../src/app.ts')
    app = createApp({ sunshineApi: fake }).server
    base = await listen(app)
  })
  after(() => {
    for (const s of [app, jf?.server]) {
      s?.closeAllConnections()
      s?.close()
    }
  })

  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}/finesse${path}`, { method, headers: { ...auth(token), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, any> }
  }

  test('everyone sees what Moonlight lists; the app is told streaming is on', async () => {
    const f = await call('GET', '/api/finesse', USER_TOKEN)
    assert.equal(f.json.features.streaming, true)
    const r = await call('GET', '/api/streaming', USER_TOKEN)
    assert.deepEqual(r.json, {
      ok: true,
      apps: [
        { id: 'sunshine-0', title: 'Desktop', hdr: false, icon: false },
        { id: 'sunshine-1', title: 'Steam Big Picture', hdr: false, icon: false },
      ],
      profiles: [],
      emulators: [],
    })
  })

  test('administrators see who’s waiting and who’s paired; others can’t', async () => {
    assert.equal((await call('GET', '/api/streaming/admin', USER_TOKEN)).status, 403)
    const r = await call('GET', '/api/streaming/admin', ADMIN_TOKEN)
    assert.deepEqual(r.json, {
      ok: true,
      host: 'sunshine',
      pending: [{ id: 'a'.repeat(32), ip: '192.168.1.50', name: 'Living room TV' }],
      devices: [{ id: 'old-uuid', name: 'Laptop', pairedAt: null }],
    })
  })

  test('pairing with the PIN, then removing a device', async () => {
    assert.equal((await call('POST', '/api/streaming/pair', USER_TOKEN, { request: 'a'.repeat(32), pin: '1234' })).status, 403)
    assert.equal((await call('POST', '/api/streaming/pair', ADMIN_TOKEN, { request: 'b'.repeat(32), pin: '1234' })).status, 404, 'not waiting')
    assert.equal((await call('POST', '/api/streaming/pair', ADMIN_TOKEN, { request: 'a'.repeat(32), pin: '12' })).status, 400)
    const ok = await call('POST', '/api/streaming/pair', ADMIN_TOKEN, { request: 'a'.repeat(32), pin: '1234', name: 'Living room TV' })
    assert.equal(ok.status, 201)
    assert.equal(ok.json.device.name, 'Living room TV')
    assert.ok(calls.includes(`POST /api/pin ${JSON.stringify({ pairing_id: 'a'.repeat(32), pin: '1234', name: 'Living room TV' })}`))
    assert.deepEqual((await call('GET', '/api/streaming/admin', ADMIN_TOKEN)).json.devices.map((d: { id: string }) => d.id), ['old-uuid', 'new-uuid'])
    assert.equal((await call('DELETE', '/api/streaming/devices/nope', ADMIN_TOKEN)).status, 404)
    assert.equal((await call('DELETE', '/api/streaming/devices/old-uuid', USER_TOKEN)).status, 403)
    assert.equal((await call('DELETE', '/api/streaming/devices/old-uuid', ADMIN_TOKEN)).status, 200)
    assert.deepEqual(clients.map((c) => c.uuid), ['new-uuid'])
  })

  test('Wolf-only parts stay closed', async () => {
    assert.equal((await call('GET', '/api/streaming/sessions', USER_TOKEN)).status, 404)
    assert.equal((await call('GET', '/api/streaming/apps/sunshine-0/icon', USER_TOKEN)).status, 404)
  })
})
