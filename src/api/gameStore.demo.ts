// The demo game store: real open source games with rough details, and pretend downloads that
// move through every state on a timer (queued → downloading → checking → installing →
// [needs you] → finishing → ready, or failed). Requests are kept in localStorage so they
// survive a reload. Only for building and testing the UI: nothing is downloaded or installed.

import {
  genreSlug,
  MODE_LABEL,
  PLATFORM_LABEL,
  type Facet,
  type GameMode,
  type GamePlatform,
  type GameRequest,
  type GameStoreApi,
  type InstallerKind,
  type StoreFacets,
  type StoreGame,
  type StoreQuery,
  type StoreSource,
} from './gameStore'

interface DemoGame {
  id: string
  title: string
  developer: string
  year: number
  genres: string[]
  modes: GameMode[]
  summary: string
  license: string
  /** Windows installer kind; omitted = Linux only. */
  win?: InstallerKind
  linux?: boolean
  mb: number
  /** Higher = more popular. */
  pop: number
  /** Days since it arrived in the store. */
  age: number
  /** Demo: the first download fails its checksum. */
  badChecksum?: boolean
}

const G: DemoGame[] = [
  { id: 'supertuxkart', title: 'SuperTuxKart', developer: 'SuperTuxKart Team', year: 2007, genres: ['Racing', 'Arcade'], modes: ['single', 'local', 'online'], summary: 'Kart racing with Tux and friends: tracks, battle arenas and power-ups, alone or with up to eight players.', license: 'GPL-3.0', win: 'inno', linux: true, mb: 680, pop: 98, age: 2 },
  { id: '0ad', title: '0 A.D.', developer: 'Wildfire Games', year: 2010, genres: ['Real-time strategy', 'Historical'], modes: ['single', 'online'], summary: 'A historical real-time strategy game of ancient civilisations: build a city, raise an army and take the map.', license: 'GPL-2.0', win: 'nsis', linux: true, mb: 2100, pop: 95, age: 30 },
  { id: 'openttd', title: 'OpenTTD', developer: 'OpenTTD Team', year: 2004, genres: ['Simulation', 'Strategy'], modes: ['single', 'online'], summary: 'Build a transport empire of trains, ships, buses and planes, and keep a growing world moving.', license: 'GPL-2.0', win: 'msi', linux: true, mb: 60, pop: 92, age: 60 },
  { id: 'wesnoth', title: 'The Battle for Wesnoth', developer: 'Wesnoth Team', year: 2003, genres: ['Turn-based strategy', 'Fantasy'], modes: ['single', 'local', 'online'], summary: 'Turn-based fantasy battles on a hex map, with long campaigns and units that grow with you.', license: 'GPL-2.0', win: 'nsis', linux: true, mb: 520, pop: 90, age: 45 },
  { id: 'xonotic', title: 'Xonotic', developer: 'Team Xonotic', year: 2010, genres: ['Shooter', 'Arena'], modes: ['single', 'online'], summary: 'A fast arena shooter: movement tricks, a dozen weapons and many game types.', license: 'GPL-3.0', win: 'archive', linux: true, mb: 1100, pop: 80, age: 12 },
  { id: 'mindustry', title: 'Mindustry', developer: 'Anuken', year: 2017, genres: ['Tower defense', 'Strategy'], modes: ['single', 'online'], summary: 'Build supply chains of conveyor belts to feed your turrets, and hold off waves of enemies.', license: 'GPL-3.0', win: 'portable', linux: true, mb: 150, pop: 94, age: 4 },
  { id: 'veloren', title: 'Veloren', developer: 'Veloren Team', year: 2018, genres: ['RPG', 'Open world'], modes: ['single', 'online'], summary: 'A voxel role-playing game with a huge world to explore, dungeons and towns, alone or with friends.', license: 'GPL-3.0', win: 'unknown', linux: true, mb: 1800, pop: 88, age: 1 },
  { id: 'hedgewars', title: 'Hedgewars', developer: 'Hedgewars Project', year: 2005, genres: ['Turn-based strategy', 'Party'], modes: ['single', 'local', 'online'], summary: 'Teams of hedgehogs take turns blowing each other up with absurd weapons. Best with friends on one couch.', license: 'GPL-2.0', win: 'nsis', linux: true, mb: 200, pop: 76, age: 90 },
  { id: 'warzone2100', title: 'Warzone 2100', developer: 'Warzone 2100 Project', year: 1999, genres: ['Real-time strategy'], modes: ['single', 'online'], summary: 'Real-time strategy after the collapse: design your own units and take back a ruined world.', license: 'GPL-2.0', win: 'nsis', linux: true, mb: 900, pop: 74, age: 20, badChecksum: true },
  { id: 'teeworlds', title: 'Teeworlds', developer: 'Teeworlds Team', year: 2007, genres: ['Shooter', 'Platformer'], modes: ['online'], summary: 'A cute 2D online shooter with grappling hooks and quick rounds.', license: 'Zlib', win: 'archive', linux: true, mb: 30, pop: 62, age: 120 },
  { id: 'luanti', title: 'Luanti', developer: 'Luanti Team', year: 2010, genres: ['Sandbox', 'Survival'], modes: ['single', 'online'], summary: 'A block-building sandbox (formerly Minetest) with hundreds of games and mods to pick from.', license: 'LGPL-2.1', win: 'archive', linux: true, mb: 70, pop: 86, age: 8 },
  { id: 'freeciv', title: 'Freeciv', developer: 'Freeciv Project', year: 1996, genres: ['Turn-based strategy', '4X'], modes: ['single', 'online'], summary: 'Lead a civilisation from the stone age to the space age, one turn at a time.', license: 'GPL-2.0', win: 'nsis', linux: true, mb: 90, pop: 66, age: 200 },
  { id: 'cdda', title: 'Cataclysm: Dark Days Ahead', developer: 'CleverRaven', year: 2013, genres: ['Roguelike', 'Survival'], modes: ['single'], summary: 'A deep survival roguelike: scavenge, craft and stay alive in a world that ended.', license: 'CC BY-SA 3.0', win: 'archive', linux: true, mb: 400, pop: 72, age: 15 },
  { id: 'openra', title: 'OpenRA', developer: 'OpenRA Team', year: 2010, genres: ['Real-time strategy', 'Classic'], modes: ['single', 'online'], summary: 'The classic Command & Conquer games, rebuilt for today with online play.', license: 'GPL-3.0', win: 'nsis', linux: true, mb: 120, pop: 84, age: 6 },
  { id: 'endless-sky', title: 'Endless Sky', developer: 'Endless Sky Team', year: 2015, genres: ['Space', 'Trading'], modes: ['single'], summary: 'Start with one small ship. Trade, fight and explore your way across the galaxy.', license: 'GPL-3.0', win: 'nsis', linux: true, mb: 450, pop: 78, age: 25 },
  { id: 'shattered-pd', title: 'Shattered Pixel Dungeon', developer: 'Shattered Pixel', year: 2014, genres: ['Roguelike', 'RPG'], modes: ['single'], summary: 'A pixel-art dungeon crawler where every run is different and every death teaches you something.', license: 'GPL-3.0', win: 'portable', linux: true, mb: 90, pop: 82, age: 3 },
  { id: 'supertux', title: 'SuperTux', developer: 'SuperTux Team', year: 2003, genres: ['Platformer', 'Arcade'], modes: ['single'], summary: 'A classic side-scrolling platformer starring Tux, across icy worlds and forests.', license: 'GPL-3.0', win: 'msi', linux: true, mb: 160, pop: 70, age: 40 },
  { id: 'red-eclipse', title: 'Red Eclipse', developer: 'Red Eclipse Team', year: 2011, genres: ['Shooter', 'Arena'], modes: ['single', 'online'], summary: 'An arena shooter with parkour: wall-run, dash and double-jump across the map.', license: 'Zlib', win: 'nsis', linux: true, mb: 1000, pop: 60, age: 70 },
  { id: 'unvanquished', title: 'Unvanquished', developer: 'Unvanquished Development', year: 2012, genres: ['Shooter', 'Strategy'], modes: ['online'], summary: 'Humans against aliens: build a base with your team, then defend it.', license: 'GPL-3.0', win: 'unknown', linux: true, mb: 1300, pop: 50, age: 100 },
  { id: 'assaultcube', title: 'AssaultCube', developer: 'Rabid Viper Productions', year: 2006, genres: ['Shooter'], modes: ['single', 'online'], summary: 'A small, quick team shooter that runs on almost anything.', license: 'Zlib', win: 'nsis', linux: true, mb: 50, pop: 55, age: 150 },
  { id: 'naev', title: 'Naev', developer: 'Naev Team', year: 2006, genres: ['Space', 'RPG'], modes: ['single'], summary: 'A space role-playing game: take missions, follow the story and build your fleet.', license: 'GPL-3.0', win: 'nsis', linux: true, mb: 700, pop: 58, age: 35 },
  { id: 'pioneer', title: 'Pioneer Space Sim', developer: 'Pioneer Developers', year: 2011, genres: ['Space', 'Simulation'], modes: ['single'], summary: 'Fly between real-scale star systems with Newtonian physics. Trade, smuggle or fight.', license: 'GPL-3.0', win: 'nsis', linux: true, mb: 800, pop: 48, age: 80 },
  { id: 'flare', title: 'Flare', developer: 'Flare Team', year: 2010, genres: ['RPG', 'Action'], modes: ['single'], summary: 'A single-player action role-playing game in the old style: loot, skills and dungeons.', license: 'GPL-3.0', win: 'archive', linux: true, mb: 300, pop: 52, age: 110 },
  { id: 'freedoom', title: 'Freedoom', developer: 'Freedoom Project', year: 2003, genres: ['Shooter', 'Classic'], modes: ['single', 'online'], summary: 'A complete free game in the style of Doom, with its own levels, monsters and music.', license: 'BSD-3-Clause', win: 'archive', linux: true, mb: 30, pop: 64, age: 55 },
  { id: 'freeorion', title: 'FreeOrion', developer: 'FreeOrion Project', year: 2003, genres: ['Turn-based strategy', '4X', 'Space'], modes: ['single', 'online'], summary: 'Grand space strategy: explore, expand, exploit and exterminate across a galaxy.', license: 'GPL-2.0', win: 'nsis', linux: true, mb: 350, pop: 56, age: 65 },
  { id: 'widelands', title: 'Widelands', developer: 'Widelands Development Team', year: 2002, genres: ['Strategy', 'City building'], modes: ['single', 'online'], summary: 'A slow, satisfying settlement builder: grow an economy road by road.', license: 'GPL-2.0', win: 'unknown', linux: true, mb: 450, pop: 54, age: 18 },
  { id: 'zero-k', title: 'Zero-K', developer: 'Zero-K Team', year: 2010, genres: ['Real-time strategy'], modes: ['single', 'online'], summary: 'Large-scale robot battles with physics, terrain you can reshape and no upkeep to manage.', license: 'GPL-2.0', win: 'inno', linux: true, mb: 1200, pop: 68, age: 28 },
  { id: 'simutrans', title: 'Simutrans', developer: 'Simutrans Team', year: 1999, genres: ['Simulation', 'Strategy'], modes: ['single', 'online'], summary: 'Move passengers, mail and goods between towns, and watch them grow.', license: 'Artistic-1.0', win: 'nsis', linux: true, mb: 100, pop: 46, age: 140 },
  { id: 'neverball', title: 'Neverball', developer: 'Neverball Team', year: 2003, genres: ['Puzzle', 'Arcade'], modes: ['single'], summary: 'Tilt the floor to roll a ball through obstacle courses before time runs out.', license: 'GPL-2.0', win: 'nsis', linux: true, mb: 90, pop: 50, age: 160 },
  { id: 'frozen-bubble', title: 'Frozen Bubble', developer: 'Frozen Bubble Team', year: 2002, genres: ['Puzzle', 'Arcade', 'Party'], modes: ['single', 'local', 'online'], summary: 'Pop coloured bubbles before they reach the bottom. Simple, then fiendish.', license: 'GPL-2.0', linux: true, mb: 40, pop: 44, age: 170 },
  { id: 'pingus', title: 'Pingus', developer: 'Pingus Team', year: 1998, genres: ['Puzzle'], modes: ['single'], summary: 'Guide a stream of penguins safely to the exit by giving them jobs: dig, block, bridge.', license: 'GPL-3.0', win: 'msi', linux: true, mb: 60, pop: 42, age: 180 },
  { id: 'etr', title: 'Extreme Tux Racer', developer: 'Extreme Tux Racer Team', year: 2007, genres: ['Racing', 'Arcade'], modes: ['single'], summary: 'Slide Tux down snowy mountains, grabbing herring along the way.', license: 'GPL-2.0', win: 'inno', linux: true, mb: 70, pop: 58, age: 50 },
  { id: 'speed-dreams', title: 'Speed Dreams', developer: 'Speed Dreams Team', year: 2010, genres: ['Racing', 'Simulation'], modes: ['single', 'local'], summary: 'A motorsport simulator with many cars and tracks, and racing against AI drivers.', license: 'GPL-2.0', win: 'nsis', linux: true, mb: 1600, pop: 50, age: 75 },
  { id: 'stunt-rally', title: 'Stunt Rally', developer: 'Stunt Rally Team', year: 2010, genres: ['Racing'], modes: ['single', 'local', 'online'], summary: 'Rally racing with loops, jumps and pipes, on more than 200 tracks.', license: 'GPL-3.0', win: 'inno', linux: true, mb: 1900, pop: 66, age: 10 },
  { id: 'armagetron', title: 'Armagetron Advanced', developer: 'Armagetron Team', year: 2001, genres: ['Arcade', 'Party'], modes: ['single', 'local', 'online'], summary: 'Light cycles: turn sharp, box everyone in, and never hit a wall.', license: 'GPL-2.0', win: 'nsis', linux: true, mb: 20, pop: 40, age: 190 },
  { id: '7kaa', title: 'Seven Kingdoms: Ancient Adversaries', developer: 'Enlight / 7kfans', year: 1997, genres: ['Real-time strategy', 'Historical'], modes: ['single', 'online'], summary: 'Real-time strategy with spies, trade and diplomacy between seven kingdoms.', license: 'GPL-2.0', win: 'nsis', mb: 90, pop: 38, age: 130 },
  { id: 'openarena', title: 'OpenArena', developer: 'OpenArena Team', year: 2005, genres: ['Shooter', 'Arena', 'Classic'], modes: ['single', 'online'], summary: 'A classic arena shooter in the late-90s mould.', license: 'GPL-2.0', win: 'archive', linux: true, mb: 450, pop: 46, age: 85 },
  { id: 'chromium-bsu', title: 'Chromium B.S.U.', developer: 'Mark B. Allan', year: 2000, genres: ['Shooter', 'Arcade'], modes: ['single'], summary: 'A fast vertical space shooter: dodge, shoot, and keep your ship alive.', license: 'Artistic', linux: true, mb: 10, pop: 30, age: 210 },
  { id: 'lincity-ng', title: 'LinCity-NG', developer: 'LinCity-NG Team', year: 2005, genres: ['City building', 'Simulation'], modes: ['single'], summary: 'Build a city that lasts: balance industry, people and the environment.', license: 'GPL-2.0', win: 'msi', linux: true, mb: 70, pop: 34, age: 220 },
  { id: 'beyond-all-reason', title: 'Beyond All Reason', developer: 'BAR Team', year: 2021, genres: ['Real-time strategy'], modes: ['single', 'online'], summary: 'Huge real-time battles in the style of Total Annihilation, with thousands of units on the field.', license: 'GPL-2.0', win: 'unknown', linux: true, mb: 4500, pop: 87, age: 5 },
]

