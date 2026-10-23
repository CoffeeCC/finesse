// Games without RomM (Windows): Finesse keeps the library itself, straight from the games folder
// (<media>/media/games/roms/<console>/…, bios/<console>/…), and answers the few RomM calls the
// Games pages make (/games/api/platforms, /roms, /roms/:id, their files) in RomM's shapes, so the
// pages and EmulatorJS work unchanged. Box art comes free from libretro's thumbnail server (by the
// No-Intro file name), cached next to Finesse's settings; SteamGridDB still fills gaps in the app.

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, type Stats } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join } from 'node:path'
import { crc32 } from 'node:zlib'
import { ApiError, sendJson } from './http/core.ts'
import { logger } from './log.ts'

const log = logger('games')

/** services.romm.url when the library is Finesse's own (no RomM to proxy to). */
export const BUILTIN_ROMM = 'builtin:'
export const isBuiltinRomm = (url: string | undefined) => url === BUILTIN_ROMM

interface System {
  name: string
  /** libretro-thumbnails' folder for this system (null: no free box art). */
  art: string | null
}

// Folder name (RomM's names, plus the usual short ones) → the console.
const S = (name: string, art: string | null): System => ({ name, art })
const NES = S('Nintendo Entertainment System', 'Nintendo - Nintendo Entertainment System')
const SNES = S('Super Nintendo', 'Nintendo - Super Nintendo Entertainment System')
const GENESIS = S('Sega Genesis / Mega Drive', 'Sega - Mega Drive - Genesis')
const SMS = S('Sega Master System', 'Sega - Master System - Mark III')
const PSX = S('PlayStation', 'Sony - PlayStation')
const PCE = S('TurboGrafx-16 / PC Engine', 'NEC - PC Engine - TurboGrafx 16')
const GC = S('GameCube', 'Nintendo - GameCube')
export const SYSTEMS: Record<string, System> = {
  nes: NES, famicom: NES,
  fds: S('Famicom Disk System', 'Nintendo - Family Computer Disk System'),
  snes: SNES, sfc: SNES,
  n64: S('Nintendo 64', 'Nintendo - Nintendo 64'),
  gb: S('Game Boy', 'Nintendo - Game Boy'),
  gbc: S('Game Boy Color', 'Nintendo - Game Boy Color'),
  gba: S('Game Boy Advance', 'Nintendo - Game Boy Advance'),
  nds: S('Nintendo DS', 'Nintendo - Nintendo DS'),
  '3ds': S('Nintendo 3DS', 'Nintendo - Nintendo 3DS'),
  virtualboy: S('Virtual Boy', 'Nintendo - Virtual Boy'), vb: S('Virtual Boy', 'Nintendo - Virtual Boy'),
  ngc: GC, gamecube: GC, gc: GC,
  wii: S('Wii', 'Nintendo - Wii'),
  wiiu: S('Wii U', 'Nintendo - Wii U'),
  switch: S('Nintendo Switch', null),
  psx: PSX, ps1: PSX, playstation: PSX,
  ps2: S('PlayStation 2', 'Sony - PlayStation 2'),
  ps3: S('PlayStation 3', 'Sony - PlayStation 3'),
  psp: S('PlayStation Portable', 'Sony - PlayStation Portable'),
  genesis: GENESIS, megadrive: GENESIS, 'genesis-slash-megadrive': GENESIS,
  sms: SMS, mastersystem: SMS,
  gamegear: S('Sega Game Gear', 'Sega - Game Gear'), gg: S('Sega Game Gear', 'Sega - Game Gear'),
  segacd: S('Sega CD', 'Sega - Mega-CD - Sega CD'),
  sega32: S('Sega 32X', 'Sega - 32X'), sega32x: S('Sega 32X', 'Sega - 32X'),
  saturn: S('Sega Saturn', 'Sega - Saturn'),
  dc: S('Dreamcast', 'Sega - Dreamcast'), dreamcast: S('Dreamcast', 'Sega - Dreamcast'),
  atari2600: S('Atari 2600', 'Atari - 2600'),
  atari5200: S('Atari 5200', 'Atari - 5200'),
  atari7800: S('Atari 7800', 'Atari - 7800'),
  lynx: S('Atari Lynx', 'Atari - Lynx'),
  jaguar: S('Atari Jaguar', 'Atari - Jaguar'),
  pce: PCE, tg16: PCE, turbografx16: PCE, 'pc-engine': PCE,
  'pc-fx': S('PC-FX', 'NEC - PC-FX'),
  ngp: S('Neo Geo Pocket', 'SNK - Neo Geo Pocket'), 'neo-geo-pocket': S('Neo Geo Pocket', 'SNK - Neo Geo Pocket'),
  ngpc: S('Neo Geo Pocket Color', 'SNK - Neo Geo Pocket Color'), 'neo-geo-pocket-color': S('Neo Geo Pocket Color', 'SNK - Neo Geo Pocket Color'),
  ws: S('WonderSwan', 'Bandai - WonderSwan'), wonderswan: S('WonderSwan', 'Bandai - WonderSwan'),
  wsc: S('WonderSwan Color', 'Bandai - WonderSwan Color'), 'wonderswan-color': S('WonderSwan Color', 'Bandai - WonderSwan Color'),
  colecovision: S('ColecoVision', 'Coleco - ColecoVision'), coleco: S('ColecoVision', 'Coleco - ColecoVision'),
  intellivision: S('Intellivision', 'Mattel - Intellivision'),
  arcade: S('Arcade', null), mame: S('Arcade (MAME)', null),
  neogeo: S('Neo Geo', 'SNK - Neo Geo'),
  '3do': S('3DO', 'The 3DO Company - 3DO'),
  amiga: S('Amiga', 'Commodore - Amiga'),
  c64: S('Commodore 64', 'Commodore - 64'),
  dos: S('DOS', 'DOS'),
  xbox: S('Xbox', 'Microsoft - Xbox'),
}

