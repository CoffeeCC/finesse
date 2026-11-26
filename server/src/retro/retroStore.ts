// Retro Games Engine: console alias normalization, HTML autoindex / Internet Archive /
// JSON feed parsing, smart region grouping & deduping, curated open-source showcase &
// opt-in homebrew shelf, Prowlarr console (category 1000) live search, direct HTTPS/LAN
// ROM downloads into RomM's library, NAS folder preview/import, and RomM auto-scan.

import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { accessSync, chownSync, constants, copyFileSync, createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import type { Endpoint, Settings } from '../config.ts'
import { httpsUrl } from '../gamestore/feed.ts'
import { magnetFromInfoHash, magnetUrl, prowlarrConfigured } from '../gamestore/prowlarrSearch.ts'
import { ApiError } from '../http/core.ts'
import { logger } from '../log.ts'

const log = logger('retro')

// ---------- Shared Contract Types ----------

export interface RetroVariant {
  id: string
  fileName: string
  region: string
  url: string
  sizeBytes?: number
}

export interface RetroGameEntry {
  id: string
  title: string
  console: string
  consoleLabel: string
  sourceName: string
  summary?: string
  cover?: string
  year?: number
  sizeBytes?: number
  homebrew?: boolean
  showcase?: boolean
  /** Best default dump first (USA > World > Europe > En, avoiding Beta/Proto/Demo/[b]). */
  variants: RetroVariant[]
}

export interface RetroSourceConfig {
  id: string
  name: string
  url: string
  console?: string
}

export interface RetroSourceStatus {
  at: string
  ok: boolean
  games: number
  error?: string
}

export interface RetroDownloadJob {
  id: string
  title: string
  console: string
  fileName: string
  state: 'downloading' | 'ready' | 'failed'
  progress: number
  receivedBytes: number
  totalBytes: number
  error?: string
  createdAt: string
}

export interface RetroLiveSearchItem {
  id: string
  title: string
  releaseTitle: string
  console: string
  consoleLabel: string
  sizeBytes: number
  seeders: number
  indexer: string
  downloadUrl: string
}

export interface RetroLiveSearchResponse {
  available: boolean
  items: RetroLiveSearchItem[]
}

export interface RetroImportConsole {
  slug: string
  label: string
  count: number
  bytes: number
  sample: string[]
}

export interface RetroImportPreview {
  folder: string
  totalFiles: number
  totalBytes: number
  consoles: RetroImportConsole[]
}

export interface RetroImportResult {
  imported: number
  skipped: number
  consoles: number
}

// ---------- Canonical Console Slugs, Aliases & Extensions ----------

interface ConsoleDef {
  slug: string
  label: string
  aliases: string[]
  extensions: string[]
}

const CONSOLES: ConsoleDef[] = [
  { slug: 'nes', label: 'NES', aliases: ['nes', 'fc', 'famicom', 'nintendo entertainment system', 'nintendo - nintendo entertainment system'], extensions: ['.nes', '.fds', '.unf', '.unif'] },
  { slug: 'snes', label: 'SNES', aliases: ['snes', 'sfc', 'super famicom', 'super nintendo', 'super nintendo entertainment system', 'nintendo - super nintendo entertainment system'], extensions: ['.sfc', '.smc', '.fig', '.swc'] },
  { slug: 'n64', label: 'Nintendo 64', aliases: ['n64', 'nintendo 64', 'nintendo - nintendo 64'], extensions: ['.n64', '.z64', '.v64'] },
  { slug: 'gb', label: 'Game Boy', aliases: ['gb', 'gameboy', 'game boy', 'nintendo - game boy'], extensions: ['.gb'] },
  { slug: 'gbc', label: 'Game Boy Color', aliases: ['gbc', 'gameboy color', 'game boy color', 'nintendo - game boy color'], extensions: ['.gbc'] },
  { slug: 'gba', label: 'Game Boy Advance', aliases: ['gba', 'gameboy advance', 'game boy advance', 'nintendo - game boy advance'], extensions: ['.gba'] },
  { slug: 'nds', label: 'Nintendo DS', aliases: ['nds', 'ds', 'nintendo ds', 'nintendo - nintendo ds'], extensions: ['.nds', '.dsi'] },
  { slug: '3ds', label: 'Nintendo 3DS', aliases: ['3ds', 'n3ds', 'nintendo 3ds', 'nintendo - nintendo 3ds'], extensions: ['.3ds', '.cia', '.cci', '.cxi'] },
  { slug: 'ngc', label: 'GameCube', aliases: ['ngc', 'gc', 'gamecube', 'nintendo gamecube', 'nintendo - gamecube'], extensions: ['.gcm', '.gcz', '.rvz'] },
  { slug: 'wii', label: 'Wii', aliases: ['wii', 'nintendo wii', 'nintendo - wii'], extensions: ['.wbfs', '.wad', '.wia'] },
  { slug: 'wiiu', label: 'Wii U', aliases: ['wiiu', 'wii u', 'wii-u', 'nintendo wii u', 'nintendo - wii u'], extensions: ['.wud', '.wux', '.wua', '.rpx'] },
  { slug: 'switch', label: 'Nintendo Switch', aliases: ['switch', 'nsw', 'ns', 'nintendo switch', 'nintendo - nintendo switch'], extensions: ['.nsp', '.xci', '.nsz', '.xcz'] },
  { slug: 'psx', label: 'PlayStation', aliases: ['psx', 'ps1', 'ps', 'psone', 'playstation', 'sony - playstation'], extensions: [] },
  { slug: 'ps2', label: 'PlayStation 2', aliases: ['ps2', 'playstation 2', 'sony - playstation 2'], extensions: [] },
  { slug: 'ps3', label: 'PlayStation 3', aliases: ['ps3', 'playstation 3', 'sony - playstation 3'], extensions: [] },
  { slug: 'psp', label: 'PSP', aliases: ['psp', 'playstation portable', 'sony - playstation portable'], extensions: ['.cso'] },
  { slug: 'psvita', label: 'PS Vita', aliases: ['psvita', 'vita', 'ps vita', 'playstation vita', 'sony - playstation vita'], extensions: ['.vpk'] },
  { slug: 'genesis', label: 'Sega Genesis', aliases: ['genesis', 'md', 'megadrive', 'mega drive', 'sega genesis', 'sega mega drive', 'sega - mega drive - genesis'], extensions: ['.md', '.gen', '.smd'] },
  { slug: 'sms', label: 'Master System', aliases: ['sms', 'mastersystem', 'master system', 'sega - master system - mark iii'], extensions: ['.sms'] },
  { slug: 'gg', label: 'Game Gear', aliases: ['gg', 'gamegear', 'game gear', 'sega - game gear'], extensions: ['.gg'] },
  { slug: 'saturn', label: 'Sega Saturn', aliases: ['saturn', 'ss', 'sega saturn', 'sega - saturn'], extensions: [] },
  { slug: 'dc', label: 'Dreamcast', aliases: ['dc', 'dreamcast', 'sega dreamcast', 'sega - dreamcast'], extensions: ['.cdi', '.gdi'] },
  { slug: 'segacd', label: 'Sega CD', aliases: ['segacd', 'sega cd', 'megacd', 'mega cd', 'sega - mega-cd - sega cd'], extensions: [] },
  { slug: 'sega32', label: 'Sega 32X', aliases: ['sega32', 'sega32x', '32x', 'sega 32x'], extensions: ['.32x'] },
  { slug: 'pce', label: 'PC Engine', aliases: ['pce', 'tg16', 'pcengine', 'pc engine', 'turbografx', 'turbografx-16'], extensions: ['.pce'] },
  { slug: 'neogeo', label: 'Neo Geo', aliases: ['neogeo', 'neo geo', 'neo-geo'], extensions: [] },
  { slug: 'arcade', label: 'Arcade', aliases: ['arcade', 'mame', 'fbneo', 'fba'], extensions: [] },
  { slug: 'atari2600', label: 'Atari 2600', aliases: ['atari2600', '2600', 'atari 2600'], extensions: ['.a26'] },
  { slug: 'pico8', label: 'PICO-8', aliases: ['pico8', 'pico-8', 'pico 8'], extensions: ['.p8'] },
]

const LABEL_BY_SLUG = new Map<string, string>()
const ALIAS_TO_SLUG = new Map<string, string>()
const EXT_TO_SLUG = new Map<string, string>()

for (const c of CONSOLES) {
  LABEL_BY_SLUG.set(c.slug, c.label)
  ALIAS_TO_SLUG.set(c.slug, c.slug)
  for (const a of c.aliases) {
    ALIAS_TO_SLUG.set(a.toLowerCase(), c.slug)
    ALIAS_TO_SLUG.set(a.toLowerCase().replace(/[^a-z0-9]+/g, ''), c.slug)
  }
  for (const ext of c.extensions) {
    EXT_TO_SLUG.set(ext.toLowerCase(), c.slug)
  }
}

/** Ambiguous ROM/disc/archive extensions accepted when console context is known. */
const GENERIC_ROM_EXTS = new Set([
  '.zip', '.7z', '.iso', '.chd', '.pbp', '.bin', '.cue', '.img', '.mdf', '.pkg', '.rom', '.cso', '.rvz',
])

const DOC_MD_NAMES = new Set(['readme.md', 'license.md', 'changelog.md', 'contributing.md', 'history.md', 'notes.md', 'todo.md'])

export const SAFE_CONSOLE_SLUG = /^[a-z0-9_-]{1,24}$/

export function normalizeConsoleSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  const direct = ALIAS_TO_SLUG.get(trimmed)
  if (direct) return direct
  const compact = trimmed.replace(/[^a-z0-9]+/g, '')
  const byCompact = ALIAS_TO_SLUG.get(compact)
  if (byCompact) return byCompact
  // Check common folder prefixes like "Nintendo - Game Boy Advance" or "Sega - Mega Drive"
  for (const c of CONSOLES) {
    for (const a of c.aliases) {
      if (a.length >= 4 && trimmed.includes(a)) return c.slug
    }
  }
  return null
}

