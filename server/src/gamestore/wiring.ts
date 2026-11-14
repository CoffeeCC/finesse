// Plugs the request pipeline into a running server: magnets through the bundled qBittorrent
// behind the VPN, https downloads fetched directly, both into the data folder. What installs a
// finished download (the engine in a sandbox: install.ts + a SandboxRunner) is handed in by the
// host; until one exists, a request downloads, is checked, and stops there saying so.

import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline as pump } from 'node:stream/promises'
import { ApiError } from '../http/core.ts'
import type { SettingsStore } from '../config.ts'
import { fromApp, toApp } from '../stack/apppaths.ts'
import { isNative } from '../stack/host.ts'
import { DirectDownloader, safeFileName } from './direct.ts'
import { Pipeline, type Installer } from './pipeline.ts'
import { QbitDownloader } from './qbit.ts'
import { YOURS, type GameStore } from './routes.ts'

export const NO_SANDBOX = 'It’s downloaded and checked, but this server can’t install games yet. That arrives with a later update. The download is kept, so “Try again” then carries on from here.'

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
        installer: opts.installer ?? noInstaller,
        freeBytes: async () => {
          const f = await statfs(stack()?.hostData ?? '/')
          return f.bavail * f.bsize
        },
        seeding: () => settings.get().gameStore?.seeding ?? { ratio: 1, days: 7 },
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
  store.installs = Boolean(opts.installer)
  get()
}
