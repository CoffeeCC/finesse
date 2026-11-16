// Playing an installed store game (WS6). Two ways, chosen each time:
// on the server's own screen, and streamed through Wolf (Moonlight, or the
// browser player). The install sandbox has no graphics card, so a game that
// only failed its start check still plays here.
//
// Stream runs the game inside a Wolf app on the Lutris image: that image has
// the same kind of Wine the sandbox installs with, plus DXVK/VKD3D and Wolf's
// own entrypoint, and it gets the GPU. The game folder is the only mount, and
// the Wine prefix lives inside it, so a game started on the screen and later
// streamed keeps its saves.

import { resolve, relative } from 'node:path'
import type { PlayWay } from './types.ts'
import type { StoredRequest } from './db.ts'

/** Wolf-compatible image with Wine, DXVK and VKD3D. Not the install sandbox (that one has no GPU). */
export const PLAY_IMAGE = process.env.FINESSE_PLAY_IMAGE || 'ghcr.io/games-on-whales/lutris:edge'

export const NO_SCREEN = 'This server has no screen'
export const NOBODY_SIGNED_IN = 'Nobody is signed in at this PC'
export const STREAM_OFF = 'Game streaming is off'
export const STREAM_WINDOWS = 'Streaming from a Windows server isn’t set up yet.'
export const NO_VIDEO = 'Game streaming isn’t ready yet. Open Wolf once, then try again.'
export const NOT_INSTALLED = 'That game isn’t installed yet.'
export const BAD_FILES = 'That game’s files aren’t where Finesse left them.'
/** Windows can see a signed-in desktop, but starting the game there isn’t built yet (WS5). */
export const DESKTOP_LATER = 'Play on this PC’s desktop isn’t set up yet.'

export interface PlayGame {
  id: string
  title: string
  /** Relative to the games folder. */
  dir: string
  /** Relative to dir. */
  program: string
  linux: boolean
}

/** A path a game is allowed to name: under the folder it was given, nothing else. */
export function safeRelative(p: string | undefined): string | null {
  if (!p || p.includes('\0') || /[\r\n]/.test(p)) return null
  // Absolute paths are someone else's files, not a file inside the game folder.
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) return null
  const parts = p.split(/[/\\]/).filter((x) => x !== '' && x !== '.')
  if (!parts.length || parts.some((x) => x === '..')) return null
  return parts.join('/')
}

/** The game's folder on the host, or null when the stored path leaves the games folder. */
export function gameHostDir(root: string, dir: string): string | null {
  const rel = safeRelative(dir)
  if (!rel) return null
  const base = resolve(root)
  const full = resolve(base, rel)
  const back = relative(base, full)
  if (back.startsWith('..') || back === '') return null
  return full
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * One line a shell can run. Windows games go through Wine; the prefix is
 * `.finesse-prefix` in the game folder, which is the only place it can write.
 */
export function launchLine(game: PlayGame): string | null {
  const program = safeRelative(game.program)
  if (!program) return null
  const file = `/game/${program}`
  if (game.linux) return `chmod +x ${q(file)} && exec ${q(file)}`
  return `mkdir -p /game/.finesse-prefix && export WINEPREFIX=/game/.finesse-prefix WINEDLLOVERRIDES=winemenubuilder.exe=d DXVK_STATE_CACHE_PATH=/game/.finesse-prefix && exec wine ${q(file)}`
}

/** Wolf app id for one request. Stable, and not an emulator id. */
export const gameAppId = (id: string) => `store-${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`

export interface LocalSpec {
  name: string
  image: string
  user: string
  /** X display (`:0`) or a Wayland socket name. */
  display: string
  wayland?: string
  /** Host directory that holds the Wayland socket. */
  runtime?: string
  hostDir: string
  command: string
}

const GPU_JSON = JSON.stringify({
  HostConfig: {
    IpcMode: 'host',
    CapAdd: ['NET_RAW', 'MKNOD', 'NET_ADMIN', 'SYS_NICE'],
    Privileged: false,
    DeviceCgroupRules: ['c 13:* rmw', 'c 244:* rmw'],
  },
})

/** One installed game as a Wolf app. `video` is copied from an app Wolf already has. */
export function storeWolfApp(game: PlayGame, video: Record<string, unknown>, hostDir: string, image = PLAY_IMAGE): Record<string, unknown> | null {
  const command = launchLine(game)
  if (!command || hostDir.includes(':')) return null
  return {
    ...video,
    title: game.title,
    id: gameAppId(game.id),
    support_hdr: false,
    start_virtual_compositor: true,
    start_audio_server: true,
    runner: {
      type: 'docker',
      // Not `Finesse-`: emulator sync keeps every app whose runner isn't one of its own.
      name: `Store-${gameAppId(game.id)}`,
      image,
      mounts: [`${hostDir}:/game:rw`],
      env: ['RUN_SWAY=1', 'GOW_REQUIRED_DEVICES=/dev/input/* /dev/dri/* /dev/nvidia*', `FINESSE_LAUNCH=${command}`],
      devices: [],
      ports: [],
      base_create_json: JSON.stringify({
        ...JSON.parse(GPU_JSON),
        // One command, the same shape as the emulator apps: Wolf runs it after its own setup.
        Cmd: ['exec gosu "${UNAME:-retro}" bash -c "$FINESSE_LAUNCH"'],
      }),
    },
  }
}

/** Names from `ls` of the X socket dir and the user runtime dirs. Null when there's no display. */
export function displayFromListing(text: string): { display: string; wayland?: string } | null {
  const tokens = text.split(/[\s/]+/).map((s) => s.trim()).filter(Boolean)
  const x = tokens.find((n) => /^X\d+$/.test(n))
  if (x) return { display: `:${x.slice(1)}` }
  const w = tokens.find((n) => /^wayland-\d+$/.test(n))
  if (w) return { display: w, wayland: w }
  return null
}

/** `query user` on Windows: a person at the console, or why there isn't one. */
export function windowsSession(queryUser: string): { ok: true } | { ok: false; why: string } {
  const rows = queryUser.split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean)
  const active = rows.some((l) => /\bActive\b/.test(l) && !/\bDisc\b/.test(l))
  return active ? { ok: true } : { ok: false, why: NOBODY_SIGNED_IN }
}