export function consoleLabel(slug: string): string {
  return LABEL_BY_SLUG.get(slug.toLowerCase()) ?? slug.toUpperCase()
}

export function detectConsoleFromExtension(fileName: string): string | null {
  const lower = basename(fileName).toLowerCase()
  if (lower.endsWith('.p8.png')) return 'pico8'
  if (DOC_MD_NAMES.has(lower)) return null
  const ext = extname(lower)
  if (!ext) return null
  return EXT_TO_SLUG.get(ext) ?? null
}

export function isRomFileName(fileName: string, knownConsole?: string | null): boolean {
  const lower = basename(fileName).toLowerCase()
  if (!lower || lower.startsWith('.')) return false
  if (DOC_MD_NAMES.has(lower)) return false
  if (lower.endsWith('.p8.png')) return true
  const ext = extname(lower)
  if (!ext) return false
  if (EXT_TO_SLUG.has(ext)) return true
  if (knownConsole && GENERIC_ROM_EXTS.has(ext)) return true
  return false
}

const TEXT_CONSOLE_PATTERNS: [RegExp, string][] = [
  [/\b(?:nintendo\s*switch|nsw|nsp|xci)\b/i, 'switch'],
  [/\b(?:wii\s*u|wiiu|wud|wux)\b/i, 'wiiu'],
  [/\b(?:game\s*boy\s*advance|gba)\b/i, 'gba'],
  [/\b(?:game\s*boy\s*color|gbc)\b/i, 'gbc'],
  [/\b(?:game\s*boy|dmg)\b/i, 'gb'],
  [/\b(?:nintendo\s*3ds|3ds|n3ds)\b/i, '3ds'],
  [/\b(?:nintendo\s*ds|nds)\b/i, 'nds'],
  [/\b(?:super\s*nintendo|super\s*famicom|snes|sfc)\b/i, 'snes'],
  [/\b(?:nintendo\s*64|n64)\b/i, 'n64'],
  [/\b(?:gamecube|ngc)\b/i, 'ngc'],
  [/\b(?:nintendo\s*wii|wii)\b/i, 'wii'],
  [/\b(?:famicom|nes)\b/i, 'nes'],
  [/\b(?:playstation\s*3|ps3)\b/i, 'ps3'],
  [/\b(?:playstation\s*2|ps2)\b/i, 'ps2'],
  [/\b(?:playstation\s*vita|ps\s*vita|psvita|vita)\b/i, 'psvita'],
  [/\b(?:playstation\s*portable|psp)\b/i, 'psp'],
  [/\b(?:playstation\s*1|psx|ps1|psone|playstation)\b/i, 'psx'],
  [/\b(?:dreamcast|dc)\b/i, 'dc'],
  [/\b(?:sega\s*saturn|saturn)\b/i, 'saturn'],
  [/\b(?:mega\s*drive|megadrive|sega\s*genesis|genesis)\b/i, 'genesis'],
  [/\b(?:master\s*system|sms)\b/i, 'sms'],
  [/\b(?:game\s*gear)\b/i, 'gg'],
  [/\b(?:sega\s*cd|mega\s*cd)\b/i, 'segacd'],
  [/\b(?:sega\s*32x|32x)\b/i, 'sega32'],
  [/\b(?:pc\s*engine|turbografx|tg16|pce)\b/i, 'pce'],
  [/\b(?:neo\s*geo|neogeo)\b/i, 'neogeo'],
  [/\b(?:atari\s*2600)\b/i, 'atari2600'],
  [/\b(?:pico[- ]?8)\b/i, 'pico8'],
]

export function detectConsoleFromText(text: string): string | null {
  for (const [re, slug] of TEXT_CONSOLE_PATTERNS) {
    if (re.test(text)) return slug
  }
  return null
}

// ---------- URL & Filename Validation ----------

const LAN_HTTP = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|[a-z0-9-]+\.(?:local|lan)(?::|\/|$))/i

/** Accepts https:// (no embedded credentials) or http:// on LAN/localhost only. */
export function allowedRetroUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 2000) return undefined
  const trimmed = v.trim()
  const secure = httpsUrl(trimmed)
  if (secure) return secure
  try {
    const u = new URL(trimmed)
    if (u.protocol === 'http:' && !u.username && !u.password && LAN_HTTP.test(trimmed)) {
      return u.toString()
    }
  } catch {
    return undefined
  }
  return undefined
}

/** Sanitizes a single filename (no directory traversal, slashes, hidden names, or invalid FS chars). */
export function sanitizeFileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.includes('/') || raw.includes('\\') || raw.includes('\0')) return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) return null
  const clean = trimmed.replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/[. ]+$/, '').trim()
  if (!clean || clean === '.' || clean === '..' || clean.startsWith('.') || Buffer.byteLength(clean) > 200) return null
  return clean
}

// ---------- Region Extraction, Variant Priority & Grouping ----------

const KNOWN_REGIONS = [
  'USA', 'US', 'World', 'Europe', 'EU', 'Japan', 'JP', 'En', 'English',
  'Australia', 'Canada', 'UK', 'France', 'Germany', 'Spain', 'Italy',
  'Korea', 'Asia', 'China', 'Taiwan', 'Brazil', 'Sweden', 'Netherlands',
  'Denmark', 'Finland', 'Norway', 'Russia', 'Poland', 'Portugal', 'Unknown',
]
const REGION_TOKEN_RE = new RegExp(`\\b(${KNOWN_REGIONS.join('|')})\\b`, 'i')
const NON_FINAL_RE = /\b(beta|proto|prototype|demo|sample|kiosk|preview|alpha|test|debug|promo|taikenban)\b/i
const UNLICENSED_RE = /\b(unl|pirate|hack|bootleg)\b/i

