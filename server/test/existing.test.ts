// "I already have these apps": reading the apps' own settings files, telling apps apart by their
// images, checking connections (and saying plainly what's wrong), finding apps in Docker, and
// connecting only when everything works. Stand-ins for the apps answer the way the real ones do
// (checked against real Sonarr 4, Radarr 6, Lidarr 3, Prowlarr 2, SABnzbd 4, qBittorrent 4.6 and
// Jellyfin 12 when this was written).

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { SettingsStore } from '../src/config.ts'
import { appOfImage, connect, normalizeUrl, parseConfig, scan, verify, type Secrets } from '../src/setup/existing.ts'
import { Docker } from '../src/stack/docker.ts'
import { fakeDocker } from './fakeDocker.ts'
import { listen } from './helpers.ts'

const SONARR_XML = `<Config>
  <BindAddress>*</BindAddress>
  <Port>8989</Port>
  <SslPort>9898</SslPort>
  <EnableSsl>False</EnableSsl>
  <ApiKey>d6884bdf32dc4596a30d97acf98dfc1d</ApiKey>
  <AuthenticationMethod>Forms</AuthenticationMethod>
  <Branch>main</Branch>
  <UrlBase></UrlBase>
  <InstanceName>Sonarr</InstanceName>
</Config>`
const SAB_INI = `__version__ = 19
__encoding__ = utf-8
[misc]
host = 0.0.0.0
port = 8085
api_key = 9e9f80ee53f5459897d27d3e0686d49d
nzb_key = 1111
url_base = /sabnzbd
[servers]
`
const QBIT_CONF = `[LegalNotice]
Accepted=true

[Preferences]
WebUI\\Port=8090
WebUI\\Username=paul
WebUI\\Password_PBKDF2="@ByteArray(abc==:def==)"
`

describe('reading the apps’ own settings files', () => {
  test('Sonarr / Radarr / Lidarr / Prowlarr config.xml', () => {
    assert.deepEqual(parseConfig('sonarr', SONARR_XML), { apiKey: 'd6884bdf32dc4596a30d97acf98dfc1d', port: 8989, base: '' })
    assert.deepEqual(parseConfig('radarr', '<Config><Port>7979</Port><ApiKey>k</ApiKey><UrlBase>radarr/</UrlBase></Config>'), { apiKey: 'k', port: 7979, base: '/radarr' })
    assert.deepEqual(parseConfig('lidarr', '<Config><UrlBase /></Config>'), { apiKey: undefined, port: undefined, base: '' })
  })
  test('SABnzbd sabnzbd.ini (its key, port and /sabnzbd path)', () => {
    assert.deepEqual(parseConfig('sabnzbd', SAB_INI), { apiKey: '9e9f80ee53f5459897d27d3e0686d49d', port: 8085, base: '/sabnzbd' })
    assert.equal(parseConfig('sabnzbd', '[misc]\nport = 8080\nurl_base = ""\n').base, '')
  })
  test('qBittorrent: its port and username (the password is only stored hashed)', () => {
    assert.deepEqual(parseConfig('qbittorrent', QBIT_CONF), { port: 8090, username: 'paul', base: '' })
  })
  test('Jellyfin network.xml', () => {
    assert.deepEqual(parseConfig('jellyfin', '<NetworkConfiguration><BaseUrl>/jellyfin</BaseUrl><InternalHttpPort>8097</InternalHttpPort></NetworkConfiguration>'), { port: 8097, base: '/jellyfin' })
  })
})

test('apps are told apart by their images, whoever packaged them', () => {
  const cases: [string, string | null][] = [
    ['lscr.io/linuxserver/sonarr:latest', 'sonarr'],
    ['ghcr.io/hotio/radarr:release-6.4', 'radarr'],
    ['binhex/arch-lidarr', 'lidarr'],
    ['linuxserver/prowlarr@sha256:abc', 'prowlarr'],
    ['binhex/arch-sabnzbdvpn:4.5', 'sabnzbd'],
    ['qbittorrentofficial/qbittorrent-nox:5.0', 'qbittorrent'],
    ['binhex/arch-qbittorrentvpn', 'qbittorrent'],
    ['jellyfin/jellyfin:10.10.7', 'jellyfin'],
    ['lscr.io/linuxserver/jellyfin', 'jellyfin'],
    ['ghcr.io/hotio/sonarr:v4', 'sonarr'],
    ['fallenbagel/jellyseerr:latest', null],
    ['ghcr.io/hotio/overseerr', null],
    ['lscr.io/linuxserver/readarr', null],
    ['ghcr.io/coffeecc/finesse:3.0.9', null],
  ]
  for (const [image, id] of cases) assert.equal(appOfImage(image), id, image)
})

