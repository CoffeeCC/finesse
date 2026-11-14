// Game downloads by magnet link, through the qBittorrent Finesse set up behind the VPN (inside
// Gluetun's network on Docker; locked to the VPN's adapter on Windows). Each download is tagged
// with its request, lands in the "games" category, and is only ever added while the VPN is up.

import type { Downloader, DownloadStatus } from './types.ts'

export interface QbitConfig {
  url: string
  username?: string
  password?: string
}

export interface QbitDeps {
  /** The bundled qBittorrent, or null when this server has none. */
  config(): QbitConfig | null
  /**
   * Whether downloads are sure to leave through the VPN: Finesse's own Gluetun, or the adapter
   * qBittorrent is locked to on Windows. Words when not.
   */
  vpn(): { ok: true; adapter?: string } | { ok: false; why: string }
  /** A folder as qBittorrent names it → as Finesse reads it. */
  localPath?(appPath: string): string | null
  fetch?: typeof fetch
}

export const GAMES_CATEGORY = 'games'
const tag = (id: string) => `finesse-game-${id}`

interface Torrent {
  hash: string
  state: string
  progress: number
  dlspeed: number
  eta: number
  ratio: number
  content_path?: string
  save_path?: string
}

const DONE = new Set(['uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'pausedUP', 'stoppedUP', 'checkingUP'])
const PAUSED = new Set(['pausedDL', 'stoppedDL'])
const QUEUED = new Set(['queuedDL', 'metaDL', 'forcedMetaDL', 'allocating', 'checkingDL', 'checkingResumeData', 'moving'])

export class QbitDownloader implements Downloader {
  private cookie = ''
  private readonly deps: QbitDeps

  constructor(deps: QbitDeps) {
    this.deps = deps
  }

  private async call(path: string, form?: Record<string, string>, retry = true): Promise<Response> {
    const cfg = this.deps.config()
    if (!cfg) throw new Error('This server has no downloader for games.')
    const f = this.deps.fetch ?? fetch
    const base = cfg.url.replace(/\/+$/, '')
    if (!this.cookie && path !== '/auth/login') await this.login()
    const r = await f(`${base}/api/v2${path}`, {
      method: form ? 'POST' : 'GET',
      headers: { Referer: base, Origin: base, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    // The session ran out: sign in again, once.
    if (r.status === 403 && retry && path !== '/auth/login') {
      this.cookie = ''
      return this.call(path, form, false)
    }
    return r
  }

  private async login() {
    const cfg = this.deps.config()!
    const r = await this.call('/auth/login', { username: cfg.username ?? '', password: cfg.password ?? '' })
    const body = await r.text()
    const sid = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]!).find((c) => /^(SID|QBT_SID)/.test(c))
    // With sign-in switched off for the local network there's no cookie, and none is needed.
    if (!r.ok || /fails/i.test(body)) throw new Error('The downloader wouldn’t let Finesse sign in.')
    this.cookie = sid ?? ''
  }

  private async torrent(id: string): Promise<Torrent | null> {
    const r = await this.call(`/torrents/info?tag=${encodeURIComponent(tag(id))}`)
    if (!r.ok) throw new Error(`The downloader answered ${r.status}.`)
    return ((await r.json()) as Torrent[])[0] ?? null
  }

  async available(): Promise<{ ok: true } | { ok: false; why: string }> {
    if (!this.deps.config()) return { ok: false, why: 'This server has no downloader for games. Add the VPN and torrent downloads in Settings → Server.' }
    const vpn = this.deps.vpn()
    if (!vpn.ok) return vpn
    try {
      const info = await this.call('/transfer/info')
      if (!info.ok) return { ok: false, why: 'The downloader isn’t answering. Check it in Settings → Server.' }
      const status = ((await info.json()) as { connection_status?: string }).connection_status
      if (status === 'disconnected') return { ok: false, why: 'The VPN is down, so nothing is being downloaded. It starts again by itself when the VPN is back.' }
      if (vpn.adapter) {
        // Windows: qBittorrent must still be locked to the VPN's adapter.
        const prefs = (await (await this.call('/app/preferences')).json()) as { current_network_interface?: string }
        if (!prefs.current_network_interface) return { ok: false, why: 'The downloader isn’t locked to the VPN any more, so Finesse won’t use it. Open Settings → Server and run a check.' }
      }
      return { ok: true }
    } catch {
      // On Docker the downloader lives inside the VPN's network: no VPN, no answer.
      return { ok: false, why: 'The VPN or the downloader is down, so nothing is being downloaded. It starts again by itself when they’re back.' }
    }
  }

  async add(job: { id: string; magnet?: string; url?: string; sizeBytes: number }): Promise<void> {
    if (!job.magnet) throw new Error('This downloader only takes magnet links.')
    if (await this.torrent(job.id)) return
    const ready = await this.available()
    if (!ready.ok) throw new Error(ready.why)
    const r = await this.call('/torrents/add', { urls: job.magnet, category: GAMES_CATEGORY, tags: tag(job.id), paused: 'false', stopped: 'false' })
    const body = await r.text()
    if (!r.ok || /fails/i.test(body)) throw new Error('The downloader wouldn’t take this download.')
  }

  async status(id: string): Promise<DownloadStatus> {
    const t = await this.torrent(id)
    if (!t) return { state: 'missing', progress: 0 }
    const progress = Math.round(t.progress * 1000) / 10
    const path = t.content_path || t.save_path
    const folder = path ? (this.deps.localPath ? (this.deps.localPath(path) ?? undefined) : path) : undefined
    if (t.state === 'error') return { state: 'error', progress, reason: 'The downloader hit an error (often a full disk).' }
    if (t.state === 'missingFiles') return { state: 'error', progress, reason: 'The downloaded files have gone missing.' }
    if (DONE.has(t.state) || t.progress >= 1) return { state: 'done', progress: 100, folder, ratio: t.ratio }
    if (PAUSED.has(t.state)) return { state: 'paused', progress }
    if (QUEUED.has(t.state)) return { state: 'queued', progress }
    // stalledDL counts as downloading (slow or waiting for peers): the speed says the rest.
    return { state: 'downloading', progress, bytesPerSecond: t.dlspeed, ...(t.eta > 0 && t.eta < 8_640_000 ? { etaSeconds: t.eta } : {}) }
  }

  /** qBittorrent 5 says stop/start where 4 said pause/resume. */
  private async either(now: string, before: string, id: string) {
    const t = await this.torrent(id)
    if (!t) return
    const r = await this.call(`/torrents/${now}`, { hashes: t.hash })
    if (r.status === 404) await this.call(`/torrents/${before}`, { hashes: t.hash })
  }

  pause(id: string) {
    return this.either('stop', 'pause', id)
  }

  resume(id: string) {
    return this.either('start', 'resume', id)
  }

  async remove(id: string, opts: { files: boolean }): Promise<void> {
    const t = await this.torrent(id)
    if (!t) return
    await this.call('/torrents/delete', { hashes: t.hash, deleteFiles: String(opts.files) })
  }
}