type Rec = Record<string, unknown>

export interface WolfPlay {
  lists(): Promise<{ apps: Rec[]; profiles: Rec[] }>
  /** Video pipelines copied from an app Wolf already runs, or null when Wolf has none. */
  video(apps: Rec[]): Rec | null
  addApp(app: Rec): Promise<void>
  deleteApp(id: string): Promise<void>
  removeProfile(id: string): Promise<void>
  addProfile(profile: Rec): Promise<void>
}

const sameRunner = (a: Rec | undefined, b: Rec) => JSON.stringify(a?.runner ?? null) === JSON.stringify(b.runner) && a?.title === b.title

/** Make sure Wolf has this game, in every profile (or on Moonlight's own list when there are none). */
export async function ensureWolfGame(wolf: WolfPlay, app: Rec): Promise<void> {
  const { apps, profiles } = await wolf.lists()
  const id = String(app.id)
  const usable = profiles.filter((p) => typeof p.id === 'string' && Array.isArray(p.apps))
  if (usable.length) {
    for (const p of usable) {
      const cur = (p.apps as Rec[]).find((a) => a.id === id)
      if (sameRunner(cur, app)) continue
      const next = { ...p, apps: [...(p.apps as Rec[]).filter((a) => a.id !== id), app] }
      await wolf.removeProfile(String(p.id))
      try {
        await wolf.addProfile(next)
      } catch (e) {
        await wolf.addProfile(p).catch(() => {})
        throw e
      }
    }
    return
  }
  const cur = apps.find((a) => a.id === id)
  if (sameRunner(cur, app)) return
  if (cur) await wolf.deleteApp(id).catch(() => {})
  await wolf.addApp(app)
}

/** Take the game back out of Wolf. Missing is fine. */
export async function forgetWolfGame(wolf: WolfPlay, id: string): Promise<void> {
  const appId = gameAppId(id)
  const { profiles } = await wolf.lists()
  for (const p of profiles) {
    if (typeof p.id !== 'string' || !Array.isArray(p.apps)) continue
    if (!(p.apps as Rec[]).some((a) => a.id === appId)) continue
    const next = { ...p, apps: (p.apps as Rec[]).filter((a) => a.id !== appId) }
    await wolf.removeProfile(p.id)
    try {
      await wolf.addProfile(next)
    } catch (e) {
      await wolf.addProfile(p).catch(() => {})
      throw e
    }
  }
  await wolf.deleteApp(appId).catch(() => {})
}

export interface PlayWayInfo {
  way: PlayWay
  ok: boolean
  why?: string
}

export interface PlayOptions {
  serverName: string
  last: { way: PlayWay; target: string } | null
  ways: PlayWayInfo[]
  /** Set when Stream can start: the Wolf app id the browser and Moonlight use. */
  appId?: string
}

export interface Desktop {
  ok: true
  display: string
  wayland?: string
  runtime?: string
}

