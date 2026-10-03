import { getSession, mediaBrowserAuthHeader } from './client'
import { CONTENT_BASE } from '../lib/contentOrigin'
import { knownFinesse } from '../lib/finesseServer'

// Games: browse the RomM library and play the retro titles via EmulatorJS.
// Everything goes through Finesse's own nginx (/finesse/games/api → RomM, with
// the RomM credentials injected server-side and gated by the caller's Jellyfin
// token) so it works remotely under the same origin — no RomM login, no CORS.

function gamesBase(): string {
  return `${CONTENT_BASE}games/api`
}

export interface RommPlatform {
  id: number
  slug: string
  fs_slug?: string
  name: string
  rom_count: number
}

export interface RommRom {
  id: number
  name: string
  fs_name: string
  fs_name_no_tags?: string
  platform_id: number
  platform_slug: string
  platform_display_name: string
  path_cover_small?: string
  path_cover_large?: string
  url_cover?: string
  is_unidentified?: boolean
  is_main_sibling?: boolean
  summary?: string
  ra_id?: number | null
  siblings?: { id: number; name: string; fs_name?: string }[]
  /** RomM's merged metadata (any field may be empty). */
  metadatum?: { genres?: string[]; companies?: string[]; first_release_date?: number | null; average_rating?: number | null; player_count?: string | null }
  regions?: string[]
  merged_screenshots?: string[]
  /** RomM couldn't find the file at its last scan. */
  missing_from_fs?: boolean
}

/** Save states, battery files, and other sidecar blobs — not playable ROMs. */
const JUNK_FS = /\.(bsv|state\d*|srm|sav|eep|ips|bps|rtcsav|autosave)$/i

const ROM_FORMAT_SCORE: Record<string, number> = {
  z64: 100, n64: 100, v64: 95, smc: 100, sfc: 100, nes: 100, fds: 95,
  gbc: 90, gba: 90, gb: 90, md: 90, gen: 90, bin: 80, iso: 80, chd: 80,
  cue: 75, pbp: 70, cia: 70, nsp: 65, xci: 65, '7z': 50, zip: 40, rar: 30,
}

function romFileScore(rom: RommRom): number {
  if (JUNK_FS.test(rom.fs_name)) return -1000
  const ext = rom.fs_name.split('.').pop()?.toLowerCase() ?? ''
  let score = ROM_FORMAT_SCORE[ext] ?? 10
  if (rom.is_main_sibling) score += 200
  return score
}

/** One card per game: drop sidecars and pick the best format among siblings. */
export function dedupeRoms(roms: RommRom[]): RommRom[] {
  const groups = new Map<string, RommRom[]>()
  for (const rom of roms) {
    if (JUNK_FS.test(rom.fs_name)) continue
    const title = (rom.fs_name_no_tags || rom.name).trim().toLowerCase()
    const key = `${rom.platform_id}:${title}`
    const bucket = groups.get(key) ?? []
    bucket.push(rom)
    groups.set(key, bucket)
  }
  const out: RommRom[] = []
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => romFileScore(b) - romFileScore(a))
    out.push(bucket[0]!)
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return out
}

async function gget<T>(path: string): Promise<T> {
  const res = await fetch(`${gamesBase()}${path}`, {
    headers: { Authorization: mediaBrowserAuthHeader() },
  })
  if (!res.ok) throw new Error(`RomM responded ${res.status}`)
  return res.json() as Promise<T>
}

export async function getPlatforms(): Promise<RommPlatform[]> {
  const list = await gget<RommPlatform[]>('/platforms')
  return list.filter((p) => p.rom_count > 0).sort((a, b) => b.rom_count - a.rom_count)
}

export interface RomsPage {
  items: RommRom[]
  total: number
}

