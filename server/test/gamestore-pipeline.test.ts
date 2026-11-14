// A request's whole journey with a pretend qBittorrent (a real HTTP server speaking its API), a
// pretend installer and real checksum files: queued → downloading → checking → installing →
// ready; the VPN being down; a restart mid-download; cancel, failure and retry; sharing back.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { GameStoreDb } from '../src/gamestore/db.ts'
import { DirectDownloader, fileNameFrom } from '../src/gamestore/direct.ts'
import { Pipeline, type Installer } from '../src/gamestore/pipeline.ts'
import { QbitDownloader } from '../src/gamestore/qbit.ts'
import type { CatalogueGame, CatalogueSource, InstallOutcome } from '../src/gamestore/types.ts'
import { listen, tmp } from './helpers.ts'

const servers: Server[] = []
after(() => {
  for (const s of servers) s.close()
})

const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
const game: CatalogueGame = { id: 'g1', title: 'Stand-in Game', summary: '', genres: [], modes: ['single'], platforms: ['windows'], addedAt: '2026-01-01T00:00:00.000Z', popularity: 1, provider: 't' }
const user = { id: 'u'.repeat(32), name: 'robin' }

interface FakeTorrent {
  hash: string
  tags: string
  category: string
  state: string
  progress: number
  dlspeed: number
  eta: number
  ratio: number
  content_path: string
}

/** qBittorrent's API, as much as Finesse uses: sign-in with a cookie, add, info by tag, stop/start, delete. */
async function fakeQbit(downloads: string) {
  const torrents: FakeTorrent[] = []
  const q = { torrents, connection: 'connected', up: true, logins: 0, v5: true, url: '' }
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (!q.up) return void req.socket.destroy()
      const url = new URL(req.url!, 'http://x')
      const form = new URLSearchParams(body)
      const path = url.pathname.replace('/api/v2', '')
      if (path === '/auth/login') {
        const ok = form.get('username') === 'admin' && form.get('password') === 'pw'
        q.logins++
        return void res.writeHead(200, ok ? { 'Set-Cookie': 'SID=abc; HttpOnly; path=/' } : {}).end(ok ? 'Ok.' : 'Fails.')
      }
      if (req.headers.cookie !== 'SID=abc') return void res.writeHead(403).end('Forbidden')
      const json = (v: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(v))
      if (path === '/transfer/info') return void json({ connection_status: q.connection })
      if (path === '/torrents/info') return void json(torrents.filter((t) => t.tags.split(',').includes(url.searchParams.get('tag') ?? '')))
      if (path === '/torrents/add') {
        const hash = /btih:([0-9a-f]+)/.exec(form.get('urls') ?? '')![1]!
        torrents.push({ hash, tags: form.get('tags') ?? '', category: form.get('category') ?? '', state: 'metaDL', progress: 0, dlspeed: 0, eta: 8640000, ratio: 0, content_path: join(downloads, 'Stand-in Game') })
        return void res.writeHead(200).end('Ok.')
      }
      const mine = torrents.filter((t) => (form.get('hashes') ?? '').split('|').includes(t.hash))
      if (path === '/torrents/stop' || path === '/torrents/start') {
        if (!q.v5) return void res.writeHead(404).end()
        for (const t of mine) t.state = path.endsWith('stop') ? 'stoppedDL' : 'downloading'
        return void res.writeHead(200).end()
      }
      if (path === '/torrents/pause' || path === '/torrents/resume') {
        for (const t of mine) t.state = path.endsWith('pause') ? 'pausedDL' : 'downloading'
        return void res.writeHead(200).end()
      }
      if (path === '/torrents/delete') {
        for (const t of mine) torrents.splice(torrents.indexOf(t), 1)
        return void res.writeHead(200).end()
      }
      res.writeHead(404).end()
    })
  })
  servers.push(server)
  q.url = await listen(server)
  return q
}

/** A finished download on disk, with its own checksum list. */
function finishedDownload(downloads: string, damaged = false) {
  const dir = join(downloads, 'Stand-in Game')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'setup.exe'), 'the installer')
  writeFileSync(join(dir, 'setup.sha256'), `${createHash('sha256').update(damaged ? 'something else' : 'the installer').digest('hex')}  setup.exe\n`)
  return dir
}

