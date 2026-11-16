// Plugs the request pipeline into a running server: magnets through the bundled qBittorrent
// behind the VPN, https downloads fetched directly, both into the data folder. A finished, checked
// download is installed by the engine (install.ts) in a sandbox: on Linux a container with no
// network (sandbox.ts). Windows hosts get theirs later (WS5); until then a request there
// downloads, is checked, and stops saying so, keeping the download for "Try again".

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, readdirSync } from 'node:fs'
import { mkdir, rm, statfs } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { pipeline as pump } from 'node:stream/promises'
import { promisify } from 'node:util'
import { ApiError } from '../http/core.ts'
import type { SettingsStore } from '../config.ts'
import { fromApp, toApp } from '../stack/apppaths.ts'
import { INSTALLER_IMAGE, wolfSocket } from '../stack/catalog.ts'
import { Docker } from '../stack/docker.ts'
import { isNative } from '../stack/host.ts'
import { appBase, wolfCall, wolfProblem } from '../streaming.ts'
import { DirectDownloader, safeFileName } from './direct.ts'
import { NO_SEEDING, Pipeline, type Installer } from './pipeline.ts'
import { DESKTOP_LATER, NO_SCREEN, createStorePlay, displayFromListing, windowsSession, type Desktop, type LocalSpec } from './play.ts'
import { QbitDownloader } from './qbit.ts'
import { YOURS, type GameStore } from './routes.ts'
import { DockerInstaller, GAMES_PC, hostResources, sandboxLimits } from './sandbox.ts'

export const NO_SANDBOX = 'It’s downloaded and checked, but Finesse can’t install games on Windows servers yet. That arrives with a later update. The download is kept, so “Try again” then carries on from here.'

/** Stands in until this host has a sandbox to install in. */
export const noInstaller: Installer = {
  install: async () => ({ state: 'failed', reason: NO_SANDBOX, log: [] }),
  finish: async () => ({ state: 'failed', reason: NO_SANDBOX, log: [] }),
  remove: async () => {},
}

/** Where game downloads land, under the data folder (as the apps name it for qBittorrent). */
export const TORRENT_GAMES = 'torrents/games'
export const DIRECT_GAMES = 'downloads/games'

/**
 * Gives the store its pipeline on servers Finesse set up (it needs the data folder and, for
 * magnets, its own VPN-protected qBittorrent). Elsewhere there's none, and requests say so.
 */
export function plugPipeline(store: GameStore, settings: SettingsStore, opts: { installer?: Installer; log?: (text: string) => void } = {}): void {
  const stack = () => {
    const s = settings.get()
    return s.mode === 'bundle' && s.stack && s.setup.state === 'ready' ? s.stack : null
  }
  const torrents = new QbitDownloader({
    config: () => {
      const q = settings.get().services.qbittorrent
      return stack() && q?.url ? { url: q.url, username: q.username, password: q.password } : null
    },
    vpn: () => {
      const st = stack()
      // Docker: qBittorrent lives inside Gluetun's network. Windows: it's locked to the VPN's adapter.
      if (st?.vpn && !isNative()) return { ok: true }
      if (st?.vpnAdapter) return { ok: true, adapter: st.vpnAdapter }
      return { ok: false, why: 'Games that download by torrent only go through a VPN Finesse set up, and this server doesn’t have one. Add a VPN in Settings → Server.' }
    },
    localPath: (p) => (stack() ? fromApp(stack()!.hostData, p) : null),
    savePath: () => (stack() ? toApp(stack()!.hostData, TORRENT_GAMES) : null),
  })
  // Linux (Docker): installs run in the sandbox. A host can hand in its own (tests, Windows later).
  // A caller that brought its own installer (the tests do) doesn't also get the Docker one.
  const sandbox =
    opts.installer !== undefined || isNative()
      ? null
      : new DockerInstaller({
          docker: Object.assign(new Docker(), { instance: settings.get().instanceId }),
          image: INSTALLER_IMAGE,
          where: () => {
            const st = stack()
            return st ? { hostData: st.hostData, puid: st.puid, pgid: st.pgid } : null
          },
          instance: settings.get().instanceId,
          limits: () => sandboxLimits(settings.get().gameStore?.sandbox, hostResources()),
          log: opts.log,
        })
  // Containers from installs that a restart interrupted: their requests start over (or, waiting on a
  // person, start a fresh sandbox when they're done).
  if (sandbox && stack()) void sandbox.sweep().catch(() => {})
  const installer = opts.installer ?? sandbox ?? noInstaller
  let direct: DirectDownloader | null = null
  // Made when first needed: a server that's still being set up gets its pipeline once setup is done.
  let pipeline: Pipeline | null = null
  const get = (): Pipeline | undefined => {
    const st = stack()
    if (!pipeline && st) {
      const files = (direct = new DirectDownloader(join(st.hostData, ...DIRECT_GAMES.split('/'))))
      pipeline = new Pipeline({
        db: store.db,
        downloaderFor: (s) => (s.magnet ? torrents : files),
        installer,
        freeBytes: async () => {
          const f = await statfs(stack()?.hostData ?? '/')
          return f.bavail * f.bsize
        },
        seeding: () => settings.get().gameStore?.seeding ?? NO_SEEDING,
        log: opts.log,
      })
      pipeline.run()
    }
    return pipeline ?? undefined
  }
  Object.defineProperty(store, 'pipeline', { get, enumerable: true })

  // A game from a file an administrator has: streamed into its own folder beside the direct
  // downloads, listed in the store, and picked up by the pipeline at "checking".
  store.upload = async (body, meta, user) => {
    const p = get()
    const st = stack()
    if (!p || !st || !direct) throw new ApiError(501, 'This server can’t take game files: that needs a server Finesse set up itself.')
    const free = await statfs(st.hostData).then((f) => f.bavail * f.bsize, () => Infinity)
    if (free < meta.sizeBytes * 3) throw new ApiError(507, 'There isn’t enough room on the server for this game and its install. Free some space and try again.')
    const id = randomUUID().replace(/-/g, '').slice(0, 16)
    const folder = direct.folder(id)
    await mkdir(folder, { recursive: true })
    try {
      await pump(body, createWriteStream(join(folder, safeFileName(meta.fileName))))
    } catch (e) {
      await rm(folder, { recursive: true, force: true })
      throw new ApiError(400, 'The file didn’t arrive in one piece. Try again.')
    }
    const slug = meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'game'
    const game = { id: `${YOURS}-${slug}-${id.slice(0, 6)}`, title: meta.title, summary: 'Added from a file on this server.', genres: [], modes: ['single' as const], platforms: [meta.platform], addedAt: new Date().toISOString(), popularity: 0, provider: YOURS }
    const source = { id: `${game.id}-file`, gameId: game.id, platform: meta.platform, installer: 'unknown' as const, sizeBytes: meta.sizeBytes, local: true, installerHint: safeFileName(meta.fileName) }
    store.db.putGame(game, [source])
    return p.adopt(id, game, source, user, folder)
  }
  store.installs = installer !== noInstaller
  if (sandbox) store.screen = (r) => sandbox.screen(r)
  attachPlay(store, settings)
  get()
}

