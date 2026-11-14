// The game store: games the server doesn't have yet, and requests for them. A request downloads
// the game with the bundled qBittorrent (behind the VPN), installs it in a sandbox, and adds it
// to game streaming. Pages only use the hooks in gameStoreQueries.ts, which call one
// GameStoreApi: the Finesse server's (below) or the demo one (gameStore.demo.ts), so the
// server side can land later without touching a page.

import { mediaBrowserAuthHeader } from './client'
import { finesseApi, type FinesseInfo } from '../lib/finesseServer'

// ---------- what the store shows ----------

/** Which ways to play it there are. */
export type GameMode = 'single' | 'local' | 'online'
export type GamePlatform = 'windows' | 'linux'

export interface StoreGame {
  /** Stable, URL-safe: the provider's own id (e.g. "supertuxkart"). */
  id: string
  title: string
  /** One or two sentences, for cards and the hero. */
  summary: string
  /** The long description, paragraphs split by blank lines. */
  description?: string
  developer?: string
  year?: number
  /** Display names ("Real-time strategy"); filter by genreSlug(name). */
  genres: string[]
  modes: GameMode[]
  platforms: GamePlatform[]
  license?: string
  website?: string
  /** Box art (portrait), a wide banner, and screenshots: absolute URLs or Finesse paths. */
  cover?: string
  hero?: string
  screenshots?: string[]
  /** ISO date it arrived in the store, for "New". */
  addedAt: string
}

/** What Finesse can tell about an installer before running anything (see the plan's tiers). */
export type InstallerKind = 'inno' | 'nsis' | 'msi' | 'archive' | 'portable' | 'linux' | 'unknown'

/** One download of a game: a game can have a Windows installer and a Linux build. The magnet
 *  itself never reaches the browser: a request names the source by id. */
export interface StoreSource {
  id: string
  platform: GamePlatform
  installer: InstallerKind
  sizeBytes: number
  /** "1.4.2", when the provider says. */
  version?: string
  /** The provider has a checksum to compare the download against. */
  verified?: boolean
}

export interface StoreGameDetail {
  game: StoreGame
  sources: StoreSource[]
  /** Same genre, for "More like this". */
  similar: StoreGame[]
}

// ---------- browsing ----------

export type StoreSort = 'popular' | 'new' | 'name' | 'year'

export interface StoreQuery {
  q?: string
  /** genreSlug values; a game matches if it has any of them. */
  genres?: string[]
  platform?: GamePlatform
  mode?: GameMode
  sort?: StoreSort
  offset?: number
  limit?: number
}

export interface StorePage {
  items: StoreGame[]
  total: number
  /** Where the next page starts; absent on the last page. */
  nextOffset?: number
}

export interface Facet {
  /** What the filter takes (a genre slug, "windows", "online"). */
  value: string
  label: string
  /** Games that match with this picked and every other filter as it is. */
  count: number
}

export interface StoreFacets {
  genres: Facet[]
  platforms: Facet[]
  modes: Facet[]
}

export interface StoreShelf {
  id: string
  title: string
  /** The search behind the shelf, so "See all" opens Browse with it. */
  query: StoreQuery
  items: StoreGame[]
}

export interface StoreHome {
  featured: StoreGame[]
  shelves: StoreShelf[]
}

// ---------- requests ----------

export type GameRequestState =
  | 'queued' // waiting for a download slot or for peers
  | 'downloading'
  | 'paused'
  | 'checking' // comparing against the provider's checksum
  | 'installing'
  | 'needs-you' // the installer wants clicks: open its screen
  | 'finishing' // finding the game's program, adding it to streaming
  | 'ready'
  | 'failed'

