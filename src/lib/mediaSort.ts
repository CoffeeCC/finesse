// Where dropped files belong: Movies, TV shows, Music or Games, and the folder inside each that
// Jellyfin and RomM understand. Plain rules, overridable per file on the Add media page.

export type Kind = 'movies' | 'tv' | 'music' | 'games' | 'skip'

export interface Dropped {
  file: File
  /** Path as dropped, with the folders that came with it ("Breaking Bad/Season 1/e01.mkv"). */
  rel: string
}

export interface Planned {
  key: string
  file: File
  kind: Kind
  /** Destination inside its library ("Big Buck Bunny (2008)/Big Buck Bunny.mkv"; games: "snes/Game.sfc"). */
  path: string
  /** Games only: which console folder (empty when it couldn't tell). */
  system?: string
  /** Why it was skipped, or a nudge ("Pick the console"). */
  note?: string
  /** Files that follow a video (subtitles, posters): they move with it when it changes library. */
  follows?: string
}

const VIDEO = new Set(['mkv', 'mp4', 'm4v', 'avi', 'mov', 'wmv', 'ts', 'm2ts', 'mts', 'webm', 'mpg', 'mpeg', 'flv', 'vob', 'ogv', '3gp'])
const AUDIO = new Set(['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'wma', 'alac', 'aiff', 'aif', 'ape', 'dsf', 'dff', 'wv', 'mka'])
const SIDECAR = new Set(['srt', 'ass', 'ssa', 'vtt', 'sub', 'idx', 'sup', 'nfo', 'jpg', 'jpeg', 'png', 'webp', 'lrc', 'cue'])

/** Console folders (as Finesse's Games library names them) by file extension. */
export const ROM_SYSTEMS: Record<string, string> = {
  nes: 'nes', fds: 'fds', sfc: 'snes', smc: 'snes', gb: 'gb', gbc: 'gbc', gba: 'gba', n64: 'n64', z64: 'n64', v64: 'n64',
  nds: 'nds', '3ds': '3ds', md: 'genesis', gen: 'genesis', smd: 'genesis', '32x': 'sega32x', sms: 'sms', gg: 'gamegear',
  pce: 'tg16', a26: 'atari2600', a78: 'atari7800', lnx: 'lynx', ws: 'wonderswan', wsc: 'wonderswancolor', ngp: 'ngp',
  ngc: 'ngpc', vb: 'virtualboy', cso: 'psp', pbp: 'psx', nsp: 'switch', xci: 'switch', wbfs: 'wii', rvz: 'gamecube', gcm: 'gamecube',
}
/** Game files that could belong to several consoles: kept as games, the console is asked. */
const ROM_AMBIGUOUS = new Set(['iso', 'chd', 'bin', 'zip', '7z', 'cue', 'img'])
/** The consoles offered when Finesse can't tell. */
export const SYSTEM_CHOICES: [string, string][] = [
  ['nes', 'NES'], ['snes', 'Super Nintendo'], ['n64', 'Nintendo 64'], ['gb', 'Game Boy'], ['gbc', 'Game Boy Color'], ['gba', 'Game Boy Advance'],
  ['nds', 'Nintendo DS'], ['gamecube', 'GameCube'], ['wii', 'Wii'], ['genesis', 'Sega Genesis'], ['sms', 'Master System'], ['gamegear', 'Game Gear'],
  ['saturn', 'Sega Saturn'], ['dc', 'Dreamcast'], ['psx', 'PlayStation'], ['ps2', 'PlayStation 2'], ['psp', 'PSP'], ['tg16', 'TurboGrafx-16'],
  ['arcade', 'Arcade'], ['dos', 'DOS'],
]

const ext = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '')
const stem = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name)
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

const EPISODE = /\b[Ss](\d{1,2})[ ._-]?[Ee](\d{1,3})\b|\b(\d{1,2})x(\d{2,3})\b/
const SEASON_DIR = /^(season|series|staffel|saison|temporada)[ ._-]*(\d{1,2})$|^s(\d{1,2})$|^specials$/i
const YEAR = /[([ ._-]((?:19|20)\d{2})[)\] ._-]/

