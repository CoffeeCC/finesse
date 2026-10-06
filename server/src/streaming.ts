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
import { request } from 'node:http'
import type { Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { logger } from './log.ts'
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
}

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
export function publicApps(raw: WolfAppRaw[]): StreamApp[] {
  return raw
    .filter((a) => typeof a.id === 'string' && typeof a.title === 'string' && !TEST_APP.test(a.title))
    .map((a) => ({
      id: a.id as string,
      title: a.title as string,
      hdr: a.support_hdr === true,
      icon: typeof a.icon_png_path === 'string' && SAFE_ICON.test(a.icon_png_path),
      ...(LAUNCHER.test(a.title as string) ? { launcher: true as const } : {}),
    }))
}

/** Wolf's profiles (Wolf UI's "who's playing"), with only their names and apps: never their PINs. */
export function publicProfiles(raw: WolfProfileRaw[]): StreamProfile[] {
  return raw
    .filter((p) => typeof p.id === 'string' && Array.isArray(p.apps))
    .map((p) => ({ id: p.id as string, name: typeof p.name === 'string' && p.name ? p.name : (p.id as string), apps: publicApps(p.apps as WolfAppRaw[]) }))
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

export function registerStreaming(router: Router, deps: { settings: SettingsStore; auth: Auth }) {
  const { settings, auth } = deps
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

  // Everyone at home: what can be streamed.
  router.get('/api/streaming', async ({ req, res }) => {
    await auth.requireUser(req)
    const socket = need()
    try {
      const { raw, profiles } = await wolfLists(socket)
      sendJson(res, 200, { ok: true, apps: publicApps(raw), profiles: publicProfiles(profiles), emulators: publicEmulators(raw, profiles) })
    } catch (e) {
      log.warn(`apps: ${wolfProblem(e, socket)}`)
      sendJson(res, 200, { ok: false, apps: [], error: 'Game streaming isn’t answering right now. Try again in a minute.' })
    }
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
  type WolfSession = { client_id?: unknown; client_ip?: unknown; app_id?: unknown }
  const sessions = async (socket: string) => (await wolfJson<{ sessions?: WolfSession[] }>(socket, 'GET', '/api/v1/sessions')).sessions?.filter((x) => typeof x.client_id === 'string') ?? []

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
      .catch((err: { code?: string }) => (err.code === 'ETIMEDOUT' ? null : wolfProblem(err, socket)))
    if (sent) throw new ApiError(502, `Couldn’t start the game: ${sent}`)
    log.info(`play: started a ${emulatorCatalog(e.switchEmulator)[emu].name} game in a Moonlight session`)
    sendJson(res, 202, { ok: true, app: app.title })
  })

}