async function world(opts: { outcome?: () => InstallOutcome; free?: number } = {}) {
  const dir = tmp()
  const downloads = join(dir, 'torrents', 'games')
  const qbit = await fakeQbit(downloads)
  let vpn: { ok: true } | { ok: false; why: string } = { ok: true }
  const installed: string[] = []
  const removed: string[] = []
  let outcome = opts.outcome ?? ((): InstallOutcome => ({ state: 'ready', by: 'unpack', program: 'app/game.exe', dir: 'install/unpacked', log: [] }))
  const installer: Installer = {
    install: async (r, folder, onStep) => {
      installed.push(folder)
      onStep('setup.exe: Inno Setup 6.2.2')
      return outcome()
    },
    finish: async () => ({ state: 'ready', by: 'needs-you', program: 'game.exe', dir: 'install/game', log: [] }),
    remove: async (r) => void removed.push(r.id),
  }
  const dbFile = join(dir, 'gamestore.db')
  let clock = Date.parse('2026-02-01T00:00:00Z')
  /** A fresh server process over the same database and the same qBittorrent. */
  const boot = () => {
    const db = new GameStoreDb(dbFile)
    const torrents = new QbitDownloader({ config: () => ({ url: qbit.url, username: 'admin', password: 'pw' }), vpn: () => vpn })
    const direct = new DirectDownloader(join(dir, 'direct'))
    const pipeline = new Pipeline({ db, downloaderFor: (s) => (s.magnet ? torrents : direct), installer, freeBytes: async () => opts.free ?? 1e12, seeding: () => ({ ratio: 1, days: 7 }), now: () => clock })
    return { db, pipeline, torrents }
  }
  const source: CatalogueSource = { id: 's1', gameId: 'g1', platform: 'windows', installer: 'inno', sizeBytes: 1000, magnet: MAGNET }
  /** Ticks until nothing is running in the background and the state has settled. */
  const settle = async (p: Pipeline, db: GameStoreDb, id: string) => {
    let last = ''
    for (let i = 0; i < 50; i++) {
      await p.tick()
      await new Promise((r) => setTimeout(r, 5))
      const now = db.request(id)?.state ?? 'gone'
      if (now === last && !['checking', 'installing', 'finishing'].includes(now)) return now
      last = now
    }
    return last
  }
  return { dir, downloads, qbit, boot, source, installed, removed, settle, setVpn: (v: typeof vpn) => (vpn = v), setOutcome: (o: () => InstallOutcome) => (outcome = o), tick: (ms: number) => (clock += ms) }
}

test('queued → downloading → checking → installing → ready, with its history; then shared back and the download removed', async () => {
  const w = await world()
  const { db, pipeline } = w.boot()
  const r = await pipeline.start(game, w.source, user)
  assert.equal(r.state, 'queued')
  await pipeline.tick()
  const t = w.qbit.torrents[0]!
  assert.deepEqual([db.request(r.id)!.state, t.category, t.tags], ['downloading', 'games', `finesse-game-${r.id}`])
  await pipeline.tick()
  assert.equal(db.request(r.id)!.detail, 'Waiting for other downloads, or for someone to share it.')

  Object.assign(t, { state: 'downloading', progress: 0.425, dlspeed: 2_000_000, eta: 90 })
  await pipeline.tick()
  const mid = db.request(r.id)!
  assert.deepEqual([mid.state, mid.progress, mid.bytesPerSecond, mid.etaSeconds, mid.detail], ['downloading', 42.5, 2_000_000, 90, undefined])

  const folder = finishedDownload(w.downloads)
  Object.assign(t, { state: 'uploading', progress: 1 })
  assert.equal(await w.settle(pipeline, db, r.id), 'ready')
  const done = db.request(r.id)!
  assert.deepEqual([done.installDir, done.program, done.folder], ['install/unpacked', 'app/game.exe', folder])
  assert.deepEqual(w.installed, [folder])
  assert.deepEqual(
    db.events(r.id).map((e) => `${e.state}: ${e.text}`),
    ['queued: robin asked for it.', 'downloading: The download started.', 'checking: The download finished.', 'installing: Its checksum matches.', 'installing: setup.exe: Inno Setup 6.2.2', 'finishing: Installed, and it starts.', 'ready: Ready to play.'],
  )
  assert.equal(w.qbit.logins, 1, 'one sign-in for all of it')

  // Still sharing: kept. Shared back as much as it took: removed, the game stays.
  await pipeline.tick()
  assert.equal(w.qbit.torrents.length, 1)
  t.ratio = 1.2
  await pipeline.tick()
  assert.deepEqual([w.qbit.torrents.length, db.request(r.id)!.downloadRemoved, db.request(r.id)!.state], [0, true, 'ready'])
})