export function extractRegion(fileName: string): string {
  const stem = stripRomExtension(fileName)
  const parens = [...stem.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.trim())
  const regionParts: string[] = []
  let suffix = ''
  for (const p of parens) {
    if (NON_FINAL_RE.test(p)) {
      if (!suffix) suffix = p.split(',')[0]!.trim()
      continue
    }
    if (REGION_TOKEN_RE.test(p) && !/^(rev\s|v\d|disc\s|disk\s|track\s|alt)/i.test(p)) {
      regionParts.push(p)
    }
  }
  const base = regionParts.length ? regionParts[0]! : 'World'
  return suffix ? `${base} (${suffix})` : base
}

/** Higher score = better default dump: USA > World > Europe > En, avoiding Beta/Proto/Demo/[b]. */
export function scoreVariant(fileName: string): number {
  const stem = stripRomExtension(fileName)
  const parens = [...stem.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.trim())
  const brackets = [...stem.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!.trim())

  let score = 400
  const regionStr = parens.join(' ')

  if (/\b(?:USA|US)\b/i.test(regionStr)) score = 1000
  else if (/\bWorld\b/i.test(regionStr)) score = 900
  else if (/\b(?:Europe|EU)\b/i.test(regionStr)) score = 800
  else if (/\b(?:En|English)\b/i.test(regionStr)) score = 700
  else if (/\b(?:Australia|Canada|UK)\b/i.test(regionStr)) score = 650
  else if (/\b(?:Japan|JP)\b/i.test(regionStr)) score = 300

  // Small revision bonus (Rev 1, Rev 2, v1.1) so latest clean revision wins within same region
  for (const p of parens) {
    const rev = /^rev\s*(\d+|[a-z])$/i.exec(p)
    if (rev) {
      const n = /^\d+$/.test(rev[1]!) ? Number(rev[1]) : rev[1]!.toLowerCase().charCodeAt(0) - 96
      score += Math.min(25, Math.max(1, n) * 5)
    }
    if (NON_FINAL_RE.test(p)) score -= 1200
    if (UNLICENSED_RE.test(p)) score -= 600
  }

  for (const b of brackets) {
    if (b === '!') score += 30
    else if (/^b\d*$/i.test(b) || /^b\s/i.test(b)) score -= 1500
    else if (/^[ohfpt]\d*/i.test(b)) score -= 600
    else if (/^bios$/i.test(b)) score -= 1600
  }

  return score
}

export function stripRomExtension(fileName: string): string {
  const base = basename(fileName)
  if (base.toLowerCase().endsWith('.p8.png')) return base.slice(0, -7)
  const ext = extname(base)
  return ext ? base.slice(0, -ext.length) : base
}

export function baseGameTitle(fileName: string): string {
  let s = stripRomExtension(fileName)
  // Remove parenthetical & bracketed tags
  s = s.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '')
  if (!s.includes(' ') && s.includes('_')) s = s.replace(/_/g, ' ')
  s = s.replace(/\s{2,}/g, ' ').trim()
  return (s || stripRomExtension(fileName) || fileName).slice(0, 180)
}

function normalizeTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export interface RawRetroFile {
  fileName: string
  url: string
  console: string
  sizeBytes?: number
  title?: string
  summary?: string
  cover?: string
  year?: number
}

/** Groups raw ROM files into deduped RetroGameEntry items with best variant first. */
export function groupRetroEntries(files: RawRetroFile[], source: { id: string; name: string }): RetroGameEntry[] {
  const groups = new Map<string, { title: string; console: string; summary?: string; cover?: string; year?: number; variants: (RetroVariant & { _score: number })[] }>()

  for (const f of files) {
    const slug = normalizeConsoleSlug(f.console) ?? (SAFE_CONSOLE_SLUG.test(f.console.toLowerCase()) ? f.console.toLowerCase() : null)
    if (!slug) continue
    const title = (f.title?.trim() || baseGameTitle(f.fileName)).slice(0, 180)
    const titleKey = normalizeTitleKey(title)
    if (!titleKey) continue

    const groupKey = `${slug}:${titleKey}`
    let g = groups.get(groupKey)
    if (!g) {
      g = { title, console: slug, summary: f.summary, cover: f.cover, year: f.year, variants: [] }
      groups.set(groupKey, g)
    } else {
      if (!g.summary && f.summary) g.summary = f.summary
      if (!g.cover && f.cover) g.cover = f.cover
      if (!g.year && f.year) g.year = f.year
    }

    // Dedupe identical URLs or identical filenames within a group
    if (g.variants.some((v) => v.url === f.url || v.fileName.toLowerCase() === f.fileName.toLowerCase())) continue

    const variantId = createHash('sha256').update(`${source.id}:${f.url}`).digest('hex').slice(0, 12)
    g.variants.push({
      id: variantId,
      fileName: f.fileName,
      region: extractRegion(f.fileName),
      url: f.url,
      ...(typeof f.sizeBytes === 'number' && Number.isFinite(f.sizeBytes) && f.sizeBytes > 0 ? { sizeBytes: Math.round(f.sizeBytes) } : {}),
      _score: scoreVariant(f.fileName),
    })
  }

  const out: RetroGameEntry[] = []
  for (const [groupKey, g] of groups) {
    if (!g.variants.length) continue
    g.variants.sort((a, b) => b._score - a._score || a.fileName.localeCompare(b.fileName))
    const cleanVariants: RetroVariant[] = g.variants.map(({ _score: _, ...rest }) => rest)
    const entryId = createHash('sha256').update(`${source.id}:${groupKey}`).digest('hex').slice(0, 16)
    out.push({
      id: entryId,
      title: g.title,
      console: g.console,
      consoleLabel: consoleLabel(g.console),
      sourceName: source.name,
      ...(g.summary ? { summary: g.summary } : {}),
      ...(g.cover ? { cover: g.cover } : {}),
      ...(g.year ? { year: g.year } : {}),
      ...(cleanVariants[0]?.sizeBytes ? { sizeBytes: cleanVariants[0].sizeBytes } : {}),
      variants: cleanVariants,
    })
  }

  out.sort((a, b) => a.title.localeCompare(b.title))
  return out
}

// ---------- Source Parsers ----------

function parseHumanSize(str: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*(B|K|KB|KiB|M|MB|MiB|G|GB|GiB)\b/i.exec(str)
  if (!m) {
    const rawNum = /\b(\d{4,12})\b/.exec(str)
    if (rawNum) return Number(rawNum[1])
    return undefined
  }
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return undefined
  const unit = m[2]!.toUpperCase()
  if (unit === 'B') return Math.round(n)
  if (unit.startsWith('K')) return Math.round(n * 1024)
  if (unit.startsWith('M')) return Math.round(n * 1024 * 1024)
  if (unit.startsWith('G')) return Math.round(n * 1024 * 1024 * 1024)
  return undefined
}

