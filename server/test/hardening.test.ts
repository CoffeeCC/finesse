import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PassThrough } from 'node:stream'
import { test, type TestContext } from 'node:test'
import { createApp } from '../src/app.ts'
import { Auth, checkSetupCode, tokenFrom } from '../src/auth.ts'
import { SettingsStore } from '../src/config.ts'
import { ApiError } from '../src/http/core.ts'
import { proxyHttp } from '../src/http/proxy.ts'
import { compressed, sendFile } from '../src/http/static.ts'
import { Jellyfin, JfError } from '../src/jellyfin.ts'
import { pruneOrphans } from '../src/stack/clips.ts'
import type { StackHost } from '../src/stack/host.ts'
import { Maintainer } from '../src/stack/maintain.ts'
import { API_KEY, listen, tmp } from './helpers.ts'

function pathsFor(t: TestContext) {
  const dir = tmp()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return {
    configDir: dir, settingsFile: join(dir, 'finesse.json'), invitesDb: join(dir, 'invites.db'),
    backups: join(dir, 'backups'), bakedWeb: dir, updatedWeb: dir, previews: dir,
  }
}

async function serve(t: TestContext, server: Server) {
  const url = await listen(server)
  t.after(() => {
    server.closeAllConnections()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return url
}

test('request and upgrade handlers contain request target parsing failures', async (t) => {
  const { server } = createApp({ paths: pathsFor(t) })
  const req = {
    get url(): string { throw new TypeError('Invalid request target') },
  } as IncomingMessage
  let status = 0
  let body = ''
  const res = {
    writeHead(code: number) { status = code },
    end(data: Buffer) { body = data.toString() },
  } as unknown as ServerResponse
  server.emit('request', req, res)
  assert.equal(status, 400)
  assert.match(body, /Invalid request URL/)

  const socket = new PassThrough()
  const closed = once(socket, 'close')
  server.emit('upgrade', req, socket, Buffer.alloc(0))
  await closed
  assert.ok(socket.destroyed)
  assert.doesNotThrow(() => socket.emit('error', new Error('late socket error')))
})

test('authenticated preview clips are privately cacheable and malformed cookies are unauthorized', async (t) => {
  const paths = pathsFor(t)
  const { server, deps } = createApp({ paths })
  deps.settings.update((s) => { s.jellyfin.apiKey = API_KEY })
  const name = `${'a'.repeat(32)}.mp4`
  writeFileSync(join(paths.previews, name), 'clip')
  const url = await serve(t, server)
  const preview = `${url}/previews/${name}`
  const bad = await fetch(preview, { headers: { cookie: 'finesse_media_token=%' } })
  assert.equal(bad.status, 401)
  const good = await fetch(preview, { headers: { 'x-emby-token': API_KEY } })
  assert.equal(good.status, 200)
  assert.equal(good.headers.get('cache-control'), 'private, max-age=86400')
  assert.equal(good.headers.get('vary'), 'Cookie, Authorization')
  assert.equal(await good.text(), 'clip')
})

test('token cookies decode safely', () => {
  const opts = { cookie: 'token', query: new URLSearchParams({ ApiKey: 'fallback' }) }
  assert.equal(tokenFrom({ headers: { cookie: 'token=%' } } as IncomingMessage, opts), null)
  assert.equal(tokenFrom({ headers: { cookie: 'token=abc%3D' } } as IncomingMessage, opts), 'abc=')
})

test('auth shares in-flight reads, retries errors, and preserves newer cache entries', async (t) => {
  const settings = new SettingsStore(pathsFor(t))
  const jf = new Jellyfin(settings)
  const auth = new Auth(settings, jf)
  let fail = true
  const me = t.mock.method(jf, 'me', async (token: string) => {
    if (token === 'retry' && fail) {
      fail = false
      throw new JfError(503, 'unavailable')
    }
    return { Id: token, Name: token }
  })
  const errors = await Promise.allSettled([auth.userFor('retry'), auth.userFor('retry')])
  assert.deepEqual(errors.map((r) => r.status), ['rejected', 'rejected'])
  assert.equal(me.mock.callCount(), 1)
  assert.equal((await auth.userFor('retry'))?.Id, 'retry')

  const [a, b] = await Promise.all([auth.userFor('keep'), auth.userFor('keep')])
  assert.equal(a, b)
  assert.equal(me.mock.callCount(), 3)
  for (let i = 0; i < 4999; i++) await auth.userFor(String(i))
  const calls = me.mock.callCount()
  assert.equal(await auth.userFor('keep'), a)
  assert.equal(me.mock.callCount(), calls)
  await auth.userFor('retry')
  assert.equal(me.mock.callCount(), calls + 1)
})

test('setup attempt buckets expire after one minute', (t) => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const req = { socket: { remoteAddress: '127.0.0.2' }, headers: {} } as IncomingMessage
  const rejectsWith = (status: number) => (e: unknown) => e instanceof ApiError && e.status === status
  for (let i = 0; i < 10; i++) assert.throws(() => checkSetupCode('', '', req), rejectsWith(401))
  assert.throws(() => checkSetupCode('', '', req), rejectsWith(429))
  now += 60_000
  const hash = scryptSync('ABCDEFGH', 'salt', 32).toString('hex')
  req.headers['x-finesse-setup-code'] = 'ABCDEFGH'
  assert.doesNotThrow(() => checkSetupCode('salt', hash, req))
})

test('static variants vary consistently, and a lost range file closes only its response', async (t) => {
  const file = join(pathsFor(t).configDir, 'app.js')
  writeFileSync(file, 'x'.repeat(2000))
  const stat = statSync(file)
  const url = await serve(t, createServer((req, res) => sendFile(req, res, file, stat, '/app.js', { Vary: 'Cookie' })))
  const identity = await fetch(url, { headers: { 'accept-encoding': 'identity' } })
  assert.equal(identity.headers.get('vary'), 'Cookie, Accept-Encoding')
  assert.equal(identity.headers.get('content-encoding'), null)
  await identity.text()
  const unchanged = await fetch(url, { headers: { 'if-none-match': identity.headers.get('etag')! } })
  assert.equal(unchanged.status, 304)
  assert.equal(unchanged.headers.get('vary'), 'Cookie, Accept-Encoding')
  const gzip = await fetch(url, { headers: { 'accept-encoding': 'gzip' } })
  assert.equal(gzip.headers.get('content-encoding'), 'gzip')
  assert.equal(gzip.headers.get('vary'), 'Cookie, Accept-Encoding')
  await gzip.text()
  rmSync(file)
  await assert.rejects(async () => (await fetch(url, { headers: { range: 'bytes=0-9' } })).text())
})

test('the compression cache evicts only the oldest entries needed to stay under budget', async (t) => {
  const dir = pathsFor(t).configDir
  const bytes = randomBytes(22 << 20)
  const files = ['first', 'second', 'third'].map((name) => {
    const file = join(dir, `${name}.js`)
    writeFileSync(file, bytes)
    return file
  })
  const gzip = (file: string) => compressed(file, statSync(file), 'gzip')

  const first = await gzip(files[0]!)
  const second = await gzip(files[1]!)
  assert.equal(await gzip(files[0]!), first)
  await gzip(files[2]!)
  assert.equal(await gzip(files[1]!), second)
  assert.notEqual(await gzip(files[0]!), first)
})

test('credential-stripping HTTP proxies suppress upstream cookies', async (t) => {
  const target = new URL(await serve(t, createServer((_req, res) => {
    res.setHeader('Set-Cookie', ['a=1', 'b=2'])
    res.end('ok')
  })))
  const url = await serve(t, createServer((req, res) => {
    void proxyHttp(req, res, { target, stripAuth: req.url === '/strip' })
  }))
  const stripped = await fetch(`${url}/strip`)
  assert.deepEqual(stripped.headers.getSetCookie(), [])
  assert.equal(await stripped.text(), 'ok')
  const retained = await fetch(url)
  assert.deepEqual(retained.headers.getSetCookie(), ['a=1', 'b=2'])
  await retained.text()
})

test('a rewrite closes an oversized chunked upstream before EOF', async (t) => {
  let upstreamClosed!: Promise<void>
  const target = new URL(await serve(t, createServer(async (_req, res) => {
    upstreamClosed = once(res, 'close').then(() => {})
    res.writeHead(200, { 'Content-Type': 'application/json' })
    const chunk = Buffer.alloc(1 << 20)
    for (let i = 0; i < 34 && !res.destroyed; i++) {
      if (!res.write(chunk)) {
        await new Promise<void>((resolve) => {
          const done = () => {
            res.off('drain', done)
            res.off('close', done)
            resolve()
          }
          res.once('drain', done)
          res.once('close', done)
        })
      }
    }
  })))
  const rewrite = t.mock.fn((value: string) => value)
  const url = await serve(t, createServer((req, res) => {
    void proxyHttp(req, res, { target, rewriteText: rewrite })
  }))
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 502)
  await response.text()
  await upstreamClosed
  assert.equal(rewrite.mock.callCount(), 0)
})

