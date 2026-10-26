// Game streaming: Finesse in front of Wolf (games-on-whales.github.io/wolf),
// which streams Steam and other apps from the NAS to Moonlight on TVs, phones
// and PCs.
//
// Wolf's API lives on a unix socket (WOLF_SOCKET, shared into this container)
// and has no login of its own. It can do much more than Finesse needs (run
// apps, pull images, change settings), so nothing is passed through: Finesse
// makes its own few calls (read apps, profiles and devices; pair and unpair).
// Finesse also adds its own emulator apps (emulators.ts) to Wolf's profiles.
// Everyone at home sees the list of apps; only
// administrators see devices waiting to pair, pair them with the PIN Moonlight
// shows, and remove paired devices. Wolf's pairing secrets stay on the server:
// the browser gets a stand-in id.

import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import { request } from 'node:http'
import type { Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { logger } from './log.ts'
import { Docker } from './stack/docker.ts'
import { createBrowserStream, type BrowserStream } from './browserStream.ts'
import { isLutrisApp, installedLutrisGames, lutrisShortcut, lutrisShortcutId, type LutrisGame } from './lutris.ts'
import { appKind, findWolf, gpuPinEnv, hostRenderCards, wolfGpu, installedGames, isSteamApp, shortcutAppId, steamArtUrls, steamShortcut, wolfStateFolder, type SteamGame } from './steam.ts'
import {
  EMULATOR_IDS,
  emulatorCatalog,
  emulatorForConsole,
  emulatorOf,
  ensureSaveFolders,
  isOurApp,
  readiness,
  validateEmulators,
  wolfApp,
  type EmulatorId,
  type EmulatorSettings,
  type WolfApp,
  type WolfAppBase,
} from './emulators.ts'

const log = logger('streaming')

export interface WolfReply {
  status: number
  type: string
  body: Buffer
}

/** One request to Wolf's API over its unix socket. */
export function wolfCall(socket: string, method: 'GET' | 'POST', path: string, body?: unknown, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<WolfReply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = request(
      {
        socketPath: socket,
        method,
        path,
        headers: { Host: 'wolf', Connection: 'close', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}) },
        timeout: opts.timeoutMs ?? 8000,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > (opts.maxBytes ?? 4_000_000)) req.destroy(new Error('Wolf sent more than expected'))
          else chunks.push(c)
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', reject)
    req.end(payload)
  })
}

/** What went wrong reaching Wolf, in words an administrator can act on. */
export function wolfProblem(e: unknown, socket: string): string {
  const code = (e as { code?: string }).code
  if (code === 'ENOENT') return `Can’t find Wolf’s socket at ${socket}. Check WOLF_SOCKET, and that Wolf’s socket folder is shared with Finesse.`
  if (code === 'EACCES' || code === 'EPERM') return `Finesse isn’t allowed to open Wolf’s socket at ${socket}.`
  if (code === 'ECONNREFUSED') return 'Wolf isn’t running: its socket is there, but nothing answers. Start Wolf and try again.'
  if (code === 'ETIMEDOUT') return 'Wolf didn’t answer in time. It may be busy starting up; try again in a minute.'
  return (e as Error)?.message || 'Couldn’t reach Wolf.'
}

class WolfError extends Error {}

/** How long a game Finesse started keeps running with nobody watching it. */
export const LOBBY_GRACE = 10 * 60_000

/** Wolf's video buffers for the app's encoder: read from the app's own pipeline (Nvidia: CUDA memory). */
export function bufferCaps(app: RawApp): string {
  const pipe = [app.h264_gst_pipeline, app.hevc_gst_pipeline].filter((x): x is string => typeof x === 'string').join(' ')
  const m = /video\/x-raw\(memory:(\w+)\)/.exec(pipe)
  return m ? `video/x-raw(memory:${m[1]})` : 'video/x-raw'
}

/** A lobby for one profile's app in a Moonlight session, as Wolf UI makes them (the profile's own folder for the app). */
export function lobbyRequest(profileId: string, app: RawApp, session: Record<string, unknown>) {
  const runner = app.runner as { name?: unknown }
  const node = typeof app.render_node === 'string' ? app.render_node : '/dev/dri/renderD128'
  const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d)
  return {
    profile_id: profileId,
    name: String(app.title),
    icon_png_path: typeof app.icon_png_path === 'string' ? app.icon_png_path : null,
    multi_user: false,
    pin: null,
    // A dropped stream (a browser tab reconnecting, Wi-Fi blinking) mustn't end the game: Finesse
    // stops the lobby itself once nobody has been in it for a while (see the lobby sweep).
    stop_when_everyone_leaves: false,
    video_settings: {
      width: num(session.video_width, 1920),
      height: num(session.video_height, 1080),
      refresh_rate: num(session.video_refresh_rate, 60),
      wayland_render_node: node,
      runner_render_node: node,
      video_producer_buffer_caps: bufferCaps(app),
    },
    audio_settings: { channel_count: num(session.audio_channel_count, 2) },
    client_settings: null,
    runner_state_folder: `profile-data/${profileId}/${String(runner?.name ?? 'app')}`,
    runner: app.runner,
  }
}

/** Wolf starts a runner without answering: it either holds the request open or hangs up on it once
 *  the app is starting. Only a refused or missing socket means it didn't get the request. */
export const runnerAccepted = (err: { code?: string; message?: string }) =>
  err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || /socket hang up/i.test(err.message ?? '')

async function wolfJson<T>(socket: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await wolfCall(socket, method, path, body)
  let data: { success?: boolean; error?: string } | null = null
  try {
    data = JSON.parse(r.body.toString('utf8'))
  } catch {
    /* not JSON */
  }
  if (r.status >= 400 || !data || data.success === false) throw new WolfError(data?.error || `Wolf answered ${r.status}`)
  return data as T
}

interface WolfAppRaw {
  id?: unknown
  title?: unknown
  support_hdr?: unknown
  icon_png_path?: unknown
}

export interface StreamApp {
  id: string
  title: string
  hdr: boolean
  icon: boolean
  /** Wolf UI: the app Moonlight opens to reach the profiles' apps. */
  launcher?: true
  /** A Steam game shortcut: the game's Steam app id (for its artwork). */
  steam?: number
  /** A Lutris game shortcut: its id in Lutris. */
  lutris?: number
  /** Artwork beyond Wolf's icon may be had (/api/streaming/apps/<id>/art). */
  art?: true
  /** Which row it goes in on the Games page. */
  kind: 'steam' | 'lutris' | 'emulator' | 'app'
  /** Last played (Unix seconds): Steam's or Lutris's record, or Finesse's own, whichever is later. */
  lastPlayed?: number
  /** Time played that Finesse saw (seconds), plus what Lutris counted. */
  playtime?: number
  /** Running right now (a game waiting in Wolf, or a stream open on it). */
  running?: true
  /** An administrator hid it from the Games page (Moonlight still lists it). */
  hidden?: true
}

/** What the Games page also knows about the apps. */
export interface AppExtras {
  /** Hidden titles (lower case). */
  hidden?: Set<string>
  /** Last played by the launcher's own record: "steam:<id>" / "lutris:<id>" → Unix seconds. */
  played?: Map<string, number>
  /** Hours Lutris counted: "lutris:<id>" → seconds. */
  launcherTime?: Map<string, number>
  /** Finesse's play history: "<profile>|<title>" (lower case) → seconds and last time. */
  history?: Record<string, { s: number; last: number }>
  /** What's running: "<profile>|<title>" (lower case); top-level apps by id: "|#<id>". */
  running?: Set<string>
  /** SteamGridDB has a key: every app may have artwork. */
  art?: boolean
}

export const historyKey = (profile: string | null, title: string) => `${profile ?? ''}|${title.toLowerCase()}`

export interface StreamProfile {
  id: string
  name: string
  apps: StreamApp[]
}

interface WolfProfileRaw {
  id?: unknown
  name?: unknown
  apps?: unknown
}

// Wolf's own test pattern: useful to Wolf's developers, not a game.
const TEST_APP = /^test ball$/i
const LAUNCHER = /^wolf ui$/i

// Icons are fetched by app, never by a path from the browser; and only paths
// Wolf's own get-icon call can take as they are (it splits its query on "=").
const SAFE_ICON = /^[\w./:-]{1,300}$/

/** Only what the app shows: Wolf's app entries also carry pipelines and runner settings (Docker images, mounts, environment). */
export function publicApps(raw: WolfAppRaw[], extras: AppExtras = {}, profile: string | null = null): StreamApp[] {
  return raw
    .filter((a) => typeof a.id === 'string' && typeof a.title === 'string' && !TEST_APP.test(a.title))
    .map((a) => {
      const title = a.title as string
      const steam = shortcutAppId(a as RawApp)
      const lutris = lutrisShortcutId(a as RawApp)
      const key = steam ? `steam:${steam}` : lutris ? `lutris:${lutris}` : null
      const mine = extras.history?.[historyKey(profile, title)]
      const last = Math.max(key ? (extras.played?.get(key) ?? 0) : 0, mine?.last ?? 0)
      const time = (mine?.s ?? 0) + (key ? (extras.launcherTime?.get(key) ?? 0) : 0)
      const running = extras.running?.has(historyKey(profile, title)) || (profile === null && extras.running?.has(`|#${a.id as string}`))
      return {
        id: a.id as string,
        title,
        hdr: a.support_hdr === true,
        icon: typeof a.icon_png_path === 'string' && SAFE_ICON.test(a.icon_png_path),
        ...(LAUNCHER.test(title) ? { launcher: true as const } : {}),
        ...(steam ? { steam } : {}),
        ...(lutris ? { lutris } : {}),
        ...(!steam && (extras.art || lutris) && !LAUNCHER.test(title) ? { art: true as const } : {}),
        kind: appKind(a as RawApp),
        ...(last ? { lastPlayed: last } : {}),
        ...(time >= 60 ? { playtime: Math.round(time) } : {}),
        ...(running ? { running: true as const } : {}),
        ...(extras.hidden?.has(title.toLowerCase()) ? { hidden: true as const } : {}),
      }
    })
}

