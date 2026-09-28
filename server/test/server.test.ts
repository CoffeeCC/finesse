// Web serving + proxies: what deploy/nginx.conf used to do, now in the server.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { after, before, describe, test } from 'node:test'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, auth, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

let base = ''
let jf: FakeJellyfin
let radarr: { url: string; seen: { path: string; headers: IncomingMessage['headers'] }[]; server: Server }
let sab: { url: string; seen: string[]; server: Server }
let app: Server

function write(dir: string, files: Record<string, string | Buffer>) {
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), c)
  }
}

before(async () => {
  jf = await fakeJellyfin()
  const seen: { path: string; headers: IncomingMessage['headers'] }[] = []
  const rs = createServer((req, res) => {
    seen.push({ path: req.url ?? '', headers: req.headers })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, path: req.url }))
  })
  radarr = { url: await listen(rs), seen, server: rs }
  const sabSeen: string[] = []
  const ss = createServer((req, res) => {
    sabSeen.push(req.url ?? '')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"status":true}')
  })
  sab = { url: await listen(ss), seen: sabSeen, server: ss }

  const work = tmp()
  write(join(work, 'baked'), webBuild('1.0.0'))
  write(join(work, 'config', 'web'), webBuild('1.2.0'))
  write(join(work, 'config', 'previews'), { 'clip.mp4': Buffer.from('0123456789abcdefghij') })
  write(join(work, 'config', 'web'), { 'assets/big.js': 'x'.repeat(5000) })
  Object.assign(process.env, {
    FINESSE_CONFIG_DIR: join(work, 'config'),
    FINESSE_WEB_DIR: join(work, 'baked'),
    JELLYFIN_URL: jf.url,
    JELLYFIN_API_KEY: API_KEY,
    RADARR_URL: radarr.url,
    RADARR_API_KEY: 'radarr-secret',
    SAB_URL: sab.url,
    SAB_API_KEY: 'sab-secret',
  })
  const { createApp } = await import('../src/app.ts')
  app = createApp().server
  base = await listen(app)
})
after(async () => {
  for (const srv of [app, radarr?.server, sab?.server, jf?.server]) {
    srv?.closeAllConnections()
    srv?.close()
  }
})