const execFileAsync = promisify(execFile)

/** Names of sockets in the X directory and each user's runtime directory. */
function localDisplays(): { display: string; wayland?: string; runtime?: string } | null {
  try {
    const hit = displayFromListing(readdirSync('/tmp/.X11-unix').join('\n'))
    if (hit && !hit.wayland) return hit
  } catch {
    /* the screen socket isn't mounted here */
  }
  try {
    for (const uid of readdirSync('/run/user')) {
      let names: string[] = []
      try {
        names = readdirSync(join('/run/user', uid))
      } catch {
        continue
      }
      const hit = displayFromListing(names.join('\n'))
      if (hit?.wayland) return { ...hit, runtime: join('/run/user', uid) }
    }
  } catch {
    /* no per-user runtime directory */
  }
  return null
}

/** A desktop session on this host, or why there isn't one. Cached by the caller. */
async function probeDesktop(docker: Docker): Promise<Desktop | { ok: false; why: string }> {
  if (isNative()) {
    try {
      const { stdout } = await execFileAsync('query', ['user'], { windowsHide: true, timeout: 5000 })
      const session = windowsSession(String(stdout))
      if (!session.ok) return session
    } catch {
      /* query user isn't on this PC */
    }
    return { ok: false, why: DESKTOP_LATER }
  }
  const here = localDisplays()
  if (here) return { ok: true, ...here }
  // Finesse's own container often can't see the host's sockets. Look from a container that can.
  try {
    const ran = await docker.runOnce(
      INSTALLER_IMAGE,
      ['sh', '-c', 'ls /x 2>/dev/null; ls -d /run/user/*/wayland-* 2>/dev/null'],
      ['/tmp/.X11-unix:/x:ro', '/run/user:/run/user:ro'],
    )
    const wayland = /\/run\/user\/(\d+)\/(wayland-\d+)/.exec(ran.output)
    if (wayland) return { ok: true, display: wayland[2]!, wayland: wayland[2]!, runtime: `/run/user/${wayland[1]}` }
    const seen = displayFromListing(ran.output)
    if (seen) return { ok: true, ...seen }
  } catch {
    /* no installer image, or Docker isn't here */
  }
  return { ok: false, why: NO_SCREEN }
}