function detectConsoleFromUrlPath(urlStr: string): string | null {
  try {
    const u = new URL(urlStr)
    const segs = u.pathname.split('/').filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
    for (let i = segs.length - 1; i >= 0; i--) {
      const hit = normalizeConsoleSlug(segs[i]) ?? detectConsoleFromText(segs[i]!)
      if (hit) return hit
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Parses an Apache / Nginx / Caddy / Myrient HTML directory listing. */
export function parseHtmlAutoindex(html: string, pageUrl: string, source: RetroSourceConfig): RetroGameEntry[] {
  const hintConsole = normalizeConsoleSlug(source.console) ?? detectConsoleFromUrlPath(pageUrl) ?? detectConsoleFromText(source.name)
  const rawFiles: RawRetroFile[] = []
  const linkRe = /<a\s+[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>([^\n<]*(?:<[^>]+>[^\n<]*){0,4})/gi

  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null) {
    const href = (m[1] ?? m[2] ?? '').trim()
    const trailing = m[4] ?? ''
    if (!href || href.startsWith('#') || href.startsWith('?') || href === '/' || href === '../' || href.endsWith('/')) continue
    if (/^(?:mailto:|javascript:|data:)/i.test(href)) continue

    let resolved: string
    try {
      resolved = new URL(href, pageUrl).toString()
    } catch {
      continue
    }
    const safeUrl = allowedRetroUrl(resolved)
    if (!safeUrl) continue

    let fileName: string
    try {
      const u = new URL(safeUrl)
      const seg = u.pathname.split('/').filter(Boolean).pop() ?? ''
      fileName = decodeURIComponent(seg)
    } catch {
      continue
    }

    const cleanName = sanitizeFileName(fileName)
    if (!cleanName) continue

    const extConsole = detectConsoleFromExtension(cleanName)
    const consoleSlug = hintConsole ?? extConsole
    if (!consoleSlug || !isRomFileName(cleanName, consoleSlug)) continue

    // Try to parse file size from the same table row / line
    const rowText = trailing.replace(/<[^>]+>/g, ' ')
    const sizeBytes = parseHumanSize(rowText)

    rawFiles.push({
      fileName: cleanName,
      url: safeUrl,
      console: consoleSlug,
      ...(sizeBytes ? { sizeBytes } : {}),
    })
  }

  return groupRetroEntries(rawFiles, source)
}

/** Detects an Internet Archive URL and returns its metadata API URL + identifier. */
export function internetArchiveTarget(urlStr: string): { identifier: string; metadataUrl: string } | null {
  try {
    const u = new URL(urlStr)
    if (!/(^|\.)archive\.org$/i.test(u.hostname)) return null
    const m = /^\/(?:details|download|metadata)\/([^/?#]+)/i.exec(u.pathname)
    if (!m) return null
    const identifier = decodeURIComponent(m[1]!)
    if (!identifier || identifier.includes('..') || identifier.includes('/')) return null
    return {
      identifier,
      metadataUrl: `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
    }
  } catch {
    return null
  }
}

/** Parses an Internet Archive /metadata/<id> JSON document. */
export function parseInternetArchiveMetadata(doc: unknown, source: RetroSourceConfig, fallbackId?: string): RetroGameEntry[] {
  if (!doc || typeof doc !== 'object') return []
  const obj = doc as { metadata?: Record<string, unknown>; files?: unknown[] }
  const files = Array.isArray(obj.files) ? obj.files : []
  const identifier = (typeof obj.metadata?.identifier === 'string' && obj.metadata.identifier.trim()) || fallbackId || ''
  if (!identifier) return []

  const metaTitle = typeof obj.metadata?.title === 'string' ? obj.metadata.title : ''
  const hintConsole =
    normalizeConsoleSlug(source.console) ??
    detectConsoleFromText(`${metaTitle} ${identifier} ${source.name}`)

  const rawFiles: RawRetroFile[] = []
  for (const item of files) {
    if (!item || typeof item !== 'object') continue
    const f = item as Record<string, unknown>
    const relName = typeof f.name === 'string' ? f.name.trim() : ''
    if (!relName || relName.startsWith('__') || relName.includes('..')) continue
    if (/(?:_meta\.xml|_files\.xml|_reviews\.xml|_archive\.torrent|\.sqlite|\.thumbs\/)/i.test(relName)) continue

    const parts = relName.split('/').filter(Boolean)
    const leaf = sanitizeFileName(parts[parts.length - 1] ?? '')
    if (!leaf) continue

    const folderConsole = parts.length > 1 ? normalizeConsoleSlug(parts[parts.length - 2]) : null
    const extConsole = detectConsoleFromExtension(leaf)
    const consoleSlug = normalizeConsoleSlug(source.console) ?? folderConsole ?? extConsole ?? hintConsole
    if (!consoleSlug || !isRomFileName(leaf, consoleSlug)) continue

    const encodedPath = parts.map((p) => encodeURIComponent(p)).join('/')
    const dlUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedPath}`
    const size = Number(f.size)

    rawFiles.push({
      fileName: leaf,
      url: dlUrl,
      console: consoleSlug,
      ...(Number.isFinite(size) && size > 0 ? { sizeBytes: Math.round(size) } : {}),
    })
  }

  return groupRetroEntries(rawFiles, source)
}

/** Parses a JSON retro catalog feed ({ games: [...] } or { items: [...] } or [...]). */
export function parseJsonRetroFeed(doc: unknown, source: RetroSourceConfig): RetroGameEntry[] {
  const list = Array.isArray(doc)
    ? doc
    : doc && typeof doc === 'object'
      ? (Array.isArray((doc as Record<string, unknown>).games)
          ? ((doc as Record<string, unknown>).games as unknown[])
          : Array.isArray((doc as Record<string, unknown>).items)
            ? ((doc as Record<string, unknown>).items as unknown[])
            : null)
      : null
  if (!list) return []

  const hintConsole = normalizeConsoleSlug(source.console) ?? detectConsoleFromText(source.name)
  const rawFiles: RawRetroFile[] = []

  for (const item of list.slice(0, 20_000)) {
    if (!item || typeof item !== 'object') continue
    const g = item as Record<string, unknown>
    const title = typeof g.title === 'string' && g.title.trim() ? g.title.trim().slice(0, 180) : undefined
    const summary = typeof g.summary === 'string' && g.summary.trim() ? g.summary.trim().slice(0, 400) : undefined
    const cover = httpsUrl(g.cover)
    const year = typeof g.year === 'number' && Number.isInteger(g.year) && g.year >= 1970 && g.year <= 2035 ? g.year : undefined
    const itemConsole = normalizeConsoleSlug(g.console) ?? hintConsole

    if (Array.isArray(g.variants) && g.variants.length > 0) {
      for (const rv of g.variants) {
        if (!rv || typeof rv !== 'object') continue
        const v = rv as Record<string, unknown>
        const url = allowedRetroUrl(v.url)
        if (!url) continue
        const urlName = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
        const fileName = sanitizeFileName(v.fileName ?? urlName)
        if (!fileName) continue
        const con = itemConsole ?? detectConsoleFromExtension(fileName)
        if (!con) continue
        const sizeBytes = Number(v.sizeBytes ?? g.sizeBytes)
        rawFiles.push({
          fileName,
          url,
          console: con,
          title,
          summary,
          cover,
          year,
          ...(Number.isFinite(sizeBytes) && sizeBytes > 0 ? { sizeBytes: Math.round(sizeBytes) } : {}),
        })
      }
    } else {
      const url = allowedRetroUrl(g.url)
      if (!url) continue
      const urlName = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
      const fileName = sanitizeFileName(g.fileName ?? urlName)
      if (!fileName) continue
      const con = itemConsole ?? detectConsoleFromExtension(fileName)
      if (!con) continue
      const sizeBytes = Number(g.sizeBytes)
      rawFiles.push({
        fileName,
        url,
        console: con,
        title,
        summary,
        cover,
        year,
        ...(Number.isFinite(sizeBytes) && sizeBytes > 0 ? { sizeBytes: Math.round(sizeBytes) } : {}),
      })
    }
  }

  return groupRetroEntries(rawFiles, source)
}

// ---------- Curated Showcase (Always 2) & Opt-In Free/Open-Source Homebrew Shelf ----------

export const SHOWCASE_GAMES: RetroGameEntry[] = [
  {
    id: 'homebrew-apotris',
    title: 'Apotris',
    console: 'gba',
    consoleLabel: 'Game Boy Advance',
    sourceName: 'Homebrew Shelf',
    summary: 'Modern, ultra-responsive open-source block-stacking puzzle game built for Game Boy Advance.',
    year: 2024,
    sizeBytes: 2_097_152,
    homebrew: true,
    showcase: true,
    variants: [
      {
        id: 'homebrew-apotris-gba',
        fileName: 'Apotris-v4.1.0GBA.zip',
        region: 'World',
        url: 'https://github.com/akouzoukos/apotris/releases/download/v4.1.0/Apotris-v4.1.0GBA.zip',
        sizeBytes: 2_097_152,
      },
    ],
  },
  {
    id: 'homebrew-tobu-tobu-girl',
    title: 'Tobu Tobu Girl',
    console: 'gb',
    consoleLabel: 'Game Boy',
    sourceName: 'Homebrew Shelf',
    summary: 'Fast-paced open-source arcade platformer for the original Game Boy — bounce upward to rescue your floating cat.',
    year: 2017,
    sizeBytes: 262_144,
    homebrew: true,
    showcase: true,
    variants: [
      {
        id: 'homebrew-tobu-tobu-girl-gb',
        fileName: 'tobutobugirl.gb',
        region: 'World',
        url: 'https://github.com/SimonLarsen/tobutobugirl/releases/download/v1.0/tobutobugirl.gb',
        sizeBytes: 262_144,
      },
    ],
  },
]

export const HOMEBREW_CATALOG: RetroGameEntry[] = [
  ...SHOWCASE_GAMES,
  {
    id: 'homebrew-super-tilt-bro',
    title: 'Super Tilt Bro.',
    console: 'nes',
    consoleLabel: 'NES',
    sourceName: 'Homebrew Shelf',
    summary: 'Open-source 2D platform fighter for NES with crisp physics and multiplayer battles.',
    year: 2023,
    sizeBytes: 524_288,
    homebrew: true,
    variants: [
      {
        id: 'homebrew-super-tilt-bro-nes',
        fileName: 'Super_Tilt_Bro_v2.0.nes',
        region: 'World',
        url: 'https://github.com/sgadrat/super-tilt-bro/releases/download/v2.0/Super_Tilt_Bro_v2.0.nes',
        sizeBytes: 524_288,
      },
    ],
  },
  {
    id: 'homebrew-ucity-advance',
    title: 'uCity Advance',
    console: 'gba',
    consoleLabel: 'Game Boy Advance',
    sourceName: 'Homebrew Shelf',
    summary: 'Open-source isometric city-building simulation crafted for Game Boy Advance.',
    year: 2022,
    sizeBytes: 1_048_576,
    homebrew: true,
    variants: [
      {
        id: 'homebrew-ucity-gba',
        fileName: 'ucity-advance.gba',
        region: 'World',
        url: 'https://github.com/AntonioND/ucity-advance/releases/latest/download/ucity-advance.gba',
        sizeBytes: 1_048_576,
      },
    ],
  },
  {
    id: 'homebrew-240p-snes',
    title: '240p Test Suite',
    console: 'snes',
    consoleLabel: 'SNES',
    sourceName: 'Homebrew Shelf',
    summary: 'Open-source calibration and latency benchmark suite for Super Nintendo displays and emulators.',
    year: 2023,
    sizeBytes: 524_288,
    homebrew: true,
    variants: [
      {
        id: 'homebrew-240p-snes-sfc',
        fileName: '240pSuite.sfc',
        region: 'World',
        url: 'https://github.com/pinobatch/240p-test-suite/releases/latest/download/240pSuite.sfc',
        sizeBytes: 524_288,
      },
    ],
  },
  {
    id: 'homebrew-abbaye-md',
    title: "L'Abbaye des Morts",
    console: 'genesis',
    consoleLabel: 'Sega Genesis',
    sourceName: 'Homebrew Shelf',
    summary: 'Gothic open-source retro action-platformer ported natively to Sega Genesis / Mega Drive.',
    year: 2018,
    sizeBytes: 1_048_576,
    homebrew: true,
    variants: [
      {
        id: 'homebrew-abbaye-md-bin',
        fileName: 'abbaye-md.bin',
        region: 'World',
        url: 'https://github.com/nevat/abbayedesmorts-gpl/releases/latest/download/abbaye-md.bin',
        sizeBytes: 1_048_576,
      },
    ],
  },
  {
    id: 'homebrew-ucity-gbc',
    title: 'uCity',
    console: 'gbc',
    consoleLabel: 'Game Boy Color',
    sourceName: 'Homebrew Shelf',
    summary: 'Open-source full-featured city-building simulation written in assembly for Game Boy Color.',
    year: 2020,
    sizeBytes: 524_288,
    homebrew: true,
    variants: [
      {
        id: 'homebrew-ucity-gbc-rom',
        fileName: 'ucity.gbc',
        region: 'World',
        url: 'https://github.com/AntonioND/ucity/releases/latest/download/ucity.gbc',
        sizeBytes: 524_288,
      },
    ],
  },
]

// ---------- Prowlarr Console Live Search (Category 1000) ----------

const RETRO_PROXY_PREFIX = 'prowlarr://'
const RETRO_PROXY_TTL_MS = 30 * 60_000
const RETRO_PROXY_MAX = 500

const retroProxyStore = new Map<string, { url: string; title: string; expiresAt: number }>()

function rememberRetroProxy(id: string, url: string, title: string): string {
  const now = Date.now()
  for (const [k, v] of retroProxyStore) if (v.expiresAt <= now) retroProxyStore.delete(k)
  if (retroProxyStore.size >= RETRO_PROXY_MAX) {
    const oldest = retroProxyStore.keys().next().value
    if (oldest) retroProxyStore.delete(oldest)
  }
  retroProxyStore.set(id, { url, title, expiresAt: now + RETRO_PROXY_TTL_MS })
  return `${RETRO_PROXY_PREFIX}${id}`
}

const PROWLARR_CONSOLE_CATS: Record<number, string> = {
  1010: 'nds',
  1020: 'psp',
  1030: 'wii',
  1060: 'wii',
  1080: 'ps3',
  1110: '3ds',
  1120: 'psvita',
  1130: 'wiiu',
}

interface ProwlarrRawItem {
  title?: unknown
  size?: unknown
  seeders?: unknown
  indexer?: unknown
  protocol?: unknown
  infoHash?: unknown
  magnetUrl?: unknown
  downloadUrl?: unknown
  guid?: unknown
  categories?: { id?: unknown }[]
}

function cleanConsoleReleaseTitle(raw: string): string {
  let s = raw.trim()
  s = s.replace(/\s*\[[^\]]*\]\s*/g, ' ')
  s = s.replace(/\s*\([^)]*(?:usa|eur|europe|jpn|japan|world|nsp|xci|cia|iso|chd|rom|multi\d*|rev\s*\d+|v\d+\.\d+|switch|ps2|ps3|psx|psp|wii|gba|snes|nes|n64|nds|3ds|gc|ngc)[^)]*\)\s*/gi, ' ')
  const dots = (s.match(/\./g) ?? []).length
  const spaces = (s.match(/\s/g) ?? []).length
  if (dots >= 2 && dots >= spaces) s = s.replace(/\./g, ' ')
  s = s.replace(/_/g, ' ').replace(/\s*[-–—:|+/]+\s*$/, '').replace(/\s{2,}/g, ' ').trim()
  return (s || raw.trim()).slice(0, 160)
}

export async function liveSearchRetro(
  query: string,
  opts: { console?: string; prowlarr?: Endpoint; fetch?: typeof fetch; timeoutMs?: number; limit?: number } = {},
): Promise<RetroLiveSearchResponse> {
  const q = query.trim().slice(0, 200)
  const ep = opts.prowlarr
  if (!prowlarrConfigured(ep)) return { available: false, items: [] }
  if (q.length < 2) return { available: true, items: [] }

  const wantConsole = opts.console ? normalizeConsoleSlug(opts.console) ?? opts.console.trim().toLowerCase() : null
  const get = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 10_000
  const limit = Math.max(1, Math.min(50, opts.limit ?? 30))

  const base = ep.url.replace(/\/+$/, '')
  const searchUrl = `${base}/api/v1/search?query=${encodeURIComponent(q)}&categories=1000&type=search`

  let rawItems: ProwlarrRawItem[]
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
    rawItems = json as ProwlarrRawItem[]
  } catch {
    return { available: false, items: [] }
  }

  const seenUrls = new Set<string>()
  const items: RetroLiveSearchItem[] = []

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const releaseTitle = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (!releaseTitle) continue
    const sizeBytes = Number(raw.size)
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) continue
    if (typeof raw.protocol === 'string' && raw.protocol.toLowerCase() === 'usenet') continue

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
        pickedUrl = rememberRetroProxy(proxyId, rawDl, releaseTitle)
      }
    }
    if (!pickedUrl || seenUrls.has(pickedUrl)) continue
    seenUrls.add(pickedUrl)

    let detected = detectConsoleFromText(releaseTitle)
    if (!detected && Array.isArray(raw.categories)) {
      for (const c of raw.categories) {
        const cid = Number(c?.id)
        if (cid in PROWLARR_CONSOLE_CATS) {
          detected = PROWLARR_CONSOLE_CATS[cid]!
          break
        }
      }
    }
    const slug = detected ?? wantConsole ?? 'retro'
    if (wantConsole && slug !== wantConsole) continue

    const seeders = typeof raw.seeders === 'number' && Number.isFinite(raw.seeders) ? Math.max(0, Math.round(raw.seeders)) : 0
    const indexer = typeof raw.indexer === 'string' && raw.indexer.trim() ? raw.indexer.trim().slice(0, 60) : 'Indexer'
    const id = createHash('sha256').update(pickedUrl).digest('hex').slice(0, 16)

    items.push({
      id,
      title: cleanConsoleReleaseTitle(releaseTitle),
      releaseTitle: releaseTitle.slice(0, 260),
      console: slug,
      consoleLabel: slug === 'retro' ? 'Console' : consoleLabel(slug),
      sizeBytes: Math.round(sizeBytes),
      seeders,
      indexer,
      downloadUrl: pickedUrl,
    })
  }

  items.sort((a, b) => b.seeders - a.seeders || b.sizeBytes - a.sizeBytes)
  return { available: true, items: items.slice(0, limit) }
}