/** Not games: saves, states, notes and pictures that sit next to them. */
const NOT_A_GAME = /\.(bsv|state\d*|srm|sav|eep|rtcsav|autosave|txt|nfo|md|pdf|jpe?g|png|gif|webp|xml|dat|db|ini|cfg|log|tmp|part|lnk|url)$/i
const hidden = (name: string) => name.startsWith('.') || name.startsWith('~') || /^(thumbs\.db|desktop\.ini)$/i.test(name)

/** "Super Mario World (USA) [!].sfc" → "Super Mario World". */
export function withoutTags(name: string): string {
  return name.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+/g, ' ').trim() || name
}

const REGIONS: Record<string, string> = { USA: 'USA', U: 'USA', Europe: 'Europe', E: 'Europe', Japan: 'Japan', J: 'Japan', World: 'World', Australia: 'Australia', Korea: 'Korea', Brazil: 'Brazil', France: 'France', Germany: 'Germany', Spain: 'Spain', Italy: 'Italy' }
function regionsOf(name: string): string[] {
  const out = new Set<string>()
  for (const m of name.matchAll(/\(([^)]*)\)/g)) for (const part of m[1]!.split(/,\s*/)) if (REGIONS[part]) out.add(REGIONS[part]!)
  return [...out]
}

/** libretro-thumbnails names files after the game with these characters replaced. */
export const artName = (name: string) => name.replace(/[&*/:`<>?\\|"]/g, '_')

interface Entry {
  id: number
  platform: string
  /** Relative to the platform folder: a file, or a folder holding one game's files. */
  rel: string
  folder: boolean
  /** What's sent for a folder of several files: a zip of them. */
  files: string[]
  size: number
  mtime: number
}

interface Index {
  next: number
  platforms: Record<string, number>
  roms: Record<string, number>
  firmware: Record<string, number>
}

interface Scan {
  at: number
  platforms: { id: number; fs: string; system: System; roms: Entry[]; firmware: { id: number; name: string; size: number }[] }[]
  byId: Map<number, Entry>
  firmwareById: Map<number, { platform: string; name: string }>
}

export interface GameLibraryOptions {
  /** <media>/media/games, or null when Games isn't on here. */
  dir: () => string | null
  /** Where ids and box art are kept. */
  cacheDir: string
  /** Box-art download (tests swap it out). Returns the image, or null when there's none. */
  fetchArt?: (url: string) => Promise<Buffer | null>
  /** How long a scan is reused (ms). */
  freshFor?: number
}

export class GameLibrary {
  private scan_: Scan | null = null
  private index: Index
  private artQueue: Entry[] = []
  private artBusy = 0
  private readonly fetchArt: (url: string) => Promise<Buffer | null>
  private readonly opts: GameLibraryOptions

  constructor(opts: GameLibraryOptions) {
    this.opts = opts
    this.index = this.loadIndex()
    this.fetchArt = opts.fetchArt ?? defaultFetchArt
  }

  private get indexFile() {
    return join(this.opts.cacheDir, 'library.json')
  }

  private loadIndex(): Index {
    try {
      const i = JSON.parse(readFileSync(this.indexFile, 'utf8')) as Index
      if (typeof i.next === 'number' && i.platforms && i.roms && i.firmware) return i
    } catch {
      /* first run */
    }
    return { next: 1, platforms: {}, roms: {}, firmware: {} }
  }

  private saveIndex() {
    mkdirSync(this.opts.cacheDir, { recursive: true })
    const tmp = `${this.indexFile}.tmp`
    writeFileSync(tmp, JSON.stringify(this.index))
    renameSync(tmp, this.indexFile)
  }

  /** Ids stay the same for the same file, so links and the app's lists don't shuffle. */
  private idFor(map: Record<string, number>, key: string): { id: number; isNew: boolean } {
    const have = map[key]
    if (have) return { id: have, isNew: false }
    const id = this.index.next++
    map[key] = id
    return { id, isNew: true }
  }

  /** Forget the last look at the folder (after an upload, say). */
  invalidate() {
    this.scan_ = null
  }

  private scan(): Scan {
    if (this.scan_ && Date.now() - this.scan_.at < (this.opts.freshFor ?? 30000)) return this.scan_
    const dir = this.opts.dir()
    if (!dir) throw new ApiError(503, 'Games isn’t switched on (Settings → Server)')
    const romsDir = join(dir, 'roms')
    const biosDir = join(dir, 'bios')
    let changed = false
    const out: Scan = { at: Date.now(), platforms: [], byId: new Map(), firmwareById: new Map() }
    for (const p of listDirs(romsDir)) {
      const system = SYSTEMS[p.toLowerCase()] ?? { name: p, art: null }
      const pid = this.idFor(this.index.platforms, p.toLowerCase())
      changed ||= pid.isNew
      const roms: Entry[] = []
      for (const e of safeList(join(romsDir, p))) {
        if (hidden(e.name)) continue
        const full = join(romsDir, p, e.name)
        let entry: Omit<Entry, 'id'> | null = null
        if (e.isDirectory()) {
          const files = safeList(full).filter((f) => f.isFile() && !hidden(f.name) && !NOT_A_GAME.test(f.name)).map((f) => f.name)
          if (!files.length) continue
          const stats = files.map((f) => statSafe(join(full, f)))
          entry = { platform: p, rel: e.name, folder: true, files: files.sort(), size: stats.reduce((n, s) => n + (s?.size ?? 0), 0), mtime: Math.max(...stats.map((s) => s?.mtimeMs ?? 0)) }
        } else if (e.isFile() && !NOT_A_GAME.test(e.name)) {
          const st = statSafe(full)
          if (!st) continue
          entry = { platform: p, rel: e.name, folder: false, files: [e.name], size: st.size, mtime: st.mtimeMs }
        }
        if (!entry) continue
        const rid = this.idFor(this.index.roms, `${p.toLowerCase()}/${entry.rel}`)
        changed ||= rid.isNew
        const rom: Entry = { id: rid.id, ...entry }
        roms.push(rom)
        out.byId.set(rom.id, rom)
      }
      const firmware: Scan['platforms'][number]['firmware'] = []
      for (const f of safeList(join(biosDir, p))) {
        if (!f.isFile() || hidden(f.name)) continue
        const fid = this.idFor(this.index.firmware, `${p.toLowerCase()}/${f.name}`)
        changed ||= fid.isNew
        firmware.push({ id: fid.id, name: f.name, size: statSafe(join(biosDir, p, f.name))?.size ?? 0 })
        out.firmwareById.set(fid.id, { platform: p, name: f.name })
      }
      out.platforms.push({ id: pid.id, fs: p, system, roms, firmware })
    }
    if (changed) this.saveIndex()
    this.scan_ = out
    this.queueArt(out)
    return out
  }

  // ---------- RomM's shapes ----------

  private platformJson(p: Scan['platforms'][number]) {
    const slug = p.fs.toLowerCase()
    return {
      id: p.id,
      slug,
      fs_slug: p.fs,
      name: p.system.name,
      display_name: p.system.name,
      rom_count: p.roms.length,
      firmware: p.firmware.map((f) => ({ id: f.id, file_name: f.name, file_size_bytes: f.size, is_verified: false })),
    }
  }

  private romJson(r: Entry, p: Scan['platforms'][number]) {
    const base = r.folder ? r.rel : r.rel.slice(0, r.rel.length - extname(r.rel).length)
    const name = withoutTags(base)
    const cover = existsSync(this.artFile(r.id)) ? `assets/covers/${r.id}.png?v=${Math.round(statSafe(this.artFile(r.id))?.mtimeMs ?? 0)}` : undefined
    return {
      id: r.id,
      name,
      fs_name: this.sentName(r),
      fs_name_no_tags: name,
      fs_extension: extname(this.sentName(r)).slice(1).toLowerCase(),
      fs_size_bytes: r.size,
      platform_id: p.id,
      platform_slug: p.fs.toLowerCase(),
      platform_fs_slug: p.fs,
      platform_display_name: p.system.name,
      path_cover_small: cover,
      path_cover_large: cover,
      is_main_sibling: true,
      siblings: [],
      regions: regionsOf(r.rel),
      metadatum: {},
      missing_from_fs: false,
      multi: r.folder && r.files.length > 1,
      files: r.files.map((f) => ({ file_name: f })),
    }
  }

  /** The name the game is sent under: its file, the folder's only file, or a zip of the folder. */
  private sentName(r: Entry): string {
    if (!r.folder) return r.rel
    if (r.files.length === 1) return r.files[0]!
    return `${r.rel}.zip`
  }

  platforms() {
    return this.scan().platforms.map((p) => this.platformJson(p))
  }

  platform(id: number) {
    const p = this.scan().platforms.find((x) => x.id === id)
    if (!p) throw new ApiError(404, 'No such console')
    return this.platformJson(p)
  }

  roms(q: URLSearchParams) {
    const s = this.scan()
    const want = new Set([...q.getAll('platform_ids'), ...q.getAll('platform_id')].flatMap((v) => v.split(',')).map(Number).filter(Boolean))
    const term = (q.get('search_term') ?? '').trim().toLowerCase()
    let items = s.platforms.filter((p) => !want.size || want.has(p.id)).flatMap((p) => p.roms.map((r) => this.romJson(r, p)))
    if (term) items = items.filter((r) => r.name.toLowerCase().includes(term) || r.fs_name.toLowerCase().includes(term))
    const desc = (q.get('order_dir') ?? 'asc').toLowerCase() === 'desc'
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * (desc ? -1 : 1))
    const total = items.length
    const offset = Math.max(0, Number(q.get('offset')) || 0)
    const limit = Math.min(5000, Math.max(1, Number(q.get('limit')) || 50))
    return { items: items.slice(offset, offset + limit), total, limit, offset }
  }

  private find(id: number) {
    const s = this.scan()
    const r = s.byId.get(id)
    const p = r && s.platforms.find((x) => x.fs === r.platform)
    if (!r || !p) throw new ApiError(404, 'No such game')
    return { r, p }
  }

  rom(id: number) {
    const { r, p } = this.find(id)
    return this.romJson(r, p)
  }

  /** The game's files on disk (for streaming hosts that launch it). */
  romPath(id: number): { path: string; folder: boolean; files: string[] } {
    const { r } = this.find(id)
    const dir = this.opts.dir()!
    return { path: join(dir, 'roms', r.platform, r.rel), folder: r.folder, files: r.files }
  }

  // ---------- Files ----------

  async sendRom(id: number, req: IncomingMessage, res: ServerResponse) {
    const { r } = this.find(id)
    const dir = join(this.opts.dir()!, 'roms', r.platform)
    if (!r.folder) return sendFile(join(dir, r.rel), r.rel, req, res)
    if (r.files.length === 1) return sendFile(join(dir, r.rel, r.files[0]!), r.files[0]!, req, res)
    return sendZip(join(dir, r.rel), r.files, `${r.rel}.zip`, res)
  }

  async sendFirmware(id: number, req: IncomingMessage, res: ServerResponse) {
    const f = this.scan().firmwareById.get(id)
    if (!f) throw new ApiError(404, 'No such BIOS file')
    return sendFile(join(this.opts.dir()!, 'bios', f.platform, f.name), f.name, req, res)
  }

  // ---------- Box art ----------

  private artFile(id: number) {
    return join(this.opts.cacheDir, 'covers', `${id}.png`)
  }

  private missFile(id: number) {
    return join(this.opts.cacheDir, 'covers', `${id}.none`)
  }

  sendCover(id: number, req: IncomingMessage, res: ServerResponse) {
    const file = this.artFile(id)
    if (!existsSync(file)) throw new ApiError(404, 'No box art yet')
    return sendFile(file, `${id}.png`, req, res, { 'cache-control': 'private, max-age=604800' })
  }

  private queueArt(s: Scan) {
    const now = Date.now()
    for (const p of s.platforms) {
      if (!p.system.art) continue
      for (const r of p.roms) {
        if (existsSync(this.artFile(r.id))) continue
        // A miss is tried again after a week (libretro's sets keep growing).
        const miss = statSafe(this.missFile(r.id))
        if (miss && now - miss.mtimeMs < 7 * 864e5) continue
        if (!this.artQueue.some((q) => q.id === r.id)) this.artQueue.push(r)
      }
    }
    this.pumpArt()
  }

  private pumpArt() {
    while (this.artBusy < 2 && this.artQueue.length) {
      const r = this.artQueue.shift()!
      this.artBusy++
      void this.fetchCover(r)
        .catch((e) => log.debug(`box art for ${r.rel}: ${(e as Error).message}`))
        .finally(() => {
          this.artBusy--
          this.pumpArt()
        })
    }
  }

  /** Tries the file's own name, then the title with the usual regions. */
  private async fetchCover(r: Entry) {
    const system = SYSTEMS[r.platform.toLowerCase()]?.art
    if (!system) return
    const base = r.folder ? r.rel : r.rel.slice(0, r.rel.length - extname(r.rel).length)
    const title = withoutTags(base)
    const names = [...new Set([base, `${title} (USA)`, `${title} (World)`, `${title} (Europe)`, `${title} (USA, Europe)`, `${title} (Japan)`])]
    mkdirSync(join(this.opts.cacheDir, 'covers'), { recursive: true })
    for (const n of names) {
      const url = `https://thumbnails.libretro.com/${encodeURIComponent(system)}/Named_Boxarts/${encodeURIComponent(artName(n))}.png`
      const img = await this.fetchArt(url)
      if (img && img.length > 100 && img.subarray(0, 4).equals(PNG)) {
        writeFileSync(this.artFile(r.id), img)
        return
      }
    }
    writeFileSync(this.missFile(r.id), '')
  }

  /** Waits for box-art downloads under way (tests). */
  async artSettled() {
    while (this.artBusy || this.artQueue.length) await new Promise((r) => setTimeout(r, 10))
  }

  // ---------- The /games/api and /games/assets routes ----------

  /** Answers a /games/api/<rest> or /games/assets/<rest> request. Only reads: the library is the folder. */
  async handle(kind: 'api' | 'assets', rest: string, req: IncomingMessage, res: ServerResponse, url: URL) {
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') throw new ApiError(405, 'Change the games folder to change the library')
    const parts = rest.split('/').filter(Boolean)
    if (kind === 'assets') {
      const m = parts[0] === 'covers' && /^(\d+)\.png$/.exec(parts[1] ?? '')
      if (m && parts.length === 2) return this.sendCover(Number(m[1]), req, res)
      throw new ApiError(404, 'Not found')
    }
    const id = Number(parts[1])
    if (parts[0] === 'heartbeat' && parts.length === 1) return sendJson(res, 200, { SYSTEM: { VERSION: 'finesse', SHOW_SETUP_WIZARD: false } })
    if (parts[0] === 'platforms' && parts.length === 1) return sendJson(res, 200, this.platforms())
    if (parts[0] === 'platforms' && parts.length === 2 && id) return sendJson(res, 200, this.platform(id))
    if (parts[0] === 'roms' && parts.length === 1) return sendJson(res, 200, this.roms(url.searchParams))
    if (parts[0] === 'roms' && parts.length === 2 && id) return sendJson(res, 200, this.rom(id))
    if (parts[0] === 'roms' && parts[2] === 'content' && id) return this.sendRom(id, req, res)
    if (parts[0] === 'firmware' && parts[2] === 'content' && id) return this.sendFirmware(id, req, res)
    throw new ApiError(404, 'Not found')
  }
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