const DAY = 86_400_000

function toGame(d: DemoGame): StoreGame {
  return {
    id: d.id,
    title: d.title,
    summary: d.summary,
    description: `${d.summary}\n\n${d.title} is free and open source (${d.license}). This is the demo store: the details here are rough, and requesting it only pretends to download and install.`,
    developer: d.developer,
    year: d.year,
    genres: d.genres,
    modes: d.modes,
    platforms: [...(d.win ? (['windows'] as const) : []), ...(d.linux ? (['linux'] as const) : [])],
    license: d.license,
    addedAt: new Date(Date.now() - d.age * DAY).toISOString(),
  }
}

const GAMES = G.map(toGame)
const BY_ID = new Map(G.map((d) => [d.id, d]))

function sources(d: DemoGame): StoreSource[] {
  const out: StoreSource[] = []
  if (d.win) out.push({ id: `${d.id}-win`, platform: 'windows', installer: d.win, sizeBytes: d.mb * 1e6, version: 'latest', verified: true })
  if (d.linux) out.push({ id: `${d.id}-linux`, platform: 'linux', installer: 'linux', sizeBytes: Math.round(d.mb * 0.9) * 1e6, version: 'latest', verified: true })
  return out
}

// ---------- searching ----------

type Filter = Omit<StoreQuery, 'sort' | 'offset' | 'limit'>

