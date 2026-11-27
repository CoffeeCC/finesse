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
  /** How the address is read: 'feed' (the format below, the default) or 'posts'. */
  kind?: 'feed' | 'posts'
  /** How to read a 'posts' source; only what an administrator gave is stored. */
  rules?: PostRules
}

/** Reading rules for a post-list source (see the post section below). */
export interface PostRules {
  /** The list address under the site's address: `{n}` is the page size, `{p}` the page number. */
  listPath?: string
  perPage?: number
  /** How many pages one read takes at most. */
  maxPages?: number
  /** The pause between pages, in milliseconds: post APIs are read slowly on purpose. */
  delayMs?: number
  /** Which fields of a post hold what (dot-separated paths). */
  titlePath?: string
  contentPath?: string
  excerptPath?: string
  linkPath?: string
  coverPath?: string
  datePath?: string
  /** Patterns that find the game's facts in the post text, searched line by line. */
  magnetRe?: string
  sizeRe?: string
  genresRe?: string
  developerRe?: string
  yearRe?: string
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

// ---------- reading a post-list source ----------
//
// Some sources aren't feed files: they're sites that publish one post per game and answer with
// JSON at a fixed list address. Finesse knows no site by name — the administrator gives the
// address and rules say how to read it: which fields of a post hold the title and the picture,
// and which patterns find the download, its size, genres, developer and year. The defaults are
// conventions the common post-list game sites follow; every one can be changed per source.
// Nothing a pattern finds is trusted: the values go through parseFeed like any other feed, and
// pages are read one at a time with a pause between them so a source isn't hammered.

const DEFAULT_POST_RULES: Required<PostRules> = {
  listPath: 'wp-json/wp/v2/posts?per_page={n}&page={p}',
  perPage: 100,
  maxPages: 40,
  delayMs: 500,
  titlePath: 'title.rendered',
  contentPath: 'content.rendered',
  excerptPath: 'excerpt.rendered',
  linkPath: 'link',
  coverPath: 'jetpack_featured_media_url',
  datePath: 'date',
  magnetRe: 'magnet:\\?[^\\s<>"\\]]+',
  sizeRe: 'Size[^\\n]*?([\\d.]+)\\s*([KMG]?B)',
  genresRe: 'Genres[^\\n]*?:\\s*([A-Za-z][^\\n]*)',
  developerRe: 'Companies[^\\n]*?:\\s*([A-Za-z][^\\n]*)',
  yearRe: '\\b(19[5-9]\\d|20[0-2]\\d)\\b',
}

const RULE_PATH_MAX = 60
const RULE_RE_MAX = 200
const RULE_BOUNDS: Record<string, [number, number]> = { perPage: [1, 100], maxPages: [1, 60], delayMs: [0, 5000] }

/** Which parts of the rules were given, checked and trimmed. Throws words for the administrator. */
function cleanPostRules(v: unknown): PostRules | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'object' || v === null) throw new Error('The reading rules must be a set of fields.')
  const out: PostRules = {}
  for (const [k, raw] of Object.entries(v)) {
    if (raw === undefined) continue
    if (k in RULE_BOUNDS) {
      const [lo, hi] = RULE_BOUNDS[k]
      const n = Number(raw)
      if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${k} is a whole number from ${lo} to ${hi}.`)
      ;(out as Record<string, unknown>)[k] = n
    } else if (typeof raw !== 'string' || !raw.trim() || raw.length > (k.endsWith('Re') ? RULE_RE_MAX : k === 'listPath' ? 120 : RULE_PATH_MAX)) {
      throw new Error(`The rule “${k}” must be a short string (a field path, a pattern, or a list address).`)
    } else if (k.endsWith('Re')) {
      try {
        new RegExp(raw)
      } catch {
        throw new Error(`The rule “${k}” isn’t a valid pattern.`)
      }
      ;(out as Record<string, unknown>)[k] = raw.trim()
    } else {
      ;(out as Record<string, unknown>)[k] = raw.trim()
    }
  }
  return Object.keys(out).length ? out : undefined
}

interface CompiledRules {
  listPath: string
  perPage: number
  maxPages: number
  delayMs: number
  paths: Record<string, string>
  patterns: Record<string, RegExp>
}

function compileRules(rules: PostRules | undefined): CompiledRules {
  const r = { ...DEFAULT_POST_RULES, ...(rules ?? {}) }
  const patterns: Record<string, RegExp> = {}
  for (const k of ['magnetRe', 'sizeRe', 'genresRe', 'developerRe', 'yearRe'] as const) patterns[k] = new RegExp(r[k], 'i')
  const paths: Record<string, string> = {}
  for (const k of ['titlePath', 'contentPath', 'excerptPath', 'linkPath', 'coverPath', 'datePath'] as const) paths[k] = r[k]
  return { listPath: r.listPath, perPage: r.perPage, maxPages: r.maxPages, delayMs: r.delayMs, paths, patterns }
}

/** Field values can be nested: "title.rendered" asks for the post's title text. */
function pick(v: unknown, path: string): string | undefined {
  let c = v
  for (const part of path.split('.')) {
    if (c === null || typeof c !== 'object') return undefined
    c = (c as Record<string, unknown>)[part]
  }
  return typeof c === 'string' || typeof c === 'number' ? String(c) : undefined
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', lt: '<', gt: '>', nbsp: ' ', '#8217': '’', '#8216': '‘', '#8211': '–', '#039': '’', '#038': '&' }

/** Post text is HTML: block tags become lines, the rest becomes plain text, one line at a time. */
function postText(html: string): string {
  const plain = html
    .replace(/<(?:br|p|div|li|tr|h\d)[^>]*>|<\/(?:p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|quot|lt|gt|nbsp|#8217|#8216|#8211|#039|#038);/gi, (m, k: string) => ENTITIES[k.toLowerCase()] ?? m)
  return plain.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

function sizeToBytes(value: string, unit: string): number {
  const n = Number(value)
  const mult = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, B: 1 }[unit.toUpperCase().charAt(0)] ?? 1
  const bytes = Math.round(n * mult)
  return bytes > 0 && bytes <= 5 * 1024 ** 4 ? bytes : 0
}

/** One post becomes one feed-game, offered as a windows download; everything is checked by parseFeed. */
function postToGame(post: Record<string, unknown>, c: CompiledRules, skipped: string[]): Record<string, unknown> | null {
  const html = pick(post, c.paths.contentPath) ?? ''
  const title = postText(pick(post, c.paths.titlePath) ?? '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
  const key = slug(pick(post, 'slug') ?? pick(post, 'id'))
  if (!title || !key) {
    skipped.push('A post with no title.')
    return null
  }
  const excerpt = postText(pick(post, c.paths.excerptPath) ?? '')
  const lines = [postText(html), excerpt].filter(Boolean).join('\n')
  const m = magnet(c.patterns.magnetRe.exec(html)?.[0] ?? '') || magnet(c.patterns.magnetRe.exec(lines)?.[0] ?? '')
  const sm = c.patterns.sizeRe.exec(lines)
  const genreLine = c.patterns.genresRe.exec(lines)
  const devLine = c.patterns.developerRe.exec(lines)
  const yearM = c.patterns.yearRe.exec(title) ?? c.patterns.yearRe.exec(lines)
  return {
    id: key,
    title,
    summary: excerpt.split('\n')[0] ?? '',
    ...(genreLine ? { genres: genreLine[1].split(',').map((g) => g.trim()).filter(Boolean).slice(0, 8) } : {}),
    ...(devLine ? { developer: devLine[1].trim().slice(0, 120) } : {}),
    ...(yearM ? { year: Number(yearM[1]) } : {}),
    ...(httpsUrl(pick(post, c.paths.coverPath)) ? { cover: httpsUrl(pick(post, c.paths.coverPath)) } : {}),
    ...(pick(post, c.paths.datePath) ? { addedAt: pick(post, c.paths.datePath) } : {}),
    downloads: m ? [{ platform: 'windows', installer: 'unknown', sizeBytes: sm ? sizeToBytes(sm[1], sm[2]) : 0, magnet: m }] : [],
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Reads a post-list source page by page, and hands the games to parseFeed. */
export async function readPostFeed(cfg: FeedConfig, get: Fetcher = defaultFetch): Promise<ParsedFeed> {
  const c = compileRules(cfg.rules)
  const base = cfg.url.replace(/\/+$/, '')
  const host = new URL(cfg.url).host
  const games: unknown[] = []
  const skipped: string[] = []
  for (let page = 1; page <= c.maxPages && games.length < MAX_GAMES; page++) {
    if (page > 1) await sleep(c.delayMs)
    const listUrl = `${base}/${c.listPath.replace('{n}', String(c.perPage)).replace('{p}', String(page))}`
    let posts: unknown
    try {
      const r = await get(listUrl)
      if (!r.ok) throw new Error(r.status === 404 ? `There’s no post list at that address (${host} said “not found”). Check the address.` : `${host} wouldn’t give the post list (it answered ${r.status}).`)
      posts = JSON.parse(await r.text())
    } catch (e) {
      if (page === 1) {
        if (e instanceof Error && /post list|Can’t reach/.test(e.message)) throw e
        throw new Error(`Can’t reach ${host}. Check the address and that the server is online.`)
      }
      break // got this far: keep what the earlier pages gave
    }
    if (!Array.isArray(posts)) {
      if (page === 1) throw new Error(`${host} answered, but not with a list of posts. Check the address and the rules.`)
      break
    }
    if (!posts.length) break
    for (const raw of posts.slice(0, c.perPage)) {
      const g = postToGame((raw ?? {}) as Record<string, unknown>, c, skipped)
      if (g) games.push(g)
    }
    if (posts.length < c.perPage) break
  }
  const feed = parseFeed({ games }, cfg.id)
  feed.skipped.unshift(...skipped)
  return feed
}

const defaultFetch: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow', headers: { Accept: 'application/json' } })

/** Fetches and reads a feed, with errors a person can act on. */
export async function readFeed(cfg: FeedConfig, get: Fetcher = defaultFetch): Promise<ParsedFeed> {
  if (cfg.kind === 'posts') return readPostFeed(cfg, get)
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
  const out: FeedConfig = { id, name, url }
  if (o.kind !== undefined) {
    if (o.kind !== 'posts') throw new Error('A source is read as a feed document (“feed”) or as a post list (“posts”).')
    out.kind = 'posts'
    const rules = cleanPostRules(o.rules)
    if (rules) out.rules = rules
  }
  return out
}
