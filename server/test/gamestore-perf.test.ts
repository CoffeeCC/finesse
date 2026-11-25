// The game store under load: the catalogue is parsed once and kept until it changes, the count
// doesn't read the games, one look at every download is one call to qBittorrent (and one
// "can it download?" per tick), and asking for a game twice at once starts one download.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { after, test } from 'node:test'
import { GameStoreDb, type StoredRequest } from '../src/gamestore/db.ts'
import { Pipeline, type Installer } from '../src/gamestore/pipeline.ts'
import { QbitDownloader } from '../src/gamestore/qbit.ts'
import { registerGameStore } from '../src/gamestore/routes.ts'
import type { CatalogueGame, CatalogueSource, Downloader, DownloadStatus } from '../src/gamestore/types.ts'
import { ApiError, Router, sendError } from '../src/http/core.ts'
import { listen, tmp } from './helpers.ts'

const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
const game = (id: string, more: Partial<CatalogueGame> = {}): CatalogueGame => ({ id, title: `Game ${id}`, summary: '', genres: ['Strategy'], modes: ['single'], platforms: ['windows'], addedAt: '2026-01-01T00:00:00.000Z', popularity: 1, provider: 'p', ...more })
const source = (id: string, gameId: string): CatalogueSource => ({ id, gameId, platform: 'windows', installer: 'inno', sizeBytes: 1000, magnet: MAGNET })
const request = (id: string, gameId: string, state: StoredRequest['state'], more: Partial<StoredRequest> = {}): StoredRequest => ({
  id,
  gameId,
  title: `Game ${gameId}`,
  sourceId: `${gameId}-s`,
  platform: 'windows',
  installer: 'inno',
  state,
  userId: 'u1',
  source: source(`${gameId}-s`, gameId),
  added: true,
  createdAt: `2026-01-01T00:00:0${id.length % 10}.000Z`,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...more,
})
const installer: Installer = { install: async () => ({ state: 'failed', reason: 'not in this test', log: [] }), finish: async () => ({ state: 'failed', reason: 'not in this test', log: [] }), remove: async () => {} }

// ---------- the catalogue in memory ----------

test('games() is parsed once and kept; every write to the catalogue drops it', () => {
  const db = new GameStoreDb(':memory:')
  db.replaceProvider('p', [{ game: game('a'), sources: [source('a-s', 'a')] }, { game: game('b'), sources: [] }])
  const first = db.games()
  const second = db.games()
  assert.deepEqual(first.map((g) => g.id).sort(), ['a', 'b'])
  assert.equal(first[0], second[0], 'the same parsed game: nothing was read again')
  assert.notEqual(first, second, 'a fresh array each time')
  first.length = 0
  first.push(game('zz'))
  assert.deepEqual(db.games().map((g) => g.id).sort(), ['a', 'b'], 'changing the array a caller got changes nothing')

  // Each write is seen by the next read.
  db.putGame(game('c', { provider: 'yours' }), [])
  assert.deepEqual(db.games().map((g) => g.id).sort(), ['a', 'b', 'c'], 'putGame')
  db.putGame(game('c', { provider: 'yours', title: 'Renamed' }), [])
  assert.equal(db.games().find((g) => g.id === 'c')!.title, 'Renamed', 'putGame replacing a game')
  db.removeGame('a')
  assert.deepEqual(db.games().map((g) => g.id).sort(), ['b', 'c'], 'removeGame')
  db.replaceProvider('p', [{ game: game('d'), sources: [] }])
  assert.deepEqual(db.games().map((g) => g.id).sort(), ['c', 'd'], 'replaceProvider')
  db.keepProviders(['p'])
  assert.deepEqual(db.games().map((g) => g.id), ['d'], 'keepProviders (a provider that went away)')

  // A failed sync leaves the catalogue as it was, and the next read says so.
  const before = db.games()
  assert.throws(() => db.replaceProvider('p', [{ game: { ...game('e'), title: undefined as unknown as string }, sources: [] }]))
  assert.deepEqual(db.games().map((g) => g.id), before.map((g) => g.id), 'rolled back')
})