test('addresses are tidied: no scheme, trailing slashes', () => {
  assert.equal(normalizeUrl('192.168.1.5:8989'), 'http://192.168.1.5:8989')
  assert.equal(normalizeUrl('http://nas:8085/sabnzbd/'), 'http://nas:8085/sabnzbd')
  assert.equal(normalizeUrl('  https://media.example.com/jellyfin  '), 'https://media.example.com/jellyfin')
  assert.equal(normalizeUrl(''), '')
})

// ---------------------------------------------------------------------------
// Stand-ins for the apps
// ---------------------------------------------------------------------------

const send = (res: import('node:http').ServerResponse, status: number, body: unknown, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': type })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}
const bodyOf = (req: IncomingMessage) => new Promise<string>((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b)) })

/** Sonarr/Radarr/Lidarr/Prowlarr: /ping, and /api/vN/system/status with the key. */
function fakeArr(appName: string, key: string, api = '/api/v3', base = '') {
  return createServer((req, res) => {
    const p = new URL(req.url ?? '/', 'http://x').pathname
    if (p === `${base}/ping`) return send(res, 200, { status: 'OK' })
    if (p === `${base}${api}/system/status`) return req.headers['x-api-key'] === key ? send(res, 200, { appName, instanceName: appName, version: '4.0.20.3014' }) : send(res, 401, { error: 'Unauthorized' })
    send(res, 404, '')
  })
}
function fakeSab(key: string) {
  return createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    if (u.pathname !== '/sabnzbd/api') return send(res, 404, 'Not found', 'text/plain')
    if (u.searchParams.get('mode') === 'version') return send(res, 200, { version: '4.5.1' })
    return u.searchParams.get('apikey') === key ? send(res, 200, { queue: { slots: [] } }) : send(res, 200, { status: false, error: 'API Key Incorrect' })
  })
}
function fakeQbit(user: string, pass: string) {
  return createServer(async (req, res) => {
    const p = new URL(req.url ?? '/', 'http://x').pathname
    if (p === '/') return send(res, 200, '<title>qBittorrent Web UI</title>', 'text/html')
    if (p === '/api/v2/auth/login') {
      const f = new URLSearchParams(await bodyOf(req))
      if (f.get('username') === user && f.get('password') === pass) {
        res.writeHead(200, { 'Set-Cookie': 'SID=abc; HttpOnly; path=/' })
        return res.end('Ok.')
      }
      return send(res, 200, 'Fails.', 'text/plain')
    }
    if (p === '/api/v2/app/version') return req.headers.cookie?.includes('SID=abc') ? send(res, 200, 'v5.0.4', 'text/plain') : send(res, 403, 'Forbidden', 'text/plain')
    send(res, 404, '')
  })
}
function fakeJellyfin(admins: Record<string, string>, viewers: Record<string, string> = {}) {
  const keys: { AppName: string; AccessToken: string }[] = []
  return createServer(async (req, res) => {
    const p = new URL(req.url ?? '/', 'http://x').pathname
    if (p === '/System/Info/Public') return send(res, 200, { ProductName: 'Jellyfin Server', Version: '10.10.7', Id: 'x', StartupWizardCompleted: true })
    if (p === '/Users/AuthenticateByName') {
      const b = JSON.parse(await bodyOf(req)) as { Username: string; Pw: string }
      if (admins[b.Username] === b.Pw) return send(res, 200, { AccessToken: 'admin-token', User: { Policy: { IsAdministrator: true } } })
      if (viewers[b.Username] === b.Pw) return send(res, 200, { AccessToken: 'viewer-token', User: { Policy: { IsAdministrator: false } } })
      return send(res, 401, 'Error processing request.', 'text/plain')
    }
    if (!String(req.headers.authorization).includes('admin-token')) return send(res, 401, '')
    if (p === '/Auth/Keys' && req.method === 'GET') return send(res, 200, { Items: keys })
    if (p === '/Auth/Keys' && req.method === 'POST') {
      keys.push({ AppName: 'Finesse', AccessToken: 'jf-key-for-finesse' })
      return send(res, 204, '')
    }
    send(res, 404, '')
  })
}