// ---------- ROMs Root Resolution & Writability ----------

export function romsRoot(s: Settings): string | null {
  if (s.mode === 'bundle' && s.stack?.hostData) {
    return join(s.stack.hostData, 'media', 'games', 'roms')
  }
  const emuRoms = s.emulators?.paths?.roms
  if (emuRoms) {
    const sub = join(emuRoms, 'roms')
    if (existsSync(sub)) return sub
    return emuRoms
  }
  return null
}

function nearestExistingDir(dir: string): string | null {
  let cur = resolve(dir)
  for (let i = 0; i < 32; i++) {
    if (existsSync(cur)) return cur
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
  return null
}

export function isRomsWritable(s: Settings): boolean {
  const root = romsRoot(s)
  if (!root) return false
  const check = nearestExistingDir(root)
  if (!check) return false
  try {
    accessSync(check, constants.W_OK)
    return true
  } catch {
    return false
  }
}

function insideRoot(root: string, target: string): boolean {
  try {
    const realRoot = realpathSync(root)
    const rel = target.slice(root.length).split(/[\\/]/).filter(Boolean)
    if (!target.startsWith(root + sep) && target !== root) return false
    let cur = root
    for (const part of rel) {
      cur = join(cur, part)
      try {
        if (lstatSync(cur).isSymbolicLink()) return false
      } catch {
        return true
      }
    }
    try {
      const realTarget = realpathSync(target)
      return realTarget === realRoot || realTarget.startsWith(realRoot + sep)
    } catch {
      return true
    }
  } catch {
    return false
  }
}

function bestEffortOwn(s: Settings, target: string, stopAt: string) {
  const uid = s.stack?.puid ?? 1000
  const gid = s.stack?.pgid ?? 1000
  let p = target
  while (p.length >= stopAt.length && p !== dirname(p)) {
    try {
      if (lstatSync(p).isSymbolicLink()) break
      chownSync(p, uid, gid)
    } catch {
      /* not root or unsupported filesystem */
    }
    if (p === stopAt) break
    p = dirname(p)
  }
}

// ---------- RomM Auto-Scan Helper ----------

export async function triggerRommScan(
  s: Settings,
  opts: { fetch?: typeof fetch; console?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; message: string }> {
  const r = s.services.romm
  if (!r?.url || (!r.password && !r.apiKey)) {
    return { ok: false, message: 'RomM is not configured.' }
  }
  const get = opts.fetch ?? fetch
  const base = r.url.replace(/\/+$/, '')
  const basic = r.apiKey && !r.username ? r.apiKey : Buffer.from(`${r.username ?? ''}:${r.password ?? ''}`).toString('base64')
  const headers = {
    Accept: 'application/json',
    Authorization: `Basic ${basic}`,
  }
  const timeoutMs = opts.timeoutMs ?? 15_000

  let registered = 0
  let reachable = false
  try {
    // 1. Register any new platform folders RomM doesn't know about yet
    const fsRes = await get(`${base}/api/platforms/filesystem`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (fsRes.ok) {
      reachable = true
      const fresh = (await fsRes.json().catch(() => [])) as { fs_slug?: string }[]
      if (Array.isArray(fresh) && fresh.length > 0) {
        const root = romsRoot(s)
        const onDisk = root && existsSync(root)
          ? new Set(readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name))
          : null
        for (const item of fresh) {
          const slug = item?.fs_slug
          if (typeof slug !== 'string' || !slug) continue
          if (onDisk && !onDisk.has(slug)) continue
          const regRes = await get(`${base}/api/platforms`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fs_slug: slug }),
            signal: AbortSignal.timeout(timeoutMs),
          }).catch(() => null)
          if (regRes?.ok) registered++
        }
      }
    } else if (fsRes.status === 401 || fsRes.status === 403) {
      return { ok: false, message: `RomM rejected credentials (${fsRes.status}).` }
    }

    // 2. Ask RomM to run a library scan (v3.6+ task endpoint, fallback to /api/scan)
    for (const path of ['/api/tasks/run/scan_library', '/api/scan']) {
      const scanRes = await get(`${base}${path}`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => null)
      if (scanRes?.ok) {
        return {
          ok: true,
          message: registered > 0
            ? `Registered ${registered} new console folder(s) and started RomM library scan.`
            : 'RomM library scan started.',
        }
      }
      if (scanRes && scanRes.status !== 404 && scanRes.status !== 405) {
        reachable = true
      }
    }

    // 3. Fallback: nudge RomM's filesystem watcher
    const root = romsRoot(s)
    if (root && existsSync(root)) {
      const targetDir = opts.console && existsSync(join(root, opts.console)) ? join(root, opts.console) : root
      const marker = join(targetDir, '.finesse-rescan.tmp')
      try {
        writeFileSync(marker, '')
        rmSync(marker, { force: true })
        if (reachable || registered > 0) {
          return { ok: true, message: 'Triggered RomM filesystem scan.' }
        }
      } catch {
        /* ignore */
      }
    }

    return reachable
      ? { ok: true, message: 'RomM checked for new games.' }
      : { ok: false, message: 'RomM did not accept a scan request.' }
  } catch (e) {
    return { ok: false, message: `Couldn’t reach RomM: ${(e as Error).message}` }
  }
}

