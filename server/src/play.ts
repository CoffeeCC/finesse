// Browser play (Beta): a game from RomM, in its emulator, streamed into the
// browser with Selkies (LinuxServer's desktop streaming: video over a
// WebSocket, audio, gamepads). Moonlight stays the low-latency way; this is
// for screens without it.
//
// Each session is its own container on Finesse's Docker network, labelled
// finesse.managed / finesse.play, made from the same emulator settings as the
// Wolf apps (folders by path, saves per profile). Finesse proxies it at
// /play/<session>/ behind the person's sign-in, and removes it when it's left
// idle. Nothing in the container is reachable from outside except through
// that proxy.

import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { request } from 'node:http'
import type { Duplex } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import type { Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { appMounts, emulatorCatalog, emulatorForConsole, launchScript, ownHome, type EmulatorId } from './emulators.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { proxyHttp, proxyUpgrade } from './http/proxy.ts'
import { logger } from './log.ts'
import { PLAY_IMAGE } from './stack/catalog.ts'
import { Docker, DockerError } from './stack/docker.ts'
import { fetchRom, gamePath } from './streaming.ts'
import { writeTar } from './tar.ts'

const log = logger('play')

/** Selkies' web port inside the container (its CUSTOM_PORT). */
const PORT = Number(process.env.FINESSE_PLAY_PORT || 3000)
const MAX = Math.max(1, Number(process.env.FINESSE_PLAY_MAX || 2))
const HOME = '/config'
/** Left with no one watching this long, a session is removed. */
const IDLE_MS = Number(process.env.FINESSE_PLAY_IDLE_MS || 5 * 60_000)
const MAX_AGE_MS = 6 * 3600_000
const COOKIE = 'finesse_play_token'

export interface PlaySession {
  id: string
  user: string
  emulator: EmulatorId
  title: string
  container: string
  state: 'starting' | 'ready' | 'error'
  detail?: string
  error?: string
  target?: string
  createdAt: number
  lastActive: number
  sockets: number
}

/** Whether browser play can run here: emulators set up, RomM, and Docker reachable. Updated in the background. */
export const playState = { available: false }

const ID = /^[0-9a-f]{12}$/

export function registerPlay(router: Router, deps: { settings: SettingsStore; auth: Auth; docker?: Docker }) {
  const { settings, auth } = deps
  const docker = deps.docker ?? new Docker()
  const sessions = new Map<string, PlaySession>()

  const configured = () => {
    const s = settings.get()
    return Boolean(s.emulators?.apps.some((a) => a !== 'esde') && s.emulators.paths.roms && s.services.romm?.url)
  }
  async function check() {
    playState.available = configured() && (await docker.ping().catch(() => false))
  }
  const timer = setInterval(() => void check(), 60_000)
  timer.unref()
  void check()

  // Finesse's own container: its network (so sessions are reachable) and image (for the device probe).
  let self: { networks: string[]; image: string | null } | null = null
  async function selfInfo() {
    if (self) return self
    const me = (await docker.inspect(hostname()).catch(() => null)) as { Config?: { Image?: string }; NetworkSettings?: { Networks?: Record<string, unknown> } } | null
    self = { networks: Object.keys(me?.NetworkSettings?.Networks ?? {}).filter((n) => n !== 'host' && n !== 'none'), image: me?.Config?.Image ?? null }
    return self
  }

  // The host's graphics devices, for the emulator and the encoder.
  let gpu: { devices: string[]; nvidia: boolean } | null = null
  async function gpuInfo() {
    if (gpu) return gpu
    const info = (await docker.info().catch(() => null)) as { Runtimes?: Record<string, unknown> } | null
    const nvidia = Boolean(info?.Runtimes && 'nvidia' in info.Runtimes)
    let devices: string[] = []
    const img = (await selfInfo()).image
    if (img) {
      const r = await docker.runOnce(img, ['sh', '-c', 'ls /host/dev/dri 2>/dev/null | grep -E "^(card|renderD)[0-9]+$"; true'], ['/dev:/host/dev:ro']).catch(() => null)
      devices = (r?.output ?? '').split(/\s+/).filter((d) => /^(card|renderD)\d+$/.test(d)).map((d) => `/dev/dri/${d}`)
    }
    gpu = { devices, nvidia }
    return gpu
  }

  async function remove(s: PlaySession, why: string) {
    sessions.delete(s.id)
    await docker.remove(s.container, { force: true }).catch((e) => log.warn(`removing ${s.container}: ${(e as Error).message}`))
    log.info(`session ${s.id} (${s.title}) removed: ${why}`)
  }

  // Leftovers from before a restart, then idle sessions every minute.
  void docker
    .list({ label: ['finesse.play=1'] })
    .then((list) => {
      for (const c of (list ?? []) as { Id: string }[]) void docker.remove(c.Id, { force: true }).catch(() => {})
    })
    .catch(() => {})
  const reaper = setInterval(() => {
    const now = Date.now()
    for (const s of sessions.values()) {
      if (s.state === 'error' && now - s.lastActive > 60_000) sessions.delete(s.id)
      else if (s.sockets === 0 && now - s.lastActive > IDLE_MS) void remove(s, 'idle')
      else if (now - s.createdAt > MAX_AGE_MS) void remove(s, 'six hours')
    }
  }, 60_000)
  reaper.unref()

  /** The upstream base for a session: its address on Finesse's network. */
  async function targetOf(container: string): Promise<string | null> {
    const c = (await docker.inspect(container).catch(() => null)) as { NetworkSettings?: { IPAddress?: string; Networks?: Record<string, { IPAddress?: string }> } } | null
    const ip = Object.values(c?.NetworkSettings?.Networks ?? {}).map((n) => n.IPAddress).find(Boolean) || c?.NetworkSettings?.IPAddress
    return ip ? `http://${ip}:${PORT}` : null
  }

  const upstreamReady = (target: string, id: string) =>
    new Promise<boolean>((resolve) => {
      const req = request(`${target}/play/${id}/`, { method: 'GET', timeout: 3000 }, (res) => {
        res.resume()
        resolve((res.statusCode ?? 500) < 400)
      })
      req.on('timeout', () => req.destroy())
      req.on('error', () => resolve(false))
      req.end()
    })

  async function startSession(s: PlaySession, spec: { emulator: EmulatorId; game: string; profile: string }) {
    const e = settings.get().emulators!
    const say = (d: string) => (s.detail = d)
    try {
      if (!(await docker.imageExists(PLAY_IMAGE))) {
        say('Getting the player (about 1 GB, once)…')
        await docker.pull(PLAY_IMAGE, (f) => say(`Getting the player — ${Math.round(f * 100)}%`))
      }
      say('Starting the emulator…')
      const [me, g] = await Promise.all([selfInfo(), gpuInfo()])
      const cat = emulatorCatalog(e.switchEmulator, HOME)
      const script = launchScript(cat[spec.emulator], Object.values(cat), { home: HOME, browser: true })
      const render = g.devices.find((d) => /renderD\d+$/.test(d))
      const tz = process.env.TZ
      const env = [
        'PUID=1000',
        'PGID=1000',
        ...(tz ? [`TZ=${tz}`] : []),
        `SUBFOLDER=/play/${s.id}/`,
        `CUSTOM_PORT=${PORT}`,
        `TITLE=${s.title}`,
        // A kiosk for one game: no file transfers, terminals or desktop menus.
        'HARDEN_DESKTOP=true',
        'HARDEN_OPENBOX=true',
        'NO_DECOR=true',
        'SELKIES_ENABLE_CLIPBOARD=false',
        'SELKIES_MICROPHONE_ENABLED=false',
        'SELKIES_WEBCAM_ENABLED=false',
        'SELKIES_VIDEO_STREAMING_MODE=true',
        'SELKIES_GAMEPAD_ENABLED=true',
        'APPIMAGE_EXTRACT_AND_RUN=1',
        ...(g.nvidia ? ['NVIDIA_DRIVER_CAPABILITIES=all', 'NVIDIA_VISIBLE_DEVICES=all'] : []),
        // The graphics card encodes the video (NVENC or VA-API). Intel and AMD also draw the desktop;
        // Nvidia's driver can't back the virtual display, so there the desktop stays on the processor.
        ...(render ? [`DRI_NODE=${render}`, ...(g.nvidia ? [] : [`DRINODE=${render}`])] : []),
        `FINESSE_GAME=${spec.game}`,
      ]
      await docker.remove(s.container, { force: true }).catch(() => {})
      await docker.create(s.container, {
        Image: PLAY_IMAGE,
        Hostname: 'finesse-play',
        Env: env,
        Labels: { 'finesse.managed': 'true', 'finesse.service': 'play', 'finesse.play': '1', 'finesse.play.session': s.id },
        HostConfig: {
          Binds: appMounts(spec.emulator, e, spec.profile, HOME),
          // Emulator settings (and what RPCS3 or Eden installs) per profile, between sessions.
          Mounts: [{ Type: 'volume', Source: `finesse-play-${spec.profile.replace(/[^\w.-]/g, '_')}-${spec.emulator}`, Target: HOME }],
          ShmSize: 1 << 30,
          Devices: g.devices.map((d) => ({ PathOnHost: d, PathInContainer: d, CgroupPermissions: 'rwm' })),
          ...(g.nvidia ? { DeviceRequests: [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu', 'video', 'compute', 'utility', 'graphics']] }] } : {}),
          ...(me.networks[0] ? { NetworkMode: me.networks[0] } : {}),
          SecurityOpt: ['seccomp=unconfined'],
          RestartPolicy: { Name: 'no' },
        },
      })
      // The desktop's autostart runs the emulator; the script is this session's.
      await docker.putArchive(s.container, '/', writeTar([
        { path: 'defaults/autostart', data: Buffer.from('bash /finesse-launch.sh\n'), mode: 0o755 },
        { path: 'finesse-launch.sh', data: Buffer.from(`${script}\n`), mode: 0o755 },
        // Runs as root before the desktop starts (LinuxServer's custom init hook).
        { path: 'custom-cont-init.d/50-finesse-home', data: Buffer.from(`#!/bin/bash\n${ownHome(HOME, 'abc')}\n`), mode: 0o755 },
      ]))
      await docker.start(s.container)
      const until = Date.now() + 90_000
      while (Date.now() < until) {
        const t = await targetOf(s.container)
        if (t && (await upstreamReady(t, s.id))) {
          s.target = t
          s.state = 'ready'
          s.detail = undefined
          s.lastActive = Date.now()
          log.info(`session ${s.id}: ${s.title} is ready`)
          return
        }
        const c = await docker.inspect(s.container)
        if (c && !c.State.Running) throw new Error(`The player stopped (exit ${c.State.ExitCode}).`)
        await new Promise((r) => setTimeout(r, 1000))
      }
      throw new Error('The player didn’t start within a minute and a half.')
    } catch (err) {
      s.state = 'error'
      s.error = err instanceof DockerError && err.status === 0 ? 'Finesse can’t reach Docker. Browser play needs Docker’s socket shared with Finesse.' : (err as Error).message
      s.lastActive = Date.now()
      log.warn(`session ${s.id}: ${s.error}`, (err as Error).message)
      await docker.remove(s.container, { force: true }).catch(() => {})
    }
  }

  const mine = (s: PlaySession | undefined, user: { Id: string; Policy?: { IsAdministrator?: boolean } }) =>
    s && (s.user === user.Id || user.Policy?.IsAdministrator) ? s : null

  const view = (s: PlaySession) => ({ id: s.id, title: s.title, emulator: s.emulator, state: s.state, detail: s.detail ?? null, error: s.error ?? null, url: `/play/${s.id}/` })

  // Start a game in the browser.
  router.post('/api/play', async ({ req, res }) => {
    const user = await auth.requireUser(req)
    const s = settings.get()
    const e = s.emulators
    if (!e || !configured()) throw new ApiError(404, 'Browser play needs the emulators set up (Settings → Server → Game streaming)')
    const body = await readJson<{ rom?: unknown; profile?: unknown }>(req)
    const romId = Number(body.rom)
    if (!Number.isInteger(romId) || romId <= 0) throw new ApiError(400, 'Which game?')
    if (!(await docker.ping().catch(() => false))) throw new ApiError(503, 'Finesse can’t reach Docker. Browser play needs Docker’s socket shared with Finesse.')
    const rom = await fetchRom(s.services.romm!, romId)
    const emulator = emulatorForConsole(e, String(rom.platform_slug ?? ''))
    if (!emulator || emulator === 'esde') throw new ApiError(400, 'None of the emulators plays this console')
    const game = gamePath(rom.fs_path, rom.fs_name)
    if (!game) throw new ApiError(400, 'RomM gave this game a path Finesse can’t use')
    const profile = typeof body.profile === 'string' && /^[\w.@-]{1,64}$/.test(body.profile) ? body.profile : 'shared'
    // One game per person at a time; a few at once for the whole house (they share the graphics card).
    for (const old of [...sessions.values()].filter((x) => x.user === user.Id)) await remove(old, 'a new game')
    if ([...sessions.values()].filter((x) => x.state !== 'error').length >= MAX) throw new ApiError(429, `${MAX} games are already playing in browsers. Try again when one ends.`)
    const id = randomBytes(6).toString('hex')
    const title = typeof rom.name === 'string' && rom.name ? rom.name.slice(0, 80) : 'Game'
    const session: PlaySession = { id, user: user.Id, emulator, title, container: `finesse-play-${id}`, state: 'starting', detail: 'Getting ready…', createdAt: Date.now(), lastActive: Date.now(), sockets: 0 }
    sessions.set(id, session)
    void startSession(session, { emulator, game, profile })
    log.info(`session ${id}: ${emulatorCatalog(e.switchEmulator)[emulator].name} for ${user.Name ?? 'someone'}`)
    sendJson(res, 202, view(session))
  })

  router.get('/api/play/:id', async ({ req, res, params }) => {
    const user = await auth.requireUser(req)
    const s = mine(sessions.get(params.id ?? ''), user)
    if (!s) throw new ApiError(404, 'That game has ended')
    sendJson(res, 200, view(s))
  })

  router.delete('/api/play/:id', async ({ req, res, params }) => {
    const user = await auth.requireUser(req)
    const s = mine(sessions.get(params.id ?? ''), user)
    if (s) await remove(s, 'stopped')
    sendJson(res, 200, { ok: true })
  })

  // Administrators: the player's last log lines, when a game won't start.
  router.get('/api/play/:id/log', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const s = sessions.get(params.id ?? '')
    if (!s) throw new ApiError(404, 'That game has ended')
    const text = await docker.logs(s.container, 120).catch(() => '')
    // The emulator's own output, and what's running (by program name).
    const inside = await docker.exec(s.container, ['sh', '-c', `tail -n 80 ${HOME}/finesse-play.log 2>/dev/null; echo '--- running:'; ps -eo comm= | sort | uniq -c | sort -rn | head -20`]).catch(() => null)
    sendJson(res, 200, { log: text.split('\n').slice(-120).join('\n'), emulator: inside?.output ?? '' })
  })

  // The session itself: Selkies' page and files, for its owner (the cookie carries the sign-in).
  router.any('/play/:id/*', async ({ req, res, params, url }) => {
    const user = await auth.requireUser(req, { cookie: COOKIE })
    const s = mine(sessions.get(params.id ?? ''), user)
    if (!s || s.state !== 'ready' || !s.target) throw new ApiError(404, 'That game has ended')
    s.lastActive = Date.now()
    await proxyHttp(req, res, { target: new URL(`${s.target}/play/${s.id}/${params.rest ?? ''}${url.search}`), stripAuth: true, timeoutMs: 30000 })
  })
  router.get('/play/:id', ({ res, params }) => {
    res.writeHead(302, { Location: `/play/${encodeURIComponent(params.id ?? '')}/` })
    res.end()
  })

  /** WebSocket upgrades for /play/<id>/…: the video, audio and input. True when it's ours. */
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url ?? '/', 'http://x')
    const m = /^\/(?:finesse\/)?play\/([0-9a-f]+)\/(.*)$/.exec(url.pathname)
    if (!m) return false
    void (async () => {
      try {
        const user = await auth.requireUser(req, { cookie: COOKIE })
        const s = ID.test(m[1]!) ? mine(sessions.get(m[1]!), user) : null
        if (!s || s.state !== 'ready' || !s.target) return void socket.destroy()
        s.sockets++
        s.lastActive = Date.now()
        socket.on('close', () => {
          s.sockets = Math.max(0, s.sockets - 1)
          s.lastActive = Date.now()
        })
        const target = new URL(`${s.target.replace(/^http/, 'ws')}/play/${s.id}/${m[2]}${url.search}`)
        proxyUpgrade(req, socket, head, { target, stripAuth: true })
      } catch {
        socket.destroy()
      }
    })()
    return true
  }

  return { upgrade, sessions, check }
}
