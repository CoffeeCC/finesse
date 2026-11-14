// The game store's API, /api/games/store/* (the calls src/api/gameStore.ts makes). Browsing is
// answered from the catalogue in sqlite. Requests are handed to the pipeline (downloading,
// checking, installing: WS2–WS5 of docs/agents/game-store-plan.md); until one is plugged in they
// answer 501 in plain words. Nothing here ever sends where a download comes from.

import { join } from 'node:path'
import type { Auth } from '../auth.ts'
import type { SettingsStore } from '../config.ts'
import { ApiError, readJson, sendJson, type Router } from '../http/core.ts'
import { facets, home, publicGame, search, similar } from './catalogue.ts'
import { GameStoreDb, publicRequest, publicSource, type StoredRequest } from './db.ts'
import type { CatalogueGame, CatalogueSource, GameMode, GamePlatform, StoreGameDetail, StoreQuery, StoreSort } from './types.ts'

/** What turns a request into an installed game. WS2 onwards provide it. */
export interface RequestPipeline {
  /** Start (or carry on) a new request. Throws an ApiError when it can't be taken, saying why. */
  start(game: CatalogueGame, source: CatalogueSource, user: { id: string; name: string }): Promise<StoredRequest>
  cancel(r: StoredRequest): Promise<void>
  retry(r: StoredRequest): Promise<StoredRequest>
  /** The person finished the installer by hand ("Needs you"). */
  installerDone(r: StoredRequest): Promise<StoredRequest>
}

export interface GameStore {
  db: GameStoreDb
  /** Plugged in by the pipeline when the server can download and install. */
  pipeline?: RequestPipeline
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

export function registerGameStore(router: Router, deps: { settings: SettingsStore; auth: Auth; db?: GameStoreDb }): GameStore {
  const { settings, auth } = deps
  const store: GameStore = { db: deps.db ?? new GameStoreDb(join(settings.paths.configDir, 'gamestore.db')) }
  const db = store.db

  const on = () => {
    if (!gameStoreEnabled(settings)) throw new ApiError(404, 'The game store isn’t turned on on this server. An administrator can turn it on in Settings.')
  }
  const pipeline = (): RequestPipeline => {
    if (!store.pipeline) throw new ApiError(501, 'This server can’t download and install games yet. Browsing works; requests come with a later update.')
    return store.pipeline
  }
  const requestOr404 = (id: string | undefined): StoredRequest => {
    const r = id ? db.request(id) : null
    if (!r) throw new ApiError(404, 'That request isn’t here any more.')
    return r
  }

  // On or off (administrators). Off is the default: Finesse ships no game sources.
  router.get('/api/games/store/settings', async ({ req, res }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, { enabled: gameStoreEnabled(settings), canInstall: Boolean(store.pipeline), games: db.games().length })
  })
  router.put('/api/games/store/settings', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ enabled?: unknown }>(req)
    if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'enabled is true or false')
    const enabled = body.enabled
    settings.update((s) => {
      s.gameStore = { ...(s.gameStore ?? {}), enabled }
    })
    sendJson(res, 200, { enabled, canInstall: Boolean(store.pipeline), games: db.games().length })
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
    sendJson(res, 200, { ok: true })
  })

  router.post('/api/games/store/requests/:id/retry', async ({ req, res, params }) => {
    const r = await mine(req, params.id)
    if (r.state !== 'failed') throw new ApiError(409, 'That request is still going.')
    sendJson(res, 200, publicRequest(await pipeline().retry(r)))
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