export interface PlayDeps {
  host: 'linux' | 'windows'
  serverName: string
  /** `media/games/pc` as the host names it, or null before the server is set up. */
  gamesRoot(): string | null
  desktop(): Promise<Desktop | { ok: false; why: string }>
  /** Null when game streaming isn't set up. */
  wolf(): WolfPlay | null
  /** puid:pgid the game's files belong to. */
  user(): string
  startLocal(spec: LocalSpec): Promise<void>
  last(userId: string): { way: PlayWay; target: string } | null
  remember(userId: string, way: PlayWay, target: string): void
}

export interface PlayAnswer {
  appId?: string
}

export interface StorePlay {
  options(r: StoredRequest, userId: string): Promise<PlayOptions>
  start(r: StoredRequest, userId: string, way: PlayWay, target: string): Promise<PlayAnswer>
  forget(r: StoredRequest): Promise<void>
  /** Absolute path of the start-check picture, or null. */
  shot(r: StoredRequest): string | null
}

const gameOf = (r: StoredRequest, root: string): { game: PlayGame; hostDir: string } | { error: string } => {
  if (r.state !== 'ready' || !r.installDir || !r.program) return { error: NOT_INSTALLED }
  const hostDir = gameHostDir(root, r.installDir)
  const program = safeRelative(r.program)
  if (!hostDir || !program) return { error: BAD_FILES }
  return { game: { id: r.id, title: r.title, dir: r.installDir, program, linux: r.platform === 'linux' }, hostDir }
}

export function createStorePlay(deps: PlayDeps): StorePlay {
  const placed = (r: StoredRequest) => {
    const root = deps.gamesRoot()
    if (!root) return { error: 'This server has no games folder yet.' } as const
    return gameOf(r, root)
  }

  async function streamWay(): Promise<PlayWayInfo> {
    if (deps.host === 'windows') return { way: 'stream', ok: false, why: STREAM_WINDOWS }
    const wolf = deps.wolf()
    if (!wolf) return { way: 'stream', ok: false, why: STREAM_OFF }
    try {
      const { apps, profiles } = await wolf.lists()
      const all = [...apps, ...profiles.flatMap((p) => (Array.isArray(p.apps) ? (p.apps as Rec[]) : []))]
      if (!wolf.video(all)) return { way: 'stream', ok: false, why: NO_VIDEO }
      return { way: 'stream', ok: true }
    } catch (e) {
      return { way: 'stream', ok: false, why: (e as Error).message || STREAM_OFF }
    }
  }

  async function serverWay(): Promise<PlayWayInfo> {
    const d = await deps.desktop()
    return d.ok ? { way: 'server', ok: true } : { way: 'server', ok: false, why: d.why }
  }

  return {
    async options(r, userId) {
      const [server, stream] = await Promise.all([serverWay(), streamWay()])
      return { serverName: deps.serverName, last: deps.last(userId), ways: [server, stream], ...(r.state === 'ready' ? { appId: gameAppId(r.id) } : {}) }
    },
    async start(r, userId, way, target) {
      const got = placed(r)
      if ('error' in got) throw new Error(got.error)
      if (way === 'server') {
        const d = await deps.desktop()
        if (!d.ok) throw new Error(d.why)
        const command = launchLine(got.game)
        if (!command) throw new Error(BAD_FILES)
        await deps.startLocal({
          name: `finesse-play-${r.id}`,
          image: PLAY_IMAGE,
          user: deps.user(),
          display: d.display,
          ...(d.wayland ? { wayland: d.wayland } : {}),
          ...(d.runtime ? { runtime: d.runtime } : {}),
          hostDir: got.hostDir,
          command,
        })
        deps.remember(userId, way, target || 'server')
        return {}
      }
      const info = await streamWay()
      if (!info.ok) throw new Error(info.why)
      const wolf = deps.wolf()
      if (!wolf) throw new Error(STREAM_OFF)
      const { apps, profiles } = await wolf.lists()
      const all = [...apps, ...profiles.flatMap((p) => (Array.isArray(p.apps) ? (p.apps as Rec[]) : []))]
      const video = wolf.video(all)
      if (!video) throw new Error(NO_VIDEO)
      const app = storeWolfApp(got.game, video, got.hostDir)
      if (!app) throw new Error(BAD_FILES)
      await ensureWolfGame(wolf, app)
      deps.remember(userId, way, target || 'browser')
      return { appId: gameAppId(r.id) }
    },
    async forget(r) {
      const wolf = deps.wolf()
      if (!wolf) return
      await forgetWolfGame(wolf, r.id)
    },
    shot(r) {
      const root = deps.gamesRoot()
      const rel = safeRelative(r.screenshot)
      if (!root || !rel || r.state !== 'ready') return null
      const base = resolve(root)
      const full = resolve(base, rel)
      if (relative(base, full).startsWith('..')) return null
      return full
    },
  }
}