function matches(g: StoreGame, f: Filter): boolean {
  if (f.q?.trim()) {
    const t = f.q.trim().toLowerCase()
    const hay = `${g.title} ${g.developer ?? ''} ${g.genres.join(' ')}`.toLowerCase()
    if (!hay.includes(t)) return false
  }
  if (f.genres?.length && !g.genres.some((x) => f.genres!.includes(genreSlug(x)))) return false
  if (f.platform && !g.platforms.includes(f.platform)) return false
  if (f.mode && !g.modes.includes(f.mode)) return false
  return true
}

function sorted(list: StoreGame[], sort: StoreQuery['sort']): StoreGame[] {
  const pop = (g: StoreGame) => BY_ID.get(g.id)?.pop ?? 0
  const out = [...list]
  if (sort === 'name') out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  else if (sort === 'new') out.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  else if (sort === 'year') out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  else out.sort((a, b) => pop(b) - pop(a))
  return out
}

function search(q: StoreQuery) {
  const all = sorted(GAMES.filter((g) => matches(g, q)), q.sort)
  const offset = q.offset ?? 0
  const limit = q.limit ?? 24
  const items = all.slice(offset, offset + limit)
  return { items, total: all.length, nextOffset: offset + limit < all.length ? offset + limit : undefined }
}

