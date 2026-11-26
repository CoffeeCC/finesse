// Live PC-game search via Prowlarr (categories 4050 PC/Games + 4000 PC) with optional
// best-effort Steam Store metadata enrichment. Never leaks Prowlarr API keys or internal URLs,
// and degrades gracefully to { available: false, items: [] } when Prowlarr isn't configured or
// unreachable.

import { createHash } from 'node:crypto'
import type { Endpoint } from '../config.ts'
import { httpsUrl } from './feed.ts'
import type { GamePlatform, InstallerKind } from './types.ts'

const PROXY_PREFIX = 'prowlarr://'
const PROXY_TTL_MS = 30 * 60_000
const PROXY_MAX = 500

interface ProxyEntry {
  url: string
  title: string
  expiresAt: number
}

const proxyStore = new Map<string, ProxyEntry>()

function rememberProxyDownload(id: string, url: string, title: string): string {
  const now = Date.now()
  for (const [k, v] of proxyStore) if (v.expiresAt <= now) proxyStore.delete(k)
  if (proxyStore.size >= PROXY_MAX) {
    const oldest = proxyStore.keys().next().value
    if (oldest) proxyStore.delete(oldest)
  }
  proxyStore.set(id, { url, title, expiresAt: now + PROXY_TTL_MS })
  return `${PROXY_PREFIX}${id}`
}

/** Build a valid magnet URI from a Prowlarr infoHash (40-char hex or 32-char base32). */
export function magnetFromInfoHash(infoHash: unknown, title?: string): string | undefined {
  if (typeof infoHash !== 'string') return undefined
  const clean = infoHash.trim()
  if (!/^(?:[0-9a-f]{40}|[a-z2-7]{32})$/i.test(clean)) return undefined
  const dn = title?.trim() ? `&dn=${encodeURIComponent(title.trim().slice(0, 200))}` : ''
  return `magnet:?xt=urn:btih:${clean.toLowerCase()}${dn}`
}

/** Extract the SHA-1 infoHash from a raw bencoded .torrent buffer (zero dependencies). */
export function torrentInfoHash(buf: Uint8Array): string | null {
  const len = buf.length
  if (len < 12 || buf[0] !== 0x64) return null // must start with 'd'
  const skip = (pos: number): number => {
    if (pos >= len) return -1
    const c = buf[pos]!
    if (c === 0x69) {
      // i<int>e
      const end = buf.indexOf(0x65, pos + 1)
      return end === -1 ? -1 : end + 1
    }
    if (c === 0x6c) {
      // l...e
      let p = pos + 1
      while (p < len && buf[p] !== 0x65) {
        p = skip(p)
        if (p < 0) return -1
      }
      return p < len ? p + 1 : -1
    }
    if (c === 0x64) {
      // d...e
      let p = pos + 1
      while (p < len && buf[p] !== 0x65) {
        p = skip(p)
        if (p < 0) return -1
        p = skip(p)
        if (p < 0) return -1
      }
      return p < len ? p + 1 : -1
    }
    if (c >= 0x30 && c <= 0x39) {
      // <len>:<bytes>
      const colon = buf.indexOf(0x3a, pos)
      if (colon === -1) return -1
      const n = Number(Buffer.from(buf.subarray(pos, colon)).toString('ascii'))
      if (!Number.isInteger(n) || n < 0 || colon + 1 + n > len) return -1
      return colon + 1 + n
    }
    return -1
  }

  let p = 1
  while (p < len && buf[p] !== 0x65) {
    const keyStart = p
    const colon = buf.indexOf(0x3a, keyStart)
    if (colon === -1) return null
    const klen = Number(Buffer.from(buf.subarray(keyStart, colon)).toString('ascii'))
    if (!Number.isInteger(klen) || klen < 0 || colon + 1 + klen > len) return null
    const key = Buffer.from(buf.subarray(colon + 1, colon + 1 + klen)).toString('utf8')
    const valStart = colon + 1 + klen
    const valEnd = skip(valStart)
    if (valEnd < 0) return null
    if (key === 'info') {
      return createHash('sha1').update(buf.subarray(valStart, valEnd)).digest('hex')
    }
    p = valEnd
  }
  return null
}