export async function getRoms(
  opts: { platformId?: number; search?: string; limit?: number; offset?: number } = {},
): Promise<RomsPage> {
  const q = new URLSearchParams()
  q.set('limit', String(opts.limit ?? 72))
  q.set('offset', String(opts.offset ?? 0))
  q.set('order_by', 'name')
  q.set('order_dir', 'asc')
  // RomM 4.1+ filters by platform_ids (it ignores platform_id, which older RomM used): send both.
  if (opts.platformId) {
    q.set('platform_ids', String(opts.platformId))
    q.set('platform_id', String(opts.platformId))
  }
  if (opts.search) q.set('search_term', opts.search)
  const d = await gget<RomsPage | RommRom[]>(`/roms?${q.toString()}`)
  const page = Array.isArray(d) ? { items: d, total: d.length } : d
  // And never show another console's games under a console, whatever RomM sent.
  const items = dedupeRoms(opts.platformId ? page.items.filter((r) => r.platform_id === opts.platformId) : page.items)
  return { items, total: items.length }
}

export async function getRom(id: string | number): Promise<RommRom> {
  return gget<RommRom>(`/roms/${id}`)
}

// ---- media + play helpers ----

const sgdbCoverCache = new Map<string, string | null>()
const sgdbInflight = new Map<string, Promise<string | null>>()

// A whole grid of cards would otherwise fire hundreds of SGDB requests at once
// (rate-limit + jank). Cap concurrency; requests queue and drain a few at a time.
let sgdbActive = 0
const sgdbQueue: (() => void)[] = []
const SGDB_MAX = 5
function sgdbSlot(): Promise<void> {
  if (sgdbActive < SGDB_MAX) {
    sgdbActive++
    return Promise.resolve()
  }
  return new Promise<void>((res) => sgdbQueue.push(() => res())).then(() => {
    sgdbActive++
  })
}
function sgdbRelease(): void {
  sgdbActive--
  sgdbQueue.shift()?.()
}

/** SteamGridDB fallback when RomM has no cover (library is mostly unidentified).
 *  Cached, in-flight-deduped, and concurrency-capped. */
export async function fetchSgdbCover(displayName: string): Promise<string | null> {
  const key = displayName.toLowerCase().trim()
  if (sgdbCoverCache.has(key)) return sgdbCoverCache.get(key) ?? null
  const existing = sgdbInflight.get(key)
  if (existing) return existing
  const run = sgdbFetchCover(key)
  sgdbInflight.set(key, run)
  return run
}

// The server says SteamGridDB isn't set up (no key): stop asking for every game.
let sgdbOff = false

async function sgdbFetchCover(key: string): Promise<string | null> {
  // The server says whether SteamGridDB has a key (older servers don't say: ask).
  if (sgdbOff || knownFinesse()?.features.sgdb === false) return null
  await sgdbSlot()
  try {
    if (sgdbOff) return null
    const q = encodeURIComponent(key)
    const searchRes = await fetch(`${CONTENT_BASE}games/sgdb/search/autocomplete/${q}`, {
      headers: { Authorization: mediaBrowserAuthHeader() },
    })
    if (searchRes.status === 503) {
      sgdbOff = true
      sgdbCoverCache.set(key, null)
      return null
    }
    if (!searchRes.ok) throw new Error(`sgdb search ${searchRes.status}`)
    const searchJson = (await searchRes.json()) as { data?: { id: number }[] }
    const gameId = searchJson.data?.[0]?.id
    if (!gameId) {
      sgdbCoverCache.set(key, null)
      return null
    }
    const gridRes = await fetch(`${CONTENT_BASE}games/sgdb/grids/game/${gameId}`, {
      headers: { Authorization: mediaBrowserAuthHeader() },
    })
    if (!gridRes.ok) throw new Error(`sgdb grids ${gridRes.status}`)
    const gridJson = (await gridRes.json()) as { data?: { thumb?: string; url?: string }[] }
    const url = gridJson.data?.[0]?.thumb ?? gridJson.data?.[0]?.url ?? null
    sgdbCoverCache.set(key, url)
    return url
  } catch {
    sgdbCoverCache.set(key, null)
    return null
  } finally {
    sgdbRelease()
    sgdbInflight.delete(key)
  }
}