test('gameCount() counts rows without reading them, and follows every write', () => {
  const db = new GameStoreDb(':memory:')
  assert.equal(db.gameCount(), 0)
  db.replaceProvider('p', [1, 2, 3].map((n) => ({ game: game(`g${n}`), sources: [] })))
  assert.equal(db.gameCount(), 3)
  db.putGame(game('x', { provider: 'yours' }), [])
  assert.equal(db.gameCount(), 4)
  db.removeGame('g1')
  assert.equal(db.gameCount(), 3)
  assert.equal(db.gameCount(), db.games().length)
})

// ---------- one request per game, even at the same moment ----------

test('createRequest: the check and the insert are one; a game with a request going gets that one', () => {
  const db = new GameStoreDb(':memory:')
  const one = db.createRequest(request('r1', 'g', 'queued'), 'robin asked for it.')
  assert.equal(one.created, true)
  const two = db.createRequest(request('r2', 'g', 'queued'), 'alex asked for it.')
  assert.deepEqual([two.created, two.request.id], [false, 'r1'])
  assert.deepEqual(db.requests().map((r) => r.id), ['r1'])
  assert.deepEqual(db.events('r1').map((e) => [e.state, e.text]), [['queued', 'robin asked for it.']])
  assert.equal(db.activeRequest('g')!.id, 'r1')
  // Once it failed, asking again starts a new one.
  db.advance('r1', 'failed', { detail: 'No.' })
  assert.equal(db.activeRequest('g'), null)
  assert.equal(db.createRequest(request('r3', 'g', 'queued'), 'again').created, true)
  assert.equal(db.activeRequest('g')!.id, 'r3')
})

/** A downloader that takes its time to say it's ready (so two asks overlap) and counts what it's asked. */
function slowDownloader() {
  const count = { available: 0, add: 0, status: 0 }
  const d: Downloader = {
    available: async () => {
      count.available++
      await new Promise((r) => setTimeout(r, 30))
      return { ok: true }
    },
    add: async () => void count.add++,
    status: async () => (count.status++, { state: 'downloading', progress: 1 }),
    pause: async () => {},
    resume: async () => {},
    remove: async () => {},
  }
  return { d, count }
}

test('the pipeline: two starts for one game at the same moment make one request', async () => {
  const db = new GameStoreDb(':memory:')
  const { d } = slowDownloader()
  const p = new Pipeline({ db, downloaderFor: () => d, installer, freeBytes: async () => 1e12 })
  const [a, b] = await Promise.all([p.start(game('g'), source('g-s', 'g'), { id: 'u1', name: 'robin' }), p.start(game('g'), source('g-s', 'g'), { id: 'u2', name: 'alex' })])
  assert.equal(a.id, b.id, 'both get the same request')
  assert.equal(db.requests().length, 1)
  await p.tick()
})

const servers: Server[] = []
after(() => {
  for (const s of servers) s.close()
})

