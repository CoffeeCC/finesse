// Download rescue: Finesse looks after downloads that get stuck, so nobody has to.
//
// Radarr, Sonarr and Lidarr already replace a download that *fails* outright. What they leave
// sitting in the queue for ever is everything else: a torrent with nobody to download from, a
// finished download that can't be added to the library, a release that turned out to be the
// wrong thing. Every few minutes the rescuer reads each app's queue, and when a download has been
// stuck for longer than its kind of problem deserves, it drops it, tells the app never to pick
// that release again, and has it search for another. The other way of downloading is a
// candidate like any other, so a dead torrent can come back from Usenet and the other way round.
//
// It is careful:
//   • a problem only a person can fix (a full disk, a folder the app can't write to) is never
//     "fixed" by downloading something else: it's reported, with what to do;
//   • a title gets at most MAX_SWAPS automatic replacements a day, then it's left for a person;
//   • nothing is touched before its waiting time is up (an hour for a stalled one unless
//     Settings says otherwise; a download that failed outright is replaced straight away), and
//     a download that starts moving again is forgotten.
//
// `diagnose` is pure (the rules, testable on their own); `DownloadRescue` is the loop, its small
// state file, and the API the app's Downloads page reads (GET/PUT /api/downloads/auto).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Auth } from './auth.ts'
import type { Endpoint, SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { joinUrl } from './http/proxy.ts'
import { logger } from './log.ts'

const log = logger('downloads')

export type RescueApp = 'radarr' | 'sonarr' | 'lidarr'
const APPS: { app: RescueApp; api: string; kind: 'movie' | 'series' | 'artist' }[] = [
  { app: 'radarr', api: '/api/v3', kind: 'movie' },
  { app: 'sonarr', api: '/api/v3', kind: 'series' },
  { app: 'lidarr', api: '/api/v1', kind: 'artist' },
]

/** One row of an app's download queue, as far as the rescuer reads it. */
export interface QueueRecord {
  id?: number
  downloadId?: string
  protocol?: string
  title?: string
  status?: string
  trackedDownloadStatus?: string
  trackedDownloadState?: string
  errorMessage?: string
  statusMessages?: { title?: string; messages?: string[] }[]
  size?: number
  sizeleft?: number
  movieId?: number
  seriesId?: number
  episodeId?: number
  artistId?: number
  albumId?: number
  movie?: { title?: string }
  series?: { title?: string }
  artist?: { artistName?: string }
}

export type Problem = 'stalled' | 'slow' | 'failed' | 'import' | 'not-needed' | 'needs-person'
export type Action = 'swap' | 'drop' | 'report'

export interface Diagnosis {
  problem: Problem
  /** swap: drop it, never pick that release again, search for another. drop: just take it out of
   *  the queue (the library already has something as good). report: only a person can fix it. */
  action: Action
  /** How long it may stay like this before the rescuer acts (ms). */
  waitMs: number
  /** The app's own words, for the log and for the page. */
  reason: string
}

const MIN = 60_000
const HOUR = 60 * MIN
/** Automatic replacements per title per day; after that it's left for a person. */
export const MAX_SWAPS = 3
/** A torrent that hasn't moved a byte for this long is as good as stalled. */
export const NO_PROGRESS_MS = 6 * HOUR
/** How long a stalled download gets before it's swapped, unless Settings says otherwise (minutes). */
export const DEFAULT_STALLED_MINUTES = 60
export const STALLED_MINUTES_RANGE = [15, 24 * 60] as const

const messagesOf = (r: QueueRecord): string[] => {
  const out: string[] = []
  if (r.errorMessage?.trim()) out.push(r.errorMessage.trim())
  for (const m of r.statusMessages ?? []) {
    for (const x of m.messages ?? []) if (x?.trim()) out.push(x.trim())
    if (!m.messages?.length && m.title?.trim()) out.push(m.title.trim())
  }
  return out
}

// What only a person can put right: downloading something else would fail the same way.
const NEEDS_PERSON = /permission|access to the path|denied|read-only|disk (is )?full|not enough (free )?space|no space left|free space|does not exist|doesn'?t exist|not found on disk|remote path|path mapping|is not writable|not accessible|unable to connect|couldn'?t connect|authentication|unauthori[sz]ed|download client (is )?unavailable|root folder/i
// The library already has this, as good or better: nothing to replace, just clear it away.
const NOT_NEEDED = /not an upgrade|not a(n)? (quality|custom format) (revision )?upgrade|already (exists|imported|in (your|the) library)|has a better|existing file|same (file|size) /i
const STALLED = /stalled|no connections|no seeds|no peers|downloading metadata|metadata (download|timed|timeout)|dead torrent|not seeded/i

/**
 * What's wrong with a queue row, if anything, and what to do about it after how long.
 * `noProgressMs`: how long its remaining size hasn't changed while it claims to be downloading.
 */
export function diagnose(r: QueueRecord, noProgressMs = 0, stalledMs = DEFAULT_STALLED_MINUTES * MIN): Diagnosis | null {
  const msgs = messagesOf(r)
  const text = msgs.join(' · ')
  const status = (r.status ?? '').toLowerCase()
  const state = (r.trackedDownloadState ?? '').toLowerCase()
  const tracked = (r.trackedDownloadStatus ?? '').toLowerCase()
  const troubled = tracked === 'warning' || tracked === 'error' || status === 'warning' || status === 'failed' || state === 'importfailed' || state === 'importblocked' || state === 'failed' || state === 'failedpending'

  if (troubled && NEEDS_PERSON.test(text)) return { problem: 'needs-person', action: 'report', waitMs: 0, reason: msgs[0] ?? 'The app reported a problem it can’t get past by itself' }
  if (status === 'failed' || state === 'failed' || state === 'failedpending') return { problem: 'failed', action: 'swap', waitMs: 0, reason: msgs[0] ?? 'The download failed' }
  if (troubled && STALLED.test(text)) return { problem: 'stalled', action: 'swap', waitMs: stalledMs, reason: msgs[0]! }

  const finished = status === 'completed' || state === 'importpending' || state === 'importfailed' || state === 'importblocked' || state === 'importing'
  if (troubled && finished) {
    if (NOT_NEEDED.test(text)) return { problem: 'not-needed', action: 'drop', waitMs: 30 * MIN, reason: msgs[0]! }
    return { problem: 'import', action: 'swap', waitMs: HOUR, reason: msgs[0] ?? 'It downloaded but couldn’t be added to the library' }
  }
  // Any other warning while still downloading: give it longer, then try another.
  if (troubled) return { problem: 'stalled', action: 'swap', waitMs: stalledMs * 1.5, reason: msgs[0] ?? 'The download isn’t moving' }

  // No warning, but a torrent that says "downloading" and hasn't moved a byte in hours.
  if (r.protocol === 'torrent' && status === 'downloading' && (r.sizeleft ?? 0) > 0 && noProgressMs >= NO_PROGRESS_MS) {
    return { problem: 'slow', action: 'swap', waitMs: 0, reason: 'Nothing has arrived for hours' }
  }
  return null
}

/** One thing the rescuer did (or decided it couldn't), newest first in the log. */
export interface RescueEvent {
  at: string
  /** `movie-12`, `series-4`, `artist-9`: the same keys the app's queue uses. */
  key: string
  title: string
  what: 'swapped' | 'dropped' | 'gave-up'
  problem: Problem
  reason: string
  via?: string
}

/** A stuck download the rescuer is watching. */
export interface RescueWatch {
  key: string
  title: string
  problem: Problem
  action: Action
  reason: string
  /** When the rescuer acts, if it will (ISO). */
  dueAt?: string
  /** Automatic replacements for this title in the last day. */
  swaps: number
  /** No more automatic replacements today. */
  exhausted: boolean
}

interface Saved {
  swaps: Record<string, number[]>
  log: RescueEvent[]
}

const titleOf = (r: QueueRecord) => r.movie?.title ?? r.series?.title ?? r.artist?.artistName ?? r.title ?? 'Unknown'

export class DownloadRescue {
  private settings: SettingsStore
  private file: string
  private saved: Saved = { swaps: {}, log: [] }
  /** Per queue row: when it was first seen stuck, and its remaining size last time it changed. */
  private seen = new Map<string, { stuckSince?: number; left?: number; movedAt: number }>()
  private watching: RescueWatch[] = []
  private timer: NodeJS.Timeout | null = null
  private running = false
  lastRun: string | null = null

  constructor(settings: SettingsStore) {
    this.settings = settings
    this.file = join(settings.paths.configDir, 'download-rescue.json')
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>
        this.saved = { swaps: raw.swaps && typeof raw.swaps === 'object' ? raw.swaps : {}, log: Array.isArray(raw.log) ? raw.log.slice(0, 60) : [] }
      }
    } catch {
      /* a broken state file only forgets the count of past swaps */
    }
  }

  get enabled(): boolean {
    return this.settings.get().downloads?.autoFix !== false
  }

  get stalledMinutes(): number {
    const n = this.settings.get().downloads?.stalledMinutes
    return typeof n === 'number' && n >= STALLED_MINUTES_RANGE[0] && n <= STALLED_MINUTES_RANGE[1] ? Math.round(n) : DEFAULT_STALLED_MINUTES
  }

  /** Which goes first when both are set up: the choice made in Finesse, Usenet otherwise. */
  get wanted(): 'usenet' | 'torrent' {
    return this.settings.get().downloads?.prefer === 'torrent' ? 'torrent' : 'usenet'
  }
  private orderCheckedAt = 0

  start(everyMs = 5 * MIN) {
    if (this.timer) return
    setTimeout(() => void this.tick(), 90_000).unref()
    this.timer = setInterval(() => void this.tick(), everyMs)
    this.timer.unref()
  }

  status() {
    return { enabled: this.enabled, stalledMinutes: this.stalledMinutes, lastRun: this.lastRun, maxSwaps: MAX_SWAPS, watching: this.watching, log: this.saved.log.slice(0, 30) }
  }

  private save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(this.saved))
      renameSync(tmp, this.file)
    } catch (e) {
      log.warn(`couldn't save download rescue's notes: ${(e as Error).message}`)
    }
  }

  private swapsToday(key: string, now: number): number {
    const recent = (this.saved.swaps[key] ?? []).filter((t) => now - t < 24 * HOUR)
    if (recent.length) this.saved.swaps[key] = recent
    else delete this.saved.swaps[key]
    return recent.length
  }

  private note(e: RescueEvent) {
    this.saved.log.unshift(e)
    this.saved.log.length = Math.min(this.saved.log.length, 60)
  }

  /** One pass over every app's queue. Safe to call any time; passes never overlap. */
  async tick(now = Date.now()): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      // With both ways of downloading set up, the apps try the chosen one first (Usenet unless
      // Finesse was told otherwise). Checked hourly; nothing is written when it's already so.
      const svcs = this.settings.get().services
      if (svcs.sabnzbd?.url && svcs.qbittorrent?.url && now - this.orderCheckedAt >= HOUR) {
        this.orderCheckedAt = now
        await this.setPreference(this.wanted).catch((e) => log.debug(`couldn't check which way of downloading goes first (${(e as Error).message})`))
      }
      const stalledMs = this.stalledMinutes * MIN
      const watching: RescueWatch[] = []
      const alive = new Set<string>()
      let changed = false
      for (const { app, api, kind } of APPS) {
        const svc = this.settings.get().services[app]
        if (!svc?.url || !svc.apiKey) continue
        let records: QueueRecord[]
        try {
          const r = await this.call<{ records?: QueueRecord[] }>(svc, api, 'GET', '/queue?page=1&pageSize=500&includeUnknownMovieItems=false')
          records = r.records ?? []
        } catch (e) {
          log.debug(`${app}: couldn't read the queue (${(e as Error).message})`)
          continue
        }
        // A season pack is many rows sharing one download: handle each download once.
        const done = new Set<string>()
        for (const r of records) {
          const refId = kind === 'movie' ? r.movieId : kind === 'series' ? r.seriesId : r.artistId
          if (!r.id || !refId) continue
          const rowKey = `${app}:${r.downloadId ?? r.id}`
          alive.add(rowKey)
          if (done.has(rowKey)) continue
          done.add(rowKey)
          const s = this.seen.get(rowKey) ?? { movedAt: now }
          if (s.left !== r.sizeleft) {
            s.left = r.sizeleft
            s.movedAt = now
          }
          const d = diagnose(r, now - s.movedAt, stalledMs)
          if (!d) {
            s.stuckSince = undefined
            this.seen.set(rowKey, s)
            continue
          }
          s.stuckSince ??= now
          this.seen.set(rowKey, s)
          const key = `${kind}-${refId}`
          const title = titleOf(r)
          const swaps = this.swapsToday(key, now)
          const exhausted = d.action === 'swap' && swaps >= MAX_SWAPS
          const due = s.stuckSince + d.waitMs
          const willAct = this.enabled && d.action !== 'report' && !exhausted
          watching.push({ key, title, problem: d.problem, action: d.action, reason: d.reason, ...(willAct ? { dueAt: new Date(due).toISOString() } : {}), swaps, exhausted })
          if (!willAct || now < due) {
            if (exhausted && !this.saved.log.some((e) => e.key === key && e.what === 'gave-up' && now - Date.parse(e.at) < 24 * HOUR)) {
              this.note({ at: new Date(now).toISOString(), key, title, what: 'gave-up', problem: d.problem, reason: d.reason, via: r.protocol })
              changed = true
            }
            continue
          }
          try {
            const sameDownload = records.filter((x) => x.id && (x.downloadId ?? x.id) === (r.downloadId ?? r.id))
            await this.act(svc, api, app, d.action, sameDownload)
            if (d.action === 'swap') (this.saved.swaps[key] ??= []).push(now)
            this.note({ at: new Date(now).toISOString(), key, title, what: d.action === 'swap' ? 'swapped' : 'dropped', problem: d.problem, reason: d.reason, via: r.protocol })
            log.info(`${title}: ${d.action === 'swap' ? 'replaced a stuck download' : 'cleared a download the library didn’t need'} (${d.problem})`)
            this.seen.delete(rowKey)
            watching.pop()
            changed = true
          } catch (e) {
            log.warn(`${title}: couldn't ${d.action} the stuck download (${(e as Error).message})`)
          }
        }
      }
      for (const k of this.seen.keys()) if (!alive.has(k)) this.seen.delete(k)
      this.watching = watching
      this.lastRun = new Date(now).toISOString()
      if (changed) this.save()
    } finally {
      this.running = false
    }
  }

  /** Take the download out (of the app and the download client) and, for a swap, never pick that
   *  release again and search for what it was fetching. */
  private async act(svc: Endpoint, api: string, app: RescueApp, action: Action, rows: QueueRecord[]) {
    const ids = [...new Set(rows.map((r) => r.id!).filter(Boolean))]
    const swap = action === 'swap'
    await this.call(svc, api, 'DELETE', `/queue/bulk?removeFromClient=true&blocklist=${swap}&skipRedownload=true`, { ids })
    if (!swap) return
    const uniq = (xs: (number | undefined)[]) => [...new Set(xs.filter((x): x is number => typeof x === 'number' && x > 0))]
    const command =
      app === 'radarr'
        ? { name: 'MoviesSearch', movieIds: uniq(rows.map((r) => r.movieId)) }
        : app === 'sonarr'
          ? uniq(rows.map((r) => r.episodeId)).length
            ? { name: 'EpisodeSearch', episodeIds: uniq(rows.map((r) => r.episodeId)) }
            : { name: 'SeriesSearch', seriesId: rows[0]!.seriesId }
          : uniq(rows.map((r) => r.albumId)).length
            ? { name: 'AlbumSearch', albumIds: uniq(rows.map((r) => r.albumId)) }
            : { name: 'ArtistSearch', artistId: rows[0]!.artistId }
    await this.call(svc, api, 'POST', '/command', command)
  }

  private async call<T>(svc: Endpoint, api: string, method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(joinUrl(svc.url!, `${api}${path.split('?')[0]}`, path.includes('?') ? `?${path.split('?')[1]}` : ''), {
      method,
      headers: { 'x-api-key': svc.apiKey!, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    })
    if (!r.ok) throw new Error(`the app answered ${r.status}`)
    const text = await r.text()
    return (text ? JSON.parse(text) : {}) as T
  }

  // ---------- Which way of downloading goes first ----------

  /** Usenet or torrents first, read from each app's own setting (its default delay profile). */
  async preference(): Promise<{ prefer: 'usenet' | 'torrent' | null; both: boolean }> {
    const s = this.settings.get().services
    const both = Boolean(s.sabnzbd?.url && s.qbittorrent?.url)
    for (const { app, api } of APPS) {
      const svc = s[app]
      if (!svc?.url || !svc.apiKey) continue
      try {
        const profiles = await this.call<{ id: number; preferredProtocol?: string; tags?: number[] }[]>(svc, api, 'GET', '/delayprofile')
        const p = profiles.find((x) => !x.tags?.length) ?? profiles[0]
        if (p?.preferredProtocol === 'usenet' || p?.preferredProtocol === 'torrent') return { prefer: both ? this.wanted : p.preferredProtocol, both }
      } catch {
        /* try the next app */
      }
    }
    return { prefer: null, both }
  }

  /** Sets which goes first in every app, keeping both switched on (the other is the backup). */
  async setPreference(prefer: 'usenet' | 'torrent'): Promise<void> {
    let done = 0
    for (const { app, api } of APPS) {
      const svc = this.settings.get().services[app]
      if (!svc?.url || !svc.apiKey) continue
      const profiles = await this.call<Record<string, unknown>[]>(svc, api, 'GET', '/delayprofile')
      const p = profiles.find((x) => !(x.tags as number[] | undefined)?.length) ?? profiles[0]
      if (!p) continue
      if (p.preferredProtocol !== prefer || p.enableUsenet !== true || p.enableTorrent !== true) {
        await this.call(svc, api, 'PUT', `/delayprofile/${p.id as number}`, { ...p, preferredProtocol: prefer, enableUsenet: true, enableTorrent: true })
      }
      done++
    }
    if (!done) throw new ApiError(503, 'No download apps are set up yet')
  }
}