// Images can't send our sign-in header, so RomM's covers ride on the games cookie.
// It was only set when a game started, so covers on the Games page failed (401).
let primedFor = ''
function primeCovers() {
  const token = getSession()?.token
  if (token && token !== primedFor) {
    primedFor = token
    primeGamesAuth()
  }
}

/** Cover-art URL (proxied through /finesse/games/assets), or null if none. */
export function rommCoverUrl(rom: RommRom): string | null {
  // RomM's own small copy first: it's on the server already and sized for a
  // tile. The original (IGDB etc.) is a full-size download from the internet.
  const p = rom.path_cover_small || rom.path_cover_large
  if (p) {
    primeCovers()
    const norm = p.replace(/^\/+/, '')
    // RomM returns "assets/roms/…"; nginx proxies /games/assets/ → RomM /assets/.
    if (norm.startsWith('assets/')) return `${CONTENT_BASE}games/${norm}`
    return `${CONTENT_BASE}games/assets/${norm}`
  }
  if (rom.url_cover && /^https?:/.test(rom.url_cover)) return rom.url_cover.replace(/\/t_(?:original|1080p|720p|screenshot_huge)\//, '/t_cover_big/')
  return null
}

/** Set a path-scoped cookie with the Jellyfin token so EmulatorJS's ROM fetch
 *  (which can't send our auth header) is still gated by nginx. Cookies are sent
 *  automatically on same-origin requests, and — unlike query args — the nginx
 *  auth_request subrequest can read them. Call before loading a game. */
export function primeGamesAuth(): void {
  const token = getSession()?.token
  if (token) {
    document.cookie = `finesse_games_token=${token}; path=${CONTENT_BASE}games; SameSite=Lax`
  }
}

/** ROM file URL for EmulatorJS (auth via the cookie set by primeGamesAuth). */
export function rommContentUrl(rom: RommRom): string {
  return `${gamesBase()}/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}`
}

// RomM platform slug → EmulatorJS system. Mirrors RomM's own player (RomM 5
// slugs), plus the older short names. Consoles that need a real PC emulator
// (Switch, PS2/3, GameCube/Wii(U), Xbox, Dreamcast) are browse-only.
const EJS_CORES: Record<string, string> = {
  nes: 'nes', fds: 'nes', famicom: 'nes', 'game-televisison': 'nes', 'new-style-nes': 'nes',
  snes: 'snes', sfc: 'snes', sfam: 'snes', 'super-nintendo-entertainment-system': 'snes',
  'super-nintendo-original-european-version': 'snes', 'super-famicom-shvc-001': 'snes',
  'super-famicom-jr-model-shvc-101': 'snes', 'new-style-super-nes-model-sns-101': 'snes',
  gb: 'gb', gbc: 'gb', 'game-boy': 'gb', 'game-boy-color': 'gb', 'game-boy-pocket': 'gb', 'game-boy-light': 'gb',
  gba: 'gba', 'game-boy-advance': 'gba', 'game-boy-adavance-sp': 'gba', 'game-boy-micro': 'gba',
  n64: 'n64', 'nintendo-64': 'n64', 'ique-player': 'n64',
  nds: 'nds', 'nintendo-ds-lite': 'nds', 'nintendo-dsi': 'nds', 'nintendo-dsi-xl': 'nds',
  virtualboy: 'vb', vb: 'vb',
  psx: 'psx', ps1: 'psx', playstation: 'psx',
  psp: 'psp',
  genesis: 'segaMD', megadrive: 'segaMD', 'sega-mega-drive-genesis': 'segaMD', 'genesis-slash-megadrive': 'segaMD',
  'sega-mega-drive-2-slash-genesis': 'segaMD', 'sega-mega-jet': 'segaMD', 'mega-pc': 'segaMD', 'tera-drive': 'segaMD', 'sega-nomad': 'segaMD',
  sms: 'segaMS', mastersystem: 'segaMS', 'sega-master-system': 'segaMS', 'sega-mark-iii': 'segaMS', 'sega-game-box-9': 'segaMS',
  'sega-master-system-ii': 'segaMS', 'master-system-super-compact': 'segaMS', 'master-system-girl': 'segaMS',
  gamegear: 'segaGG', gg: 'segaGG',
  segacd: 'segaCD', sega32: 'sega32x', sega32x: 'sega32x', saturn: 'segaSaturn',
  atari2600: 'atari2600', 'atari-2600-plus': 'atari2600', atari5200: 'atari5200', atari7800: 'atari7800',
  lynx: 'lynx', 'atari-lynx-mkii': 'lynx', jaguar: 'jaguar',
  wonderswan: 'ws', 'wonderswan-color': 'ws', swancrystal: 'ws', ws: 'ws', wsc: 'ws',
  'neo-geo-pocket': 'ngp', 'neo-geo-pocket-color': 'ngp', ngp: 'ngp', ngpc: 'ngp',
  tg16: 'pce', 'turbografx-cd': 'pce', supergrafx: 'pce', pce: 'pce', 'pc-engine': 'pce', turbografx16: 'pce',
  'pc-fx': 'pcfx',
  colecovision: 'coleco', coleco: 'coleco',
  arcade: 'arcade', neogeoaes: 'arcade', neogeomvs: 'arcade', neogeo: 'arcade', mame: 'mame2003',
  '3do': '3do',
  amiga: 'amiga', 'amiga-cd32': 'amiga',
  c64: 'c64', 'commodore-64c': 'c64', c128: 'c128', 'commmodore-128': 'c128', cpet: 'pet', 'c-plus-4': 'plus4', 'vic-20': 'vic20',
  dos: 'dos',
  // Beta: only in EmulatorJS's preview build (see BETA).
  '3ds': '3ds', 'new-nintendo-3ds': '3ds',
  intellivision: 'intv',
}

/** Systems only EmulatorJS's preview ("nightly") build has. They load from its
 *  CDN, not RomM's copy, and the app calls them Beta. */
const BETA = new Set(['3ds', 'intv'])
export const isBeta = (core: string) => BETA.has(core)
export const EJS_NIGHTLY = 'https://cdn.emulatorjs.org/nightly/data/'

/** Systems whose emulators need threads (PSP, DOS, 3DS): only on a cross-origin isolated page,
 *  which the TV app (and Safari) can't give them. */
const THREADED = new Set(['psp', 'dos', '3ds'])
export const needsThreads = (core: string) => THREADED.has(core)

export function ejsCore(slug: string | undefined): string | null {
  const core = slug ? EJS_CORES[slug.toLowerCase()] ?? null : null
  if (core && __WEBOS__ && needsThreads(core)) return null
  return core
}

export function isPlayable(rom: RommRom): boolean {
  return !!ejsCore(rom.platform_slug)
}

// The BIOS file each system looks for, best first. A platform's firmware in
// RomM is matched against these; anything else falls back to the first file.
const BIOS_NAMES: Record<string, string[]> = {
  psx: ['scph5501.bin', 'scph5500.bin', 'scph5502.bin', 'scph1001.bin', 'scph7001.bin', 'scph101.bin', 'psxonpsp660.bin'],
  segaCD: ['bios_cd_u.bin', 'bios_cd_e.bin', 'bios_cd_j.bin'],
  segaSaturn: ['saturn_bios.bin', 'sega_101.bin', 'mpr-17933.bin'],
  '3do': ['panafz10.bin', 'panafz1.bin', 'panafz10-norsa.bin', 'goldstar.bin'],
  lynx: ['lynxboot.img'],
  gba: ['gba_bios.bin'],
  nes: ['disksys.rom'],
  pce: ['syscard3.pce', 'syscard2.pce', 'syscard1.pce'],
  atari5200: ['5200.rom'],
  atari7800: ['7800 bios (u).rom', '7800 bios (e).rom'],
  coleco: ['colecovision.rom', 'coleco.rom'],
  arcade: ['neogeo.zip'],
  amiga: ['kick34005.a500', 'kick40068.a1200', 'kick40063.a600'],
  pcfx: ['pcfx.rom'],
}

// Systems that need several BIOS files at once: a zip of them, which the
// emulator unpacks (the DS: bios7, bios9, firmware; Intellivision: exec, grom).
const BIOS_ZIP = new Set(['nds', 'intv'])

export interface RommFirmware {
  id: number
  file_name: string
  is_verified?: boolean
}

/** The firmware to hand the emulator for this game's console, if RomM has any. */
export async function biosUrl(rom: RommRom, core: string): Promise<string | null> {
  let files: RommFirmware[] = []
  try {
    files = (await gget<{ firmware?: RommFirmware[] }>(`/platforms/${rom.platform_id}`)).firmware ?? []
  } catch {
    return null
  }
  if (!files.length) return null
  const want = BIOS_NAMES[core] ?? []
  const byName = (n: string) => files.find((f) => f.file_name.toLowerCase() === n)
  const pick =
    want.map(byName).find(Boolean) ??
    (BIOS_ZIP.has(core) ? files.find((f) => /\.zip$/i.test(f.file_name)) : undefined) ??
    files.find((f) => f.is_verified) ??
    files[0]!
  return `${gamesBase()}/firmware/${pick.id}/content/${encodeURIComponent(pick.file_name)}`
}

// ---- display helpers (shared by the grid + detail page) ----

/** Trim the file extension + redump/region noise for a clean display title. */
export function cleanName(name: string): string {
  return name
    .replace(/\.(7z|zip|rar|z64|n64|nes|smc|sfc|gb[ac]?|gba|iso|nsp|nsz|xci|nds|md|bin|cue|chd|pce)$/i, '')
    .replace(/\[[^\]]*\]/g, '') // [NSP], [!], [FitGirl Repack]
    .replace(/\([^)]*\)/g, (m) => (/disc/i.test(m) ? m : '')) // drop (USA)/(Rev 1)/(En,Fr) — keep (Disc N)
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Brand-ish colors per console so the (mostly art-less) grid reads as designed,
// not empty. Two-stop gradient keyed off the platform; unknown → hashed hue.
const PLATFORM_COLORS: Record<string, [string, string]> = {
  nes: ['#c9243f', '#7a0d1c'], famicom: ['#c9243f', '#7a0d1c'],
  snes: ['#8b5cf6', '#4c1d95'], sfc: ['#8b5cf6', '#4c1d95'],
  n64: ['#2f7d32', '#123f14'],
  gb: ['#8bac0f', '#38560a'], gbc: ['#a855f7', '#6b21a8'], gba: ['#4f46e5', '#312e81'],
  nds: ['#e11d48', '#881337'],
  psx: ['#334155', '#0f172a'], ps1: ['#334155', '#0f172a'], ps2: ['#1d4ed8', '#0b1e57'],
  ps3: ['#111827', '#000000'],
  genesis: ['#1e6fd9', '#0b3a7a'], megadrive: ['#1e6fd9', '#0b3a7a'], 'genesis-slash-megadrive': ['#1e6fd9', '#0b3a7a'],
  mastersystem: ['#2563eb', '#0b3a7a'], gamegear: ['#0891b2', '#0e3a45'],
  switch: ['#e60012', '#7a000a'], wiiu: ['#0ea5e9', '#075985'], wii: ['#38bdf8', '#0c4a6e'],
  gamecube: ['#6d5ae6', '#33257a'], gc: ['#6d5ae6', '#33257a'],
  psp: ['#0f172a', '#020617'], ps4: ['#1d4ed8', '#0b1e57'],
  arcade: ['#f59e0b', '#7c4a02'], mame: ['#f59e0b', '#7c4a02'], neogeo: ['#dc2626', '#7f1d1d'],
  pce: ['#ea580c', '#7c2d12'], c64: ['#4b5563', '#1f2937'],
}

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

export function tileGradient(rom: RommRom): string {
  const c = PLATFORM_COLORS[rom.platform_slug?.toLowerCase()]
  if (c) return `linear-gradient(150deg, ${c[0]}, ${c[1]})`
  const hue = hashHue(rom.platform_slug || rom.name)
  return `linear-gradient(150deg, hsl(${hue} 55% 42%), hsl(${hue} 60% 20%))`
}