export interface GameRequest {
  id: string
  gameId: string
  title: string
  cover?: string
  sourceId: string
  platform: GamePlatform
  installer: InstallerKind
  state: GameRequestState
  /** 0–100 while downloading or paused (and installing, when the installer reports it). */
  progress?: number
  bytesPerSecond?: number
  etaSeconds?: number
  sizeBytes?: number
  /** Plain words on what's happening, or why it failed and what to do. */
  detail?: string
  requestedBy?: string
  createdAt: string
  updatedAt: string
}

// ---------- the one interface ----------

export interface GameStoreApi {
  home(): Promise<StoreHome>
  search(q: StoreQuery): Promise<StorePage>
  facets(q: StoreQuery): Promise<StoreFacets>
  game(id: string): Promise<StoreGameDetail>
  requests(): Promise<GameRequest[]>
  request(gameId: string, sourceId: string): Promise<GameRequest>
  /** Stop it and remove what was downloaded. */
  cancel(requestId: string): Promise<void>
  retry(requestId: string): Promise<GameRequest>
  /** The person finished the installer on its screen ("needs-you" → carry on). */
  installerDone(requestId: string): Promise<GameRequest>
  /** The installer's screen (a noVNC websocket), or null where there isn't one (the demo). */
  installerScreenUrl(requestId: string): string | null
}

/** "server" when the Finesse server has the store; "demo" for building the UI (dev server, or a
 *  build with VITE_GAME_STORE=demo); null hides the store. */
export type StoreMode = 'server' | 'demo'

export function gameStoreMode(info: FinesseInfo | null | undefined): StoreMode | null {
  if (info?.features.gameStore) return 'server'
  if (import.meta.env.DEV || import.meta.env.VITE_GAME_STORE === 'demo') return 'demo'
  return null
}

let demo: Promise<GameStoreApi> | null = null

export function gameStoreApi(mode: StoreMode): Promise<GameStoreApi> {
  if (mode === 'server') return Promise.resolve(serverStore)
  demo ??= import('./gameStore.demo').then((m) => m.demoStore)
  return demo
}

/** The installer screen's websocket for a "needs-you" request (server only; the demo draws its own). */
export function installerScreenUrl(mode: StoreMode, requestId: string): string | null {
  return mode === 'server' ? serverStore.installerScreenUrl(requestId) : null
}

// ---------- helpers shared by pages, the demo and the server ----------

export function genreSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export const PLATFORM_LABEL: Record<GamePlatform, string> = { windows: 'Windows', linux: 'Linux' }
export const MODE_LABEL: Record<GameMode, string> = { single: 'Single-player', local: 'Local multiplayer', online: 'Online' }
export const SORT_LABEL: Record<StoreSort, string> = { popular: 'Popular', new: 'Newest', name: 'Name', year: 'Release year' }

/** What happens to this download, in plain words (shown before requesting). */
export const INSTALLER_NOTE: Record<InstallerKind, string> = {
  inno: 'Windows installer. Finesse installs it for you.',
  nsis: 'Windows installer. Finesse installs it for you.',
  msi: 'Windows installer. Finesse installs it for you.',
  archive: 'A zip of the game. Finesse unpacks it.',
  portable: 'Ready to run. Nothing to install.',
  linux: 'Linux build. Runs as it is, no Windows layer.',
  unknown: 'An installer Finesse doesn’t know. You may need to click through it once.',
}

export function formatSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** A StoreQuery as URL params (Browse's address, and the server's query string). */
export function queryToParams(q: StoreQuery): URLSearchParams {
  const p = new URLSearchParams()
  if (q.q?.trim()) p.set('q', q.q.trim())
  if (q.genres?.length) p.set('genres', q.genres.join(','))
  if (q.platform) p.set('platform', q.platform)
  if (q.mode) p.set('mode', q.mode)
  if (q.sort && q.sort !== 'popular') p.set('sort', q.sort)
  if (q.offset) p.set('offset', String(q.offset))
  if (q.limit) p.set('limit', String(q.limit))
  return p
}

const SORTS = new Set<StoreSort>(['popular', 'new', 'name', 'year'])

