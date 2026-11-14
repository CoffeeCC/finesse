// A request, from "asked for" to "ready to play": queued → downloading → checking → installing
// (→ needs-you) → finishing → ready, or failed with the reason. Everything it knows is in
// sqlite, so a restart carries on where it was: tick() looks at each request and moves it one
// step. Downloads run side by side; one game installs at a time.

import { randomUUID } from 'node:crypto'
import { describeChecks, verifyDownload } from '../downloadCheck.ts'
import { ApiError } from '../http/core.ts'
import type { GameStoreDb, StoredRequest } from './db.ts'
import type { RequestPipeline } from './routes.ts'
import type { CatalogueGame, CatalogueSource, Downloader, GameRequestState, InstallOutcome } from './types.ts'

/** What installs a finished download: the engine (install.ts) in this host's sandbox. */
export interface Installer {
  install(r: StoredRequest, folder: string, onStep: (text: string) => void): Promise<InstallOutcome>
  /** A person finished the installer on its screen. */
  finish(r: StoredRequest): Promise<InstallOutcome>
  /** Stop anything running for this request and delete what it installed. */
  remove(r: StoredRequest): Promise<void>
}

export interface PipelineDeps {
  db: GameStoreDb
  /** Magnet links go to the VPN's downloader, https addresses are fetched directly. */
  downloaderFor(source: CatalogueSource): Downloader
  installer: Installer
  /** Free space where games are downloaded and installed. */
  freeBytes(): Promise<number>
  /** How long a finished torrent is shared back before its download is removed. */
  seeding?(): { ratio: number; days: number }
  verify?: typeof verifyDownload
  now?(): number
  log?(text: string): void
}

/** Download + unpacked + installed, at worst. */
const ROOM_NEEDED = 3
const GB = 1024 ** 3
const ACTIVE: GameRequestState[] = ['queued', 'downloading', 'paused', 'checking', 'installing', 'finishing']

const roughSize = (bytes: number) => (bytes >= GB ? `${Math.ceil((bytes / GB) * 10) / 10} GB` : `${Math.max(1, Math.ceil(bytes / 1024 ** 2))} MB`)

export class Pipeline implements RequestPipeline {
  private readonly deps: PipelineDeps
  private ticking: Promise<void> | null = null
  /** Requests with a check or an install running in this process. */
  private readonly busy = new Set<string>()
  private installing: string | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(deps: PipelineDeps) {
    this.deps = deps
  }

  private now() {
    return new Date(this.deps.now?.() ?? Date.now()).toISOString()
  }

