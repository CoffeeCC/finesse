// The game store's API, /api/games/store/* (the calls src/api/gameStore.ts makes). Browsing is
// answered from the catalogue in sqlite. Requests are handed to the pipeline (downloading,
// checking, installing: WS2–WS5 of docs/agents/game-store-plan.md); until one is plugged in they
// answer 501 in plain words. Nothing here ever sends where a download comes from.

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Auth } from '../auth.ts'
import type { SettingsStore } from '../config.ts'
import { ApiError, readJson, sendJson, type Router } from '../http/core.ts'
import { ArtCache, artId } from './art.ts'
import { facets, home, publicGame, search, similar } from './catalogue.ts'
import { GameStoreDb, publicRequest, publicSource, type StoredRequest } from './db.ts'
import { cleanFeedConfig, feedProvider, parseFeed, type Fetcher, type FeedConfig } from './feed.ts'
import type { CatalogueGame, CatalogueSource, GameMode, GamePlatform, StoreGameDetail, StoreQuery, StoreSort } from './types.ts'

/** What turns a request into an installed game. WS2 onwards provide it. */
export interface RequestPipeline {
  /** Start (or carry on) a new request. Throws an ApiError when it can't be taken, saying why. */
  start(game: CatalogueGame, source: CatalogueSource, user: { id: string; name: string }): Promise<StoredRequest>
  cancel(r: StoredRequest): Promise<void>
  retry(r: StoredRequest): Promise<StoredRequest>
  /** The person finished the installer by hand ("Needs you"). */
  installerDone(r: StoredRequest): Promise<StoredRequest>
  pause(r: StoredRequest): Promise<StoredRequest>
  resume(r: StoredRequest): Promise<StoredRequest>
}

/** A game added from a file an administrator has (wiring.ts streams it into the data folder). */
export type Upload = (body: NodeJS.ReadableStream, meta: { title: string; fileName: string; platform: GamePlatform; sizeBytes: number }, user: { id: string; name: string }) => Promise<StoredRequest>

/** How a feed's last read went (Settings shows it). */
export interface FeedStatus {
  at: string
  ok: boolean
  games: number
  /** Why it failed, or which games were left out, in words. */
  notes: string[]
}

export interface GameStore {
  db: GameStoreDb
  /** Reads every feed into the catalogue. Never throws: each feed's status says how it went. */
  sync(): Promise<Record<string, FeedStatus>>
  /** Reads the feeds now and twice a day while the store is on. */
  start(): void
  stop(): void
  /** Plugged in (wiring.ts) on servers that can download. */
  pipeline?: RequestPipeline
  upload?: Upload
  /** There's a sandbox to install in too; without one a request stops after its download is checked. */
  installs?: boolean
}

const SORTS: StoreSort[] = ['popular', 'new', 'name', 'year']
const PLATFORMS: GamePlatform[] = ['windows', 'linux']
const MODES: GameMode[] = ['single', 'local', 'online']

function oneOf<T extends string>(v: string | null, all: T[], what: string): T | undefined {
  if (v === null || v === '') return undefined
  if (!all.includes(v as T)) throw new ApiError(400, `${what} is one of: ${all.join(', ')}`)
  return v as T
}

function count(v: string | null, what: string): number | undefined {
  if (v === null || v === '') return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) throw new ApiError(400, `${what} is a whole number`)
  return n
}

/** The query the app sends (src/api/gameStore.ts queryToParams). */
export function queryFrom(p: URLSearchParams): StoreQuery {
  const genres = (p.get('genres') ?? '').split(',').map((g) => g.trim().toLowerCase()).filter(Boolean)
  return {
    q: p.get('q')?.slice(0, 200) || undefined,
    genres: genres.length ? genres.slice(0, 30) : undefined,
    platform: oneOf(p.get('platform'), PLATFORMS, 'platform'),
    mode: oneOf(p.get('mode'), MODES, 'mode'),
    sort: oneOf(p.get('sort'), SORTS, 'sort'),
    offset: count(p.get('offset'), 'offset'),
    limit: count(p.get('limit'), 'limit'),
  }
}

export function gameStoreEnabled(settings: SettingsStore): boolean {
  return settings.get().gameStore?.enabled === true
}

const SYNC_EVERY_MS = 12 * 60 * 60 * 1000
/** Games added from files by an administrator: not from any feed, so a sync leaves them alone. */
export const YOURS = 'yours'