// ---------- NAS / Local Folder Discovery & Import ----------

interface DiscoveredRom {
  sourcePath: string
  fileName: string
  console: string
  sizeBytes: number
}

function discoverRomsInFolder(folder: string): { resolved: string; files: DiscoveredRom[] } {
  if (typeof folder !== 'string' || !folder.trim()) {
    throw new ApiError(400, 'Specify a folder path on the server.')
  }
  const resolved = resolve(folder.trim())
  let st
  try {
    st = statSync(resolved)
  } catch {
    throw new ApiError(400, `Folder not found: ${resolved}`)
  }
  if (!st.isDirectory()) {
    throw new ApiError(400, `Not a directory: ${resolved}`)
  }

  const discovered: DiscoveredRom[] = []

  const collectFile = (fullPath: string, name: string, dirConsole: string | null) => {
    const clean = sanitizeFileName(name)
    if (!clean) return
    const extConsole = detectConsoleFromExtension(clean)
    const slug = dirConsole ?? extConsole
    if (!slug || !isRomFileName(clean, dirConsole ?? extConsole)) return
    let sizeBytes = 0
    try {
      const fst = statSync(fullPath)
      if (!fst.isFile()) return
      sizeBytes = fst.size
    } catch {
      return
    }
    discovered.push({ sourcePath: fullPath, fileName: clean, console: slug, sizeBytes })
  }

  const walk = (dir: string, depth: number, inheritedConsole: string | null) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue
      const full = join(dir, ent.name)
      if (ent.isFile()) {
        collectFile(full, ent.name, inheritedConsole)
      } else if (ent.isDirectory() && depth < 2) {
        const nextConsole = inheritedConsole ?? normalizeConsoleSlug(ent.name)
        walk(full, depth + 1, nextConsole)
      }
    }
  }

  const topAlias = normalizeConsoleSlug(basename(resolved))
  walk(resolved, 0, topAlias)
  return { resolved, files: discovered }
}