async function defaultFetchArt(url: string): Promise<Buffer | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Finesse' } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`libretro answered ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

function safeList(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function listDirs(dir: string): string[] {
  return safeList(dir)
    .filter((e) => e.isDirectory() && !hidden(e.name))
    .map((e) => e.name)
    .sort()
}

function statSafe(file: string): Stats | null {
  try {
    return statSync(file)
  } catch {
    return null
  }
}

const TYPES: Record<string, string> = { '.png': 'image/png', '.zip': 'application/zip', '.json': 'application/json' }

/** A file, with byte ranges (EmulatorJS and download managers ask for parts). */
function sendFile(file: string, name: string, req: IncomingMessage, res: ServerResponse, extra: Record<string, string> = {}) {
  const st = statSafe(file)
  if (!st?.isFile()) throw new ApiError(404, 'That file is gone')
  const headers: Record<string, string | number> = {
    'content-type': TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    etag: `"${createHash('sha1').update(`${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 16)}"`,
    ...extra,
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
  let start = 0
  let end = st.size - 1
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]))
    end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` })
      res.end()
      return
    }
    res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${st.size}` })
  } else {
    res.writeHead(200, { ...headers, 'content-length': st.size })
  }
  if (req.method === 'HEAD' || st.size === 0) {
    res.end()
    return
  }
  return new Promise<void>((resolve) => {
    const s = createReadStream(file, { start, end })
    s.on('error', () => res.destroy())
    res.on('close', () => {
      s.destroy()
      resolve()
    })
    s.pipe(res)
  })
}