/** The store's routes on a small server of their own: turned on, signed in as whoever X-Who names. */
async function storeServer() {
  const router = new Router()
  const db = new GameStoreDb(':memory:')
  const who = (req: { headers: Record<string, unknown> }) => String(req.headers['x-who'] ?? '')
  const person = (req: { headers: Record<string, unknown> }) => ({ id: who(req), Name: who(req), admin: who(req) === 'alex' })
  const auth = {
    requireUser: async (req: never) => person(req),
    requirePerson: async (req: never) => person(req),
    requireAdmin: async (req: never) => {
      if (!person(req).admin) throw new ApiError(403, 'Administrators only')
      return person(req)
    },
  }
  const settings = { get: () => ({ gameStore: { enabled: true } }), update: () => {}, paths: { configDir: tmp() } }
  const store = registerGameStore(router, { settings: settings as never, auth: auth as never, db })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    try {
      if (!(await router.dispatch({ req, res, path: url.pathname, url }))) throw new ApiError(404, 'Not found')
    } catch (e) {
      sendError(res, e)
    }
  })
  servers.push(server)
  const base = await listen(server)
  const call = async (method: string, path: string, who: string, body?: unknown) => {
    const r = await fetch(`${base}/api/games/store${path}`, { method, headers: { 'X-Who': who, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, data: (await r.json()) as Record<string, unknown> }
  }
  return { store, db, call }
}

test('over HTTP: parallel asks for one game start one download; the settings count the catalogue', async () => {
  const { store, db, call } = await storeServer()
  db.replaceProvider('yours', [{ game: game('g', { provider: 'yours' }), sources: [source('g-s', 'g')] }, { game: game('h', { provider: 'yours' }), sources: [source('h-s', 'h')] }])
  assert.equal((await call('GET', '/settings', 'alex')).data.games, 2)

  const { d } = slowDownloader()
  // Only a start asks how much room there is: how many starts ran.
  let starts = 0
  const p = new Pipeline({ db, downloaderFor: () => d, installer, freeBytes: async () => (starts++, 1e12) })
  store.pipeline = p
  const asks = await Promise.all([
    call('POST', '/requests', 'robin', { gameId: 'g', sourceId: 'g-s' }),
    call('POST', '/requests', 'alex', { gameId: 'g', sourceId: 'g-s' }),
    call('POST', '/requests', 'robin', { gameId: 'g', sourceId: 'g-s' }),
  ])
  assert.deepEqual(asks.map((a) => a.status).sort(), [200, 200, 201], 'one started it, the others joined')
  assert.equal(new Set(asks.map((a) => a.data.id)).size, 1, 'everyone sees the same request')
  assert.equal(db.requests().filter((r) => r.gameId === 'g').length, 1)
  assert.equal(starts, 1, 'one start: the others joined it rather than starting their own')
  // Asking once it's going: that one, straight from the database.
  const again = await call('POST', '/requests', 'robin', { gameId: 'g', sourceId: 'g-s' })
  assert.deepEqual([again.status, again.data.id], [200, asks[0]!.data.id])
  // Another game is its own request.
  assert.equal((await call('POST', '/requests', 'robin', { gameId: 'h', sourceId: 'h-s' })).status, 201)
  await p.tick()
})

// ---------- one call to qBittorrent per look ----------

interface FakeTorrent {
  hash: string
  state: string
  progress: number
  dlspeed: number
  eta: number
  ratio: number
  tags: string
  category: string
  content_path: string
}

/** qBittorrent's API as a fetch function: counts each call by path. */
function qbitFetch(torrents: FakeTorrent[]) {
  const calls: string[] = []
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/api/v2', '')
    calls.push(`${path}${url.search}`)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (path === '/auth/login') return new Response('Ok.', { status: 200 })
    if (path === '/transfer/info') return json({ connection_status: 'connected' })
    if (path === '/torrents/info') {
      const tagged = url.searchParams.get('tag')
      const category = url.searchParams.get('category')
      return json(torrents.filter((t) => (tagged === null || t.tags.split(',').map((x) => x.trim()).includes(tagged)) && (category === null || t.category === category)))
    }
    void init
    return new Response('', { status: 404 })
  }) as typeof fetch
  return { f, calls, info: () => calls.filter((c) => c.startsWith('/torrents/info')) }
}

const torrent = (id: string, more: Partial<FakeTorrent> = {}): FakeTorrent => ({ hash: `h${id}`, state: 'downloading', progress: 0.25, dlspeed: 100, eta: 60, ratio: 0, tags: `finesse-game-${id}`, category: 'games', content_path: `/downloads/${id}`, ...more })