/** Resolve either a direct magnet/https URL or an opaque prowlarr://<id> token server-side. */
export async function resolveLiveDownload(
  rawUrl: unknown,
  opts: { prowlarr?: Endpoint; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ magnet?: string; url?: string } | null> {
  const direct = validLiveDownloadUrl(rawUrl)
  if (direct) return direct
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith(PROXY_PREFIX)) return null

  const id = rawUrl.slice(PROXY_PREFIX.length)
  const entry = proxyStore.get(id)
  if (!entry || entry.expiresAt <= Date.now()) {
    proxyStore.delete(id)
    return null
  }
  const get = opts.fetch ?? fetch
  const headers: Record<string, string> = {}
  if (opts.prowlarr?.apiKey) headers['X-Api-Key'] = opts.prowlarr.apiKey

  try {
    const res = await get(entry.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
      headers,
    })
    const loc = res.headers.get('location')
    if (loc) {
      const m = magnetUrl(loc)
      if (m) return { magnet: m }
      const u = httpsUrl(loc)
      if (u && !/[?&]api_?key=/i.test(u)) return { url: u }
    }
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    const hash = torrentInfoHash(bytes)
    if (hash) {
      const m = magnetFromInfoHash(hash, entry.title)
      if (m) return { magnet: m }
    }
  } catch {
    return null
  }
  return null
}

export interface LiveGameResult {
  id: string
  /** Cleaned human-readable game title (e.g. "Elden Ring"). */
  title: string
  /** Original release name from the indexer. */
  releaseTitle: string
  /** Recognized repack or release group (e.g. "FitGirl", "DODI", "GOG", "Portable"). */
  group?: string
  platform: GamePlatform
  installer: InstallerKind
  sizeBytes: number
  seeders: number
  indexer: string
  /** Validated magnet:? or https:// download URL (never a Prowlarr API URL). */
  downloadUrl: string
  /** Best-effort Steam Store enrichment. */
  cover?: string
  summary?: string
  year?: number
  genres?: string[]
  steamAppId?: number
}

export interface LiveSearchResponse {
  available: boolean
  items: LiveGameResult[]
}

export interface LiveSearchOptions {
  prowlarr?: Endpoint
  fetch?: typeof fetch
  timeoutMs?: number
  /** Best-effort Steam Store cover/metadata lookup (default true). */
  enrich?: boolean
  limit?: number
}

/** Same magnet rule as feed.ts: infohash v1 (40 hex or 32 base32) or v2 (68 hex). */
export function magnetUrl(v: unknown): string | undefined {
  return typeof v === 'string' && v.length <= 8000 && /^magnet:\?(?:.*&)?xt=urn:bt(?:ih:(?:[0-9a-f]{40}|[a-z2-7]{32})|mh:[0-9a-f]{68})(?:&|$)/i.test(v)
    ? v
    : undefined
}

/** Accepts either a valid magnet link or an https:// URL (without embedded credentials), matching feed.ts rules. */
export function validLiveDownloadUrl(v: unknown): { magnet?: string; url?: string } | null {
  const m = magnetUrl(v)
  if (m) return { magnet: m }
  const u = httpsUrl(v)
  if (u) return { url: u }
  return null
}

const KNOWN_GROUPS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bfitgirl\b/i, label: 'FitGirl' },
  { pattern: /\bdodi\b/i, label: 'DODI' },
  { pattern: /\belamigos\b/i, label: 'ElAmigos' },
  { pattern: /\bgog(?:[-.\s]?games)?\b/i, label: 'GOG' },
  { pattern: /\blinuxrulez!?/i, label: 'LinuxRuleZ' },
  { pattern: /\bportable\b/i, label: 'Portable' },
  { pattern: /\binsaneramzes\b/i, label: 'InsaneRamZes' },
  { pattern: /\bkaos\b/i, label: 'KaOs' },
  { pattern: /\brune\b/i, label: 'RUNE' },
  { pattern: /\btenoke\b/i, label: 'TENOKE' },
  { pattern: /\bcodex\b/i, label: 'CODEX' },
  { pattern: /\bempress\b/i, label: 'EMPRESS' },
  { pattern: /\bskidrow\b/i, label: 'SKIDROW' },
  { pattern: /\bflt\b/i, label: 'FLT' },
  { pattern: /\brazor1911\b/i, label: 'Razor1911' },
  { pattern: /\bplaza\b/i, label: 'PLAZA' },
  { pattern: /\bhoodlum\b/i, label: 'HOODLUM' },
  { pattern: /\bi_know\b/i, label: 'I_KnoW' },
  { pattern: /\bgoldberg\b/i, label: 'Goldberg' },
  { pattern: /\bp2p\b/i, label: 'P2P' },
]