/** "The.Matrix.1999.1080p.BluRay.x264" → { title: "The Matrix", year: "1999" } */
export function titleOf(name: string): { title: string; year?: string } {
  const s = ` ${stem(name).replace(/[._]+/g, ' ')} `
  const y = YEAR.exec(s)
  let title = (y ? s.slice(0, y.index) : s)
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|hdr|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|hdtv|dvdrip|x264|x265|h\.?264|h\.?265|hevc|remux|proper|repack|extended|unrated)\b.*$/i, '')
    .replace(/[[(].*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title) title = stem(name).trim()
  return { title, year: y?.[1] }
}

/** Plans every dropped file. Folders that came with a drop are kept where they make sense. */
export function plan(items: Dropped[], opts: { games: boolean }): Planned[] {
  const out: Planned[] = []
  // Videos first, so sidecars can follow them.
  const videoAt = new Map<string, Planned[]>() // source folder → planned videos
  const sorted = [...items].sort((a, b) => Number(SIDECAR.has(ext(a.rel))) - Number(SIDECAR.has(ext(b.rel))))
  for (const it of sorted) {
    const rel = it.rel.replace(/\\/g, '/').replace(/^\/+/, '')
    const name = base(rel)
    const e = ext(name)
    const key = `${rel}:${it.file.size}`
    if (name.startsWith('.') || /^(thumbs\.db|desktop\.ini)$/i.test(name)) continue
    if (VIDEO.has(e)) {
      const p = placeVideo(rel, it.file)
      out.push(p)
      const d = dir(rel)
      videoAt.set(d, [...(videoAt.get(d) ?? []), p])
      continue
    }
    if (AUDIO.has(e)) {
      out.push({ key, file: it.file, kind: 'music', path: dir(rel) ? rel : `Added/${name}` })
      continue
    }
    if (SIDECAR.has(e)) {
      // A subtitle or poster goes next to the video it belongs to (same folder, name starting alike).
      const near = videoAt.get(dir(rel)) ?? []
      const owner = near.find((v) => stem(name).toLowerCase().startsWith(stem(base(v.path)).toLowerCase())) ?? (near.length === 1 ? near[0] : undefined)
      if (owner) {
        out.push({ key, file: it.file, kind: owner.kind, path: `${dir(owner.path) ? dir(owner.path) + '/' : ''}${name}`, follows: owner.key })
        continue
      }
      // Album art and lyrics with music.
      const music = out.find((o) => o.kind === 'music' && dir(o.path) === (dir(rel) || 'Added'))
      if (music) {
        out.push({ key, file: it.file, kind: 'music', path: `${dir(music.path)}/${name}` })
        continue
      }
      out.push({ key, file: it.file, kind: 'skip', path: rel, note: 'Not sure where this goes' })
      continue
    }
    if (opts.games && (ROM_SYSTEMS[e] || ROM_AMBIGUOUS.has(e))) {
      const system = ROM_SYSTEMS[e] ?? systemFromFolders(rel) ?? ''
      out.push({ key, file: it.file, kind: 'games', path: `${system || '?'}/${name}`, system, note: system ? undefined : 'Pick the console' })
      continue
    }
    out.push({ key, file: it.file, kind: 'skip', path: rel, note: 'Not a video, song or game' })
  }
  return out
}

/** A folder named after a console ("SNES", "psx") on the way to a game file. */
function systemFromFolders(rel: string): string | undefined {
  const names = rel.toLowerCase().split('/').slice(0, -1)
  for (const n of names.reverse()) {
    const hit = SYSTEM_CHOICES.find(([id, label]) => n === id || n === label.toLowerCase() || n.replace(/[^a-z0-9]/g, '') === label.toLowerCase().replace(/[^a-z0-9]/g, ''))
    if (hit) return hit[0]
    if (n === 'ps1' || n === 'playstation1') return 'psx'
    if (n === 'megadrive' || n === 'mega drive') return 'genesis'
  }
  return undefined
}

function placeVideo(rel: string, file: File): Planned {
  const key = `${rel}:${file.size}`
  const name = base(rel)
  const parts = rel.split('/')
  const folders = parts.slice(0, -1)
  const ep = EPISODE.exec(name)
  const seasonDirAt = folders.findIndex((f) => SEASON_DIR.test(f))
  if (ep || seasonDirAt >= 0) {
    // TV: <Show>/Season N/<file>. The show is the folder above the season folder, or the folder the
    // episodes came in, or the start of the file name.
    const season = Number(ep?.[1] ?? ep?.[3] ?? SEASON_DIR.exec(folders[seasonDirAt] ?? '')?.slice(2).find(Boolean) ?? 1)
    let show = seasonDirAt > 0 ? folders[seasonDirAt - 1]! : seasonDirAt < 0 && folders.length ? folders[folders.length - 1]! : ''
    if (!show || /^(tv|shows?|series|downloads?|videos?)$/i.test(show)) {
      const before = ep ? stem(name).slice(0, ep.index).replace(/[._]+/g, ' ').replace(/[-\s]+$/, '').trim() : ''
      show = titleOf(before ? `${before}.x` : name).title
    }
    const seasonDir = folders[seasonDirAt] && /^specials$/i.test(folders[seasonDirAt]!) ? 'Specials' : `Season ${season}`
    return { key, file, kind: 'tv', path: `${show}/${seasonDir}/${name}` }
  }
  // A movie: in a folder named like one already ("Heat (1995)"), keep it; otherwise give it one.
  const parent = folders[folders.length - 1]
  if (parent && YEAR.test(` ${parent} `)) return { key, file, kind: 'movies', path: `${parent}/${name}` }
  const t = titleOf(name)
  return { key, file, kind: 'movies', path: `${t.year ? `${t.title} (${t.year})` : t.title}/${name}` }
}

/** The path when someone moves a file to another library on the page. */
export function repath(p: Planned, kind: Kind, system?: string): string {
  const name = base(p.path)
  if (kind === 'games') return `${system || p.system || '?'}/${name}`
  if (kind === 'movies') {
    const t = titleOf(name)
    return `${t.year ? `${t.title} (${t.year})` : t.title}/${name}`
  }
  if (kind === 'tv') {
    const ep = EPISODE.exec(name)
    const show = titleOf(ep ? `${stem(name).slice(0, ep.index)}.x` : name).title
    return `${show}/Season ${Number(ep?.[1] ?? ep?.[3] ?? 1)}/${name}`
  }
  if (kind === 'music') return dir(p.path) && p.kind === 'music' ? p.path : `Added/${name}`
  return p.path
}

/** Every file in a drop, folders included (Chrome, Edge, Firefox and Safari all read folders this way). */
export async function readDrop(dt: DataTransfer): Promise<Dropped[]> {
  const entries = [...dt.items].map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null)).filter(Boolean) as FileSystemEntry[]
  if (!entries.length) return [...dt.files].map((file) => ({ file, rel: file.name }))
  const out: Dropped[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push({ file, rel: prefix + entry.name })
      return
    }
    if (!entry.isDirectory) return
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries hands folders over in batches (100 at a time in Chrome) until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
    }
  }
  for (const e of entries) await walk(e, '')
  return out
}

/** Files from a picker (<input webkitdirectory> keeps their folders). */
export function fromInput(files: FileList | null): Dropped[] {
  return [...(files ?? [])].map((file) => ({ file, rel: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }))
}
