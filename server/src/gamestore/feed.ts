// A catalogue feed: one JSON document, at an address the server's administrator gives, that
// lists games and where each can be downloaded. Finesse ships none (docs/game-store-feed.md has
// the format). Anything can publish one: a studio's own downloads, a folder of free games, a
// script of your own. Every field is checked and trimmed on the way in; nothing in a feed is
// trusted to be the right shape, and only magnet links and https addresses are accepted.

import type { ChecksumEntry } from '../downloadCheck.ts'
import type { CatalogueGame, CatalogueSource, GameMode, GamePlatform, InstallerKind, Provider } from './types.ts'

export interface FeedConfig {
  /** Short, stable, lower-case: it prefixes the ids of this feed's games. */
  id: string
  name: string
  url: string
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

const MAX_FEED_BYTES = 32 * 1024 * 1024
const MAX_GAMES = 20_000
const KINDS: InstallerKind[] = ['inno', 'nsis', 'msi', 'archive', 'portable', 'linux', 'unknown']
const MODES: GameMode[] = ['single', 'local', 'online']
const PLATFORMS: GamePlatform[] = ['windows', 'linux']
const ALGOS = ['md5', 'sha1', 'sha256'] as const
const HEX_LENGTH: Record<string, number> = { md5: 32, sha1: 40, sha256: 64 }

const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const slug = (v: unknown): string | undefined => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) : ''
  return s || undefined
}
/** An https address (pictures, websites, downloads), or nothing. */
export function httpsUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 2000) return undefined
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : undefined
  } catch {
    return undefined
  }
}
const magnet = (v: unknown): string | undefined => (typeof v === 'string' && v.length <= 8000 && /^magnet:\?(?:.*&)?xt=urn:bt(?:ih:(?:[0-9a-f]{40}|[a-z2-7]{32})|mh:[0-9a-f]{68})(?:&|$)/i.test(v) ? v : undefined)

function checksums(v: unknown): ChecksumEntry[] {
  const out: ChecksumEntry[] = []
  for (const c of list(v).slice(0, 5000)) {
    const o = (c ?? {}) as Record<string, unknown>
    const algo = ALGOS.find((a) => a === o.algo)
    const file = text(o.file, 500)?.replace(/\\/g, '/')
    const expected = typeof o.expected === 'string' ? o.expected.toLowerCase() : ''
    if (!algo || !file || file.split('/').includes('..') || file.startsWith('/') || !new RegExp(`^[0-9a-f]{${HEX_LENGTH[algo]}}$`).test(expected)) continue
    out.push({ file, algo, expected })
  }
  return out
}

export interface ParsedFeed {
  entries: { game: CatalogueGame; sources: CatalogueSource[] }[]
  /** Games left out, and why, in words (shown to the administrator). */
  skipped: string[]
}