export interface ParsedRelease {
  title: string
  group?: string
  platform: GamePlatform
  installer: InstallerKind
  year?: number
}

/** Extract clean game title, group/tag, platform, and installer guess from a raw indexer release title. */
export function parseReleaseInfo(rawTitle: string): ParsedRelease {
  const raw = rawTitle.trim()

  // Group / tag detection
  let group: string | undefined
  for (const g of KNOWN_GROUPS) {
    if (g.pattern.test(raw)) {
      group = g.label
      break
    }
  }

  // Platform detection
  const isLinux = /\b(linux|linuxrulez|steamos|appimage|ubuntu|debian|\.tar\.(?:gz|xz|zst))\b/i.test(raw)
  const platform: GamePlatform = isLinux ? 'linux' : 'windows'

  // Installer guess
  let installer: InstallerKind = 'unknown'
  if (platform === 'linux') {
    installer = 'linux'
  } else if (/\b(portable|insaneramzes|pre[-.\s]?installed|no[-.\s]?install|steam[-.\s]?rip)\b/i.test(raw)) {
    installer = 'portable'
  } else if (/\b(fitgirl|dodi|elamigos|gog|kaos|repack)\b/i.test(raw)) {
    installer = 'inno'
  } else if (/\b(zip|rar|7z|archive)\b/i.test(raw)) {
    installer = 'archive'
  }

  // Extract a plausible release year if explicitly bracketed like (2022) or [2024]
  let year: number | undefined
  const yearMatch = /[([]((?:19[89]\d)|(?:20[0-3]\d))[)\]]/.exec(raw)
  if (yearMatch) {
    const y = Number(yearMatch[1])
    if (y >= 1980 && y <= 2035) year = y
  }

  const title = cleanReleaseTitle(raw)
  return { title, ...(group ? { group } : {}), platform, installer, ...(year ? { year } : {}) }
}

/** Turn "Elden.Ring.Shadow.of.the.Erdtree.v1.12.MULTi14-FitGirl [Repack]" into "Elden Ring Shadow of the Erdtree". */
export function cleanReleaseTitle(raw: string): string {
  let s = raw.trim()
  // Remove bracketed/parenthesized release metadata like [FitGirl Repack], (GOG), (v1.2), [MULTi12]
  s = s.replace(/\s*\[[^\]]*\]\s*/g, ' ')
  s = s.replace(/\s*\((?:[^)]*(?:repack|fitgirl|dodi|gog|elamigos|portable|multi\d*|dlc|build|v?\d+\.\d+|x64|x86|win\d*|linux|pc|iso|crack|update|steam|epic|19[89]\d|20[0-3]\d)[^)]*)\)\s*/gi, ' ')

  // Strip trailing "-GROUP" scene tags (e.g. "-RUNE", "-CODEX", "-FitGirl", "-TENOKE")
  s = s.replace(/[-–—]\s*(?:fitgirl|dodi|elamigos|gog(?:-games)?|linuxrulez!?|portable|insaneramzes|kaos|rune|tenoke|codex|empress|skidrow|flt|razor1911|plaza|hoodlum|i_know|goldberg|p2p|dinu|chronos|darksiders|anadius|tinyiso|cpy|steampunk|reloaded|proper|repack)\s*$/i, '')

  // Convert dot/underscore-separated scene names to spaces when dots/underscores dominate
  const dots = (s.match(/\./g) ?? []).length
  const spaces = (s.match(/\s/g) ?? []).length
  if (dots >= 2 && dots >= spaces) {
    s = s.replace(/\./g, ' ')
  }
  s = s.replace(/_/g, ' ')

  // Cut off everything from common release metadata markers onward
  s = s.replace(/\s+(?:v\d+(?:\.\d+)*|build\s+\d+|update\s+[\d.]+|incl(?:uding)?\.?\s+(?:all\s+)?dlcs?|\+\s*(?:all\s+)?\d*\s*dlcs?|multi\d+|repack|fitgirl|dodi|elamigos|gog|portable|linuxrulez!?|steam[- ]?rip|pre[- ]?installed|pc[- ]?game|x64|x86|win64|win32|iso|crackfix|full[- ]?unlocked)\b.*$/i, '')

  // Strip stray trailing separators and collapse whitespace
  s = s.replace(/\s*[-–—:|+/]+\s*$/, '').replace(/\s{2,}/g, ' ').trim()
  return (s || raw.trim()).slice(0, 160)
}