// ---------- A folder as a zip, made on the fly (stored, not compressed: games barely shrink) ----------

function dosTime(ms: number): { time: number; date: number } {
  const d = new Date(ms)
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Streams the files as one zip (classic zip: up to 4 GB, which a game in a browser emulator never reaches). */
async function sendZip(dir: string, files: string[], name: string, res: ServerResponse) {
  const stats = files.map((f) => statSafe(join(dir, f)))
  if (stats.some((s) => !s)) throw new ApiError(404, 'A file of this game is gone')
  const total = stats.reduce((n, s) => n + s!.size, 0)
  if (total + files.length * 200 > 0xfffffff0) throw new ApiError(413, 'This game is too big to send as one file')
  const names = files.map((f) => Buffer.from(f, 'utf8'))
  // Sizes are known up front, so the length is too: the CRCs go in data descriptors after each file.
  const length = names.reduce((n, b, i) => n + 30 + b.length + stats[i]!.size + 16 + 46 + b.length, 0) + 22
  res.writeHead(200, {
    'content-type': 'application/zip',
    'content-length': length,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
  })
  const central: Buffer[] = []
  let offset = 0
  const write = (b: Buffer) =>
    new Promise<void>((resolve, reject) => {
      if (res.destroyed) return reject(new Error('closed'))
      res.write(b) ? resolve() : res.once('drain', resolve)
    })
  try {
    for (let i = 0; i < files.length; i++) {
      const st = stats[i]!
      const n = names[i]!
      const { time, date } = dosTime(st.mtimeMs)
      const flags = 0x0808 // data descriptor follows; names are UTF-8
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(flags, 6)
      local.writeUInt16LE(0, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt16LE(n.length, 26)
      await write(Buffer.concat([local, n]))
      let crc = 0
      for await (const chunk of createReadStream(join(dir, files[i]!))) {
        crc = crc32(chunk as Buffer, crc)
        await write(chunk as Buffer)
      }
      const desc = Buffer.alloc(16)
      desc.writeUInt32LE(0x08074b50, 0)
      desc.writeUInt32LE(crc >>> 0, 4)
      desc.writeUInt32LE(st.size, 8)
      desc.writeUInt32LE(st.size, 12)
      await write(desc)
      const c = Buffer.alloc(46)
      c.writeUInt32LE(0x02014b50, 0)
      c.writeUInt16LE(20, 4)
      c.writeUInt16LE(20, 6)
      c.writeUInt16LE(flags, 8)
      c.writeUInt16LE(0, 10)
      c.writeUInt16LE(time, 12)
      c.writeUInt16LE(date, 14)
      c.writeUInt32LE(crc >>> 0, 16)
      c.writeUInt32LE(st.size, 20)
      c.writeUInt32LE(st.size, 24)
      c.writeUInt16LE(n.length, 28)
      c.writeUInt32LE(offset, 42)
      central.push(Buffer.concat([c, n]))
      offset += 30 + n.length + st.size + 16
    }
    const cd = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(files.length, 8)
    end.writeUInt16LE(files.length, 10)
    end.writeUInt32LE(cd.length, 12)
    end.writeUInt32LE(offset, 16)
    await write(Buffer.concat([cd, end]))
    res.end()
  } catch {
    res.destroy()
  }
}

const libraries = new WeakMap<object, GameLibrary>()

/** The one library for this server's settings (the Games pages, uploads and streaming share it). */
export function gameLibrary(settings: import('./config.ts').SettingsStore): GameLibrary {
  let lib = libraries.get(settings)
  if (!lib) {
    lib = new GameLibrary({
      dir: () => {
        const s = settings.get()
        return isBuiltinRomm(s.services.romm?.url) && s.stack ? join(s.stack.hostData, 'media', 'games') : null
      },
      cacheDir: join(settings.paths.configDir, 'games'),
    })
    libraries.set(settings, lib)
  }
  return lib
}