/** Reads a feed document. Throws only when it isn't a feed at all. */
export function parseFeed(doc: unknown, providerId: string, now = new Date().toISOString()): ParsedFeed {
  const games = (doc as { games?: unknown } | null)?.games
  if (!Array.isArray(games)) throw new Error('That address didn’t give a game feed (it needs a "games" list).')
  const entries: ParsedFeed['entries'] = []
  const skipped: string[] = []
  const seen = new Set<string>()
  for (const raw of games.slice(0, MAX_GAMES)) {
    const g = (raw ?? {}) as Record<string, unknown>
    const title = text(g.title, 200)
    const key = slug(g.id ?? g.title)
    if (!title || !key) {
      skipped.push('A game with no title.')
      continue
    }
    const id = `${providerId}-${key}`
    if (seen.has(id)) {
      skipped.push(`${title}: listed twice.`)
      continue
    }
    const sources: CatalogueSource[] = []
    for (const [i, rs] of list(g.downloads).slice(0, 20).entries()) {
      const s = (rs ?? {}) as Record<string, unknown>
      const platform = PLATFORMS.find((p) => p === s.platform)
      const m = magnet(s.magnet)
      const url = m ? undefined : httpsUrl(s.url)
      const size = Number(s.sizeBytes)
      if (!platform || (!m && !url) || !Number.isFinite(size) || size <= 0) continue
      const sums = checksums(s.checksums)
      sources.push({
        id: `${id}-${slug(s.id) ?? i + 1}`,
        gameId: id,
        platform,
        installer: KINDS.find((k) => k === s.installer) ?? 'unknown',
        sizeBytes: Math.round(size),
        ...(text(s.version, 40) ? { version: text(s.version, 40) } : {}),
        ...(m ? { magnet: m } : { url }),
        ...(sums.length ? { checksums: sums } : {}),
        ...(text(s.installerFile, 500) ? { installerHint: text(s.installerFile, 500) } : {}),
      })
    }
    if (!sources.length) {
      skipped.push(`${title}: no download Finesse can use (a magnet link or an https address, with its size and platform).`)
      continue
    }
    seen.add(id)
    const year = Number(g.year)
    const modes = MODES.filter((m) => list(g.modes).includes(m))
    const shots = list(g.screenshots).map(httpsUrl).filter((u): u is string => Boolean(u)).slice(0, 12)
    const popularity = Number(g.popularity)
    const added = typeof g.addedAt === 'string' && !Number.isNaN(Date.parse(g.addedAt)) ? new Date(g.addedAt).toISOString() : now
    entries.push({
      game: {
        id,
        title,
        summary: text(g.summary, 300) ?? '',
        ...(text(g.description, 8000) ? { description: text(g.description, 8000) } : {}),
        ...(text(g.developer, 120) ? { developer: text(g.developer, 120) } : {}),
        ...(Number.isInteger(year) && year > 1950 && year < 2200 ? { year } : {}),
        genres: [...new Set(list(g.genres).map((x) => text(x, 40)).filter((x): x is string => Boolean(x)))].slice(0, 8),
        modes: modes.length ? modes : ['single'],
        platforms: PLATFORMS.filter((p) => sources.some((s) => s.platform === p)),
        ...(text(g.license, 80) ? { license: text(g.license, 80) } : {}),
        ...(httpsUrl(g.website) ? { website: httpsUrl(g.website) } : {}),
        ...(httpsUrl(g.cover) ? { cover: httpsUrl(g.cover) } : {}),
        ...(httpsUrl(g.hero) ? { hero: httpsUrl(g.hero) } : {}),
        ...(shots.length ? { screenshots: shots } : {}),
        addedAt: added,
        popularity: Number.isFinite(popularity) ? popularity : 0,
        provider: providerId,
      },
      sources,
    })
  }
  if (games.length > MAX_GAMES) skipped.push(`Only the first ${MAX_GAMES} games were read.`)
  return { entries, skipped }
}

const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow', headers: { Accept: 'application/json' } })

/** Fetches and reads a feed, with errors a person can act on. */
export async function readFeed(cfg: FeedConfig, get: Fetcher = defaultFetch): Promise<ParsedFeed> {
  const host = new URL(cfg.url).host
  let body: string
  try {
    const r = await get(cfg.url)
    if (!r.ok) throw new Error(r.status === 404 ? `There’s no feed at that address (${host} said “not found”). Check the address.` : `${host} wouldn’t give the feed (it answered ${r.status}).`)
    body = await r.text()
  } catch (e) {
    if (e instanceof Error && /feed/.test(e.message)) throw e
    throw new Error(`Can’t reach ${host}. Check the address and that the server is online.`)
  }
  if (body.length > MAX_FEED_BYTES) throw new Error('That feed is too big to read (over 32 MB).')
  let doc: unknown
  try {
    doc = JSON.parse(body)
  } catch {
    throw new Error(`${host} answered, but not with a game feed. Check the address.`)
  }
  return parseFeed(doc, cfg.id)
}

export function feedProvider(cfg: FeedConfig, get?: Fetcher): Provider & { skipped: string[] } {
  const p = {
    id: cfg.id,
    name: cfg.name,
    skipped: [] as string[],
    async *list() {
      const feed = await readFeed(cfg, get)
      p.skipped = feed.skipped
      yield* feed.entries
    },
  }
  return p
}

/** Checks what an administrator typed for a feed. Throws words for them. */
export function cleanFeedConfig(v: unknown, taken: string[] = []): FeedConfig {
  const o = (v ?? {}) as Record<string, unknown>
  const name = text(o.name, 60)
  if (!name) throw new Error('Give the feed a name.')
  const url = httpsUrl(o.url) ?? (typeof o.url === 'string' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(o.url) ? o.url : undefined)
  if (!url) throw new Error('The feed’s address must start with https:// (http:// is fine for one on your own network).')
  let id = slug(o.id) ?? slug(name) ?? 'feed'
  id = id.slice(0, 24).replace(/-$/, '')
  if (taken.includes(id)) throw new Error(`There’s already a feed called “${id}”.`)
  return { id, name, url }
}