const servers: Server[] = []
const up = async (s: Server) => {
  servers.push(s)
  return (await listen(s)).replace('localhost', '127.0.0.1')
}
after(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

describe('checking a connection says plainly what’s wrong', () => {
  let sonarr = ''
  let sab = ''
  let qbit = ''
  let jf = ''
  before(async () => {
    sonarr = await up(fakeArr('Sonarr', 'good-key'))
    sab = await up(fakeSab('sab-key'))
    qbit = await up(fakeQbit('admin', 'secret'))
    jf = await up(fakeJellyfin({ paul: 'pw' }, { kid: 'pw2' }))
  })

  test('*arr: works, a wrong key, the wrong app on that port, nothing there', async () => {
    assert.equal((await verify('sonarr', { url: sonarr, apiKey: 'good-key' })).ok, true)
    assert.match((await verify('sonarr', { url: sonarr, apiKey: 'nope' })).message, /didn’t accept that API key/)
    assert.match((await verify('radarr', { url: sonarr, apiKey: 'good-key' })).message, /That’s Sonarr, not Radarr/)
    assert.match((await verify('sonarr', { url: sonarr })).message, /Enter Sonarr’s API key/)
    assert.match((await verify('sonarr', { url: 'http://127.0.0.1:1', apiKey: 'k' })).message, /Nothing answered/)
  })

  test('SABnzbd: finds its /sabnzbd path by itself, and explains a wrong key', async () => {
    const v = await verify('sabnzbd', { url: sab.replace('http://', ''), apiKey: 'sab-key' })
    assert.equal(v.ok, true)
    assert.equal(v.save?.url, `${sab}/sabnzbd`)
    assert.match((await verify('sabnzbd', { url: `${sab}/sabnzbd`, apiKey: 'x' })).message, /API Key Incorrect/)
  })

  test('qBittorrent: its login', async () => {
    assert.equal((await verify('qbittorrent', { url: qbit, username: 'admin', password: 'secret' })).ok, true)
    assert.match((await verify('qbittorrent', { url: qbit, username: 'admin', password: 'x' })).message, /didn’t accept that username and password/)
  })

  test('Jellyfin: an administrator signs in and Finesse gets its own key; others are told why not', async () => {
    const v = await verify('jellyfin', { url: jf, username: 'paul', password: 'pw' })
    assert.equal(v.ok, true)
    assert.equal(v.save?.apiKey, 'jf-key-for-finesse')
    assert.equal(v.save?.basePath, '')
    assert.match((await verify('jellyfin', { url: jf, username: 'kid', password: 'pw2' })).message, /isn’t an administrator/)
    assert.match((await verify('jellyfin', { url: jf, username: 'paul', password: 'no' })).message, /didn’t accept that username and password/)
    // Again: it reuses the key it made, rather than making another.
    assert.equal((await verify('jellyfin', { url: jf, username: 'paul', password: 'pw' })).save?.apiKey, 'jf-key-for-finesse')
  })
})

describe('finding apps in Docker', () => {
  test('reads keys out of the containers, reaches them by published port, and explains the rest', async () => {
    const sonarr = await up(fakeArr('Sonarr', 'd6884bdf32dc4596a30d97acf98dfc1d'))
    const sonarrPort = new URL(sonarr).port
    const fd = await fakeDocker([
      { id: 'me', name: 'finesse', image: 'ghcr.io/coffeecc/finesse:3.1.0', networks: { finesse: { IPAddress: '172.30.0.2', Gateway: '127.0.0.1' } } },
      // Published on a different host port than its own: Finesse follows the mapping.
      { id: 's', name: 'sonarr', image: 'lscr.io/linuxserver/sonarr:latest', networks: { media: { IPAddress: '203.0.113.9' } }, ports: { '8989/tcp': sonarrPort }, files: { '/config/config.xml': SONARR_XML } },
      { id: 'l', name: 'lidarr', image: 'binhex/arch-lidarr', running: false },
      { id: 'p', name: 'prowlarr', image: 'lscr.io/linuxserver/prowlarr', networks: { arr_net: { IPAddress: '203.0.113.10' } }, files: { '/config/config.xml': '<Config><ApiKey>pk</ApiKey></Config>' } },
      { id: 'm', name: 'finesse-radarr', image: 'lscr.io/linuxserver/radarr', labels: { 'finesse.managed': 'true' } },
      { id: 'j', name: 'jellyseerr', image: 'fallenbagel/jellyseerr' },
    ])
    try {
      const docker = new Docker(fd.socket)
      const me = await docker.inspect('finesse')
      const { result, secrets } = await scan({ docker, me, computer: false })
      const by = Object.fromEntries(result.apps.map((a) => [a.id, a]))
      assert.equal(by.sonarr!.state, 'ready')
      assert.equal(by.sonarr!.url, `http://127.0.0.1:${sonarrPort}`)
      assert.equal(by.sonarr!.where, 'container “sonarr”')
      assert.equal(secrets.sonarr?.apiKey, 'd6884bdf32dc4596a30d97acf98dfc1d')
      assert.equal(by.lidarr!.state, 'stopped')
      assert.equal(by.prowlarr!.state, 'unreachable')
      // It tried joining Prowlarr's network to reach it by name.
      assert.deepEqual(fd.joined, [{ network: 'arr_net', container: 'me' }])
      // Finesse's own Radarr isn't "yours": not found.
      assert.equal(by.radarr!.state, 'not-found')
      // Nothing secret in what the page gets.
      assert.ok(!JSON.stringify(result).includes('d6884bdf'))
    } finally {
      await fd.close()
    }
  })
})

describe('connecting', () => {
  let jf = ''
  let sonarr = ''
  let qbit = ''
  const store = () => {
    const dir = mkdtempSync(join(tmpdir(), 'finesse-existing-'))
    return new SettingsStore({ configDir: dir, settingsFile: join(dir, 'finesse.json'), invitesDb: join(dir, 'i.db'), bakedWeb: dir, updatedWeb: dir, previews: dir, backups: dir })
  }
  before(async () => {
    jf = await up(fakeJellyfin({ paul: 'pw' }))
    sonarr = await up(fakeArr('Sonarr', 'sk'))
    qbit = await up(fakeQbit('admin', 'secret'))
  })

  test('saves nothing unless every chosen app works, and says which didn’t', async () => {
    const s = store()
    const found: Secrets = { sonarr: { url: sonarr, apiKey: 'sk', where: 'container “sonarr”', container: 'sonarr' } }
    const r = await connect({ jellyfin: { url: jf, username: 'paul', password: 'pw' }, sonarr: {}, qbittorrent: { url: qbit, username: 'admin', password: 'wrong' } }, found, (fn) => s.update(fn))
    assert.equal(r.ok, false)
    assert.equal(r.results.sonarr?.ok, true)
    assert.equal(r.results.qbittorrent?.ok, false)
    assert.equal(s.get().setup.state, 'new')
    assert.equal(s.get().mode, 'bundle')
  })

  test('Jellyfin is required', async () => {
    const r = await connect({ sonarr: { url: sonarr, apiKey: 'sk' } }, {}, () => assert.fail('saved'))
    assert.equal(r.ok, false)
    assert.match(r.results.jellyfin!.message, /needs Jellyfin/)
  })

  test('when everything works: adopt mode, ready, every app saved with its key, where it was found remembered', async () => {
    const s = store()
    const found: Secrets = { sonarr: { url: sonarr, apiKey: 'sk', where: 'container “sonarr”', container: 'sonarr' } }
    const r = await connect({ jellyfin: { url: jf, username: 'paul', password: 'pw' }, sonarr: {}, qbittorrent: { url: qbit, username: 'admin', password: 'secret' }, radarr: { skip: true } }, found, (fn) => s.update(fn))
    assert.equal(r.ok, true)
    const st = s.get()
    assert.equal(st.mode, 'adopt')
    assert.equal(st.setup.state, 'ready')
    assert.deepEqual(st.jellyfin, { url: jf, apiKey: 'jf-key-for-finesse', basePath: '' })
    assert.deepEqual(st.services.sonarr, { url: sonarr, apiKey: 'sk' })
    assert.deepEqual(st.services.qbittorrent, { url: qbit, username: 'admin', password: 'secret' })
    assert.equal(st.services.radarr, undefined)
    assert.deepEqual(st.existing?.apps.sonarr, { where: 'container “sonarr”', container: 'sonarr' })
  })

  test('a key found by a scan isn’t sent to a different address someone typed', async () => {
    const other = await up(fakeArr('Sonarr', 'different'))
    const r = await connect({ jellyfin: { url: jf, username: 'paul', password: 'pw' }, sonarr: { url: other } }, { sonarr: { url: sonarr, apiKey: 'sk' } }, () => assert.fail('saved'))
    assert.equal(r.ok, false)
    assert.match(r.results.sonarr!.message, /Enter Sonarr’s API key/)
  })
})

describe('apps installed on this computer (no Docker)', () => {
  test('finds their settings files in the usual folders and reaches them on their own ports', async () => {
    const sonarr = await up(fakeArr('Sonarr', 'local-key'))
    const port = new URL(sonarr).port
    const dir = mkdtempSync(join(tmpdir(), 'finesse-apps-'))
    mkdirSync(join(dir, 'Sonarr'))
    writeFileSync(join(dir, 'Sonarr', 'config.xml'), `<Config><Port>${port}</Port><ApiKey>local-key</ApiKey><InstanceName>Sonarr</InstanceName></Config>`)
    const { result, secrets } = await scan({ extraDirs: [dir] })
    const s = result.apps.find((a) => a.id === 'sonarr')!
    assert.equal(s.state, 'ready')
    assert.equal(s.url, `http://127.0.0.1:${port}`)
    assert.equal(secrets.sonarr?.apiKey, 'local-key')
  })
})

describe('the setup routes', () => {
  test('need the setup code, keep every key on the server, and close once the server is set up', async () => {
    const jf = await up(fakeJellyfin({ paul: 'pw' }))
    const sonarr = await up(fakeArr('Sonarr', 'route-key'))
    const work = mkdtempSync(join(tmpdir(), 'finesse-routes-'))
    for (const k of ['JELLYFIN_URL', 'JELLYFIN_API_KEY', 'FINESSE_MODE']) delete process.env[k]
    Object.assign(process.env, { FINESSE_CONFIG_DIR: join(work, 'config'), FINESSE_WEB_DIR: join(work, 'web'), FINESSE_MAINTENANCE: 'off', DOCKER_SOCKET: join(work, 'no-docker.sock') })
    const { createApp } = await import('../src/app.ts')
    const { defaultPlugins } = await import('../src/main.ts')
    const { ensureSetupCode } = await import('../src/auth.ts')
    const built = createApp({ plugins: defaultPlugins() })
    const base = await up(built.server)
    const code = ensureSetupCode(built.deps.settings)!
    const call = (path: string, body?: unknown, withCode = true) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(withCode ? { 'X-Finesse-Setup-Code': code } : {}) }, body: JSON.stringify(body ?? {}) })

    assert.equal((await call('/api/setup/existing/scan', {}, false)).status, 401)
    const scanned = await call('/api/setup/existing/scan')
    assert.equal(scanned.status, 200)
    assert.ok(Array.isArray(((await scanned.json()) as { apps: unknown[] }).apps))

    const checked = (await (await call('/api/setup/existing/check', { id: 'sonarr', url: sonarr, apiKey: 'route-key' })).json()) as { ok: boolean; message: string }
    assert.equal(checked.ok, true)

    const bad = (await (await call('/api/setup/existing/connect', { jellyfin: { url: jf, username: 'paul', password: 'nope' } })).json()) as { ok: boolean; results: Record<string, { ok: boolean; message: string }> }
    assert.equal(bad.ok, false)
    assert.match(bad.results.jellyfin!.message, /didn’t accept/)
    assert.equal(built.deps.settings.get().setup.state, 'new')

    const res = await call('/api/setup/existing/connect', { jellyfin: { url: jf, username: 'paul', password: 'pw' }, sonarr: { url: sonarr, apiKey: 'route-key' } })
    const text = await res.text()
    assert.equal(res.status, 200, text)
    assert.ok(!text.includes('route-key') && !text.includes('jf-key-for-finesse'), 'no key in the answer')
    assert.equal(built.deps.settings.get().mode, 'adopt')
    assert.equal(built.deps.settings.get().services.sonarr?.apiKey, 'route-key')

    // Set up now: the discovery routes are closed.
    assert.equal((await call('/api/setup/existing/scan')).status, 409)
    // And Finesse uses what it connected to: discovery shows the features.
    const info = (await (await fetch(`${base}/api/finesse`)).json()) as { mode: string; features: { shows: boolean; system: boolean }; setup: { state: string } }
    assert.equal(info.mode, 'adopt')
    assert.equal(info.setup.state, 'ready')
    assert.equal(info.features.shows, true)
    assert.equal(info.features.system, false)
  })
})
