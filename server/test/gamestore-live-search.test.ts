// Live Prowlarr PC-game search & live-request endpoint tests.

import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { after, before, test } from 'node:test'
import { Auth } from '../src/auth.ts'
import { SettingsStore } from '../src/config.ts'
import { Jellyfin } from '../src/jellyfin.ts'
import { GameStoreDb, type StoredRequest } from '../src/gamestore/db.ts'
import { cleanReleaseTitle, liveSearchGames, parseReleaseInfo, validLiveDownloadUrl } from '../src/gamestore/prowlarrSearch.ts'
import { LIVE, registerGameStore, type GameStore, type RequestPipeline } from '../src/gamestore/routes.ts'
import { ApiError, Router, sendJson } from '../src/http/core.ts'
import { listen, tmp } from './helpers.ts'
import { call, fakeJellyfin } from './peers.ts'

const MAGNET_A = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=EldenRing'
const MAGNET_B = 'magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98&dn=Hades'
const MAGNET_C = 'magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&dn=LinuxGame'
const HTTPS_DL = 'https://cdn.example.com/games/celeste-v1.4.zip'

// ---------- Unit tests for release parsing & URL validation ----------

test('parseReleaseInfo extracts clean title, group, platform, installer, and year', () => {
  const fitgirl = parseReleaseInfo('Elden.Ring.Shadow.of.the.Erdtree.v1.12.MULTi14-FitGirl [FitGirl Repack]')
  assert.equal(fitgirl.title, 'Elden Ring Shadow of the Erdtree')
  assert.equal(fitgirl.group, 'FitGirl')
  assert.equal(fitgirl.platform, 'windows')
  assert.equal(fitgirl.installer, 'inno')

  const dodi = parseReleaseInfo('Cyberpunk 2077 (2020) + Phantom Liberty [DODI Repack]')
  assert.equal(dodi.title, 'Cyberpunk 2077 + Phantom Liberty')
  assert.equal(dodi.group, 'DODI')
  assert.equal(dodi.platform, 'windows')
  assert.equal(dodi.installer, 'inno')
  assert.equal(dodi.year, 2020)

  const linux = parseReleaseInfo('Hades.v1.38.Linux.LinuxRuleZ!')
  assert.equal(linux.title, 'Hades')
  assert.equal(linux.group, 'LinuxRuleZ')
  assert.equal(linux.platform, 'linux')
  assert.equal(linux.installer, 'linux')

  const portable = parseReleaseInfo('Hollow Knight Silksong v1.0 Portable InsaneRamZes')
  assert.equal(portable.title, 'Hollow Knight Silksong')
  assert.equal(portable.group, 'Portable')
  assert.equal(portable.platform, 'windows')
  assert.equal(portable.installer, 'portable')

  assert.equal(cleanReleaseTitle('Stardew_Valley_v1.6.8_GOG'), 'Stardew Valley')
})

test('validLiveDownloadUrl accepts valid magnet & https URLs and rejects unsafe schemes', () => {
  assert.deepEqual(validLiveDownloadUrl(MAGNET_A), { magnet: MAGNET_A })
  assert.deepEqual(validLiveDownloadUrl(HTTPS_DL), { url: HTTPS_DL })
  assert.equal(validLiveDownloadUrl('http://insecure.example.com/game.zip'), null)
  assert.equal(validLiveDownloadUrl('https://user:pass@example.com/game.zip'), null)
  assert.equal(validLiveDownloadUrl('magnet:?xt=urn:btih:not-a-valid-hash'), null)
  assert.equal(validLiveDownloadUrl('javascript:alert(1)'), null)
  assert.equal(validLiveDownloadUrl('file:///etc/passwd'), null)
  assert.equal(validLiveDownloadUrl(''), null)
})

test('liveSearchGames returns { available: false, items: [] } when Prowlarr is not configured or unreachable', async () => {
  const unconfigured = await liveSearchGames('elden ring')
  assert.deepEqual(unconfigured, { available: false, items: [] })

  const failingFetch: typeof fetch = async () => {
    throw new Error('ECONNREFUSED')
  }
  const unreachable = await liveSearchGames('elden ring', {
    prowlarr: { url: 'http://127.0.0.1:9696', apiKey: 'secret-key' },
    fetch: failingFetch,
  })
  assert.deepEqual(unreachable, { available: false, items: [] })
})