  /** Looks at every request every few seconds. */
  run(everyMs = 5000) {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), everyMs)
    this.timer.unref()
    void this.tick()
  }

  halt() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // ---------- what the routes call ----------

  async start(game: CatalogueGame, source: CatalogueSource, user: { id: string; name: string }): Promise<StoredRequest> {
    const ready = await this.deps.downloaderFor(source).available()
    if (!ready.ok) throw new ApiError(503, ready.why)
    await this.room(source.sizeBytes)
    const at = this.now()
    const r: StoredRequest = {
      id: randomUUID().replace(/-/g, '').slice(0, 16),
      gameId: game.id,
      title: game.title,
      ...(game.cover ? { cover: game.cover } : {}),
      sourceId: source.id,
      platform: source.platform,
      installer: source.installer,
      state: 'queued',
      sizeBytes: source.sizeBytes,
      requestedBy: user.name,
      userId: user.id,
      source,
      createdAt: at,
      updatedAt: at,
    }
    this.deps.db.saveRequest(r)
    this.deps.db.advance(r.id, 'queued', {}, `${user.name} asked for it.`)
    void this.tick()
    return this.deps.db.request(r.id)!
  }

  private async room(sizeBytes: number) {
    const free = await this.deps.freeBytes().catch(() => Infinity)
    const need = sizeBytes * ROOM_NEEDED
    if (free < need) throw new ApiError(507, `There isn’t enough room for this game: it needs about ${roughSize(need)} free while it installs, and there’s ${roughSize(free)}. Free some space and ask again.`)
  }

  async cancel(r: StoredRequest): Promise<void> {
    if (r.source) await this.deps.downloaderFor(r.source).remove(r.id, { files: true }).catch(() => {})
    await this.deps.installer.remove(r)
    this.busy.delete(r.id)
    if (this.installing === r.id) this.installing = null
  }

  async retry(r: StoredRequest): Promise<StoredRequest> {
    if (!r.source) throw new ApiError(409, 'That game isn’t in the store any more, so it can’t be tried again.')
    await this.deps.installer.remove(r)
    // A download that finished is kept: only what came after it is done again.
    const status = r.added ? await this.deps.downloaderFor(r.source).status(r.id).catch(() => null) : null
    const have = status?.state === 'done'
    if (!have) {
      const ready = await this.deps.downloaderFor(r.source).available()
      if (!ready.ok) throw new ApiError(503, ready.why)
      await this.room(r.source.sizeBytes)
    }
    const next = this.deps.db.advance(r.id, have ? 'checking' : 'queued', { detail: undefined, progress: have ? 100 : 0, added: have, waitingOn: undefined }, 'Trying again.')!
    void this.tick()
    return next
  }

  async installerDone(r: StoredRequest): Promise<StoredRequest> {
    this.deps.db.advance(r.id, 'finishing', { detail: undefined }, 'The installer was finished by hand.')
    this.busy.add(r.id)
    try {
      this.settle(r.id, await this.deps.installer.finish(r))
    } catch (e) {
      this.fail(r.id, 'Finesse couldn’t check the installed game. Try again.', e)
    } finally {
      this.busy.delete(r.id)
    }
    return this.deps.db.request(r.id)!
  }

  // ---------- the steps ----------

  /** One look at every request. Calls made while one is running wait for it and share its result. */
  tick(): Promise<void> {
    return (this.ticking ??= this.once().finally(() => (this.ticking = null)))
  }

  private async once() {
    const { db } = this.deps
    for (const r of db.requests().reverse()) {
      try {
        if (r.state === 'queued') await this.queued(r)
        else if (r.state === 'downloading' || r.state === 'paused') await this.downloading(r)
        else if (r.state === 'checking') this.check(r)
        else if (r.state === 'installing') this.install(r)
        // Interrupted between "installed" and "ready" by a restart: the game is there; check it again.
        else if (r.state === 'finishing' && !this.busy.has(r.id)) void this.installerDone(r)
        else if (r.state === 'ready') await this.seeded(r)
      } catch (e) {
        // One request's trouble never stops the others; it's looked at again next time.
        this.deps.log?.(`game request ${r.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  private fail(id: string, reason: string, e?: unknown) {
    if (e) this.deps.log?.(`game request ${id}: ${e instanceof Error ? e.message : String(e)}`)
    this.deps.db.advance(id, 'failed', { detail: reason, bytesPerSecond: undefined, etaSeconds: undefined }, reason)
  }

  private async queued(r: StoredRequest) {
    if (!r.source) return this.fail(r.id, 'That game isn’t in the store any more.')
    const d = this.deps.downloaderFor(r.source)
    const ready = await d.available()
    // Waiting (for the VPN, say) isn't failing: it says why and tries again.
    if (!ready.ok) return void (r.detail !== ready.why && this.deps.db.advance(r.id, 'queued', { detail: ready.why }, ready.why))
    await d.add({ id: r.id, magnet: r.source.magnet, url: r.source.url, sizeBytes: r.source.sizeBytes })
    this.deps.db.advance(r.id, 'downloading', { added: true, progress: 0, detail: undefined }, 'The download started.')
  }

  private async downloading(r: StoredRequest) {
    const d = this.deps.downloaderFor(r.source!)
    let s = await d.status(r.id)
    // After a restart a direct download has to be picked up again; adding twice changes nothing.
    if (s.state === 'missing' || (s.state === 'paused' && r.state === 'downloading')) {
      await d.add({ id: r.id, magnet: r.source!.magnet, url: r.source!.url, sizeBytes: r.source!.sizeBytes }).catch(() => {})
      s = await d.status(r.id)
    }
    if (s.state === 'missing') return this.fail(r.id, 'The download disappeared from the downloader. Try again.')
    if (s.state === 'error') return this.fail(r.id, s.reason ?? 'The download failed. Try again.')
    if (s.state === 'done') {
      if (!s.folder) return this.fail(r.id, 'The download finished, but Finesse can’t see where it was saved. Check the downloads folder in Settings → Server.')
      return void this.deps.db.advance(r.id, 'checking', { progress: 100, bytesPerSecond: undefined, etaSeconds: undefined, folder: s.folder }, 'The download finished.')
    }
    const state: GameRequestState = s.state === 'paused' ? 'paused' : 'downloading'
    const detail = s.state === 'queued' ? 'Waiting for other downloads, or for someone to share it.' : undefined
    this.deps.db.advance(r.id, state, { progress: s.progress, bytesPerSecond: s.bytesPerSecond, etaSeconds: s.etaSeconds, detail })
  }

  private check(r: StoredRequest) {
    if (this.busy.has(r.id)) return
    this.busy.add(r.id)
    const verify = this.deps.verify ?? verifyDownload
    void verify(r.folder!, { store: r.source?.checksums })
      .then((checks) => {
        if (!this.deps.db.request(r.id)) return
        const v = describeChecks(checks)
        if (!v.ok) return this.fail(r.id, v.text)
        this.deps.db.advance(r.id, 'installing', { detail: undefined, progress: undefined }, v.text)
      })
      .catch((e) => this.fail(r.id, 'Finesse couldn’t read the downloaded files to check them.', e))
      .finally(() => {
        this.busy.delete(r.id)
        void this.tick()
      })
  }

  private install(r: StoredRequest) {
    // One at a time: an install wants the whole sandbox and most of the disk's attention.
    if (this.installing || this.busy.has(r.id)) return
    this.installing = r.id
    this.busy.add(r.id)
    const { db } = this.deps
    void this.deps.installer
      .install(r, r.folder!, (text) => db.request(r.id) && db.advance(r.id, 'installing', {}, text))
      .then((out) => this.settle(r.id, out))
      .catch((e) => this.fail(r.id, 'Installing stopped unexpectedly. Try again.', e))
      .finally(() => {
        this.busy.delete(r.id)
        if (this.installing === r.id) this.installing = null
        void this.tick()
      })
  }

  /** What an install came to. */
  private settle(id: string, out: InstallOutcome) {
    const { db } = this.deps
    const r = db.request(id)
    // Cancelled while it ran.
    if (!r) return
    if (out.state === 'failed') return this.fail(id, out.reason)
    if (out.state === 'needs-you') return void db.advance(id, 'needs-you', { detail: out.why, waitingOn: out.waitingOn }, out.why)
    db.advance(id, 'finishing', { installDir: out.dir, program: out.program, screenshot: out.screenshot, waitingOn: undefined, detail: undefined }, 'Installed, and it starts.')
    db.advance(id, 'ready', { readyAt: this.now() }, 'Ready to play.')
    // A direct download has done its job; a torrent is shared back for a while first (seeded()).
    if (r.source && !r.source.magnet) void this.dropDownload(db.request(id)!)
  }

  private async dropDownload(r: StoredRequest) {
    await this.deps.downloaderFor(r.source!).remove(r.id, { files: true }).catch(() => {})
    this.deps.db.advance(r.id, 'ready', { downloadRemoved: true, folder: undefined })
  }

  /** A finished torrent is removed once it's been shared back enough, or for long enough. */
  private async seeded(r: StoredRequest) {
    if (r.downloadRemoved || !r.source?.magnet || !r.readyAt) return
    const limit = this.deps.seeding?.() ?? { ratio: 1, days: 7 }
    const days = ((this.deps.now?.() ?? Date.now()) - Date.parse(r.readyAt)) / 86_400_000
    const s = days >= limit.days ? null : await this.deps.downloaderFor(r.source).status(r.id)
    if (s && s.state !== 'missing' && (s.ratio ?? 0) < limit.ratio) return
    await this.dropDownload(r)
  }

  /** Requests that are still on their way. */
  active(): StoredRequest[] {
    return this.deps.db.requests().filter((r) => ACTIVE.includes(r.state))
  }
}