interface ProwlarrItem {
  title?: unknown
  size?: unknown
  seeders?: unknown
  indexer?: unknown
  protocol?: unknown
  infoHash?: unknown
  magnetUrl?: unknown
  downloadUrl?: unknown
  guid?: unknown
  publishDate?: unknown
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function relevanceScore(item: LiveGameResult, query: string): number {
  const q = normalizeForMatch(query)
  const t = normalizeForMatch(item.title)
  let score = 0
  if (t === q) score += 1000
  else if (t.startsWith(q)) score += 600
  else if (t.includes(q)) score += 300
  else {
    const words = q.split(' ').filter(Boolean)
    const matched = words.filter((w) => t.includes(w)).length
    score += words.length ? Math.round((matched / words.length) * 200) : 0
  }
  // Prefer reputable repacks & GOG/Portable releases slightly when seeders are similar
  if (item.group && ['FitGirl', 'DODI', 'GOG', 'ElAmigos', 'Portable', 'LinuxRuleZ'].includes(item.group)) {
    score += 40
  }
  // Seeders contribute smoothly (capped so a dead exact match doesn't always beat a well-seeded match, and huge seeder counts still win)
  score += Math.min(500, Math.round(Math.log10(item.seeders + 1) * 180))
  if (item.seeders === 0) score -= 120
  return score
}

interface SteamMeta {
  steamAppId: number
  cover?: string
  name: string
}

async function lookupSteamMeta(term: string, get: typeof fetch): Promise<SteamMeta | null> {
  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`
    const res = await get(url, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { items?: { id?: unknown; name?: unknown; tiny_image?: unknown }[] }
    if (!Array.isArray(data?.items) || data.items.length === 0) return null

    const want = normalizeForMatch(term)
    const best =
      data.items.find((x) => typeof x.name === 'string' && normalizeForMatch(x.name) === want) ??
      data.items.find((x) => typeof x.name === 'string' && (normalizeForMatch(x.name).includes(want) || want.includes(normalizeForMatch(x.name)))) ??
      data.items[0]
    if (!best || typeof best.id !== 'number' || typeof best.name !== 'string') return null

    // Prefer Steam's crisp header art when tiny_image is present, falling back to tiny_image.
    let cover: string | undefined
    if (typeof best.tiny_image === 'string') {
      const upgraded = best.tiny_image.replace(/capsule_231x87/i, 'header')
      cover = httpsUrl(upgraded) ?? httpsUrl(best.tiny_image)
    }
    if (!cover) {
      cover = httpsUrl(`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${best.id}/header.jpg`)
    }
    return { steamAppId: best.id, cover, name: best.name }
  } catch {
    return null
  }
}

export function prowlarrConfigured(ep: Endpoint | undefined): ep is Required<Pick<Endpoint, 'url' | 'apiKey'>> & Endpoint {
  if (!ep?.url || !ep.apiKey) return false
  try {
    const u = new URL(ep.url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Query Prowlarr for PC games (categories 4050 + 4000) and optionally enrich top titles with Steam art. */
export async function liveSearchGames(query: string, opts: LiveSearchOptions = {}): Promise<LiveSearchResponse> {
  const q = query.trim().slice(0, 200)
  const ep = opts.prowlarr
  if (!prowlarrConfigured(ep)) return { available: false, items: [] }
  if (q.length < 2) return { available: true, items: [] }

  const get = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 10_000
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20))

  const base = ep.url.replace(/\/+$/, '')
  const searchUrl = `${base}/api/v1/search?query=${encodeURIComponent(q)}&categories=4050&categories=4000&type=search`

  let rawItems: ProwlarrItem[]
  try {
    const res = await get(searchUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'X-Api-Key': ep.apiKey,
        Accept: 'application/json',
      },
    })
    if (!res.ok) return { available: false, items: [] }
    const json = (await res.json()) as unknown
    if (!Array.isArray(json)) return { available: false, items: [] }
    rawItems = json as ProwlarrItem[]
  } catch {
    return { available: false, items: [] }
  }

  const seenUrls = new Set<string>()
  const results: LiveGameResult[] = []

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const releaseTitle = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (!releaseTitle) continue

    const sizeBytes = Number(raw.size)
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) continue

    // Skip Usenet (.nzb) results for now since the Game Store pipeline downloads torrents/HTTPS.
    if (typeof raw.protocol === 'string' && raw.protocol.toLowerCase() === 'usenet') continue

    // 1) Prefer direct magnet:? links or synthesized magnet from Prowlarr's infoHash
    // 2) Accept direct https:// URLs without embedded API keys
    // 3) Fall back to an opaque prowlarr://<id> token resolved server-side on request (never leaking API keys)
    const rawDl = typeof raw.downloadUrl === 'string' ? raw.downloadUrl.trim() : ''
    let pickedUrl =
      magnetUrl(raw.magnetUrl) ??
      magnetUrl(raw.downloadUrl) ??
      magnetUrl(raw.guid) ??
      magnetFromInfoHash(raw.infoHash, releaseTitle)

    if (!pickedUrl && rawDl) {
      const cleanHttps = httpsUrl(rawDl)
      let sameProwlarrOrigin = false
      try {
        sameProwlarrOrigin = new URL(rawDl).origin === new URL(base).origin
      } catch {
        sameProwlarrOrigin = false
      }
      if (cleanHttps && !/[?&]api_?key=/i.test(cleanHttps) && !sameProwlarrOrigin) {
        pickedUrl = cleanHttps
      } else if (sameProwlarrOrigin) {
        const proxyId = createHash('sha256').update(rawDl).digest('hex').slice(0, 16)
        pickedUrl = rememberProxyDownload(proxyId, rawDl, releaseTitle)
      }
    }
    if (!pickedUrl) continue
    if (seenUrls.has(pickedUrl)) continue
    seenUrls.add(pickedUrl)

    const parsed = parseReleaseInfo(releaseTitle)
    const seeders = typeof raw.seeders === 'number' && Number.isFinite(raw.seeders) ? Math.max(0, Math.round(raw.seeders)) : 0
    const indexer = typeof raw.indexer === 'string' && raw.indexer.trim() ? raw.indexer.trim().slice(0, 60) : 'Indexer'
    const id = createHash('sha256').update(pickedUrl).digest('hex').slice(0, 16)

    results.push({
      id,
      title: parsed.title,
      releaseTitle: releaseTitle.slice(0, 260),
      ...(parsed.group ? { group: parsed.group } : {}),
      platform: parsed.platform,
      installer: parsed.installer,
      sizeBytes: Math.round(sizeBytes),
      seeders,
      indexer,
      downloadUrl: pickedUrl,
      ...(parsed.year ? { year: parsed.year } : {}),
    })
  }

  results.sort((a, b) => relevanceScore(b, q) - relevanceScore(a, q) || b.seeders - a.seeders || b.sizeBytes - a.sizeBytes)
  const top = results.slice(0, limit)

  // Best-effort Steam Store enrichment for up to 5 unique game titles
  if (opts.enrich !== false && top.length > 0) {
    const uniqueTitles: string[] = []
    const seenTitleKeys = new Set<string>()
    for (const item of top) {
      const k = normalizeForMatch(item.title)
      if (!k || seenTitleKeys.has(k)) continue
      seenTitleKeys.add(k)
      uniqueTitles.push(item.title)
      if (uniqueTitles.length >= 5) break
    }
    const enriched = new Map<string, SteamMeta>()
    const settled = await Promise.allSettled(
      uniqueTitles.map(async (t) => {
        const meta = await lookupSteamMeta(t, get)
        if (meta) enriched.set(normalizeForMatch(t), meta)
      }),
    )
    void settled
    for (const item of top) {
      const meta = enriched.get(normalizeForMatch(item.title))
      if (meta) {
        if (meta.cover) item.cover = meta.cover
        item.steamAppId = meta.steamAppId
      }
    }
  }

  return { available: true, items: top }
}
