import { getSession, mediaBrowserAuthHeader } from './client'
import { CONTENT_BASE } from '../lib/contentOrigin'

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
  platform_id: number
  platform_slug: string
  platform_display_name: string
  path_cover_small?: string
  path_cover_large?: string
  url_cover?: string
  is_unidentified?: boolean
  summary?: string
  ra_id?: number | null
  siblings?: { id: number; name: string; fs_name?: string }[]
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
  if (opts.platformId) q.set('platform_id', String(opts.platformId))
  if (opts.search) q.set('search_term', opts.search)
  const d = await gget<RomsPage | RommRom[]>(`/roms?${q.toString()}`)
  return Array.isArray(d) ? { items: d, total: d.length } : d
}

export async function getRom(id: string | number): Promise<RommRom> {
  return gget<RommRom>(`/roms/${id}`)
}

// ---- media + play helpers ----

/** Cover-art URL (proxied through /finesse/games/assets), or null if none. */
export function rommCoverUrl(rom: RommRom): string | null {
  if (rom.url_cover && /^https?:/.test(rom.url_cover)) return rom.url_cover
  const p = rom.path_cover_small || rom.path_cover_large
  if (!p) return null
  return `${CONTENT_BASE}games/${p.replace(/^\/+/, '')}`
}

/** ROM file URL for EmulatorJS. The Jellyfin token rides in the query string
 *  because EmulatorJS fetches the ROM without our auth headers. */
export function rommContentUrl(rom: RommRom): string {
  const token = getSession()?.token ?? ''
  return `${gamesBase()}/roms/${rom.id}/content/${encodeURIComponent(rom.fs_name)}?token=${encodeURIComponent(token)}`
}

// RomM platform slug → EmulatorJS core. Only these are browser-emulatable; every
// other platform (Switch, PS2/3, GameCube/Wii(U), Xbox, PSP, arcade/Model2, the
// fantasy consoles) is browse-only in v1.
const EJS_CORES: Record<string, string> = {
  nes: 'nes', fds: 'nes', famicom: 'nes',
  snes: 'snes', sfc: 'snes', 'super-nintendo-entertainment-system': 'snes',
  gb: 'gb', gbc: 'gb', 'game-boy': 'gb', 'game-boy-color': 'gb',
  gba: 'gba', 'game-boy-advance': 'gba',
  n64: 'n64', 'nintendo-64': 'n64',
  nds: 'nds',
  psx: 'psx', ps1: 'psx', playstation: 'psx',
  genesis: 'segaMD', megadrive: 'segaMD', 'sega-mega-drive-genesis': 'segaMD', 'genesis-slash-megadrive': 'segaMD',
  sms: 'segaMS', mastersystem: 'segaMS', 'sega-master-system': 'segaMS',
  gamegear: 'segaGG', gg: 'segaGG',
  segacd: 'segaCD', sega32x: 'sega32x', saturn: 'segaSaturn',
  atari2600: 'atari2600', atari5200: 'atari5200', atari7800: 'atari7800',
  lynx: 'lynx', jaguar: 'jaguar', vb: 'vb', virtualboy: 'vb',
  ws: 'ws', wsc: 'ws', ngp: 'ngp', ngpc: 'ngp',
  pce: 'pce', 'pc-engine': 'pce', turbografx16: 'pce', tg16: 'pce',
  colecovision: 'coleco', coleco: 'coleco', c64: 'commodore_c64',
  arcade: 'arcade', mame: 'mame2003', neogeo: 'arcade', '3do': '3do',
}

export function ejsCore(slug: string | undefined): string | null {
  return slug ? EJS_CORES[slug.toLowerCase()] ?? null : null
}

export function isPlayable(rom: RommRom): boolean {
  return !!ejsCore(rom.platform_slug)
}