test('qbit statuses(): every download in one call, matched by tag; one moved out of the category is still found', async () => {
  const q = qbitFetch([
    torrent('a'),
    torrent('b', { state: 'uploading', progress: 1, ratio: 1.5, tags: 'someone-else, finesse-game-b' }),
    torrent('c', { category: 'films' }),
  ])
  const d = new QbitDownloader({ config: () => ({ url: 'http://qbit' }), vpn: () => ({ ok: true }), fetch: q.f })
  const st = await d.statuses(['a', 'b', 'c', 'd'])
  assert.deepEqual(st.get('a'), { state: 'downloading', progress: 25, bytesPerSecond: 100, etaSeconds: 60 })
  assert.deepEqual(st.get('b'), { state: 'done', progress: 100, folder: '/downloads/b', ratio: 1.5 })
  assert.equal(st.get('c')!.state, 'downloading', 'in another category: looked up by its tag')
  assert.equal(st.get('d')!.state, 'missing')
  assert.deepEqual(q.info(), ['/torrents/info?category=games', '/torrents/info?tag=finesse-game-c', '/torrents/info?tag=finesse-game-d'])
  // The same answer as asking one by one.
  for (const id of ['a', 'b', 'c', 'd']) assert.deepEqual(await d.status(id), st.get(id))
  assert.equal((await d.statuses([])).size, 0)
})

test('a tick over many downloads asks qBittorrent once; a tick over many waiting requests asks "can it download?" once', async () => {
  const db = new GameStoreDb(':memory:')
  const ids = ['a', 'b', 'c', 'd', 'e']
  for (const id of ids) db.saveRequest(request(id, `game-${id}`, 'downloading'))
  // A finished one still being shared back: its ratio comes from the same call.
  db.saveRequest(request('seed', 'game-seed', 'ready', { readyAt: '2026-01-01T00:00:00.000Z' }))
  const q = qbitFetch([...ids.map((id) => torrent(id)), torrent('seed', { state: 'uploading', progress: 1, ratio: 0.2 })])
  const qbit = new QbitDownloader({ config: () => ({ url: 'http://qbit' }), vpn: () => ({ ok: true }), fetch: q.f })
  const p = new Pipeline({ db, downloaderFor: () => qbit, installer, freeBytes: async () => 1e12, now: () => Date.parse('2026-01-02T00:00:00Z') })
  await p.tick()
  assert.deepEqual(q.info(), ['/torrents/info?category=games'], 'one call for all six')
  for (const id of ids) assert.equal(db.request(id)!.progress, 25)
  assert.equal(db.request('seed')!.downloadRemoved, undefined, 'not shared back enough yet')

  // Waiting requests: the downloader is asked whether it can take downloads once per tick.
  const db2 = new GameStoreDb(':memory:')
  const counted: { available: number; status: number } = { available: 0, status: 0 }
  const down: Downloader = {
    available: async () => (counted.available++, { ok: false, why: 'The VPN is down.' }),
    add: async () => {},
    status: async (): Promise<DownloadStatus> => (counted.status++, { state: 'missing', progress: 0 }),
    pause: async () => {},
    resume: async () => {},
    remove: async () => {},
  }
  for (const id of ['q1', 'q2', 'q3', 'q4']) db2.saveRequest(request(id, `game-${id}`, 'queued', { added: false }))
  const p2 = new Pipeline({ db: db2, downloaderFor: () => down, installer, freeBytes: async () => 1e12 })
  await p2.tick()
  assert.equal(counted.available, 1)
  assert.deepEqual(db2.requests().map((r) => [r.state, r.detail]), Array(4).fill(['queued', 'The VPN is down.']))
  await p2.tick()
  assert.equal(counted.available, 2, 'and again next tick (the VPN may be back)')
})

test('a batch that fails leaves each download to be asked by itself', async () => {
  const db = new GameStoreDb(':memory:')
  db.saveRequest(request('a', 'game-a', 'downloading'))
  const q = qbitFetch([torrent('a')])
  let broken = true
  const f = (async (input: string | URL | Request, init?: RequestInit) => (broken && String(input).includes('category=') ? new Response('', { status: 500 }) : q.f(input, init))) as typeof fetch
  const logs: string[] = []
  const qbit = new QbitDownloader({ config: () => ({ url: 'http://qbit' }), vpn: () => ({ ok: true }), fetch: f })
  const p = new Pipeline({ db, downloaderFor: () => qbit, installer, freeBytes: async () => 1e12, log: (t) => logs.push(t) })
  await p.tick()
  assert.equal(db.request('a')!.progress, 25, 'still moved on')
  assert.match(logs.join('\n'), /answered 500/)
  broken = false
})