test('liveSearchGames filters, parses, sorts by relevance & seeders, enriches via Steam, and never leaks API key', async () => {
  const requestedHeaders: Record<string, string>[] = []
  const requestedUrls: string[] = []

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    requestedUrls.push(url)
    const headers = (init?.headers ?? {}) as Record<string, string>
    requestedHeaders.push(headers)

    if (url.includes('/api/v1/search')) {
      return new Response(
        JSON.stringify([
          // Invalid: zero size
          { title: 'Elden Ring Broken', size: 0, seeders: 999, magnetUrl: MAGNET_A, indexer: 'BadIdx' },
          // Invalid: http downloadUrl with apikey (should be filtered out)
          { title: 'Elden Ring Leak', size: 50_000_000_000, seeders: 500, downloadUrl: 'http://prowlarr:9696/1/download?apikey=super-secret', indexer: 'LeakIdx' },
          // Valid lower seeders
          { title: 'Elden.Ring.v1.12-RUNE', size: 65_000_000_000, seeders: 12, magnetUrl: MAGNET_B, indexer: '1337x' },
          // Valid higher seeders FitGirl repack
          { title: 'Elden.Ring.v1.12.MULTi14-FitGirl [FitGirl Repack]', size: 48_000_000_000, seeders: 420, magnetUrl: MAGNET_A, indexer: 'FitGirl' },
          // Duplicate magnet should be deduped
          { title: 'Elden Ring Dup', size: 48_000_000_000, seeders: 1, magnetUrl: MAGNET_A, indexer: 'DupIdx' },
          // Valid HTTPS direct release
          { title: 'Elden Ring Linux Portable', size: 40_000_000_000, seeders: 5, downloadUrl: HTTPS_DL, indexer: 'Direct' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url.includes('store.steampowered.com/api/storesearch')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 1245620,
              name: 'ELDEN RING',
              tiny_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/capsule_231x87.jpg',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('Not found', { status: 404 })
  }

  const res = await liveSearchGames('elden ring', {
    prowlarr: { url: 'http://prowlarr.local:9696', apiKey: 'super-secret-key' },
    fetch: mockFetch,
  })

  assert.equal(res.available, true)
  assert.equal(res.items.length, 3)
  assert.ok(requestedUrls[0]!.includes('categories=4050&categories=4000&type=search'))
  assert.equal(requestedHeaders[0]!['X-Api-Key'], 'super-secret-key')

  // FitGirl repack with 420 seeders should rank first
  assert.equal(res.items[0]!.title, 'Elden Ring')
  assert.equal(res.items[0]!.group, 'FitGirl')
  assert.equal(res.items[0]!.installer, 'inno')
  assert.equal(res.items[0]!.seeders, 420)
  assert.equal(res.items[0]!.steamAppId, 1245620)
  assert.equal(res.items[0]!.cover, 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg')

  // Never leaks API key anywhere in the response
  assert.equal(JSON.stringify(res).includes('super-secret-key'), false)
})

test('liveSearchGames still succeeds when Steam enrichment is offline', async () => {
  const mockFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/v1/search')) {
      return new Response(
        JSON.stringify([{ title: 'Hades.v1.38.LinuxRuleZ!', size: 11_000_000_000, seeders: 80, magnetUrl: MAGNET_C, indexer: 'RuTracker' }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw new Error('Steam offline')
  }

  const res = await liveSearchGames('hades', {
    prowlarr: { url: 'http://prowlarr.local:9696', apiKey: 'k' },
    fetch: mockFetch,
  })
  assert.equal(res.available, true)
  assert.equal(res.items.length, 1)
  assert.equal(res.items[0]!.title, 'Hades')
  assert.equal(res.items[0]!.platform, 'linux')
  assert.equal(res.items[0]!.cover, undefined)
})

// ---------- HTTP route tests: /live-search & /live-request ----------

let jf: Awaited<ReturnType<typeof fakeJellyfin>>
let apiServer: Server
let apiUrl: string
let store: GameStore
let settings: SettingsStore
const startedRequests: { gameId: string; sourceId: string; magnet?: string; url?: string; user: string }[] = []

before(async () => {
  jf = await fakeJellyfin('Home', [{ name: 'alex', token: 't-admin', admin: true }, { name: 'robin', token: 't-robin', admin: false }], 'service')
  const dir = tmp()
  settings = new SettingsStore({
    configDir: dir,
    settingsFile: `${dir}/finesse.json`,
    invitesDb: `${dir}/invites.db`,
    bakedWeb: dir,
    updatedWeb: dir,
    previews: dir,
    backups: dir,
  })
  settings.update((s) => {
    s.jellyfin = { url: jf.url, apiKey: 'service', basePath: '' }
    s.services.prowlarr = { url: 'http://mock-prowlarr:9696', apiKey: 'prowlarr-secret-xyz' }
    s.gameStore = { enabled: true }
  })

  const router = new Router()
  const auth = new Auth(settings, new Jellyfin(settings))
  const db = new GameStoreDb(':memory:')

  const mockLiveFetch: typeof fetch = async (input) => {
    const u = typeof input === 'string' ? input : input.toString()
    if (u.includes('/api/v1/search')) {
      return new Response(
        JSON.stringify([
          {
            title: 'Balatro.v1.0.1-GOG',
            size: 120_000_000,
            seeders: 150,
            magnetUrl: MAGNET_A,
            indexer: '1337x',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  store = registerGameStore(router, { settings, auth, db, liveFetch: mockLiveFetch })

  const fakePipeline: RequestPipeline = {
    async start(game, source, user) {
      startedRequests.push({ gameId: game.id, sourceId: source.id, magnet: source.magnet, url: source.url, user: user.name })
      const now = new Date().toISOString()
      const r: StoredRequest = {
        id: `req-${game.id}`,
        gameId: game.id,
        title: game.title,
        ...(game.cover ? { cover: game.cover } : {}),
        sourceId: source.id,
        platform: source.platform,
        installer: source.installer,
        sizeBytes: source.sizeBytes,
        state: 'queued',
        userId: user.id,
        requestedBy: user.name,
        source,
        createdAt: now,
        updatedAt: now,
      }
      db.saveRequest(r)
      return r
    },
    async cancel() {},
    async retry(r) {
      return r
    },
    async installerDone(r) {
      return r
    },
    async pickProgram(r) {
      return r
    },
    async pause(r) {
      return r
    },
    async resume(r) {
      return r
    },
  }
  store.pipeline = fakePipeline

  apiServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    void router.dispatch({ req, res, path: url.pathname, url }).then((matched) => {
      if (!matched) sendJson(res, 404, { error: 'Not found' })
    }).catch((err: unknown) => {
      if (err instanceof ApiError) sendJson(res, err.status, { error: err.message })
      else sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' })
    })
  })
  apiUrl = await listen(apiServer)
})

after(() => {
  apiServer.close()
  jf.server.close()
})

test('GET /api/games/store/live-search requires auth, returns clean results, and never leaks Prowlarr API key', async () => {
  assert.equal((await call(apiUrl, 'GET', '/api/games/store/live-search?q=balatro')).status, 401)

  const res = await call(apiUrl, 'GET', '/api/games/store/live-search?q=balatro', 't-robin')
  assert.equal(res.status, 200)
  assert.equal(res.data.available, true)
  const items = res.data.items as { title: string; group?: string; downloadUrl: string; seeders: number }[]
  assert.equal(items.length, 1)
  assert.equal(items[0]!.title, 'Balatro')
  assert.equal(items[0]!.group, 'GOG')
  assert.equal(items[0]!.seeders, 150)
  assert.equal(res.text.includes('prowlarr-secret-xyz'), false)
})

test('POST /api/games/store/live-request validates input, upserts under live provider (survives sync), and starts pipeline', async () => {
  assert.equal((await call(apiUrl, 'POST', '/api/games/store/live-request', 't-robin', { title: 'Bad', downloadUrl: 'http://evil.local/a.exe', sizeBytes: 1000 })).status, 400)
  assert.equal((await call(apiUrl, 'POST', '/api/games/store/live-request', 't-robin', { title: '', downloadUrl: MAGNET_A, sizeBytes: 1000 })).status, 400)
  assert.equal((await call(apiUrl, 'POST', '/api/games/store/live-request', 't-robin', { title: 'Zero', downloadUrl: MAGNET_A, sizeBytes: 0 })).status, 400)

  const created = await call(apiUrl, 'POST', '/api/games/store/live-request', 't-robin', {
    title: 'Balatro',
    downloadUrl: MAGNET_A,
    sizeBytes: 120_000_000,
    platform: 'windows',
    installer: 'inno',
    cover: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2379780/header.jpg',
    year: 2024,
    genres: ['Card', 'Roguelike'],
  })
  assert.equal(created.status, 201)
  assert.equal(created.data.title, 'Balatro')
  assert.equal(created.data.gameId, 'live-balatro')
  assert.equal(created.data.state, 'queued')
  assert.equal(startedRequests.length, 1)
  assert.equal(startedRequests[0]!.magnet, MAGNET_A)

  // Verify the game was saved under the protected LIVE provider and survives feed sync
  const storedGame = store.db.game('live-balatro')
  assert.ok(storedGame)
  assert.equal(storedGame.provider, LIVE)
  await store.sync()
  assert.ok(store.db.game('live-balatro'), 'live provider games must not be wiped by feed sync')

  // Requesting the same game again returns the existing active request (200) without starting a duplicate
  const dup = await call(apiUrl, 'POST', '/api/games/store/live-request', 't-robin', {
    title: 'Balatro',
    downloadUrl: MAGNET_A,
    sizeBytes: 120_000_000,
  })
  assert.equal(dup.status, 200)
  assert.equal(startedRequests.length, 1)
})