test('a buffered rewrite times out when upstream stops sending after headers', async (t) => {
  let upstreamClosed!: Promise<void>
  const target = new URL(await serve(t, createServer((_req, res) => {
    upstreamClosed = once(res, 'close').then(() => {})
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{')
  })))
  const url = await serve(t, createServer((req, res) => {
    void proxyHttp(req, res, { target, timeoutMs: 100, rewriteText: (value) => value })
  }))
  // No response body from the upstream can escape while the rewrite is pending.
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
  assert.equal(response.status, 502)
  await response.text()
  await upstreamClosed
})

test('repeated shrunken clip listings preserve the last good baseline and clear candidates', () => {
  const missing = 'a'.repeat(32)
  const names = [`${missing}.mp4`]
  const full = new Set(Array.from({ length: 10 }, (_, i) => String(i)))
  const small = new Set(['1', '2'])
  const first = pruneOrphans(names, full, { count: 0 })
  assert.deepEqual(first.next.candidates, [missing])
  const shrunken = pruneOrphans(names, small, first.next)
  assert.deepEqual(shrunken, { remove: [], next: { count: 10, candidates: [] }, skipped: true })
  assert.deepEqual(pruneOrphans(names, small, shrunken.next), shrunken)
  assert.deepEqual(pruneOrphans(names, new Set(), first.next), shrunken)
  const recovered = pruneOrphans(names, full, shrunken.next)
  assert.deepEqual(recovered.remove, [])
  assert.deepEqual(pruneOrphans(names, full, recovered.next).remove, names)
})

test('backups run one at a time with distinct snapshots and recover after failure', async (t) => {
  const paths = pathsFor(t)
  const settings = new SettingsStore(paths)
  settings.update((s) => { s.mode = 'adopt' })
  const db = new DatabaseSync(paths.invitesDb)
  db.exec('CREATE TABLE example (id INTEGER)')
  db.close()
  const maint = new Maintainer(settings, {} as StackHost, paths)
  const steps: string[] = []
  const first = maint.backupNow('manual', ['settings'], (step) => steps.push(`first ${step}`))
  const second = maint.backupNow('nightly', ['settings'], (step) => steps.push(`second ${step}`))
  const [a, b] = await Promise.all([first, second])
  assert.notEqual(a.name, b.name)
  assert.deepEqual(new Set(readdirSync(paths.backups)), new Set([a.name, b.name]))
  assert.ok(steps.indexOf('first Writing the backup…') < steps.indexOf('second Asking the apps for snapshots…'))
  assert.ok(steps.includes('first Writing the backup…'))

  await assert.rejects(maint.backupNow('manual', [], () => { throw new Error('interrupted') }), /interrupted/)
  const recovered = await maint.backupNow('manual', [])
  assert.ok(recovered.size > 0)
})