test('the VPN: nothing is added while it’s down, and the request says why and waits', async () => {
  const w = await world()
  const { db, pipeline } = w.boot()
  w.setVpn({ ok: false, why: 'The VPN isn’t set up.' })
  await assert.rejects(pipeline.start(game, w.source, user), /The VPN isn’t set up\./)
  w.setVpn({ ok: true })
  const r = await pipeline.start(game, w.source, user)

  // It drops between asking and adding.
  w.qbit.connection = 'disconnected'
  await pipeline.tick()
  assert.deepEqual([db.request(r.id)!.state, w.qbit.torrents.length], ['queued', 0])
  assert.match(db.request(r.id)!.detail!, /^The VPN is down, so nothing is being downloaded/)
  // On Docker the downloader is inside the VPN's network: no VPN, no answer at all.
  w.qbit.up = false
  await pipeline.tick()
  assert.match(db.request(r.id)!.detail!, /^The VPN or the downloader is down/)
  w.qbit.up = true
  w.qbit.connection = 'connected'
  await pipeline.tick()
  await pipeline.tick()
  assert.deepEqual([db.request(r.id)!.state, w.qbit.torrents.length, db.request(r.id)!.detail], ['downloading', 1, 'Waiting for other downloads, or for someone to share it.'])
})

test('a restart mid-download carries on; adding is never done twice', async () => {
  const w = await world()
  const first = w.boot()
  const r = await first.pipeline.start(game, w.source, user)
  await first.pipeline.tick()
  Object.assign(w.qbit.torrents[0]!, { state: 'downloading', progress: 0.3 })
  await first.pipeline.tick()
  first.pipeline.halt()

  const second = w.boot()
  assert.deepEqual([second.db.request(r.id)!.state, second.db.request(r.id)!.progress], ['downloading', 30])
  Object.assign(w.qbit.torrents[0]!, { progress: 0.8 })
  await second.pipeline.tick()
  assert.deepEqual([second.db.request(r.id)!.progress, w.qbit.torrents.length], [80, 1])
  await second.torrents.add({ id: r.id, magnet: MAGNET, sizeBytes: 1000 })
  assert.equal(w.qbit.torrents.length, 1)

  // And a restart while it was installing: the install is simply run again.
  finishedDownload(w.downloads)
  Object.assign(w.qbit.torrents[0]!, { state: 'stalledUP', progress: 1 })
  await second.pipeline.tick()
  second.db.advance(r.id, 'installing')
  const third = w.boot()
  assert.equal(await w.settle(third.pipeline, third.db, r.id), 'ready')
  assert.equal(w.installed.length, 1)
})

test('a damaged download fails with what’s wrong; retry keeps a good download and only installs again', async () => {
  const w = await world()
  const { db, pipeline } = w.boot()
  const r = await pipeline.start(game, w.source, user)
  await pipeline.tick()
  finishedDownload(w.downloads, true)
  Object.assign(w.qbit.torrents[0]!, { state: 'uploading', progress: 1 })
  assert.equal(await w.settle(pipeline, db, r.id), 'failed')
  assert.match(db.request(r.id)!.detail!, /^setup\.exe doesn’t match its checksum\. It may be damaged or incomplete/)
  assert.equal(w.installed.length, 0, 'nothing damaged is ever installed')

  // The files are fine this time, but the installer isn't.
  finishedDownload(w.downloads)
  w.setOutcome(() => ({ state: 'failed', reason: 'The installer said: Not enough disk space.', log: [] }))
  assert.equal((await pipeline.retry(db.request(r.id)!)).state, 'checking')
  assert.equal(await w.settle(pipeline, db, r.id), 'failed')
  assert.equal(db.request(r.id)!.detail, 'The installer said: Not enough disk space.')

  w.setOutcome(() => ({ state: 'needs-you', waitingOn: 'Setup', why: 'Setup: Enter your player name', log: [] }))
  await pipeline.retry(db.request(r.id)!)
  assert.equal(await w.settle(pipeline, db, r.id), 'needs-you')
  assert.deepEqual([db.request(r.id)!.detail, db.request(r.id)!.waitingOn, w.qbit.torrents.length], ['Setup: Enter your player name', 'Setup', 1])
  const finished = await pipeline.installerDone(db.request(r.id)!)
  assert.deepEqual([finished.state, finished.program, finished.waitingOn], ['ready', 'game.exe', undefined])
})