export function previewRomImport(folder: string): RetroImportPreview {
  const { resolved, files } = discoverRomsInFolder(folder)
  const byConsole = new Map<string, RetroImportConsole>()
  let totalBytes = 0

  for (const f of files) {
    totalBytes += f.sizeBytes
    let c = byConsole.get(f.console)
    if (!c) {
      c = { slug: f.console, label: consoleLabel(f.console), count: 0, bytes: 0, sample: [] }
      byConsole.set(f.console, c)
    }
    c.count++
    c.bytes += f.sizeBytes
    if (c.sample.length < 5) c.sample.push(f.fileName)
  }

  const consoles = [...byConsole.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return {
    folder: resolved,
    totalFiles: files.length,
    totalBytes,
    consoles,
  }
}

export async function runRomImport(
  folder: string,
  s: Settings,
  opts: { fetch?: typeof fetch } = {},
): Promise<RetroImportResult> {
  const destRoot = romsRoot(s)
  if (!destRoot || !isRomsWritable(s)) {
    throw new ApiError(409, 'ROMs folder is not configured or not writable on this server.')
  }
  const { files } = discoverRomsInFolder(folder)
  mkdirSync(destRoot, { recursive: true })

  let imported = 0
  let skipped = 0
  const touchedConsoles = new Set<string>()

  for (const f of files) {
    const consoleDir = join(destRoot, f.console)
    const target = join(consoleDir, f.fileName)
    if (!insideRoot(destRoot, target)) continue
    if (existsSync(target)) {
      skipped++
      continue
    }
    mkdirSync(consoleDir, { recursive: true })
    const part = join(consoleDir, `.${f.fileName}.${randomUUID().slice(0, 8)}.part`)
    try {
      copyFileSync(f.sourcePath, part)
      renameSync(part, target)
      bestEffortOwn(s, target, consoleDir)
      imported++
      touchedConsoles.add(f.console)
    } catch (e) {
      rmSync(part, { force: true })
      log.warn(`import failed for ${f.fileName}: ${(e as Error).message}`)
    }
  }

  if (imported > 0) {
    void triggerRommScan(s, { fetch: opts.fetch }).catch(() => {})
  }

  return {
    imported,
    skipped,
    consoles: touchedConsoles.size,
  }
}

// ---------- Retro Engine State (Sources Cache + Direct Download Manager) ----------

const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024 * 1024 // 16 GB safety cap
const MAX_JOBS_RETAINED = 25

export class RetroEngine {
  private readonly entriesBySource = new Map<string, RetroGameEntry[]>()
  private readonly statusBySource = new Map<string, RetroSourceStatus>()
  private readonly jobs: RetroDownloadJob[] = []
  private readonly getFetch: () => typeof fetch

  constructor(opts: { fetch?: typeof fetch } = {}) {
    this.getFetch = () => opts.fetch ?? fetch
  }

  /** Syncs a single source (HTML autoindex, Internet Archive, or JSON feed). */
  async syncSource(cfg: RetroSourceConfig): Promise<RetroSourceStatus> {
    const at = new Date().toISOString()
    const doFetch = this.getFetch()
    try {
      const ia = internetArchiveTarget(cfg.url)
      const fetchUrl = ia ? ia.metadataUrl : cfg.url
      const res = await doFetch(fetchUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Accept: ia ? 'application/json' : 'application/json, text/html;q=0.9, */*;q=0.8',
        },
      })
      if (!res.ok) {
        throw new Error(`Source returned HTTP ${res.status}`)
      }
      const text = await res.text()
      if (text.length > 32 * 1024 * 1024) {
        throw new Error('Source response exceeded 32 MB limit')
      }

      let entries: RetroGameEntry[]
      const ct = (res.headers.get('content-type') ?? '').toLowerCase()
      const trimmed = text.trimStart()
      if (ia || ct.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const doc = JSON.parse(text) as unknown
        if (ia || (doc && typeof doc === 'object' && Array.isArray((doc as Record<string, unknown>).files) && (doc as Record<string, unknown>).metadata)) {
          entries = parseInternetArchiveMetadata(doc, cfg, ia?.identifier)
        } else {
          entries = parseJsonRetroFeed(doc, cfg)
        }
      } else {
        entries = parseHtmlAutoindex(text, res.url || cfg.url, cfg)
      }

      this.entriesBySource.set(cfg.id, entries)
      const status: RetroSourceStatus = { at, ok: true, games: entries.length }
      this.statusBySource.set(cfg.id, status)
      return status
    } catch (e) {
      const status: RetroSourceStatus = {
        at,
        ok: false,
        games: this.entriesBySource.get(cfg.id)?.length ?? 0,
        error: e instanceof Error ? e.message : 'Failed to sync source',
      }
      this.statusBySource.set(cfg.id, status)
      return status
    }
  }

  async syncAll(sources: RetroSourceConfig[]): Promise<Record<string, RetroSourceStatus>> {
    const keep = new Set(sources.map((s) => s.id))
    for (const id of [...this.entriesBySource.keys()]) if (!keep.has(id)) this.entriesBySource.delete(id)
    for (const id of [...this.statusBySource.keys()]) if (!keep.has(id)) this.statusBySource.delete(id)

    const statuses: Record<string, RetroSourceStatus> = {}
    for (const src of sources) {
      statuses[src.id] = await this.syncSource(src)
    }
    return statuses
  }

  removeSource(id: string) {
    this.entriesBySource.delete(id)
    this.statusBySource.delete(id)
  }

  statusOf(id: string): RetroSourceStatus | null {
    return this.statusBySource.get(id) ?? null
  }

  /** Builds the catalog view for GET /api/retro/catalog. */
  catalog(s: Settings, query: { q?: string; console?: string } = {}) {
    const sources = s.retro?.sources ?? []
    const homebrewEnabled = s.retro?.homebrew === true

    const combined: RetroGameEntry[] = []
    const seenIds = new Set<string>()
    for (const src of sources) {
      for (const entry of this.entriesBySource.get(src.id) ?? []) {
        if (seenIds.has(entry.id)) continue
        seenIds.add(entry.id)
        combined.push(entry)
      }
    }
    if (homebrewEnabled) {
      for (const hb of HOMEBREW_CATALOG) {
        if (seenIds.has(hb.id)) continue
        seenIds.add(hb.id)
        combined.push(hb)
      }
    }

    const q = (query.q ?? '').trim().toLowerCase()
    const matchedByQuery = q
      ? combined.filter((item) =>
          item.title.toLowerCase().includes(q) ||
          item.console.toLowerCase().includes(q) ||
          item.consoleLabel.toLowerCase().includes(q) ||
          (item.summary?.toLowerCase().includes(q) ?? false),
        )
      : combined

    const consoleCounts = new Map<string, { slug: string; label: string; count: number }>()
    for (const item of matchedByQuery) {
      const cur = consoleCounts.get(item.console)
      if (cur) cur.count++
      else consoleCounts.set(item.console, { slug: item.console, label: item.consoleLabel, count: 1 })
    }
    const consoles = [...consoleCounts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

    const wantConsole = query.console ? (normalizeConsoleSlug(query.console) ?? query.console.trim().toLowerCase()) : ''
    const items = wantConsole ? matchedByQuery.filter((i) => i.console === wantConsole) : matchedByQuery

    return {
      romsWritable: isRomsWritable(s),
      homebrewEnabled,
      showcase: SHOWCASE_GAMES,
      items,
      consoles,
      sourcesCount: sources.length,
    }
  }

  /** Lists active + recent 25 download jobs (newest first). */
  downloads(): RetroDownloadJob[] {
    return this.jobs.slice(0, MAX_JOBS_RETAINED)
  }

  /** Starts an async streaming ROM download into <romsDir>/<console>/<fileName>. */
  startDownload(
    s: Settings,
    input: { title?: unknown; console?: unknown; fileName?: unknown; url?: unknown },
  ): RetroDownloadJob {
    const rawUrl = allowedRetroUrl(input.url)
    if (!rawUrl) {
      throw new ApiError(400, 'Download URL must be https:// (or http:// on your local network).')
    }
    const rawConsole = typeof input.console === 'string' ? input.console.trim().toLowerCase() : ''
    const consoleSlug = normalizeConsoleSlug(rawConsole) ?? rawConsole
    if (!SAFE_CONSOLE_SLUG.test(consoleSlug)) {
      throw new ApiError(400, 'Invalid console slug.')
    }
    const fileName = sanitizeFileName(input.fileName)
    if (!fileName) {
      throw new ApiError(400, 'Invalid file name.')
    }
    const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 180) : baseGameTitle(fileName)

    const destRoot = romsRoot(s)
    if (!destRoot || !isRomsWritable(s)) {
      throw new ApiError(409, 'ROMs folder is not configured or not writable on this server.')
    }

    const job: RetroDownloadJob = {
      id: randomUUID().slice(0, 12),
      title,
      console: consoleSlug,
      fileName,
      state: 'downloading',
      progress: 0,
      receivedBytes: 0,
      totalBytes: 0,
      createdAt: new Date().toISOString(),
    }

    this.jobs.unshift(job)
    // Trim finished jobs beyond retention cap while keeping active downloads
    if (this.jobs.length > MAX_JOBS_RETAINED * 2) {
      const active = this.jobs.filter((j) => j.state === 'downloading')
      const done = this.jobs.filter((j) => j.state !== 'downloading').slice(0, MAX_JOBS_RETAINED)
      this.jobs.length = 0
      this.jobs.push(...active, ...done)
    }

    void this.runDownload(s, destRoot, job, rawUrl)
    return job
  }

  private async runDownload(s: Settings, destRoot: string, job: RetroDownloadJob, url: string) {
    const consoleDir = join(destRoot, job.console)
    const finalPath = join(consoleDir, job.fileName)
    const partPath = join(consoleDir, `.${job.fileName}.${job.id}.part`)

    try {
      mkdirSync(consoleDir, { recursive: true })
      if (!insideRoot(destRoot, finalPath)) {
        throw new Error('Target path escapes the ROMs folder.')
      }

      const doFetch = this.getFetch()
      const res = await doFetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30 * 60_000),
      })
      if (!res.ok) {
        throw new Error(`Upstream returned HTTP ${res.status}`)
      }
      if (res.url && !allowedRetroUrl(res.url)) {
        throw new Error('Redirected to an unsafe download URL.')
      }
      if (!res.body) {
        throw new Error('Empty response body.')
      }

      const contentLength = Number(res.headers.get('content-length') ?? 0)
      if (Number.isFinite(contentLength) && contentLength > 0) {
        if (contentLength > MAX_DOWNLOAD_BYTES) {
          throw new Error('ROM file exceeds the 16 GB safety limit.')
        }
        job.totalBytes = Math.round(contentLength)
      }

      const ws = createWriteStream(partPath)
      const wsError = new Promise<never>((_, reject) => ws.once('error', reject))
      try {
        for await (const chunk of res.body) {
          const buf = Buffer.from(chunk)
          job.receivedBytes += buf.length
          if (job.receivedBytes > MAX_DOWNLOAD_BYTES) {
            throw new Error('ROM file exceeds the 16 GB safety limit.')
          }
          if (job.totalBytes > 0) {
            job.progress = Math.min(99, Math.round((job.receivedBytes / job.totalBytes) * 100))
          }
          if (!ws.write(buf)) {
            await Promise.race([once(ws, 'drain'), wsError])
          }
        }
        ws.end()
        await Promise.race([once(ws, 'finish'), wsError])
      } catch (e) {
        ws.destroy()
        throw e
      }

      renameSync(partPath, finalPath)
      bestEffortOwn(s, finalPath, consoleDir)
      job.totalBytes = job.totalBytes || job.receivedBytes
      job.progress = 100
      job.state = 'ready'
      log.info(`downloaded retro ROM: ${job.console}/${job.fileName} (${job.receivedBytes} bytes)`)

      void triggerRommScan(s, { fetch: doFetch, console: job.console }).catch(() => {})
    } catch (e) {
      rmSync(partPath, { force: true })
      job.state = 'failed'
      job.error = e instanceof Error ? e.message : 'Download failed'
      log.warn(`retro download failed (${job.console}/${job.fileName}): ${job.error}`)
    }
  }
}

export function cleanRetroSourceConfig(v: unknown, takenIds: string[] = []): RetroSourceConfig {
  const o = (v ?? {}) as Record<string, unknown>
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : ''
  if (!name) throw new ApiError(400, 'Give the source a name.')
  const url = allowedRetroUrl(o.url)
  if (!url) throw new ApiError(400, 'Source URL must start with https:// (or http:// on your local network).')

  let consoleSlug: string | undefined
  if (typeof o.console === 'string' && o.console.trim()) {
    const norm = normalizeConsoleSlug(o.console) ?? o.console.trim().toLowerCase()
    if (!SAFE_CONSOLE_SLUG.test(norm)) throw new ApiError(400, 'Invalid console slug.')
    consoleSlug = norm
  }

  let baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'source'
  let id = baseId
  let n = 2
  while (takenIds.includes(id)) {
    id = `${baseId}-${n++}`
  }

  return { id, name, url, ...(consoleSlug ? { console: consoleSlug } : {}) }
}