export function registerDownloadRescue(router: Router, deps: { settings: SettingsStore; auth: Auth }): DownloadRescue {
  const { settings, auth } = deps
  const rescue = new DownloadRescue(settings)

  // Anyone signed in: the Downloads page shows what Finesse is doing about a stuck download.
  router.get('/api/downloads/auto', async ({ req, res }) => {
    await auth.requireUser(req)
    sendJson(res, 200, { ...rescue.status(), ...(await rescue.preference()) })
  })

  router.put('/api/downloads/auto', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ enabled?: unknown; prefer?: unknown; stalledMinutes?: unknown }>(req)
    const mins = body.stalledMinutes
    if (mins !== undefined && !(typeof mins === 'number' && Number.isFinite(mins) && mins >= STALLED_MINUTES_RANGE[0] && mins <= STALLED_MINUTES_RANGE[1])) {
      throw new ApiError(400, `The wait is between ${STALLED_MINUTES_RANGE[0]} minutes and ${STALLED_MINUTES_RANGE[1] / 60} hours`)
    }
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new ApiError(400, 'enabled is on or off')
    if (body.prefer !== undefined && body.prefer !== 'usenet' && body.prefer !== 'torrent') throw new ApiError(400, 'prefer is usenet or torrent')
    if (body.prefer) {
      try {
        await rescue.setPreference(body.prefer)
      } catch (e) {
        if (e instanceof ApiError) throw e
        throw new ApiError(502, 'Couldn’t change that in the download apps. Check they’re running (Settings → Server), then try again.')
      }
    }
    if (typeof body.enabled === 'boolean' || body.prefer || typeof mins === 'number') {
      settings.update((s) => {
        s.downloads = {
          ...(s.downloads ?? {}),
          ...(typeof body.enabled === 'boolean' ? { autoFix: body.enabled } : {}),
          ...(body.prefer ? { prefer: body.prefer as 'usenet' | 'torrent' } : {}),
          ...(typeof mins === 'number' ? { stalledMinutes: Math.round(mins) } : {}),
        }
      })
    }
    sendJson(res, 200, { ...rescue.status(), ...(await rescue.preference()) })
  })

  // Check now (the page's own Retry does the work itself; this is for after changing a setting).
  router.post('/api/downloads/auto/check', async ({ req, res }) => {
    await auth.requireAdmin(req)
    await rescue.tick()
    sendJson(res, 200, { ...rescue.status(), ...(await rescue.preference()) })
  })

  return rescue
}