test('cancel stops the download and removes its files; a downloader error and a vanished download fail in words; no room is said up front', async () => {
  const w = await world()
  const { db, pipeline } = w.boot()
  const r = await pipeline.start(game, w.source, user)
  await pipeline.tick()
  await pipeline.cancel(db.request(r.id)!)
  db.removeRequest(r.id)
  assert.deepEqual([w.qbit.torrents.length, w.removed], [0, [r.id]])
  await pipeline.tick()

  const b = await pipeline.start(game, w.source, user)
  await pipeline.tick()
  w.qbit.torrents[0]!.state = 'error'
  await pipeline.tick()
  assert.deepEqual([db.request(b.id)!.state, db.request(b.id)!.detail], ['failed', 'The downloader hit an error (often a full disk).'])
  w.qbit.torrents.length = 0
  assert.equal((await pipeline.retry(db.request(b.id)!)).state, 'queued')
  await pipeline.tick()
  w.qbit.torrents.length = 0
  await pipeline.tick()
  await pipeline.tick()
  assert.equal(db.request(b.id)!.state, 'downloading', 'a download that vanished is added again once')

  const small = await world({ free: 2500 })
  await assert.rejects(small.boot().pipeline.start(game, small.source, user), /isn’t enough room for this game: it needs about 1 MB free while it installs/)
})

test('qBittorrent 4 says pause where 5 says stop; a wrong password is said plainly', async () => {
  const w = await world()
  const { pipeline, torrents } = w.boot()
  const r = await pipeline.start(game, w.source, user)
  await pipeline.tick()
  await torrents.pause(r.id)
  assert.equal(w.qbit.torrents[0]!.state, 'stoppedDL')
  assert.equal((await torrents.status(r.id)).state, 'paused')
  w.qbit.v5 = false
  await torrents.resume(r.id)
  assert.equal(w.qbit.torrents[0]!.state, 'downloading')
  const wrong = new QbitDownloader({ config: () => ({ url: w.qbit.url, username: 'admin', password: 'nope' }), vpn: () => ({ ok: true }) })
  assert.deepEqual(await wrong.available(), { ok: false, why: 'The VPN or the downloader is down, so nothing is being downloaded. It starts again by itself when they’re back.' })
  assert.deepEqual(await new QbitDownloader({ config: () => null, vpn: () => ({ ok: true }) }).available().then((a) => a.ok), false)
})

test('a direct https download: carried on after being cut off, and removed once the game is installed', async () => {
  const dir = tmp()
  const data = Buffer.alloc(300_000, 7)
  let cut = true
  const ranges: (string | null)[] = []
  // A pretend https server: the first answer is cut off part-way; then it honours "carry on from here".
  const get = (async (url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range')
    ranges.push(range)
    const from = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ === 0) return void c.enqueue(data.subarray(from, from + 100_000))
        if (cut) return void c.error(new Error('terminated'))
        if (from + 100_000 < data.length) c.enqueue(data.subarray(from + 100_000))
        c.close()
      },
    })
    const res = new Response(body, { status: from ? 206 : 200, headers: { 'content-length': String(data.length - from) } })
    Object.defineProperty(res, 'url', { value: url })
    return res
  }) as typeof fetch
  const d = new DirectDownloader(dir, get)
  const job = { id: 'r1', url: 'https://example.org/dl/My%20Game-1.0.tar.xz?x=1', sizeBytes: data.length }
  await assert.rejects(d.add({ id: 'x', url: 'http://example.org/a', sizeBytes: 1 }), /only takes https/)
  await d.add(job)
  const until = async (state: string) => {
    for (let i = 0; i < 200 && (await d.status('r1')).state !== state; i++) await new Promise((r) => setTimeout(r, 5))
    return d.status('r1')
  }
  const broken = await until('error')
  assert.match(broken.reason!, /cut off\. Try again: it carries on/)
  cut = false
  await d.resume('r1')
  const done = await until('done')
  assert.deepEqual([done.folder, ranges], [d.folder('r1'), [null, 'bytes=100000-']])
  assert.equal(existsSync(join(d.folder('r1'), 'My Game-1.0.tar.xz')), true)
  assert.equal(fileNameFrom('https://example.org/a/..%2F..%2Fetc%2Fpasswd'), '_.._etc_passwd')
  // A new process finds it finished on disk.
  assert.equal((await new DirectDownloader(dir, get).status('r1')).state, 'done')
  await d.remove('r1', { files: true })
  assert.equal(existsSync(d.folder('r1')), false)
})