/** Starts the game on the host's display. The game folder is the only place it can write. */
async function startOnDesktop(docker: Docker, spec: LocalSpec): Promise<void> {
  const cur = (await docker.inspect(spec.name)) as { State?: { Running?: boolean } } | null
  if (cur?.State?.Running) return
  if (cur) await docker.remove(spec.name, { force: true })
  const binds = [`${spec.hostDir}:/game:rw`, '/dev/dri:/dev/dri']
  const env = spec.wayland ? [`WAYLAND_DISPLAY=${spec.wayland}`, 'XDG_RUNTIME_DIR=/tmp/runtime'] : [`DISPLAY=${spec.display}`]
  if (spec.wayland && spec.runtime) binds.push(`${spec.runtime}:/tmp/runtime:ro`)
  else binds.push('/tmp/.X11-unix:/tmp/.X11-unix:ro')
  try {
    await docker.create(spec.name, {
      Image: spec.image,
      Entrypoint: [],
      Cmd: ['bash', '-c', spec.command],
      User: spec.user,
      Env: env,
      Labels: { 'finesse.managed': 'true', 'finesse.job': 'play' },
      HostConfig: {
        Binds: binds,
        IpcMode: 'host',
        Privileged: false,
        CapAdd: ['NET_RAW', 'MKNOD', 'NET_ADMIN', 'SYS_NICE'],
        DeviceCgroupRules: ['c 13:* rmw', 'c 244:* rmw'],
      },
    })
    await docker.start(spec.name)
  } catch (e) {
    const msg = (e as Error).message || ''
    if (/no such image/i.test(msg)) throw new Error('The image that runs games on the screen isn’t on this server yet.')
    throw new Error('The game didn’t start on the server’s screen.')
  }
}

/**
 * Play on the server's screen, and stream through Wolf. Wolf's API adds the app (no config
 * rewrite, no Wolf restart). A host with no desktop gets Play on the server greyed out.
 */
function attachPlay(store: GameStore, settings: SettingsStore): void {
  const stack = () => {
    const s = settings.get()
    return s.mode === 'bundle' && s.stack && s.setup.state === 'ready' ? s.stack : null
  }
  const docker = Object.assign(new Docker(), { instance: settings.get().instanceId })
  let desk: { at: number; value: Desktop | { ok: false; why: string } } | null = null
  const socketOf = () => {
    const set = settings.get().streaming?.socket
    if (set && existsSync(set)) return set
    const st = stack()
    if (!st) return null
    const path = wolfSocket(st)
    return existsSync(path) ? path : null
  }
  async function wolfJson<T>(sock: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let reply: { status: number; body: Buffer }
    try {
      reply = await wolfCall(sock, method, path, body)
    } catch (e) {
      throw new Error(wolfProblem(e, sock))
    }
    let data: { success?: boolean; error?: string } | null = null
    try {
      data = JSON.parse(reply.body.toString('utf8')) as { success?: boolean; error?: string }
    } catch {
      data = null
    }
    if (reply.status >= 400 || !data || data.success === false) throw new Error(data?.error || 'Game streaming didn’t answer.')
    return data as T
  }

  store.play = createStorePlay({
    host: isNative() ? 'windows' : 'linux',
    serverName: hostname(),
    gamesRoot: () => {
      const st = stack()
      return st ? join(st.hostData, ...GAMES_PC.split('/')) : null
    },
    desktop: async () => {
      if (desk && Date.now() - desk.at < 60_000) return desk.value
      const value = await probeDesktop(docker)
      desk = { at: Date.now(), value }
      return value
    },
    wolf: () => {
      const sock = socketOf()
      if (!sock) return null
      return {
        lists: async () => {
          const [apps, profiles] = await Promise.all([
            wolfJson<{ apps?: Record<string, unknown>[] }>(sock, 'GET', '/api/v1/apps'),
            wolfJson<{ profiles?: Record<string, unknown>[] }>(sock, 'GET', '/api/v1/profiles').catch(() => ({ profiles: [] as Record<string, unknown>[] })),
          ])
          return { apps: Array.isArray(apps.apps) ? apps.apps : [], profiles: Array.isArray(profiles.profiles) ? profiles.profiles : [] }
        },
        video: (apps) => (appBase(apps) as Record<string, unknown> | null),
        addApp: async (app) => {
          await wolfJson(sock, 'POST', '/api/v1/apps/add', app)
        },
        deleteApp: async (id) => {
          await wolfJson(sock, 'POST', '/api/v1/apps/delete', { id })
        },
        removeProfile: async (id) => {
          await wolfJson(sock, 'POST', '/api/v1/profiles/remove', { id })
        },
        addProfile: async (profile) => {
          await wolfJson(sock, 'POST', '/api/v1/profiles/add', profile)
        },
      }
    },
    user: () => {
      const st = stack()
      return st ? `${st.puid}:${st.pgid}` : '0:0'
    },
    startLocal: (spec) => startOnDesktop(docker, spec),
    last: (userId) => store.db.playChoice(userId),
    remember: (userId, way, target) => store.db.rememberPlay(userId, way, target),
  })
}