export function registerGameStore(router: Router, deps: { settings: SettingsStore; auth: Auth; db?: GameStoreDb; get?: Fetcher; art?: ArtCache }): GameStore {
  const { settings, auth } = deps
  const db = deps.db ?? new GameStoreDb(join(settings.paths.configDir, 'gamestore.db'))
  const feeds = (): FeedConfig[] => settings.get().gameStore?.feeds ?? []
  const status: Record<string, FeedStatus> = {}
  let syncing: Promise<Record<string, FeedStatus>> | null = null
  let timer: NodeJS.Timeout | null = null

  // Feed files dropped into the config folder (game-feeds/*.json): the same format, read from
  // disk. This is where a script of your own, or an agent, plugs a source in: it writes the file.
  const filesDir = join(settings.paths.configDir, 'game-feeds')
  const localFeeds = (): { id: string; name: string; file: string }[] => {
    let names: string[] = []
    try {
      names = readdirSync(filesDir).filter((n) => n.toLowerCase().endsWith('.json')).sort()
    } catch {
      /* no folder: no files */
    }
    return names.slice(0, 50).map((n) => {
      const name = basename(n, '.json')
      return { id: `file-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'feed'}`, name, file: join(filesDir, n) }
    })
  }

  const syncOnce = async () => {
    const list = feeds()
    const files = localFeeds()
    const ids = [...list.map((f) => f.id), ...files.map((f) => f.id), YOURS]
    db.keepProviders(ids)
    for (const id of Object.keys(status)) if (!ids.includes(id)) delete status[id]
    for (const f of files) {
      try {
        const feed = parseFeed(JSON.parse(readFileSync(f.file, 'utf8')), f.id)
        db.replaceProvider(f.id, feed.entries)
        status[f.id] = { at: new Date().toISOString(), ok: true, games: feed.entries.length, notes: feed.skipped.slice(0, 20) }
      } catch (e) {
        const why = e instanceof SyntaxError ? 'The file isn’t valid JSON.' : e instanceof Error ? e.message : 'The file couldn’t be read.'
        status[f.id] = { at: new Date().toISOString(), ok: false, games: db.games().filter((g) => g.provider === f.id).length, notes: [why] }
      }
    }
    for (const cfg of list) {
      const provider = feedProvider(cfg, deps.get)
      try {
        const entries = []
        for await (const e of provider.list()) entries.push(e)
        db.replaceProvider(cfg.id, entries)
        status[cfg.id] = { at: new Date().toISOString(), ok: true, games: entries.length, notes: provider.skipped.slice(0, 20) }
      } catch (e) {
        // A feed that can't be read keeps the games it gave last time.
        status[cfg.id] = { at: new Date().toISOString(), ok: false, games: db.games().filter((g) => g.provider === cfg.id).length, notes: [e instanceof Error ? e.message : 'The feed couldn’t be read.'] }
      }
    }
    return status
  }
  const store: GameStore = {
    db,
    sync: () => (syncing ??= syncOnce().finally(() => (syncing = null))),
    start() {
      if (timer) return
      const tick = () => void (gameStoreEnabled(settings) && (feeds().length || localFeeds().length) ? store.sync() : null)
      timer = setInterval(tick, SYNC_EVERY_MS)
      timer.unref()
      tick()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
  const feedList = () => [
    ...feeds().map((f) => ({ ...f, status: status[f.id] ?? null })),
    ...localFeeds().map((f) => ({ id: f.id, name: f.name, file: basename(f.file), status: status[f.id] ?? null })),
  ]

  const on = () => {
    if (!gameStoreEnabled(settings)) throw new ApiError(404, 'The game store isn’t turned on on this server. An administrator can turn it on in Settings.')
  }
  const pipeline = (): RequestPipeline => {
    if (!store.pipeline) throw new ApiError(501, 'This server can’t download games: that needs a server Finesse set up itself. Browsing the store still works.')
    return store.pipeline
  }
  const requestOr404 = (id: string | undefined): StoredRequest => {
    const r = id ? db.request(id) : null
    if (!r) throw new ApiError(404, 'That request isn’t here any more.')
    return r
  }

  const seeding = () => settings.get().gameStore?.seeding ?? { ratio: 1, days: 7 }
  const state = () => ({ enabled: gameStoreEnabled(settings), canDownload: Boolean(store.pipeline), canInstall: Boolean(store.pipeline && store.installs), games: db.games().length, seeding: seeding() })

  // On or off (administrators). Off is the default: Finesse ships no game sources.
  router.get('/api/games/store/settings', async ({ req, res }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, state())
  })
  router.put('/api/games/store/settings', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ enabled?: unknown; seeding?: { ratio?: unknown; days?: unknown } }>(req)
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new ApiError(400, 'enabled is true or false')
    if (body.enabled === undefined && body.seeding === undefined) throw new ApiError(400, 'Nothing to change')
    const enabled = body.enabled ?? gameStoreEnabled(settings)
    let share = seeding()
    if (body.seeding !== undefined) {
      const ratio = Number(body.seeding?.ratio)
      const days = Number(body.seeding?.days)
      if (!(ratio >= 0 && ratio <= 10) || !(days >= 0 && days <= 365)) throw new ApiError(400, 'Share back up to 10 times what was downloaded, for up to a year.')
      share = { ratio, days }
    }
    settings.update((s) => {
      s.gameStore = { ...(s.gameStore ?? {}), enabled, seeding: share }
    })
    // Turned on: read the feeds straight away, so the store isn't empty until the next round.
    if (body.enabled === true) await store.sync()
    sendJson(res, 200, state())
  })

  // Where the games come from: feeds an administrator adds (Finesse ships none).
  router.get('/api/games/store/feeds', async ({ req, res }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, { feeds: feedList() })
  })
  router.post('/api/games/store/feeds', async ({ req, res }) => {
    await auth.requireAdmin(req)
    let cfg: FeedConfig
    try {
      cfg = cleanFeedConfig(await readJson(req), feeds().map((f) => f.id))
    } catch (e) {
      throw new ApiError(400, e instanceof Error ? e.message : 'That feed can’t be added.')
    }
    if (feeds().length >= 20) throw new ApiError(400, 'That’s the most feeds one server can have (20). Remove one first.')
    settings.update((s) => {
      s.gameStore = { ...(s.gameStore ?? {}), feeds: [...(s.gameStore?.feeds ?? []), cfg] }
    })
    await store.sync()
    sendJson(res, 201, { feeds: feedList() })
  })
  router.delete('/api/games/store/feeds/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    if (!feeds().some((f) => f.id === params.id)) throw new ApiError(404, 'That feed isn’t here any more.')
    settings.update((s) => {
      s.gameStore = { ...(s.gameStore ?? {}), feeds: (s.gameStore?.feeds ?? []).filter((f) => f.id !== params.id) }
    })
    await store.sync()
    sendJson(res, 200, { feeds: feedList() })
  })
  router.post('/api/games/store/sync', async ({ req, res }) => {
    await auth.requireAdmin(req)
    await store.sync()
    sendJson(res, 200, { feeds: feedList() })
  })

  // ---------- browsing ----------

  router.get('/api/games/store/home', async ({ req, res }) => {
    await auth.requireUser(req)
    on()
    sendJson(res, 200, home(db.games()))
  })

  router.get('/api/games/store/search', async ({ req, res, url }) => {
    await auth.requireUser(req)
    on()
    sendJson(res, 200, search(db.games(), queryFrom(url.searchParams)))
  })

  router.get('/api/games/store/facets', async ({ req, res, url }) => {
    await auth.requireUser(req)
    on()
    sendJson(res, 200, facets(db.games(), queryFrom(url.searchParams)))
  })

  router.get('/api/games/store/games/:id', async ({ req, res, params }) => {
    await auth.requireUser(req)
    on()
    const game = params.id ? db.game(params.id) : null
    if (!game) throw new ApiError(404, 'That game isn’t in the store any more.')
    const detail: StoreGameDetail = { game: publicGame(game), sources: db.sources(game.id).map(publicSource), similar: similar(db.games(), game) }
    sendJson(res, 200, detail)
  })

  // Pictures (art.ts). No sign-in: an <img> can't send one, and a picture is only served for
  // an address that's in the catalogue, by a hash nobody can turn back into that address.
  const art = deps.art ?? new ArtCache(join(settings.paths.configDir, 'gamestore-art'))
  let known: { at: number; byId: Map<string, string> } | null = null
  const pictureUrl = (id: string): string | undefined => {
    const fresh = () => {
      const byId = new Map<string, string>()
      for (const g of db.games()) for (const u of [g.cover, g.hero, ...(g.screenshots ?? [])]) if (u) byId.set(artId(u), u)
      // A request keeps its cover even after its game has left the store.
      for (const r of db.requests()) if (r.cover) byId.set(artId(r.cover), r.cover)
      return (known = { at: Date.now(), byId })
    }
    const now = known && Date.now() - known.at < 60_000 ? known : fresh()
    return now.byId.get(id) ?? (now.at < Date.now() - 2000 ? fresh().byId.get(id) : undefined)
  }
  router.get('/api/games/store/art/:id', async ({ res, params }) => {
    on()
    const url = /^[0-9a-f]{32}$/.test(params.id ?? '') ? pictureUrl(params.id!) : undefined
    const pic = url ? await art.picture(url) : null
    if (!pic) throw new ApiError(404, 'No such picture')
    res.writeHead(200, { 'Content-Type': pic.type, 'Content-Length': pic.body.length, 'Cache-Control': 'private, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff' })
    res.end(pic.body)
  })

  // ---------- requests ----------

  router.get('/api/games/store/requests', async ({ req, res }) => {
    await auth.requireUser(req)
    on()
    sendJson(res, 200, db.requests().map(publicRequest))
  })

  router.post('/api/games/store/requests', async ({ req, res }) => {
    const user = await auth.requirePerson(req)
    on()
    const body = await readJson<{ gameId?: unknown; sourceId?: unknown }>(req)
    if (typeof body.gameId !== 'string' || typeof body.sourceId !== 'string') throw new ApiError(400, 'Which game, and which download of it?')
    const game = db.game(body.gameId)
    const source = db.source(body.sourceId)
    if (!game || !source || source.gameId !== game.id) throw new ApiError(404, 'That game isn’t in the store any more.')
    // One request per game at a time: asking again shows the one already going.
    const going = db.requests().find((r) => r.gameId === game.id && r.state !== 'failed')
    if (going) return sendJson(res, 200, publicRequest(going))
    sendJson(res, 201, publicRequest(await pipeline().start(game, source, { id: user.id, name: user.Name })))
  })

  /** Whoever asked, or an administrator. */
  const mine = async (req: Parameters<Auth['requirePerson']>[0], id: string | undefined): Promise<StoredRequest> => {
    const user = await auth.requirePerson(req)
    on()
    const r = requestOr404(id)
    if (!user.admin && r.userId !== user.id) throw new ApiError(403, 'Only whoever asked for it, or an administrator, can change this request.')
    return r
  }

  router.delete('/api/games/store/requests/:id', async ({ req, res, params }) => {
    const r = await mine(req, params.id)
    await pipeline().cancel(r)
    db.removeRequest(r.id)
    // A game that only existed as that file goes with it.
    if (r.source?.local) db.removeGame(r.gameId)
    sendJson(res, 200, { ok: true })
  })

  router.post('/api/games/store/requests/:id/retry', async ({ req, res, params }) => {
    const r = await mine(req, params.id)
    if (r.state !== 'failed') throw new ApiError(409, 'That request is still going.')
    sendJson(res, 200, publicRequest(await pipeline().retry(r)))
  })

  router.post('/api/games/store/requests/:id/pause', async ({ req, res, params }) => {
    const r = await mine(req, params.id)
    sendJson(res, 200, publicRequest(await pipeline().pause(r)))
  })
  router.post('/api/games/store/requests/:id/resume', async ({ req, res, params }) => {
    const r = await mine(req, params.id)
    sendJson(res, 200, publicRequest(await pipeline().resume(r)))
  })

  // An administrator adds a game from an installer or archive they have: the file is the
  // request's body, its name and the game's title are in the address.
  router.post('/api/games/store/upload', async ({ req, res, url }) => {
    await auth.requireAdmin(req)
    const user = await auth.requirePerson(req)
    on()
    if (!store.upload) throw new ApiError(501, 'This server can’t take game files: that needs a server Finesse set up itself.')
    const title = (url.searchParams.get('title') ?? '').trim().slice(0, 200)
    const fileName = (url.searchParams.get('name') ?? '').trim()
    const sizeBytes = Number(req.headers['content-length'])
    if (!title) throw new ApiError(400, 'Give the game a name.')
    if (!fileName || !(sizeBytes > 0)) throw new ApiError(400, 'Choose the game’s installer or archive.')
    const asked = oneOf(url.searchParams.get('platform'), PLATFORMS, 'platform')
    const platform = asked ?? (/\.(sh|run|appimage|x86_64|tar(\.\w+)?|tgz)$/i.test(fileName) ? 'linux' : 'windows')
    sendJson(res, 201, publicRequest(await store.upload(req, { title, fileName, platform, sizeBytes }, { id: user.id, name: user.Name })))
  })

  router.post('/api/games/store/requests/:id/installer-done', async ({ req, res, params }) => {
    const r = await mine(req, params.id)
    if (r.state !== 'needs-you') throw new ApiError(409, 'That request isn’t waiting for you.')
    sendJson(res, 200, publicRequest(await pipeline().installerDone(r)))
  })

  // The installer's screen ("Needs you") is a websocket the sandbox runner serves (WS4); a plain
  // request to it says so instead of falling through to the app's page.
  router.get('/api/games/store/requests/:id/screen', async ({ req, params }) => {
    await mine(req, params.id)
    throw new ApiError(501, 'Finishing an installer from here isn’t available on this server yet.')
  })

  return store
}