export function paramsToQuery(p: URLSearchParams): StoreQuery {
  const platform = p.get('platform')
  const mode = p.get('mode')
  const sort = p.get('sort') as StoreSort | null
  return {
    q: p.get('q') ?? undefined,
    genres: p.get('genres')?.split(',').filter(Boolean),
    platform: platform === 'windows' || platform === 'linux' ? platform : undefined,
    mode: mode === 'single' || mode === 'local' || mode === 'online' ? mode : undefined,
    sort: sort && SORTS.has(sort) ? sort : 'popular',
  }
}

export function browseHref(q: StoreQuery): string {
  const s = queryToParams({ ...q, offset: undefined, limit: undefined }).toString()
  return `/games/store/browse${s ? `?${s}` : ''}`
}

/** A request that's still moving (worth polling). */
export function isActive(r: GameRequest): boolean {
  return r.state !== 'ready' && r.state !== 'failed' && r.state !== 'needs-you'
}

// ---------- the Finesse server ----------

export class StoreError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', Authorization: mediaBrowserAuthHeader() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(finesseApi(`/api/games/store${path}`), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new StoreError(0, 'Can’t reach Finesse')
  }
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) throw new StoreError(res.status, (data as { error?: string } | null)?.error || 'The store didn’t answer')
  return data as T
}

const qs = (q: StoreQuery) => {
  const s = queryToParams(q).toString()
  return s ? `?${s}` : ''
}

const serverStore: GameStoreApi = {
  home: () => call('GET', '/home'),
  search: (q) => call('GET', `/search${qs(q)}`),
  facets: (q) => call('GET', `/facets${qs({ ...q, offset: undefined, limit: undefined })}`),
  game: (id) => call('GET', `/games/${encodeURIComponent(id)}`),
  requests: () => call('GET', '/requests'),
  request: (gameId, sourceId) => call('POST', '/requests', { gameId, sourceId }),
  cancel: (id) => call('DELETE', `/requests/${encodeURIComponent(id)}`),
  retry: (id) => call('POST', `/requests/${encodeURIComponent(id)}/retry`),
  installerDone: (id) => call('POST', `/requests/${encodeURIComponent(id)}/installer-done`),
  installerScreenUrl: (id) => {
    const u = new URL(finesseApi(`/api/games/store/requests/${encodeURIComponent(id)}/screen`), window.location.href)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return u.toString()
  },
}

// ---------- Settings → Server → Game store (administrators) ----------

/** How a source's last read went. */
export interface FeedStatus {
  at: string
  ok: boolean
  games: number
  /** Why it failed, or which games were left out, in words. */
  notes: string[]
}

/** A source of games: a feed at an address, or a feed file in the server's config folder. */
export interface StoreFeed {
  id: string
  name: string
  url?: string
  /** A file in the config folder's game-feeds folder (removed by deleting the file). */
  file?: string
  status: FeedStatus | null
}

export interface StoreSettings {
  enabled: boolean
  /** This server can download games (browsing works without). */
  canDownload: boolean
  /** It can install them too; without that a request stops once its download is checked. */
  canInstall: boolean
  games: number
}

export const gameStoreAdmin = {
  settings: () => call<StoreSettings>('GET', '/settings'),
  setEnabled: (enabled: boolean) => call<StoreSettings>('PUT', '/settings', { enabled }),
  feeds: () => call<{ feeds: StoreFeed[] }>('GET', '/feeds').then((r) => r.feeds),
  addFeed: (name: string, url: string) => call<{ feeds: StoreFeed[] }>('POST', '/feeds', { name, url }).then((r) => r.feeds),
  removeFeed: (id: string) => call<{ feeds: StoreFeed[] }>('DELETE', `/feeds/${encodeURIComponent(id)}`).then((r) => r.feeds),
  sync: () => call<{ feeds: StoreFeed[] }>('POST', '/sync').then((r) => r.feeds),
}