function count<T extends string>(values: T[], label: (v: T) => string, has: (g: StoreGame, v: T) => boolean, base: StoreGame[]): Facet[] {
  return values
    .map((v) => ({ value: v, label: label(v), count: base.filter((g) => has(g, v)).length }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function facets(q: StoreQuery): StoreFacets {
  // Each facet counts with every other filter applied, so picking one never empties the others.
  const without = (k: keyof Filter) => GAMES.filter((g) => matches(g, { ...q, [k]: undefined }))
  const genreNames = [...new Set(GAMES.flatMap((g) => g.genres))]
  const bySlug = new Map(genreNames.map((n) => [genreSlug(n), n]))
  return {
    genres: count([...bySlug.keys()], (s) => bySlug.get(s)!, (g, s) => g.genres.some((x) => genreSlug(x) === s), without('genres')),
    platforms: count<GamePlatform>(['windows', 'linux'], (p) => PLATFORM_LABEL[p], (g, p) => g.platforms.includes(p), without('platform')),
    modes: count<GameMode>(['single', 'local', 'online'], (m) => MODE_LABEL[m], (g, m) => g.modes.includes(m), without('mode')),
  }
}

// ---------- pretend requests ----------

interface DemoRequest {
  id: string
  gameId: string
  sourceId: string
  /** When the current attempt started (ms). */
  startedAt: number
  /** When the person finished the installer screen. */
  installerDoneAt?: number
  /** This attempt fails its checksum. */
  failChecksum?: boolean
  createdAt: number
}

const KEY = 'finesse.gameStoreDemo.requests'

// Seconds into an attempt each step ends (scaled by size for the download).
const QUEUED = 3
const CHECK = 4
const INSTALL = 14
const FINISH = 4

function downloadSeconds(bytes: number): number {
  return Math.min(90, Math.max(12, bytes / 40e6))
}

function load(): DemoRequest[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as DemoRequest[]
  } catch {
    /* fall through to the starter set */
  }
  // A starter set so every state is on screen the first time.
  const now = Date.now()
  const seed: DemoRequest[] = [
    { id: 'r-openttd', gameId: 'openttd', sourceId: 'openttd-win', startedAt: now - 3 * DAY, createdAt: now - 3 * DAY },
    { id: 'r-0ad', gameId: '0ad', sourceId: '0ad-win', startedAt: now - 20_000, createdAt: now - 20_000 },
    { id: 'r-veloren', gameId: 'veloren', sourceId: 'veloren-win', startedAt: now - 10 * 60_000, createdAt: now - 10 * 60_000 },
    { id: 'r-warzone2100', gameId: 'warzone2100', sourceId: 'warzone2100-win', startedAt: now - 10 * 60_000, createdAt: now - 10 * 60_000, failChecksum: true },
  ]
  save(seed)
  return seed
}

function save(list: DemoRequest[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* private mode: requests last until reload */
  }
}

const INSTALL_DETAIL: Record<InstallerKind, string> = {
  inno: 'Unpacking the Windows installer',
  nsis: 'Unpacking the Windows installer',
  msi: 'Unpacking the Windows installer',
  archive: 'Unpacking the zip',
  portable: 'Copying the game into place',
  linux: 'Unpacking the Linux build',
  unknown: 'Starting the installer',
}

function view(r: DemoRequest, now = Date.now()): GameRequest {
  const d = BY_ID.get(r.gameId)!
  const src = sources(d).find((s) => s.id === r.sourceId) ?? sources(d)[0]!
  const base = {
    id: r.id,
    gameId: r.gameId,
    title: d.title,
    sourceId: src.id,
    platform: src.platform,
    installer: src.installer,
    sizeBytes: src.sizeBytes,
    createdAt: new Date(r.createdAt).toISOString(),
  }
  const t = (now - r.startedAt) / 1000
  const dl = downloadSeconds(src.sizeBytes)
  const at = (s: number) => new Date(r.startedAt + s * 1000).toISOString()
  if (t < QUEUED) return { ...base, state: 'queued', detail: 'Finding people sharing it', updatedAt: at(0) }
  if (t < QUEUED + dl) {
    const p = (t - QUEUED) / dl
    const bps = src.sizeBytes / dl
    return { ...base, state: 'downloading', progress: Math.round(p * 100), bytesPerSecond: bps, etaSeconds: Math.ceil(dl - (t - QUEUED)), detail: 'Over the VPN', updatedAt: at(QUEUED) }
  }
  const checked = QUEUED + dl + CHECK
  if (t < checked) return { ...base, state: 'checking', detail: 'Making sure the download is the real thing', updatedAt: at(QUEUED + dl) }
  if (r.failChecksum)
    return {
      ...base,
      state: 'failed',
      detail: 'The download doesn’t match the checksum the store gave. It may have been tampered with, so Finesse deleted it. Try again, or pick another download.',
      updatedAt: at(checked),
    }
  const installed = checked + INSTALL
  if (t < installed) {
    if (src.installer === 'unknown' && t > checked + 3)
      return r.installerDoneAt
        ? finishing(base, r.installerDoneAt, now)
        : { ...base, state: 'needs-you', detail: 'The installer is asking questions. Open its screen and click through it.', updatedAt: at(checked + 3) }
    return { ...base, state: 'installing', progress: Math.round(((t - checked) / INSTALL) * 100), detail: INSTALL_DETAIL[src.installer], updatedAt: at(checked) }
  }
  if (src.installer === 'unknown') {
    if (!r.installerDoneAt) return { ...base, state: 'needs-you', detail: 'The installer is asking questions. Open its screen and click through it.', updatedAt: at(checked + 3) }
    return finishing(base, r.installerDoneAt, now)
  }
  if (t < installed + FINISH) return { ...base, state: 'finishing', detail: 'Adding it to game streaming', updatedAt: at(installed) }
  return { ...base, state: 'ready', detail: 'It’s in Your games', updatedAt: at(installed + FINISH) }
}

function finishing(base: Omit<GameRequest, 'state' | 'updatedAt'>, doneAt: number, now: number): GameRequest {
  if (now - doneAt < FINISH * 1000) return { ...base, state: 'finishing', detail: 'Adding it to game streaming', updatedAt: new Date(doneAt).toISOString() }
  return { ...base, state: 'ready', detail: 'It’s in Your games', updatedAt: new Date(doneAt + FINISH * 1000).toISOString() }
}

const wait = <T>(v: T, ms = 250 + Math.random() * 350) => new Promise<T>((res) => setTimeout(() => res(v), ms))

function notFound(): never {
  throw new Error('That isn’t in the store any more')
}

export const demoStore: GameStoreApi = {
  async home() {
    const pick = (q: StoreQuery) => search({ ...q, limit: 16 }).items
    const shelves = [
      { id: 'popular', title: 'Popular right now', query: { sort: 'popular' } },
      { id: 'new', title: 'New in the store', query: { sort: 'new' } },
      { id: 'friends', title: 'Play with friends', query: { mode: 'online' } },
      { id: 'couch', title: 'On one couch', query: { mode: 'local' } },
      { id: 'rts', title: 'Real-time strategy', query: { genres: ['real-time-strategy'] } },
      { id: 'racing', title: 'Racing', query: { genres: ['racing'] } },
      { id: 'linux', title: 'Linux builds', query: { platform: 'linux', sort: 'name' } },
    ] satisfies { id: string; title: string; query: StoreQuery }[]
    return wait({
      featured: search({ sort: 'popular', limit: 5 }).items,
      shelves: shelves.map((s) => ({ ...s, items: pick(s.query) })),
    })
  },
  search: (q) => wait(search(q)),
  facets: (q) => wait(facets(q), 150),
  async game(id) {
    const d = BY_ID.get(id) ?? notFound()
    const game = toGame(d)
    const similar = search({ genres: game.genres.map(genreSlug), limit: 13 }).items.filter((g) => g.id !== id).slice(0, 12)
    return wait({ game, sources: sources(d), similar })
  },
  requests: () => wait(load().map((r) => view(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), 120),
  async request(gameId, sourceId) {
    const d = BY_ID.get(gameId) ?? notFound()
    const list = load()
    const existing = list.find((r) => r.gameId === gameId)
    if (existing) return wait(view(existing))
    const now = Date.now()
    const r: DemoRequest = { id: `r-${gameId}-${now}`, gameId, sourceId, startedAt: now, createdAt: now, failChecksum: d.badChecksum }
    save([r, ...list])
    return wait(view(r))
  },
  async cancel(id) {
    save(load().filter((r) => r.id !== id))
    await wait(undefined)
  },
  async retry(id) {
    const list = load()
    const r = list.find((x) => x.id === id) ?? notFound()
    // The demo's tampered download only fails once.
    Object.assign(r, { startedAt: Date.now(), installerDoneAt: undefined, failChecksum: false })
    save(list)
    return wait(view(r))
  },
  async installerDone(id) {
    const list = load()
    const r = list.find((x) => x.id === id) ?? notFound()
    r.installerDoneAt = Date.now()
    save(list)
    return wait(view(r))
  },
  installerScreenUrl: () => null,
}