/** Wolf's profiles (Wolf UI's "who's playing"), with only their names and apps: never their PINs. */
export function publicProfiles(raw: WolfProfileRaw[], extras: AppExtras = {}): StreamProfile[] {
  return raw
    .filter((p) => typeof p.id === 'string' && Array.isArray(p.apps))
    .map((p) => ({ id: p.id as string, name: typeof p.name === 'string' && p.name ? p.name : (p.id as string), apps: publicApps(p.apps as WolfAppRaw[], extras, p.id as string) }))
    .filter((p) => p.apps.length > 0)
}

// ---------- Emulators in Wolf ----------

type RawApp = Record<string, unknown>
type RawProfile = { id: string; name?: string; icon_png_path?: string; pin?: number[] | null; apps: RawApp[] }

const BASE_KEYS = ['h264_gst_pipeline', 'hevc_gst_pipeline', 'av1_gst_pipeline', 'render_node', 'opus_gst_pipeline'] as const

/** Wolf's encoder settings, from an app it already has (Finesse never makes its own up). */
export function appBase(apps: RawApp[]): WolfAppBase | null {
  const a = [...apps.filter((x) => !isOurApp(x)), ...apps].find((x) => BASE_KEYS.every((k) => typeof x[k] === 'string'))
  return a ? (Object.fromEntries(BASE_KEYS.map((k) => [k, a[k] as string])) as unknown as WolfAppBase) : null
}

/** Our apps as Wolf holds them, ready to compare with what they should be (ids are Wolf's). */
const ours = (apps: RawApp[]) => JSON.stringify(apps.filter(isOurApp).map(({ id: _id, ...rest }) => rest))

/** Wolf's profiles: which exist, and which have a PIN (who may use them is Wolf's say; PINs stay here). */
export async function wolfProfileLocks(socket: string): Promise<Map<string, boolean>> {
  const r = await wolfJson<{ profiles?: RawProfile[] }>(socket, 'GET', '/api/v1/profiles')
  return new Map((Array.isArray(r.profiles) ? r.profiles : []).filter((p) => typeof p.id === 'string').map((p) => [p.id, Array.isArray(p.pin) && p.pin.length > 0]))
}

export interface EmulatorSync {
  /** Profiles (names) that have the apps now. */
  profiles: string[]
  changed: boolean
}

/** Puts Finesse's emulator apps in Wolf, as the settings say; takes them out when there are none. Idempotent. */
export async function syncEmulators(socket: string, s: EmulatorSettings | undefined, owner: { uid: number; gid: number }): Promise<EmulatorSync> {
  const settings: EmulatorSettings = s ?? { apps: [], paths: {} }
  const [appsR, profR] = await Promise.all([
    wolfJson<{ apps?: RawApp[] }>(socket, 'GET', '/api/v1/apps'),
    wolfJson<{ profiles?: RawProfile[] }>(socket, 'GET', '/api/v1/profiles').catch(() => ({ profiles: [] as RawProfile[] })),
  ])
  const moonlight = Array.isArray(appsR.apps) ? appsR.apps : []
  const profiles = (Array.isArray(profR.profiles) ? profR.profiles : []).filter((p) => typeof p.id === 'string' && Array.isArray(p.apps))
  const base = appBase([...moonlight, ...profiles.flatMap((p) => p.apps)])
  if (!base && settings.apps.length) throw new WolfError('Wolf has no app to copy its video settings from. Add any app in Wolf first.')
  const want = (profile: string): WolfApp[] => settings.apps.map((id) => wolfApp(id, { settings, profile, base: base! }))
  let changed = false

  // Wolf UI: the apps go in its profiles (one per person), saves in each profile's folder.
  if (profiles.length) {
    const targets = profiles.filter((p) => !settings.profiles?.length || settings.profiles.includes(p.id))
    for (const p of profiles) {
      const wanted = targets.includes(p) ? want(p.id) : []
      if (ours(p.apps) === ours(wanted as unknown as RawApp[])) continue
      if (wanted.length) ensureSaveFolders(settings, p.id, owner)
      const next = { ...p, apps: [...p.apps.filter((a) => !isOurApp(a)), ...wanted] }
      // Wolf changes a profile by replacing it; put the old one back if the new one is refused.
      await wolfJson(socket, 'POST', '/api/v1/profiles/remove', { id: p.id })
      try {
        await wolfJson(socket, 'POST', '/api/v1/profiles/add', next)
      } catch (e) {
        await wolfJson(socket, 'POST', '/api/v1/profiles/add', p).catch(() => log.error(`couldn’t restore Wolf profile ${p.name ?? p.id}`))
        throw e
      }
      changed = true
      log.info(`emulators: ${wanted.length ? `${wanted.length} apps in` : 'removed from'} Wolf profile ${p.name ?? p.id}`)
    }
    return { profiles: targets.filter(() => settings.apps.length > 0).map((p) => p.name || p.id), changed }
  }

  // Older Wolf, without profiles: Moonlight's own list.
  const wanted = want('shared')
  if (ours(moonlight) !== ours(wanted as unknown as RawApp[])) {
    if (wanted.length) ensureSaveFolders(settings, 'shared', owner)
    for (const a of moonlight.filter(isOurApp)) await wolfJson(socket, 'POST', '/api/v1/apps/delete', { id: a.id })
    for (const a of wanted) await wolfJson(socket, 'POST', '/api/v1/apps/add', a)
    changed = true
  }
  return { profiles: settings.apps.length ? ['Moonlight'] : [], changed }
}

/** A game in RomM, as a path inside the emulator app; null when RomM's path isn't one Finesse trusts. */
export function gamePath(fsPath: unknown, fsName: unknown): string | null {
  if (typeof fsPath !== 'string' || typeof fsName !== 'string' || !fsName) return null
  const rel = fsPath.replace(/^\/?romm\/library\/?/, '').replace(/^\/+|\/+$/g, '')
  const all = [...rel.split('/'), fsName]
  if (all.some((x) => x === '..' || x === '.' || /[\0\n\r]/.test(x)) || fsName.includes('/')) return null
  return ['/finesse/roms', rel, fsName].filter(Boolean).join('/')
}

export interface RommGame {
  platform_slug?: unknown
  fs_path?: unknown
  fs_name?: unknown
  name?: unknown
  /** Every file RomM found for the game (a folder game has several). */
  files?: { file_path?: unknown; file_name?: unknown }[]
}

// What each emulator opens, best first. Anything else in a game's folder (covers, notes, programs) is passed over.
const OPENS: Record<string, string[]> = {
  pcsx2: ['iso', 'chd', 'cso', 'zso', 'gz', 'cue', 'bin', 'img', 'elf'],
  dolphin: ['rvz', 'iso', 'gcm', 'gcz', 'wbfs', 'wia', 'ciso', 'dol', 'elf', 'wad'],
  rpcs3: ['iso'],
  cemu: ['wua', 'wud', 'wux', 'rpx'],
  switch: ['xci', 'nsp', 'nca', 'nro', 'nso'],
}
const extOf = (n: string) => (/\.([a-z0-9]+)$/i.exec(n)?.[1] ?? '').toLowerCase()

/** The file the emulator should open for a RomM game, as a path inside the app; or why there isn't one. */
export function pickGame(rom: RommGame, emulator: string, emulatorName = emulator): { path: string } | { error: string } {
  const want = OPENS[emulator] ?? []
  const fsName = typeof rom.fs_name === 'string' ? rom.fs_name : ''
  // A single file RomM knows as the game.
  if (want.includes(extOf(fsName))) {
    const path = gamePath(rom.fs_path, fsName)
    return path ? { path } : { error: 'RomM gave this game a path Finesse can’t use' }
  }
  // A folder: the best file inside it.
  const files = (rom.files ?? []).filter((f) => typeof f.file_name === 'string' && typeof f.file_path === 'string') as { file_path: string; file_name: string }[]
  const best = files.filter((f) => want.includes(extOf(f.file_name))).sort((a, b) => want.indexOf(extOf(a.file_name)) - want.indexOf(extOf(b.file_name)))[0]
  if (best) {
    const path = gamePath(best.file_path, best.file_name)
    return path ? { path } : { error: 'RomM gave this game a path Finesse can’t use' }
  }
  // RPCS3 opens a game's folder (PS3_GAME, EBOOT.BIN) as it is.
  if (emulator === 'rpcs3' && fsName && (files.some((f) => /^eboot\.bin$/i.test(f.file_name)) || !extOf(fsName))) {
    const path = gamePath(rom.fs_path, fsName)
    if (path) return { path }
  }
  const has = [...new Set(files.map((f) => extOf(f.file_name)).filter(Boolean))].map((e) => `.${e}`)
  const mds = has.includes('.mds') ? ' MDS files are only the index of a disc image: the .mdf beside them holds the game, or convert the disc to .iso.' : ''
  return { error: `There’s no game file here that ${emulatorName} can open${has.length ? ` (it has ${has.slice(0, 6).join(', ')})` : ''}.${mds}` }
}

/** One game from RomM (Basic auth added here; the browser never sees it). */
export async function fetchRom(romm: { url?: string; apiKey?: string; username?: string; password?: string }, id: number): Promise<RommGame> {
  const basic = romm.apiKey && !romm.username ? romm.apiKey : Buffer.from(`${romm.username ?? ''}:${romm.password ?? ''}`).toString('base64')
  const r = await fetch(`${String(romm.url).replace(/\/+$/, '')}/api/roms/${id}`, { headers: { authorization: `Basic ${basic}` }, signal: AbortSignal.timeout(10000) }).catch(() => null)
  if (!r?.ok) throw new ApiError(r?.status === 404 ? 404 : 502, r?.status === 404 ? 'RomM doesn’t have that game' : 'Couldn’t reach RomM. Try again in a minute.')
  return (await r.json()) as RommGame
}

/** The browser's stand-in for a Moonlight session (Wolf's session ids stay here, with its keys). */
export const sessionId = (id: string) => createHash('sha256').update(`finesse-session:${id}`).digest('hex').slice(0, 16)

