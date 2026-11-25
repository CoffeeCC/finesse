import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test, type TestContext } from 'node:test'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { createApp } from '../src/app.ts'
import { sendJson } from '../src/http/core.ts'
import { proxyHttp } from '../src/http/proxy.ts'
import { listen, tmp } from './helpers.ts'

async function serve(t: TestContext, server: Server) {
  const url = await listen(server)
  t.after(() => {
    server.closeAllConnections()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return url
}

async function appFor(t: TestContext, upstream: Server, basePath = '') {
  const dir = tmp()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const target = await serve(t, upstream)
  const { server, deps } = createApp({ paths: {
    configDir: dir, settingsFile: join(dir, 'settings.json'), invitesDb: join(dir, 'invites.db'),
    bakedWeb: dir, updatedWeb: dir, backups: dir, previews: dir,
  } })
  deps.settings.update((s) => { s.jellyfin = { url: target, basePath } })
  return { url: await serve(t, server), dir }
}

function raw(url: string, method: string, encoding: string) {
  return new Promise<{ status: number | undefined; headers: import('node:http').IncomingHttpHeaders; bytes: Buffer }>((resolve, reject) => {
    const req = request(url, { method, headers: { 'Accept-Encoding': encoding } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

test('sendJson negotiates br or gzip, merges Vary, and emits HEAD metadata without a body', async (t) => {
  const large = { value: 'cross-device '.repeat(400) }
  const url = await serve(t, createServer((req, res) => {
    res.setHeader('Vary', 'Origin')
    if (req.url === '/small') return sendJson(res, 200, { ok: true })
    if (req.url === '/explicit') return sendJson(res, 200, large, { 'content-encoding': 'identity' })
    sendJson(res, 201, large, { vArY: 'Cookie, origin' })
  }))

  for (const [accept, encoding, decode] of [
    ['gzip, br', 'br', brotliDecompressSync],
    ['br;q=0, gzip', 'gzip', gunzipSync],
  ] as const) {
    const response = await raw(url, 'GET', accept)
    assert.equal(response.status, 201)
    assert.equal(response.headers['content-encoding'], encoding)
    assert.equal(Number(response.headers['content-length']), response.bytes.length)
    assert.equal(response.headers.vary, 'Origin, Cookie, Accept-Encoding')
    assert.deepEqual(JSON.parse(decode(response.bytes).toString()), large)
    const head = await raw(url, 'HEAD', accept)
    assert.equal(head.status, response.status)
    assert.equal(head.headers['content-encoding'], encoding)
    assert.equal(head.headers['content-length'], response.headers['content-length'])
    assert.equal(head.bytes.length, 0)
    assert.deepEqual(await (await fetch(url, { headers: { 'Accept-Encoding': accept } })).json(), large)
  }

  const identity = await raw(url, 'GET', 'identity')
  assert.equal(identity.headers['content-encoding'], undefined)
  assert.equal(identity.headers.vary, 'Origin, Cookie, Accept-Encoding')
  assert.equal(identity.bytes.toString(), JSON.stringify(large))
  assert.equal((await raw(url, 'HEAD', 'identity')).headers['content-length'], String(identity.bytes.length))
  const small = await raw(`${url}/small`, 'GET', 'br, gzip')
  assert.equal(small.headers['content-encoding'], undefined)
  assert.equal(small.headers.vary, 'Origin')
  assert.equal(small.bytes.toString(), '{"ok":true}')
  const explicit = await raw(`${url}/explicit`, 'GET', 'br, gzip')
  assert.equal(explicit.headers['content-encoding'], 'identity')
  assert.equal(explicit.bytes.toString(), JSON.stringify(large))
})

test('proxyHttp reuses the upstream connection across sequential requests', async (t) => {
  const sockets = new Set()
  const target = new URL(await serve(t, createServer((req, res) => {
    sockets.add(req.socket)
    res.end('upstream')
  })))
  const proxy = await serve(t, createServer((req, res) => { void proxyHttp(req, res, { target }) }))
  for (let i = 0; i < 3; i++) assert.equal((await raw(proxy, 'GET', 'identity')).bytes.toString(), 'upstream')
  assert.equal(sockets.size, 1)
})

test('only successful, tagged Jellyfin item images get the default immutable policy', async (t) => {
  const { url } = await appFor(t, createServer((req, res) => {
    const path = new URL(req.url!, 'http://upstream')
    assert.ok(path.pathname.startsWith('/base/Items/'))
    const tag = path.searchParams.get('tag')
    res.setHeader('Cache-Control', tag === 'existing' ? 'private, max-age=42, Immutable' : 'no-cache')
    res.statusCode = tag === 'missing' ? 404 : 200
    res.end('image')
  }), '/base')

  const path = '/jellyfin/Items/abc/Images/Primary'
  for (const [method, prefix, suffix, status, policy] of [
    ['GET', '', '?tag=abc', 200, 'private, max-age=604800, immutable'],
    ['HEAD', '/finesse', '/0?tag=abc', 200, 'private, max-age=604800, immutable'],
    ['GET', '', '', 200, 'no-cache'],
    ['GET', '', '?tag=', 200, 'no-cache'],
    ['GET', '', '?tag=missing', 404, 'no-cache'],
    ['POST', '', '?tag=abc', 200, 'no-cache'],
    ['GET', '', '?tag=existing', 200, 'private, max-age=42, Immutable'],
  ] as const) {
    const response = await raw(`${url}${prefix}${path}${suffix}`, method, 'identity')
    assert.equal(response.status, status)
    assert.equal(response.headers['cache-control'], policy)
  }
  const metadata = await raw(`${url}/jellyfin/Items/abc?tag=abc`, 'GET', 'identity')
  assert.equal(metadata.headers['cache-control'], 'no-cache')
})

test('concurrent preview requests share a single Jellyfin visibility lookup', async (t) => {
  const item = 'a'.repeat(32)
  const viewer = 'b'.repeat(32)
  let lookups = 0
  const { url, dir } = await appFor(t, createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://upstream')
    res.setHeader('Content-Type', 'application/json')
    if (path.pathname === '/Users/Me') {
      res.end(JSON.stringify({ Id: viewer, Name: 'Viewer' }))
    } else if (path.pathname === `/Items/${item}` && path.searchParams.get('userId') === viewer) {
      lookups++
      await delay(100)
      res.end(JSON.stringify({ Id: item }))
    } else {
      res.writeHead(404).end()
    }
  }))
  writeFileSync(join(dir, `${item}.mp4`), 'preview')
  const preview = `${url}/previews/${item}.mp4`
  const get = () => fetch(preview, { headers: { 'X-Emby-Token': 'preview-viewer-token' } }).then(async (response) => {
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'preview')
  })
  await Promise.all(Array.from({ length: 12 }, get))
  await get()
  assert.equal(lookups, 1)
})
