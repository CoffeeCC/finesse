// What in a console's folder is a game, and what a console is called.
// RomM lists every file and folder it finds in a console's folder as a game, so
// emulator settings (xenia.config.toml), patches (daytona.pat) and an emulator's
// own folders (SYSTEM, TEXTURES) showed up as games. Those are hidden here; real
// games kept in a folder (a PS3 or Wii U game, a multi-disc set) stay.
// RomM names a console folder it doesn't recognise by title-casing it ("gc" →
// "Gc", "n3ds" → "N3Ds"): those get their proper names.
// Pure (no imports), so server/test/game-files.test.ts can test it.

/** Saves, emulator settings, patches, checksums, notes and pictures: never a game. */
const SUPPORT_EXT = new Set([
  // saves and states
  'bsv', 'srm', 'sav', 'eep', 'rtcsav', 'autosave', 'mcr', 'mcd', 'sav0',
  // emulator settings
  'toml', 'ini', 'cfg', 'conf', 'config', 'yml', 'yaml', 'json', 'xml', 'opt', 'rmp',
  // patches and cheats
  'pat', 'ips', 'bps', 'ups', 'xdelta', 'ppf', 'aps', 'cht',
  // checksums, notes, logs
  'sfv', 'md5', 'sha1', 'txt', 'nfo', 'md', 'log', 'url', 'pdf',
  // pictures
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp',
  // texture and shader packs
  'htc', 'dds',
])
const STATE_EXT = /^state\d*$/

/** Folders emulators keep beside games (Xenia, Dolphin, PCSX2, RetroArch…): never a game. */
const SUPPORT_DIRS = new Set([
  'system', 'systems', 'bios', 'firmware', 'textures', 'texture packs', 'shaders', 'shadercache', 'shader cache', 'cache',
  'saves', 'save', 'savestates', 'states', 'memcards', 'memory cards', 'screenshots', 'snaps', 'cheats', 'patches',
  'config', 'configs', 'settings', 'logs', 'mods', 'resource packs', 'load', 'dump', 'dumps', 'nand', 'sdmc', 'gamesettings',
  'images', 'media', 'manuals', 'covers', 'downloaded_images', 'dlc', 'updates', 'update',
])

/** The few fields of a RomM entry this looks at. */
export interface RomFileLike {
  fs_name: string
  /** RomM: the file's extension ("" for a folder, on RomM versions that send it). */
  fs_extension?: string
  /** RomM: a game made of several files (a folder). */
  multi?: boolean
  has_multiple_files?: boolean
}

/** A save, setting, patch or emulator folder that RomM listed as a game. */
export function isSupportFile(rom: RomFileLike): boolean {
  const name = rom.fs_name.trim()
  if (!name || name.startsWith('.')) return true
  const lower = name.toLowerCase()
  const folder = rom.multi === true || rom.has_multiple_files === true || rom.fs_extension === ''
  // An emulator's own folder: by name, whether or not RomM says it's a folder.
  if (SUPPORT_DIRS.has(lower)) return true
  if (folder) return false
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return false
  const ext = lower.slice(dot + 1)
  return SUPPORT_EXT.has(ext) || STATE_EXT.test(ext)
}

/** Console folder names (RomM's and ES-DE's) RomM may not know, with their proper names. */
const CONSOLE_NAMES: Record<string, string> = {
  gc: 'Nintendo GameCube', ngc: 'Nintendo GameCube', gamecube: 'Nintendo GameCube',
  wii: 'Nintendo Wii', wiiu: 'Nintendo Wii U', switch: 'Nintendo Switch',
  n64: 'Nintendo 64', nes: 'Nintendo Entertainment System', famicom: 'Famicom', fds: 'Famicom Disk System',
  snes: 'Super Nintendo', sfc: 'Super Famicom', gb: 'Game Boy', gbc: 'Game Boy Color', gba: 'Game Boy Advance',
  nds: 'Nintendo DS', n3ds: 'Nintendo 3DS', '3ds': 'Nintendo 3DS', virtualboy: 'Virtual Boy',
  psx: 'PlayStation', ps1: 'PlayStation', ps2: 'PlayStation 2', ps3: 'PlayStation 3', ps4: 'PlayStation 4',
  psp: 'PlayStation Portable', psvita: 'PlayStation Vita', vita: 'PlayStation Vita',
  xbox: 'Xbox', xbox360: 'Xbox 360', x360: 'Xbox 360',
  genesis: 'Sega Genesis', megadrive: 'Sega Mega Drive', mastersystem: 'Sega Master System', sms: 'Sega Master System',
  gamegear: 'Sega Game Gear', gg: 'Sega Game Gear', segacd: 'Sega CD', sega32x: 'Sega 32X', saturn: 'Sega Saturn',
  dreamcast: 'Sega Dreamcast', dc: 'Sega Dreamcast',
  pcengine: 'PC Engine', pce: 'PC Engine', tg16: 'TurboGrafx-16', 'tg-cd': 'TurboGrafx-CD',
  neogeo: 'Neo Geo', arcade: 'Arcade', mame: 'Arcade (MAME)', fbneo: 'Arcade (FinalBurn Neo)',
  atari2600: 'Atari 2600', atari5200: 'Atari 5200', atari7800: 'Atari 7800', lynx: 'Atari Lynx', jaguar: 'Atari Jaguar',
  c64: 'Commodore 64', amiga: 'Amiga', dos: 'DOS', msx: 'MSX', '3do': '3DO', intellivision: 'Intellivision', colecovision: 'ColecoVision',
}

/**
 * A console's name to show. RomM's own name is kept, unless it's just the folder name
 * title-cased (a folder RomM didn't recognise): then the proper name, if known.
 */
export function consoleName(name: string | undefined, ...slugs: (string | undefined)[]): string {
  const shown = (name ?? '').trim()
  for (const slug of slugs) {
    const key = slug?.trim().toLowerCase()
    if (!key) continue
    const proper = CONSOLE_NAMES[key]
    if (proper && (!shown || shown.toLowerCase() === key)) return proper
  }
  return shown || slugs.find((s) => s?.trim())?.trim() || 'Games'
}