/** Raw GET without fetch's URL normalisation (for traversal tests). */
function rawGet(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }> {
  const u = new URL(base)
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('web app', () => {
  test('/ redirects to the app', async () => {
    const r = await rawGet('/')
    assert.equal(r.status, 302)
    assert.equal(r.headers.location, '/finesse/')
  })

  test('serves the newer of baked vs updated build, never cached', async () => {
    const r = await rawGet('/finesse/')
    assert.equal(r.status, 200)
    assert.match(r.body.toString(), /Finesse 1\.2\.0/)
    assert.match(String(r.headers['cache-control']), /no-cache/)
  })

  test('hashed assets cache forever and compress', async () => {
    const r = await rawGet('/finesse/assets/big.js', { 'Accept-Encoding': 'gzip' })
    assert.equal(r.status, 200)
    assert.match(String(r.headers['cache-control']), /immutable/)
    assert.equal(r.headers['content-encoding'], 'gzip')
    assert.equal(gunzipSync(r.body).toString(), 'x'.repeat(5000))
    const br = await rawGet('/finesse/assets/big.js', { 'Accept-Encoding': 'gzip, br' })
    assert.equal(br.headers['content-encoding'], 'br')
  })

  test('app routes fall back to index.html; missing assets are 404', async () => {
    assert.match((await rawGet('/finesse/item/abc123')).body.toString(), /<!doctype html>/)
    assert.equal((await rawGet('/finesse/assets/nope.js')).status, 404)
  })

  test('no path traversal, no dotfiles', async () => {
    for (const p of ['/finesse/../../../../etc/passwd', '/finesse/%2e%2e/%2e%2e/etc/passwd', '/finesse/assets/..%2f..%2f..%2fetc%2fpasswd', '/finesse/.hidden', '/previews/../finesse.json']) {
      const r = await rawGet(p)
      assert.ok(!/root:/.test(r.body.toString()), `${p} leaked`)
      assert.ok(!/instanceId/.test(r.body.toString()), `${p} leaked settings`)
    }
  })

  test('preview clips support ranges and conditional requests', async () => {
    // Clips of the library are for signed-in viewers only (the token rides in the address).
    assert.equal((await rawGet('/finesse/previews/clip.mp4')).status, 401)
    assert.equal((await rawGet('/finesse/previews/manifest.json')).status, 401)
    assert.equal((await rawGet('/finesse/previews/clip.mp4?ApiKey=bogus')).status, 401)
    const r = await rawGet(`/finesse/previews/clip.mp4?ApiKey=${USER_TOKEN}`, { Range: 'bytes=2-5' })
    assert.equal(r.status, 206)
    assert.equal(r.headers['content-range'], 'bytes 2-5/20')
    assert.equal(r.body.toString(), '2345')
    const tail = await rawGet(`/finesse/previews/clip.mp4?ApiKey=${USER_TOKEN}`, { Range: 'bytes=-3' })
    assert.equal(tail.body.toString(), 'hij')
    assert.equal((await rawGet(`/finesse/previews/clip.mp4?ApiKey=${USER_TOKEN}`, { Range: 'bytes=50-60' })).status, 416)
    const full = await rawGet(`/finesse/previews/clip.mp4?ApiKey=${USER_TOKEN}`)
    const again = await rawGet(`/finesse/previews/clip.mp4?ApiKey=${USER_TOKEN}`, { 'If-None-Match': String(full.headers.etag) })
    assert.equal(again.status, 304)
  })
})

describe('discovery', () => {
  test('/api/finesse describes the server', async () => {
    const r = await fetch(`${base}/finesse/api/finesse`)
    const j = (await r.json()) as Record<string, any>
    assert.equal(j.name, 'finesse')
    assert.equal(j.mode, 'adopt') // env-configured Jellyfin = adopted setup
    assert.equal(j.web, '1.2.0')
    assert.deepEqual(j.jellyfin, { path: '/jellyfin' })
    assert.equal(j.setup.state, 'ready')
    assert.equal(j.features.movies, true)
    assert.equal(j.features.shows, false)
    assert.equal(r.headers.get('access-control-allow-origin'), '*')
  })
})

describe('service proxies', () => {
  test('*arr calls need a sign-in, get the key injected and lose the caller’s credentials', async () => {
    assert.equal((await fetch(`${base}/finesse/arr/radarr/movie/lookup?term=x`)).status, 401)
    assert.equal((await fetch(`${base}/finesse/arr/radarr/movie/lookup?term=x`, { headers: auth('bogus') })).status, 401)
    const r = await fetch(`${base}/finesse/arr/radarr/movie/lookup?term=signal`, { headers: { ...auth(USER_TOKEN), Cookie: 'x=1' } })
    assert.equal(r.status, 200)
    const seen = radarr.seen.at(-1)!
    assert.equal(seen.path, '/api/v3/movie/lookup?term=signal')
    assert.equal(seen.headers['x-api-key'], 'radarr-secret')
    assert.equal(seen.headers.authorization, undefined)
    assert.equal(seen.headers.cookie, undefined)
  })

  test('unconfigured services say so', async () => {
    const r = await fetch(`${base}/finesse/arr/sonarr/series`, { headers: auth(USER_TOKEN) })
    assert.equal(r.status, 503)
    assert.match(((await r.json()) as { error: string }).error, /Sonarr isn't set up/)
  })

  test('Prowlarr is admin-only', async () => {
    assert.equal((await fetch(`${base}/finesse/arr/prowlarr/indexer`, { headers: auth(USER_TOKEN) })).status, 403)
  })

  test('SABnzbd gets its key as a query parameter, never the caller’s', async () => {
    const r = await fetch(`${base}/finesse/arr/sab?mode=queue&output=json&apikey=evil`, { headers: auth(ADMIN_TOKEN) })
    assert.equal(r.status, 200)
    const q = new URL(sab.seen.at(-1)!, 'http://x')
    assert.equal(q.pathname, '/api')
    assert.equal(q.searchParams.get('apikey'), 'sab-secret')
    assert.equal(q.searchParams.getAll('apikey').length, 1)
    assert.equal(q.searchParams.get('mode'), 'queue')
  })

  test('preflight', async () => {
    const r = await fetch(`${base}/finesse/arr/radarr/movie`, { method: 'OPTIONS' })
    assert.equal(r.status, 204)
    assert.match(String(r.headers.get('access-control-allow-headers')), /Authorization/)
  })
})

describe('jellyfin proxy', () => {
  test('passes through with the caller’s own auth (plain Jellyfin: prefix stripped)', async () => {
    const r = await fetch(`${base}/jellyfin/Users/Me`, { headers: auth(USER_TOKEN) })
    assert.equal(r.status, 200)
    assert.equal(((await r.json()) as { Name: string }).Name, 'Viewer')
    assert.ok(jf.calls.includes('GET /Users/Me'))
    const pub = await fetch(`${base}/jellyfin/System/Info/Public`)
    assert.equal(pub.status, 200)
  })

  test('websocket upgrade is proxied', async () => {
    // Teach the fake Jellyfin an RFC 6455 handshake that then echoes bytes.
    jf.server.on('upgrade', (req, socket) => {
      const accept = createHash('sha1').update(String(req.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-Path: ${req.url}\r\n\r\n`)
      socket.on('data', (d) => socket.write(d))
      socket.on('end', () => socket.end())
    })
    const u = new URL(base)
    const got = await new Promise<string>((resolve, reject) => {
      const s = connect(Number(u.port), u.hostname, () => {
        s.write(`GET /jellyfin/socket?api_key=x HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
      })
      let buf = ''
      s.on('data', (d) => {
        buf += d.toString()
        if (buf.includes('\r\n\r\n') && !buf.includes('PING')) s.write('PING')
        if (buf.endsWith('PING')) {
          s.destroy()
          resolve(buf)
        }
      })
      s.on('error', reject)
      setTimeout(() => reject(new Error('ws timeout: ' + buf)), 5000)
    })
    assert.match(got, /101 Switching Protocols/)
    assert.match(got, /X-Path: \/socket\?api_key=x/)
    assert.match(got, /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/)
  })
})