/** The browser's stand-in for a pending pair request (Wolf's pair secret never leaves the server). */
export const pendingId = (secret: string) => createHash('sha256').update(`finesse-pair:${secret}`).digest('hex').slice(0, 16)

export function registerStreaming(router: Router, deps: { settings: SettingsStore; auth: Auth; docker?: Docker }): BrowserStream {
  const { settings, auth } = deps
  const docker = deps.docker ?? new Docker()
  const socketOf = () => settings.get().streaming?.socket
  const need = () => {
    const socket = socketOf()
    if (!socket) throw new ApiError(404, 'Game streaming isn’t set up on this server')
    return socket
  }

  // Moonlight's list (Wolf's apps), plus the apps inside Wolf UI's profiles:
  // with Wolf UI, Moonlight only shows the launcher and the games live there.
  let appsCache: { at: number; raw: WolfAppRaw[]; profiles: WolfProfileRaw[] } | null = null
  async function wolfLists(socket: string): Promise<{ raw: WolfAppRaw[]; profiles: WolfProfileRaw[] }> {
    if (appsCache && Date.now() - appsCache.at < 30_000) return appsCache
    const [r, p] = await Promise.all([
      wolfJson<{ apps?: WolfAppRaw[] }>(socket, 'GET', '/api/v1/apps'),
      // Older Wolf has no profiles.
      wolfJson<{ profiles?: WolfProfileRaw[] }>(socket, 'GET', '/api/v1/profiles').catch(() => ({ profiles: [] })),
    ])
    appsCache = { at: Date.now(), raw: Array.isArray(r.apps) ? r.apps : [], profiles: Array.isArray(p.profiles) ? p.profiles : [] }
    return appsCache
  }
  /** Every app Finesse may show an icon for: Moonlight's and the profiles'. */
  const allAppsRaw = async (socket: string) => {
    const { raw, profiles } = await wolfLists(socket)
    return [...raw, ...profiles.flatMap((p) => (Array.isArray(p.apps) ? (p.apps as WolfAppRaw[]) : []))]
  }

  /** Our emulator apps Wolf has, the consoles they play, and where (only titles and names). */
  const publicEmulators = (raw: WolfAppRaw[], profiles: WolfProfileRaw[]) => {
    const e = settings.get().emulators
    const cat = emulatorCatalog(e?.switchEmulator)
    const where = new Map<EmulatorId, { title: string; profiles: string[] }>()
    const add = (a: RawApp, profile: string | null) => {
      const id = emulatorOf(a)
      if (!id || typeof a.title !== 'string') return
      const w = where.get(id) ?? { title: a.title, profiles: [] }
      if (profile) w.profiles.push(profile)
      where.set(id, w)
    }
    for (const a of raw as RawApp[]) add(a, null)
    for (const p of profiles) for (const a of (Array.isArray(p.apps) ? p.apps : []) as RawApp[]) add(a, typeof p.name === 'string' && p.name ? p.name : String(p.id))
    const canPlay = Boolean(e?.paths.roms && settings.get().services.romm?.url)
    return EMULATOR_IDS.filter((id) => where.has(id)).map((id) => ({ id, title: where.get(id)!.title, consoles: cat[id].consoles, profiles: where.get(id)!.profiles, play: canPlay && cat[id].consoles.length > 0 }))
  }
  const owner = () => ({ uid: settings.get().stack?.puid ?? 1000, gid: settings.get().stack?.pgid ?? 1000 })

  // At start: put the emulator apps back if Wolf lost them (a reset config, a new Wolf). Idempotent.
  const startup = setTimeout(() => {
    const socket = socketOf()
    const e = settings.get().emulators
    if (!socket || !e?.apps.length) return
    syncEmulators(socket, e, owner()).then(
      (r) => r.changed && log.info('emulators: Wolf’s apps brought up to date'),
      (err) => log.warn(`emulators: ${err instanceof WolfError ? err.message : wolfProblem(err, socket)}`),
    )
  }, 5000)
  startup.unref()

  const clientIds = async (socket: string) =>
    (await wolfJson<{ clients?: { client_id?: unknown }[] }>(socket, 'GET', '/api/v1/clients')).clients?.map((c) => String(c.client_id ?? '')).filter(Boolean) ?? []

  const pending = async (socket: string) =>
    ((await wolfJson<{ requests?: { pair_secret?: unknown; client_ip?: unknown }[] }>(socket, 'GET', '/api/v1/pair/pending')).requests ?? [])
      .filter((p) => typeof p.pair_secret === 'string' && p.pair_secret)
      .map((p) => ({ secret: p.pair_secret as string, ip: String(p.client_ip ?? '') }))

  /** Hidden apps, play history, what's running, and the launchers' last-played times (cached reads; never waits long). */
  async function appExtras(raw: WolfAppRaw[], profiles: WolfProfileRaw[]): Promise<AppExtras> {
    const st = settings.get().streaming
    const hidden = new Set((st?.hidden ?? []).map((t) => t.toLowerCase()))
    const socket = need()
    const all = [...(raw as RawApp[]), ...profiles.flatMap((p) => (Array.isArray(p.apps) ? (p.apps as RawApp[]) : []))]
    const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null)
    const [steamList, lutrisList, live] = await Promise.all([
      all.some((a) => shortcutAppId(a) !== null) ? within(steamPlaces(socket).then((f) => steamGames(f.places, 5 * 60_000)), 4000) : null,
      all.some((a) => lutrisShortcutId(a) !== null) ? within(steamPlaces(socket).then((f) => lutrisGames(f, 5 * 60_000)), 4000) : null,
      within(runningNow(socket, raw), 3000),
    ])
    const played = new Map<string, number>()
    const launcherTime = new Map<string, number>()
    for (const g of steamList ?? []) if (g.lastPlayed) played.set(`steam:${g.appId}`, g.lastPlayed)
    for (const g of lutrisList ?? []) {
      if (g.lastPlayed) played.set(`lutris:${g.id}`, g.lastPlayed)
      if (g.playtime) launcherTime.set(`lutris:${g.id}`, g.playtime * 3600)
    }
    return { hidden, played, launcherTime, history: st?.history ?? {}, running: live ?? new Set(), art: Boolean(settings.get().services.steamgriddb?.apiKey) }
  }

  /** What's running in Wolf: games waiting or played in a lobby, and apps open in a Moonlight stream. */
  async function runningNow(socket: string, raw: WolfAppRaw[]): Promise<Set<string>> {
    const [lobbies, open] = await Promise.all([
      wolfJson<{ lobbies?: { name?: unknown; started_by_profile_id?: unknown }[] }>(socket, 'GET', '/api/v1/lobbies').then((r) => r.lobbies ?? [], () => []),
      sessions(socket).catch(() => []),
    ])
    const out = new Set<string>()
    for (const l of lobbies) if (typeof l.name === 'string') out.add(historyKey(typeof l.started_by_profile_id === 'string' ? l.started_by_profile_id : null, l.name))
    for (const x of open) {
      const app = (raw as RawApp[]).find((a) => a.id === x.app_id)
      if (app && typeof app.title === 'string' && !LAUNCHER.test(app.title)) out.add(`|#${String(app.id)}`)
    }
    return out
  }

  // ---------- Watching Wolf: play history, its graphics memory, a restart when it's idle and full ----------
  /** Wolf's graphics memory at the last look (every 2 minutes), for administrators' warning. */
  let gpuSeen: { at: number; gpus: { name: string; used: number; total: number; wolf: number }[] } | null = null
  let lastAutoRestart = 0
  let tick = 0
  const WATCH_MS = Number(process.env.FINESSE_WATCH_MS) || 60_000
  const watch = setInterval(() => {
    const socket = socketOf()
    if (!socket) return
    tick++
    void (async () => {
      const [lobbies, open, lists] = await Promise.all([
        wolfJson<{ lobbies?: { name?: unknown; started_by_profile_id?: unknown; connected_sessions?: unknown[] }[] }>(socket, 'GET', '/api/v1/lobbies').then((r) => r.lobbies ?? []),
        sessions(socket),
        wolfLists(socket),
      ])
      // Play history: a minute for every game someone is in (a lobby with people, or an app open in a stream).
      const add = new Set<string>()
      for (const l of lobbies) if (typeof l.name === 'string' && Array.isArray(l.connected_sessions) && l.connected_sessions.length) add.add(historyKey(typeof l.started_by_profile_id === 'string' ? l.started_by_profile_id : null, l.name))
      for (const x of open) {
        const app = (lists.raw as RawApp[]).find((a) => a.id === x.app_id)
        if (app && typeof app.title === 'string' && !LAUNCHER.test(app.title)) add.add(historyKey(null, app.title))
      }
      if (add.size) {
        const now = Math.floor(Date.now() / 1000)
        settings.update((x) => {
          const h = { ...(x.streaming?.history ?? {}) }
          for (const k of add) h[k] = { s: (h[k]?.s ?? 0) + WATCH_MS / 1000, last: now }
          x.streaming = { ...x.streaming, history: h }
        })
      }
      if (tick % 2) return
      // Wolf's graphics memory; and when it holds most of a card with nothing playing, a restart gives it back.
      const wolf = await findWolf(docker).catch(() => null)
      const gpus = wolf ? await wolfGpu(docker, wolf.Id).catch(() => null) : null
      gpuSeen = gpus ? { at: Date.now(), gpus } : null
      const full = (gpus ?? []).some((g) => g.total > 0 && g.used / g.total > 0.85 && g.wolf > g.total * 0.4)
      if (full && wolf && settings.get().streaming?.autoRestartWolf !== false && !lobbies.length && !open.length && Date.now() - lastAutoRestart > 30 * 60_000) {
        lastAutoRestart = Date.now()
        log.warn('wolf: it held most of the graphics card’s memory with nothing playing; restarting it')
        await docker.restart(wolf.Id, 10)
        appsCache = null
        gpuSeen = null
      }
    })().catch(() => {})
  }, WATCH_MS)
  watch.unref()

  // Administrators: what playing in Finesse's page needs, part by part, and how to fix what's missing.
  router.get('/api/streaming/browser/check', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const httpsPort = Number(process.env.FINESSE_HTTPS_PORT || 0) || null
    const streamPort = Number(process.env.FINESSE_STREAM_PORT || 0) || null
    const mw = await browser.target().catch(() => null)
    const known = settings.get().streaming?.browserClient
    const paired = known ? (await clientIds(socket).catch(() => [] as string[])).includes(known) : null
    const items = [
      { id: 'https', ok: Boolean(httpsPort), title: 'Finesse on https', detail: httpsPort ? `Port ${httpsPort}.` : 'Browsers only play games on a secure page.', fix: httpsPort ? [] : ['Set FINESSE_HTTPS_PORT (e.g. 30543) on Finesse’s container and publish that port.'] },
      { id: 'port', ok: Boolean(streamPort), title: 'A port for the game stream', detail: streamPort ? `Port ${streamPort}.` : 'Moonlight-Web needs an address of its own.', fix: streamPort ? [] : ['Set FINESSE_STREAM_PORT (e.g. 30544) on Finesse’s container and publish that port.'] },
      {
        id: 'mw',
        ok: Boolean(mw),
        title: 'Moonlight-Web',
        detail: mw ? `Found (${mw.container}).` : 'Finesse can’t find it running in Docker here.',
        fix: mw ? [] : ['Run ghcr.io/linckosz/moonlight-web with host networking and MW_HTTPS_PORT set (e.g. 30600), and Wolf’s socket folder /var/run/wolf mounted.', 'Or tell Finesse where it is: FINESSE_MOONLIGHT_WEB=https://<address>:<port> and FINESSE_MOONLIGHT_WEB_CONTAINER=<name>.'],
      },
      {
        id: 'paired',
        ok: paired !== false,
        title: 'Paired with Wolf',
        detail: paired === true ? 'Yes.' : paired === false ? 'Wolf doesn’t know it any more.' : 'Checked after the first game you play here.',
        fix: paired === false ? ['Open Moonlight-Web’s own page once, add this server, and enter the PIN it shows under Settings → Game streaming.'] : [],
      },
    ]
    sendJson(res, 200, { ready: items.every((i) => i.ok), items })
  })

  // Administrators: the stream quality for games played in Finesse's page, and Wolf's self-restart.
  const QUALITY = /^(auto|(720|1080|1440|2160)p(30|60|120))$/
  router.put('/api/streaming/settings', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ quality?: unknown; autoRestartWolf?: unknown }>(req)
    if (body.quality !== undefined && (typeof body.quality !== 'string' || !QUALITY.test(body.quality))) throw new ApiError(400, 'Pick a quality from the list')
    settings.update((x) => {
      x.streaming = {
        ...x.streaming,
        ...(typeof body.quality === 'string' ? { browserQuality: body.quality } : {}),
        ...(typeof body.autoRestartWolf === 'boolean' ? { autoRestartWolf: body.autoRestartWolf } : {}),
      }
    })
    const st = settings.get().streaming
    sendJson(res, 200, { ok: true, quality: st?.browserQuality ?? 'auto', autoRestartWolf: st?.autoRestartWolf !== false })
  })
  router.get('/api/streaming/settings', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const st = settings.get().streaming
    sendJson(res, 200, { quality: st?.browserQuality ?? 'auto', autoRestartWolf: st?.autoRestartWolf !== false })
  })

  // Everyone at home: what can be streamed.
  router.get('/api/streaming', async ({ req, res }) => {
    const user = await auth.requireUser(req)
    const socket = need()
    try {
      const { raw, profiles } = await wolfLists(socket)
      const hasSteam = [...(raw as RawApp[]), ...profiles.flatMap((p) => (Array.isArray(p.apps) ? (p.apps as RawApp[]) : []))].some(isSteamApp)
      const extras = await appExtras(raw, profiles)
      const isAdmin = user.Policy?.IsAdministrator === true
      const high = isAdmin && gpuSeen && Date.now() - gpuSeen.at < 10 * 60_000 ? gpuSeen.gpus.find((g) => g.total > 0 && g.used / g.total > 0.8) : undefined
      sendJson(res, 200, {
        ok: true,
        apps: publicApps(raw, extras),
        profiles: publicProfiles(profiles, extras),
        emulators: publicEmulators(raw, profiles),
        steam: hasSteam,
        ...(high ? { gpuWarning: { used: high.used, total: high.total, wolf: high.wolf } } : {}),
      })
    } catch (e) {
      log.warn(`apps: ${wolfProblem(e, socket)}`)
      sendJson(res, 200, { ok: false, apps: [], error: 'Game streaming isn’t answering right now. Try again in a minute.' })
    }
  })

  // Administrators: hide an app from the Games page, or show it again (by title: Wolf renumbers its apps).
  router.put('/api/streaming/hidden', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ title?: unknown; hidden?: unknown }>(req)
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
    if (!title) throw new ApiError(400, 'Which app?')
    settings.update((x) => {
      const rest = (x.streaming?.hidden ?? []).filter((t) => t.toLowerCase() !== title.toLowerCase())
      x.streaming = { ...x.streaming, hidden: body.hidden === true ? [...rest, title] : rest }
    })
    sendJson(res, 200, { ok: true })
  })

  router.get('/api/streaming/apps/:id/icon', async ({ req, res, params, url }) => {
    await auth.requireUser(req, { query: url.searchParams })
    const socket = need()
    const app = (await allAppsRaw(socket).catch(() => [] as WolfAppRaw[])).find((a) => a.id === params.id)
    const path = typeof app?.icon_png_path === 'string' && SAFE_ICON.test(app.icon_png_path) ? app.icon_png_path : null
    if (!path) throw new ApiError(404, 'No icon')
    const r = await wolfCall(socket, 'GET', `/api/v1/utils/get-icon?icon_path=${path}`, undefined, { timeoutMs: 15000, maxBytes: 3_000_000 }).catch(() => null)
    if (!r || r.status !== 200 || !r.type.startsWith('image/png')) throw new ApiError(404, 'No icon')
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(r.body.length), 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
    res.end(r.body)
  })

  // Everyone at home: artwork for apps that aren't Steam games: SteamGridDB (when it has a key) by
  // the app's name, square icons for apps and tall covers for Lutris games; for Lutris, its own cover
  // file as a fallback. Fetched here, so the page only talks to Finesse; misses are kept a while.
  const sgdbArt = new Map<string, { at: number; got: { type: string; body: Buffer } | null }>()
  async function sgdbFor(title: string, cover: boolean): Promise<{ type: string; body: Buffer } | null> {
    const key = settings.get().services.steamgriddb?.apiKey
    if (!key) return null
    const api = (path: string) =>
      fetch(`https://www.steamgriddb.com/api/v2${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? (r.json() as Promise<{ data?: unknown }>) : null))
    // Finesse's own names carry a console or a note in brackets: "PCSX2 (PS2)" is PCSX2.
    const name = title.replace(/\s*\(.*?\)\s*/g, ' ').trim() || title
    const found = (await api(`/search/autocomplete/${encodeURIComponent(name)}`).catch(() => null))?.data as { id?: number }[] | undefined
    const id = found?.[0]?.id
    if (!id) return null
    const list = (await api(cover ? `/grids/game/${id}?dimensions=600x900` : `/icons/game/${id}`).catch(() => null))?.data as { url?: string }[] | undefined
    const url = list?.find((x) => typeof x.url === 'string' && /^https:\/\//.test(x.url))?.url
    if (!url) return null
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) }).catch(() => null)
    const type = r?.headers.get('content-type') ?? ''
    if (!r?.ok || !type.startsWith('image/')) return null
    const body = Buffer.from(await r.arrayBuffer())
    return body.length < 4_000_000 ? { type, body } : null
  }
  router.get('/api/streaming/apps/:id/art', async ({ req, res, params, url }) => {
    await auth.requireUser(req, { query: url.searchParams })
    const socket = need()
    const app = (await allAppsRaw(socket).catch(() => [] as WolfAppRaw[])).find((a) => a.id === params.id) as RawApp | undefined
    if (!app || typeof app.title !== 'string') throw new ApiError(404, 'No artwork')
    const lutris = lutrisShortcutId(app)
    const key = `${lutris ? 'cover' : 'icon'}:${app.title.toLowerCase()}`
    let hit = sgdbArt.get(key)
    if (!hit || (!hit.got && Date.now() - hit.at > 3600_000)) {
      let got = await sgdbFor(app.title, Boolean(lutris)).catch(() => null)
      if (!got && lutris) got = await lutrisCover(app).catch(() => null)
      if (sgdbArt.size > 300) sgdbArt.delete(sgdbArt.keys().next().value!)
      sgdbArt.set(key, (hit = { at: Date.now(), got }))
    }
    if (!hit.got) throw new ApiError(404, 'No artwork')
    res.writeHead(200, { 'Content-Type': hit.got.type, 'Content-Length': String(hit.got.body.length), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' })
    res.end(hit.got.body)
  })
  /** Lutris's own cover for a shortcut's game (coverart/<slug>.jpg in the profile's Lutris folder). */
  async function lutrisCover(app: RawApp): Promise<{ type: string; body: Buffer } | null> {
    const id = lutrisShortcutId(app)
    const found = await steamPlaces(need())
    const game = (await lutrisGames(found, 10 * 60_000)).find((g) => g.id === id)
    if (!game?.slug || !/^[\w.-]+$/.test(game.slug)) return null
    const state = await wolfStateFolder(docker)
    const p = found.profiles.find((x) => x.apps.some((a) => lutrisShortcutId(a) === id))
    const base = p?.apps.find(isLutrisApp)
    if (!state || !p || !base) return null
    const me = await docker.inspect(process.env.FINESSE_CONTAINER || hostname()).catch(() => null)
    const image = me?.Config.Image ?? process.env.FINESSE_IMAGE
    if (!image) return null
    const home = `${state}/profile-data/${p.id}/${String((base.runner as { name: string }).name)}`
    const r = await docker.runOnce(image, ['sh', '-c', `f=/lutris/.local/share/lutris/coverart/${game.slug}.jpg; [ -f "$f" ] && base64 -w0 "$f"; echo`], [`${home}:/lutris:ro`])
    const b64 = r.output.trim().split('\n').pop() ?? ''
    if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return null
    return { type: 'image/jpeg', body: Buffer.from(b64, 'base64') }
  }

  // Administrators: pairing and paired devices.
  router.get('/api/streaming/admin', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    try {
      const [waiting, ids] = await Promise.all([pending(socket), clientIds(socket)])
      const names = settings.get().streaming?.devices ?? {}
      sendJson(res, 200, {
        ok: true,
        pending: waiting.map((p) => ({ id: pendingId(p.secret), ip: p.ip })),
        devices: ids.map((id) => ({ id, name: names[id]?.name ?? null, pairedAt: names[id]?.pairedAt ?? null })),
      })
    } catch (e) {
      sendJson(res, 200, { ok: false, error: wolfProblem(e, socket), pending: [], devices: [] })
    }
  })

  // Administrators: Wolf itself: how much graphics memory it holds, and a restart that gives it back.
  router.get('/api/streaming/wolf', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const wolf = await findWolf(docker).catch(() => null)
    const lobbies = await wolfJson<{ lobbies?: { connected_sessions?: unknown[] }[] }>(socket, 'GET', '/api/v1/lobbies').then((r) => r.lobbies ?? [], () => [])
    const sessionsNow = await sessions(socket).catch(() => [])
    sendJson(res, 200, {
      container: wolf ? wolf.Names[0]!.replace(/^\//, '') : null,
      gpus: wolf ? await wolfGpu(docker, wolf.Id).catch(() => null) : null,
      games: lobbies.length,
      streams: sessionsNow.length,
    })
  })

  router.post('/api/streaming/wolf/restart', async ({ req, res }) => {
    const user = await auth.requireAdmin(req)
    const wolf = await findWolf(docker).catch(() => null)
    if (!wolf) throw new ApiError(404, 'Finesse can’t find Wolf’s container. Restart it where you run it.')
    try {
      await docker.restart(wolf.Id, 10)
    } catch (e) {
      throw new ApiError(502, `Wolf didn’t restart: ${(e as Error).message}`)
    }
    // Wolf numbers its apps afresh when it starts, and every game and stream ended.
    appsCache = null
    ourLobbies.clear()
    saveLobbies()
    log.info(`wolf: restarted by ${user.Name}`)
    sendJson(res, 200, { ok: true })
  })

  router.post('/api/streaming/pair', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const body = await readJson<{ request?: unknown; pin?: unknown; name?: unknown }>(req)
    const pin = String(body.pin ?? '').trim()
    if (!/^\d{4}$/.test(pin)) throw new ApiError(400, 'The PIN is the 4 digits Moonlight shows')
    const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Moonlight device'
    let waiting: { secret: string; ip: string }[]
    let before: string[]
    try {
      ;[waiting, before] = await Promise.all([pending(socket), clientIds(socket)])
    } catch (e) {
      throw new ApiError(502, wolfProblem(e, socket))
    }
    const match = waiting.find((p) => pendingId(p.secret) === String(body.request ?? ''))
    if (!match) throw new ApiError(404, 'That device stopped waiting. In Moonlight, start pairing again.')
    try {
      await wolfJson(socket, 'POST', '/api/v1/pair/client', { pair_secret: match.secret, pin })
    } catch (e) {
      throw new ApiError(502, e instanceof WolfError ? `Wolf didn’t take the PIN (${e.message}). In Moonlight, start pairing again.` : wolfProblem(e, socket))
    }
    // Wolf hands the PIN to Moonlight's handshake; the device shows up once that succeeds.
    let added: string | undefined
    for (let i = 0; i < 16 && !added; i++) {
      await new Promise((r) => setTimeout(r, 500))
      added = (await clientIds(socket).catch(() => before)).find((id) => !before.includes(id))
    }
    if (!added) {
      sendJson(res, 200, { ok: false, error: 'Moonlight didn’t finish pairing. If it says the PIN was wrong, start pairing again in Moonlight.' })
      return
    }
    const id = added
    settings.update((s) => {
      s.streaming = { ...s.streaming, devices: { ...s.streaming?.devices, [id]: { name, pairedAt: new Date().toISOString() } } }
    })
    log.info(`paired ${name}`)
    sendJson(res, 201, { ok: true, device: { id, name } })
  })

  router.delete('/api/streaming/devices/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const socket = need()
    let ids: string[]
    try {
      ids = await clientIds(socket)
    } catch (e) {
      throw new ApiError(502, wolfProblem(e, socket))
    }
    const id = params.id ?? ''
    if (!ids.includes(id)) throw new ApiError(404, 'No such device')
    try {
      await wolfJson(socket, 'POST', '/api/v1/unpair/client', { client_id: id })
    } catch (e) {
      throw new ApiError(502, e instanceof WolfError ? `Wolf couldn’t remove it (${e.message})` : wolfProblem(e, socket))
    }
    const name = settings.get().streaming?.devices?.[id]?.name
    settings.update((s) => {
      if (s.streaming?.devices) delete s.streaming.devices[id]
    })
    log.info(`removed ${name ?? 'a device'}`)
    sendJson(res, 200, { ok: true })
  })

  // Administrators: the emulator apps, their folders, and what's in them (by file name).
  router.get('/api/streaming/emulators', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const e = settings.get().emulators ?? null
    const profiles = await wolfLists(socket)
      .then((l) => l.profiles.filter((p) => typeof p.id === 'string').map((p) => ({ id: p.id as string, name: typeof p.name === 'string' && p.name ? p.name : (p.id as string) })))
      .catch(() => [])
    sendJson(res, 200, { settings: e, readiness: e ? readiness(e) : [], profiles })
  })

  async function applyEmulators(e: EmulatorSettings | undefined) {
    const socket = need()
    try {
      const r = await syncEmulators(socket, e, owner())
      appsCache = null
      return { ok: true, ...r }
    } catch (err) {
      return { ok: false, error: err instanceof WolfError ? `Wolf didn’t take the apps: ${err.message}` : wolfProblem(err, socket) }
    }
  }

  router.put('/api/streaming/emulators', async ({ req, res }) => {
    await auth.requireAdmin(req)
    need()
    const body = await readJson<unknown>(req)
    const problems = validateEmulators(body)
    if (problems.length) throw new ApiError(400, problems.map((p) => `${p.path.replace(/^emulators\.?/, '') || 'emulators'}: ${p.message}`).join('\n'))
    const e = body as EmulatorSettings
    settings.update((x) => void (x.emulators = { ...e, apps: [...new Set(e.apps)] }))
    const synced = await applyEmulators(settings.get().emulators)
    log.info(`emulators saved: ${e.apps.join(', ') || 'none'}`)
    sendJson(res, 200, { ...synced, readiness: readiness(settings.get().emulators!) })
  })

  router.post('/api/streaming/emulators/sync', async ({ req, res }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, await applyEmulators(settings.get().emulators))
  })

  // Everyone at home: Moonlight sessions open right now, to start a game in (never Wolf's ids or keys).
  type WolfSession = { client_id?: unknown; client_ip?: unknown; app_id?: unknown; aes_key?: unknown; aes_iv?: unknown }
  const openSession = (x: WolfSession) => ({ client: x.client_id as string, stream: createHash('sha256').update(`${String(x.client_id)}:${String(x.aes_key)}:${String(x.aes_iv)}`).digest('hex').slice(0, 16) })
  const sessions = async (socket: string) => (await wolfJson<{ sessions?: WolfSession[] }>(socket, 'GET', '/api/v1/sessions')).sessions?.filter((x) => typeof x.client_id === 'string') ?? []

  // Playing in Finesse's own page (Moonlight-Web in a frame): what to stream, and which session it is.
  const browser = createBrowserStream({
    auth,
    settings,
    docker,
    sessions: async () => (await sessions(need())).map(openSession),
    streamFor: async (appId) => {
      const { raw, profiles } = await wolfLists(need())
      const inProfile = profiles.some((p) => Array.isArray(p.apps) && (p.apps as RawApp[]).some((a) => a.id === appId))
      if (inProfile) {
        const launcher = (raw as RawApp[]).find((a) => typeof a.title === 'string' && LAUNCHER.test(a.title))
        return launcher ? { title: launcher.title as string, join: true } : null
      }
      const app = (raw as RawApp[]).find((a) => a.id === appId)
      return app && typeof app.title === 'string' ? { title: app.title, join: false } : null
    },
  })
  browser.register(router)

  router.get('/api/streaming/sessions', async ({ req, res }) => {
    await auth.requireUser(req)
    const socket = need()
    try {
      const [list, apps] = await Promise.all([sessions(socket), allAppsRaw(socket).catch(() => [] as WolfAppRaw[])])
      sendJson(res, 200, {
        ok: true,
        sessions: list.map((x) => ({ id: sessionId(x.client_id as string), ip: String(x.client_ip ?? ''), app: apps.find((a) => a.id === x.app_id)?.title ?? null })),
      })
    } catch (e) {
      log.warn(`sessions: ${wolfProblem(e, socket)}`)
      sendJson(res, 200, { ok: false, sessions: [], error: 'Game streaming isn’t answering right now. Try again in a minute.' })
    }
  })

  // Everyone at home: start one of Wolf's apps (a Steam game, Kodi…) in a Moonlight session that's open,
  // the way picking it in Wolf UI would. Apps in a profile with a PIN only an administrator starts from here.
  // Lobbies Finesse started, and since when nobody's been in each (null: someone is). Stopped after
  // LOBBY_GRACE with nobody: long enough to reconnect, short enough not to hold the graphics card.
  // Kept in settings too, so a Finesse restart doesn't leave a game running for good.
  const ourLobbies = new Map<string, number | null>((settings.get().streaming?.lobbies ?? []).map((id) => [id, null]))
  const saveLobbies = () => {
    const ids = [...ourLobbies.keys()]
    const was = settings.get().streaming?.lobbies ?? []
    if (ids.length !== was.length || ids.some((id, i) => id !== was[i])) settings.update((x) => void (x.streaming = { ...x.streaming, lobbies: ids }))
  }
  const sweep = setInterval(() => {
    const socket = socketOf()
    if (!socket || !ourLobbies.size) return
    wolfJson<{ lobbies?: { id?: string; connected_sessions?: unknown[] }[] }>(socket, 'GET', '/api/v1/lobbies')
      .then(async (r) => {
        const now = Date.now()
        const live = new Map((r.lobbies ?? []).map((l) => [String(l.id), Array.isArray(l.connected_sessions) ? l.connected_sessions.length : 0]))
        for (const [id, since] of ourLobbies) {
          if (!live.has(id)) (ourLobbies.delete(id), saveLobbies())
          else if (live.get(id)! > 0) ourLobbies.set(id, null)
          else if (since === null) ourLobbies.set(id, now)
          else if (now - since >= LOBBY_GRACE) {
            ourLobbies.delete(id)
            saveLobbies()
            await wolfJson(socket, 'POST', '/api/v1/lobbies/stop', { lobby_id: id, pin: null }).catch(() => {})
            log.info('launch: stopped a game nobody came back to')
          }
        }
      })
      .catch(() => {})
  }, 60_000)
  sweep.unref()

  router.post('/api/streaming/launch', async ({ req, res }) => {
    const user = await auth.requireUser(req)
    const socket = need()
    const body = await readJson<{ app?: unknown; session?: unknown }>(req)
    const appId = typeof body.app === 'string' ? body.app : ''
    if (!appId) throw new ApiError(400, 'Which app?')
    let list: WolfSession[]
    let found: { apps: RawApp[]; profiles: RawProfile[] }
    try {
      const [l, appsR, profR] = await Promise.all([
        sessions(socket),
        wolfJson<{ apps?: RawApp[] }>(socket, 'GET', '/api/v1/apps'),
        wolfJson<{ profiles?: RawProfile[] }>(socket, 'GET', '/api/v1/profiles').catch(() => ({ profiles: [] as RawProfile[] })),
      ])
      list = l
      found = { apps: Array.isArray(appsR.apps) ? appsR.apps : [], profiles: (Array.isArray(profR.profiles) ? profR.profiles : []).filter((p) => typeof p.id === 'string' && Array.isArray(p.apps)) }
    } catch (e) {
      throw new ApiError(502, wolfProblem(e, socket))
    }
    const inProfile = found.profiles.map((p) => ({ p, a: p.apps.find((a) => a.id === appId) })).find((x) => x.a)
    const app = inProfile?.a ?? found.apps.find((a) => a.id === appId)
    if (!app || typeof app.title !== 'string' || LAUNCHER.test(app.title)) throw new ApiError(404, 'That app isn’t in Wolf anymore')
    if (inProfile && Array.isArray(inProfile.p.pin) && inProfile.p.pin.length > 0 && !user.Policy?.IsAdministrator)
      throw new ApiError(403, `${inProfile.p.name ?? 'That profile'} has a PIN. Start it in Moonlight, which asks for the PIN.`)
    const wanted = String(body.session ?? '')
    // Played in Finesse's page: the session Moonlight-Web opened for it.
    const browserClient = wanted.startsWith('browser:') ? browser.sessionFor(wanted.slice(8), user.Id, list.map(openSession)) : null
    const session = list.find((x) => (browserClient ? x.client_id === browserClient : sessionId(x.client_id as string) === wanted))
    if (!session) throw new ApiError(404, wanted.startsWith('browser:') ? 'The stream in this page ended. Start the game again.' : 'That Moonlight session ended. Open Moonlight on the device, then try again.')
    if (inProfile) {
      // A profile's app runs in a lobby, the way Wolf UI starts it: that's what gives it the profile's
      // own folder (its Steam sign-in, library and saves). Started straight in the session instead,
      // Wolf would hand it the launcher's folder: a fresh Steam asking to sign in.
      const pin = gpuPinEnv(app.render_node, await hostRenderCards(docker).catch(() => ({})))
      const runner = app.runner as { env?: unknown }
      const env = Array.isArray(runner.env) ? (runner.env as string[]) : []
      const pinned = pin.length && !env.some((e) => e.startsWith('MESA_VK_DEVICE_SELECT=')) ? { ...app, runner: { ...runner, env: [...env, ...pin] } } : app
      const lobby = lobbyRequest(inProfile.p.id, pinned, session)
      let lobbyId: string
      try {
        // Already running for this profile (left within the last few minutes): back into it. A second
        // copy would share the profile's folder with the first, and Wolf stops it at once.
        const running = (await wolfJson<{ lobbies?: { id?: unknown; name?: unknown; started_by_profile_id?: unknown; multi_user?: unknown }[] }>(socket, 'GET', '/api/v1/lobbies').catch(() => ({ lobbies: [] }))).lobbies ?? []
        lobbyId = String(running.find((l) => l.started_by_profile_id === inProfile.p.id && l.name === app.title)?.id ?? '')
        if (!lobbyId) lobbyId = (await wolfJson<{ lobby_id?: string }>(socket, 'POST', '/api/v1/lobbies/create', lobby)).lobby_id ?? ''
        if (!lobbyId) throw new WolfError('no lobby id')
        await wolfJson(socket, 'POST', '/api/v1/lobbies/join', { lobby_id: lobbyId, moonlight_session_id: session.client_id, pin: null })
        ourLobbies.set(lobbyId, null)
        saveLobbies()
        if (browserClient) browser.noteLobby(wanted.slice(8), lobbyId)
      } catch (e) {
        throw new ApiError(502, `Couldn’t start it: ${e instanceof WolfError ? e.message : wolfProblem(e, socket)}`)
      }
    } else {
      // Moonlight's own list (no profiles): straight in the session. Wolf starts the runner and
      // doesn't answer when it worked; a quiet socket, or one it hangs up, means it's starting.
      const sent = await wolfCall(socket, 'POST', '/api/v1/runners/start', { stop_stream_when_over: false, runner: app.runner, session_id: session.client_id }, { timeoutMs: 4000 })
        .then((x) => (x.status >= 400 ? `Wolf answered ${x.status}` : null))
        .catch((err: { code?: string }) => (runnerAccepted(err) ? null : wolfProblem(err, socket)))
      if (sent) throw new ApiError(502, `Couldn’t start it: ${sent}`)
    }
    log.info(`launch: started ${app.title} in a Moonlight session`)
    sendJson(res, 202, { ok: true, app: app.title })
  })

  // A stream in Finesse's page ends: end Wolf's session for it too. Left alone, Wolf keeps it (and its
  // launcher, and the graphics memory both hold) waiting for a Moonlight that isn't coming back.
  const endSession = async (socket: string, client: string) => {
    await wolfJson(socket, 'POST', '/api/v1/sessions/stop', { session_id: client }).catch((e) => log.warn(`stream end: ${wolfProblem(e, socket)}`))
  }
  router.post('/api/streaming/browser/alive', async ({ req, res }) => {
    const user = await auth.requireUser(req)
    const body = await readJson<{ play?: unknown }>(req)
    sendJson(res, browser.touch(String(body.play ?? ''), user.Id) ? 200 : 404, { ok: true })
  })
  router.post('/api/streaming/browser/close', async ({ req, res }) => {
    const user = await auth.requireUser(req)
    const socket = need()
    const body = await readJson<{ play?: unknown }>(req)
    const play = String(body.play ?? '')
    // Never launched anything into it (an app streamed on its own): find its session now.
    browser.sessionFor(play, user.Id, await sessions(socket).then((l) => l.map(openSession), () => []))
    const client = browser.finish(play, user.Id)
    if (client) await endSession(socket, client)
    sendJson(res, 200, { ok: true })
  })
  // A page that closed without saying so (the tab, the laptop lid): its session ends after a few minutes.
  // And whatever this Finesse doesn't know about (it restarted mid-game, or an older one left it):
  // Moonlight-Web's session in Wolf with no page here playing through it for 3 minutes ends too.
  let unusedSince = 0
  const abandon = setInterval(() => {
    const socket = socketOf()
    if (!socket) return
    for (const client of browser.abandoned(3 * 60_000)) {
      log.info('stream end: a page playing a game went away')
      void endSession(socket, client)
    }
    const client = browser.unusedClient()
    if (!client) return void (unusedSince = 0)
    void sessions(socket).then(
      (open) => {
        if (!open.some((x) => x.client_id === client)) return void (unusedSince = 0)
        if (!unusedSince) return void (unusedSince = Date.now())
        if (Date.now() - unusedSince < 3 * 60_000) return
        unusedSince = 0
        log.info('stream end: a browser stream nobody is watching')
        void endSession(socket, client)
      },
      () => {},
    )
  }, 30_000)
  abandon.unref()

  // Quit game, from the menu of a game played in Finesse's page: stop the game that play started.
  router.post('/api/streaming/browser/quit', async ({ req, res }) => {
    const user = await auth.requireUser(req)
    const socket = need()
    const body = await readJson<{ play?: unknown }>(req)
    const lobby = browser.lobbyOf(String(body.play ?? ''), user.Id)
    if (!lobby) throw new ApiError(404, 'That game isn’t running from here')
    try {
      await wolfJson(socket, 'POST', '/api/v1/lobbies/stop', { lobby_id: lobby, pin: null })
    } catch (e) {
      throw new ApiError(502, `Couldn’t close it: ${e instanceof WolfError ? e.message : wolfProblem(e, socket)}`)
    }
    ourLobbies.delete(lobby)
    saveLobbies()
    const client = browser.finish(String(body.play ?? ''), user.Id)
    if (client) await endSession(socket, client)
    log.info('launch: closed a game played in the page')
    sendJson(res, 200, { ok: true })
  })

  // Everyone at home: start a RomM game in an open Moonlight session, with its emulator.
  router.post('/api/streaming/play', async ({ req, res }) => {
    await auth.requireUser(req)
    const socket = need()
    const body = await readJson<{ rom?: unknown; session?: unknown; profile?: unknown }>(req)
    const e = settings.get().emulators
    const romm = settings.get().services.romm
    if (!e?.paths.roms || !romm?.url) throw new ApiError(404, 'Playing a game from here needs RomM and the emulators set up')
    const romId = Number(body.rom)
    if (!Number.isInteger(romId) || romId <= 0) throw new ApiError(400, 'Which game?')
    const rom = await fetchRom(romm, romId)
    const emu = emulatorForConsole(e, String(rom.platform_slug ?? ''))
    if (!emu) throw new ApiError(400, 'None of the emulator apps plays this console')
    const picked = pickGame(rom, emu, emulatorCatalog(e.switchEmulator)[emu].name)
    if ('error' in picked) throw new ApiError(400, picked.error)
    const game = picked.path
    let list: WolfSession[]
    let lists: { raw: WolfAppRaw[]; profiles: WolfProfileRaw[] }
    try {
      ;[list, lists] = await Promise.all([sessions(socket), wolfLists(socket)])
    } catch (err) {
      throw new ApiError(502, wolfProblem(err, socket))
    }
    const session = list.find((x) => sessionId(x.client_id as string) === String(body.session ?? ''))
    if (!session) throw new ApiError(404, 'That Moonlight session ended. Open Moonlight on the device, then try again.')
    const profiles = lists.profiles.filter((p) => typeof p.id === 'string').map((p) => p.id as string)
    const profile = typeof body.profile === 'string' && profiles.includes(body.profile) ? body.profile : profiles.length === 1 ? profiles[0]! : profiles.length ? null : 'shared'
    if (!profile) throw new ApiError(400, 'Whose saves? Pick a profile.')
    const base = appBase([...(lists.raw as RawApp[]), ...lists.profiles.flatMap((p) => (Array.isArray(p.apps) ? (p.apps as RawApp[]) : []))])
    if (!base) throw new ApiError(502, 'Wolf has no app to copy its video settings from')
    const app = wolfApp(emu, { settings: e, profile, base, game })
    const runner = { ...(app.runner as Record<string, unknown>), name: `Finesse-${emu}-play` }
    // Wolf starts the runner and doesn't answer when it worked; a quiet socket means it's starting.
    const sent = await wolfCall(socket, 'POST', '/api/v1/runners/start', { stop_stream_when_over: false, runner, session_id: session.client_id }, { timeoutMs: 4000 })
      .then((x) => (x.status >= 400 ? `Wolf answered ${x.status}` : null))
      .catch((err: { code?: string }) => (runnerAccepted(err) ? null : wolfProblem(err, socket)))
    if (sent) throw new ApiError(502, `Couldn’t start the game: ${sent}`)
    log.info(`play: started a ${emulatorCatalog(e.switchEmulator)[emu].name} game in a Moonlight session`)
    sendJson(res, 202, { ok: true, app: app.title })
  })


  // ---------- Steam games as their own apps ----------
  // Administrators pick installed Steam games; each becomes a Wolf app that opens Steam straight into it.

  type SteamPlace = { profile: RawProfile | null; app: RawApp }
  /** Wolf's Steam apps, and where each lives (a Wolf UI profile, or Moonlight's own list). */
  const steamPlaces = async (socket: string): Promise<{ places: SteamPlace[]; profiles: RawProfile[]; apps: RawApp[] }> => {
    const [appsR, profR] = await Promise.all([
      wolfJson<{ apps?: RawApp[] }>(socket, 'GET', '/api/v1/apps'),
      wolfJson<{ profiles?: RawProfile[] }>(socket, 'GET', '/api/v1/profiles').catch(() => ({ profiles: [] as RawProfile[] })),
    ])
    const apps = Array.isArray(appsR.apps) ? appsR.apps : []
    const profiles = (Array.isArray(profR.profiles) ? profR.profiles : []).filter((p) => typeof p.id === 'string' && Array.isArray(p.apps))
    const places: SteamPlace[] = [...profiles.flatMap((p) => p.apps.filter(isSteamApp).map((app) => ({ profile: p, app }))), ...apps.filter(isSteamApp).map((app) => ({ profile: null, app }))]
    return { places, profiles, apps }
  }

  let gamesCache: { at: number; games: SteamGame[] } | null = null
  /** The games installed in Wolf's Steam apps (cached a minute; reading them starts a container). */
  async function steamGames(places: SteamPlace[], maxAge = 60_000): Promise<SteamGame[]> {
    if (gamesCache && Date.now() - gamesCache.at < maxAge) return gamesCache.games
    const state = await wolfStateFolder(docker)
    if (!state) throw new ApiError(502, 'Finesse can’t find the folder Wolf keeps its apps in. Is Wolf running in Docker here?')
    const homes = [...new Set(places.filter((p) => p.profile).map((p) => `${state}/profile-data/${p.profile!.id}/${String((p.app.runner as { name: string }).name)}`))]
    if (!homes.length) throw new ApiError(400, 'Steam games need Wolf UI’s profiles (a newer Wolf): Steam’s folder is per profile there.')
    const all = new Map<number, SteamGame>()
    for (const home of homes) for (const g of await installedGames(docker, home)) all.set(g.appId, g)
    const games = [...all.values()].sort((a, b) => a.name.localeCompare(b.name))
    gamesCache = { at: Date.now(), games }
    return games
  }

  /** Replaces a profile's apps (Wolf changes a profile by replacing it); puts the old one back if Wolf refuses. */
  async function setProfileApps(socket: string, p: RawProfile, apps: RawApp[]) {
    await wolfJson(socket, 'POST', '/api/v1/profiles/remove', { id: p.id })
    try {
      await wolfJson(socket, 'POST', '/api/v1/profiles/add', { ...p, apps })
    } catch (e) {
      await wolfJson(socket, 'POST', '/api/v1/profiles/add', p).catch(() => log.error(`couldn’t restore Wolf profile ${p.name ?? p.id}`))
      throw e
    }
  }

  // ---------- Lutris games, the same way ----------
  let lutrisCache: { at: number; games: LutrisGame[] } | null = null
  /** The installed games in Wolf's Lutris apps (by profile), cached like Steam's. */
  async function lutrisGames(found: Awaited<ReturnType<typeof steamPlaces>>, maxAge = 60_000): Promise<LutrisGame[]> {
    if (lutrisCache && Date.now() - lutrisCache.at < maxAge) return lutrisCache.games
    const state = await wolfStateFolder(docker)
    if (!state) throw new ApiError(502, 'Finesse can’t find the folder Wolf keeps its apps in. Is Wolf running in Docker here?')
    const homes = [...new Set(found.profiles.flatMap((p) => p.apps.filter(isLutrisApp).map((a) => `${state}/profile-data/${p.id}/${String((a.runner as { name: string }).name)}`)))]
    const all = new Map<number, LutrisGame>()
    for (const home of homes) for (const g of await installedLutrisGames(docker, home)) all.set(g.id, g)
    const games = [...all.values()].sort((a, b) => a.name.localeCompare(b.name))
    lutrisCache = { at: Date.now(), games }
    return games
  }
  const hasLutris = (found: Awaited<ReturnType<typeof steamPlaces>>) => found.profiles.some((p) => p.apps.some(isLutrisApp))
  const lutrisIds = (found: Awaited<ReturnType<typeof steamPlaces>>) =>
    new Set(found.profiles.flatMap((p) => p.apps).map(lutrisShortcutId).filter((x): x is number => x !== null))
  async function addLutris(socket: string, found: Awaited<ReturnType<typeof steamPlaces>>, games: LutrisGame[]) {
    for (const p of found.profiles) {
      const lutris = p.apps.find(isLutrisApp)
      if (!lutris) continue
      const fresh = games.filter((g) => !p.apps.some((a) => lutrisShortcutId(a) === g.id))
      if (fresh.length) await setProfileApps(socket, p, [...p.apps, ...fresh.map((g) => lutrisShortcut(lutris, g))])
    }
    appsCache = null
  }
  async function removeLutris(socket: string, found: Awaited<ReturnType<typeof steamPlaces>>, ids: Set<number>) {
    let removed = 0
    for (const p of found.profiles) {
      const keep = p.apps.filter((a) => !ids.has(lutrisShortcutId(a) ?? -1))
      if (keep.length === p.apps.length) continue
      await setProfileApps(socket, p, keep)
      removed += p.apps.length - keep.length
    }
    appsCache = null
    return removed
  }

  // Administrators: Lutris's installed games, and which have tiles.
  router.get('/api/streaming/lutris', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const found = await steamPlaces(socket).catch(() => null)
    if (!found || !hasLutris(found)) return sendJson(res, 200, { ok: false, games: [] })
    try {
      const have = lutrisIds(found)
      sendJson(res, 200, { ok: true, games: (await lutrisGames(found)).map((g) => ({ ...g, added: have.has(g.id) })) })
    } catch (e) {
      sendJson(res, 200, { ok: false, games: [], error: (e as Error).message })
    }
  })
  router.post('/api/streaming/lutris/shortcuts', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const body = await readJson<{ id?: unknown; all?: unknown }>(req)
    const id = Number(body.id)
    if (body.all !== true && (!Number.isInteger(id) || id <= 0)) throw new ApiError(400, 'Which game?')
    const found = await steamPlaces(socket).catch((e) => {
      throw new ApiError(502, wolfProblem(e, socket))
    })
    if (!hasLutris(found)) throw new ApiError(404, 'Wolf has no Lutris app in a profile')
    const installed = await lutrisGames(found)
    const games = body.all === true ? installed : installed.filter((g) => g.id === id)
    if (!games.length) throw new ApiError(404, body.all === true ? 'No games are installed in Lutris' : 'That game isn’t installed in Lutris')
    const have = lutrisIds(found)
    try {
      await addLutris(socket, found, games)
    } catch (e) {
      throw new ApiError(502, e instanceof WolfError ? `Wolf didn’t take it: ${e.message}` : wolfProblem(e, socket))
    }
    log.info(`lutris: added ${games.length === 1 ? games[0]!.name : `${games.length} games`}`)
    sendJson(res, 201, { ok: true, title: games[0]!.name, added: games.filter((g) => !have.has(g.id)).length })
  })
  router.delete('/api/streaming/lutris/shortcuts/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Which game?')
    const found = await steamPlaces(socket).catch((e) => {
      throw new ApiError(502, wolfProblem(e, socket))
    })
    try {
      sendJson(res, 200, { ok: true, removed: await removeLutris(socket, found, new Set([id])) })
    } catch (e) {
      throw new ApiError(502, e instanceof WolfError ? `Wolf didn’t take it: ${e.message}` : wolfProblem(e, socket))
    }
  })

  router.get('/api/streaming/steam', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    let found: Awaited<ReturnType<typeof steamPlaces>>
    try {
      found = await steamPlaces(socket)
    } catch (e) {
      return sendJson(res, 200, { ok: false, games: [], error: wolfProblem(e, socket) })
    }
    if (!found.places.length) return sendJson(res, 200, { ok: false, games: [], error: 'Wolf has no Steam app. Add Steam in Wolf first, sign in, and install a game.' })
    const added = new Set([...found.apps, ...found.profiles.flatMap((p) => p.apps)].map(shortcutAppId).filter((x): x is number => x !== null))
    try {
      const games = await steamGames(found.places)
      sendJson(res, 200, { ok: true, sync: settings.get().streaming?.steamSync === true, games: games.map((g) => ({ ...g, added: added.has(g.appId) })) })
    } catch (e) {
      sendJson(res, 200, { ok: false, games: [], error: (e as Error).message })
    }
  })

  /** Adds shortcuts for these games next to every Steam app that lacks them: one change per profile. */
  async function addShortcuts(socket: string, found: Awaited<ReturnType<typeof steamPlaces>>, games: SteamGame[]) {
    if (!games.length) return
    // Two or more graphics cards: pin the game to the one the stream is drawn on.
    const cards = await hostRenderCards(docker).catch(() => ({}))
    for (const p of found.profiles) {
      const steam = p.apps.find(isSteamApp)
      if (!steam) continue
      const fresh = games.filter((g) => !p.apps.some((a) => shortcutAppId(a) === g.appId))
      if (fresh.length) await setProfileApps(socket, p, [...p.apps, ...fresh.map((g) => steamShortcut(steam, g, gpuPinEnv(steam.render_node, cards)))])
    }
    const top = found.apps.find(isSteamApp)
    if (top) {
      for (const g of games.filter((g) => !found.apps.some((a) => shortcutAppId(a) === g.appId)))
        await wolfJson(socket, 'POST', '/api/v1/apps/add', steamShortcut(top, g, gpuPinEnv(top.render_node, cards)))
    }
    appsCache = null
  }

  const shortcutIds = (found: Awaited<ReturnType<typeof steamPlaces>>) =>
    new Set([...found.apps, ...found.profiles.flatMap((p) => p.apps)].map(shortcutAppId).filter((x): x is number => x !== null))

  /** Removes these games' shortcuts everywhere: one change per profile. */
  async function removeShortcuts(socket: string, found: Awaited<ReturnType<typeof steamPlaces>>, appIds: Set<number>) {
    let removed = 0
    for (const p of found.profiles) {
      const keep = p.apps.filter((a) => !appIds.has(shortcutAppId(a) ?? -1))
      if (keep.length === p.apps.length) continue
      await setProfileApps(socket, p, keep)
      removed += p.apps.length - keep.length
    }
    for (const a of found.apps.filter((x) => appIds.has(shortcutAppId(x) ?? -1))) {
      await wolfJson(socket, 'POST', '/api/v1/apps/delete', { id: a.id })
      removed++
    }
    appsCache = null
    return removed
  }

  const wolfFail = (e: unknown, socket: string) => new ApiError(502, e instanceof WolfError ? `Wolf didn’t take it: ${e.message}` : wolfProblem(e, socket))
  const placesOr502 = (socket: string) =>
    steamPlaces(socket).catch((e) => {
      throw new ApiError(502, wolfProblem(e, socket))
    })

  // One game ({ appId }), or every installed game that isn't there yet ({ all: true }).
  router.post('/api/streaming/steam/shortcuts', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const body = await readJson<{ appId?: unknown; all?: unknown }>(req)
    const appId = Number(body.appId)
    if (body.all !== true && (!Number.isInteger(appId) || appId <= 0)) throw new ApiError(400, 'Which game?')
    const found = await placesOr502(socket)
    if (!found.places.length) throw new ApiError(404, 'Wolf has no Steam app')
    // Only games that are really installed, with Steam's own name for them.
    const installed = await steamGames(found.places)
    const games = body.all === true ? installed : installed.filter((g) => g.appId === appId)
    if (!games.length) throw new ApiError(404, body.all === true ? 'No games are installed in Wolf’s Steam' : 'That game isn’t installed in Wolf’s Steam')
    const have = shortcutIds(found)
    const added = games.filter((g) => !have.has(g.appId)).length
    try {
      await addShortcuts(socket, found, games)
    } catch (e) {
      throw wolfFail(e, socket)
    }
    log.info(body.all === true ? `steam: added ${added} games` : `steam: added ${games[0]!.name}`)
    sendJson(res, 201, { ok: true, title: games[0]!.name, added })
  })

  router.delete('/api/streaming/steam/shortcuts/:appId', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const appId = Number(params.appId)
    if (!Number.isInteger(appId) || appId <= 0) throw new ApiError(400, 'Which game?')
    const found = await placesOr502(socket)
    let removed: number
    try {
      removed = await removeShortcuts(socket, found, new Set([appId]))
    } catch (e) {
      throw wolfFail(e, socket)
    }
    sendJson(res, 200, { ok: true, removed })
  })

  // Keep in sync: games installed in Steam get their tile, uninstalled ones lose it. Checked every
  // few minutes while it's on (reading Steam's folder starts a small container, so not more often).
  async function syncSteam(socket: string) {
    const lut = await syncLutris(socket).catch((e) => {
      log.warn(`lutris sync: ${(e as Error).message}`)
      return { added: 0, removed: 0 }
    })
    const st = await syncSteamOnly(socket)
    return { added: st.added + lut.added, removed: st.removed + lut.removed }
  }
  async function syncLutris(socket: string) {
    const found = await steamPlaces(socket)
    if (!hasLutris(found)) return { added: 0, removed: 0 }
    lutrisCache = null
    const installed = await lutrisGames(found)
    const have = lutrisIds(found)
    const missing = installed.filter((g) => !have.has(g.id))
    const gone = installed.length ? new Set([...have].filter((id) => !installed.some((g) => g.id === id))) : new Set<number>()
    if (missing.length) await addLutris(socket, found, missing)
    if (gone.size) await removeLutris(socket, await steamPlaces(socket), gone)
    if (missing.length || gone.size) log.info(`lutris sync: ${missing.length} added, ${gone.size} removed`)
    return { added: missing.length, removed: gone.size }
  }
  async function syncSteamOnly(socket: string) {
    const found = await steamPlaces(socket)
    if (!found.places.length) return { added: 0, removed: 0 }
    gamesCache = null
    const installed = await steamGames(found.places)
    const have = shortcutIds(found)
    const missing = installed.filter((g) => !have.has(g.appId))
    // Nothing installed at all is more likely a Steam folder Finesse couldn't read than a library emptied: leave the tiles.
    const gone = installed.length ? new Set([...have].filter((id) => !installed.some((g) => g.appId === id))) : new Set<number>()
    if (missing.length) await addShortcuts(socket, found, missing)
    if (gone.size) await removeShortcuts(socket, await steamPlaces(socket), gone)
    if (missing.length || gone.size) log.info(`steam sync: ${missing.length} added, ${gone.size} removed`)
    return { added: missing.length, removed: gone.size }
  }
  let syncing = false
  const steamSync = setInterval(() => {
    const socket = socketOf()
    if (!socket || !settings.get().streaming?.steamSync || syncing) return
    syncing = true
    syncSteam(socket)
      .catch((e) => log.warn(`steam sync: ${e instanceof ApiError || e instanceof WolfError ? e.message : wolfProblem(e, socket)}`))
      .finally(() => (syncing = false))
  }, 5 * 60_000)
  steamSync.unref()

  router.put('/api/streaming/steam/sync', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const body = await readJson<{ on?: unknown }>(req)
    const on = body.on === true
    settings.update((x) => void (x.streaming = { ...x.streaming, steamSync: on }))
    let r = { added: 0, removed: 0 }
    if (on) {
      try {
        r = await syncSteam(socket)
      } catch (e) {
        throw e instanceof ApiError ? e : wolfFail(e, socket)
      }
    }
    sendJson(res, 200, { ok: true, on, ...r })
  })

  // Everyone at home: a shortcut's artwork, from Steam's store (fetched here, so the page only talks to Finesse).
  const art = new Map<number, { type: string; body: Buffer }>()
  router.get('/api/streaming/steam/art/:appId', async ({ req, res, params, url }) => {
    await auth.requireUser(req, { query: url.searchParams })
    const appId = Number(params.appId)
    if (!Number.isInteger(appId) || appId <= 0 || appId > 1e9) throw new ApiError(400, 'Which game?')
    if (!art.has(appId)) {
      let got: { type: string; body: Buffer } | null = null
      for (const u of steamArtUrls(appId)) {
        const r = await fetch(u, { signal: AbortSignal.timeout(8000) }).catch(() => null)
        const type = r?.headers.get('content-type') ?? ''
        if (r?.ok && type.startsWith('image/')) {
          const body = Buffer.from(await r.arrayBuffer())
          if (body.length < 4_000_000) {
            got = { type, body }
            break
          }
        }
      }
      if (art.size > 300) art.delete(art.keys().next().value!)
      // A miss isn't kept: Steam may just have been unreachable.
      if (got) art.set(appId, got)
    }
    const a = art.get(appId)
    if (!a) throw new ApiError(404, 'No artwork')
    res.writeHead(200, { 'Content-Type': a.type, 'Content-Length': String(a.body.length), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' })
    res.end(a.body)
  })
  return browser
}
