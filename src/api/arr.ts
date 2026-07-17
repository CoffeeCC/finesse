import { mediaBrowserAuthHeader } from './client'
import { CONTENT_BASE } from '../lib/contentOrigin'

// Finesse's request feature talks to Radarr (movies), Sonarr (shows) and Lidarr
// (music) through the app's OWN nginx, which reverse-proxies /arr/{app}/* to the
// *arr APIs with the API key injected server-side (see nginx.conf). That keeps the
// keys out of the browser, avoids CORS, works remotely through the funnel, and
// is gated by an nginx auth_request that validates the caller's Jellyfin token.

export type ArrKind = 'movie' | 'series' | 'artist'

const APP_OF: Record<ArrKind, string> = { movie: 'radarr', series: 'sonarr', artist: 'lidarr' }

export class ArrError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Where the proxy lives: the Finesse origin's base path (/finesse/arr). On the
 *  webOS build there's no local nginx, so this resolves to the deployed server. */
function arrBase(): string {
  return `${CONTENT_BASE}arr`
}

interface ArrImage {
  coverType?: string
  remoteUrl?: string
  url?: string
}

/** Normalized search result, shared between movie + series. */
export interface ArrResult {
  kind: ArrKind
  /** *arr library id; 0 means not added yet. */
  id: number
  title: string
  year?: number
  overview?: string
  poster?: string
  tmdbId?: number
  tvdbId?: number
  /** Media is actually present on disk (movie file / at least one episode). */
  hasFile: boolean
  monitored: boolean
  /** Original lookup object — posted back verbatim (plus our fields) to add it. */
  raw: Record<string, unknown>
}

/** What's on disk for an in-library title (for upgrade/downgrade UI). */
export interface ArrQualityInfo {
  qualityName?: string
  /** Quality profile resolution bucket (e.g. 1080), not always real pixel height. */
  qualityResolution?: number
  width?: number
  height?: number
  /** e.g. "1920x800" from mediaInfo when width/height missing. */
  resolutionLabel?: string
  videoCodec?: string
  sizeBytes?: number
  /** Series: how many episode files were summarized. */
  fileCount?: number
  /** Series: min–max quality names if mixed. */
  qualityRange?: string
}

/** A release from interactive search (Radarr/Sonarr). */
export interface ArrRelease {
  guid: string
  indexerId: number
  title: string
  qualityName: string
  qualityResolution?: number
  size: number
  seeders?: number
  ageHours?: number
  rejected: boolean
  rejections: string[]
  customFormatScore: number
  /** True if *arr thinks this is an upgrade over the current file. */
  isUpgrade?: boolean
  raw: Record<string, unknown>
}

async function arrFetch<T>(
  kind: ArrKind,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const app = APP_OF[kind]
  const res = await fetch(`${arrBase()}/${app}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: mediaBrowserAuthHeader(),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const text = await res.text()
      if (text) {
        // *arr returns { message, description } for many failures (e.g. SABnzbd).
        try {
          const j = JSON.parse(text) as { message?: string; description?: string; error?: string }
          const msg = (j.message || j.error || '').trim()
          // description often includes a stack trace — keep only the first line
          const desc = (j.description || '').split('\n')[0]?.trim()
          if (msg && desc && !desc.startsWith(msg)) detail = `${msg}${desc ? ` — ${desc}` : ''}`
          else if (msg) detail = msg
          else if (desc) detail = desc
          else detail = text
        } catch {
          detail = text
        }
      }
    } catch {
      /* ignore */
    }
    // Friendly rewrites for common download-client failures
    if (/sabnzbd/i.test(detail) && /error response/i.test(detail)) {
      detail =
        'SABnzbd rejected the grab (NZB may be dead, client busy, or category misconfigured). Try another release.'
    }
    if (/qbittorrent/i.test(detail) && /error|fail/i.test(detail)) {
      detail = 'qBittorrent rejected the grab. Torrents may be disabled for this title, or qBit is unreachable.'
    }
    throw new ArrError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

function pickPoster(images?: ArrImage[], remotePoster?: string): string | undefined {
  const poster = images?.find((i) => i.coverType === 'poster')
  return poster?.remoteUrl ?? poster?.url ?? remotePoster
}

function mapMovie(m: Record<string, unknown>): ArrResult {
  return {
    kind: 'movie',
    id: (m.id as number) ?? 0,
    title: (m.title as string) ?? 'Unknown',
    year: m.year as number | undefined,
    overview: m.overview as string | undefined,
    poster: pickPoster(m.images as ArrImage[], m.remotePoster as string),
    tmdbId: m.tmdbId as number | undefined,
    // Radarr's lookup leaves hasFile null even for downloaded titles, but sets
    // movieFileId when a file exists — that's the reliable "in library" signal.
    hasFile: Boolean(m.movieFileId) || Boolean(m.hasFile),
    monitored: Boolean(m.monitored),
    raw: m,
  }
}

function mapSeries(s: Record<string, unknown>): ArrResult {
  const stats = (s.statistics as { episodeFileCount?: number } | undefined) ?? {}
  return {
    kind: 'series',
    id: (s.id as number) ?? 0,
    title: (s.title as string) ?? 'Unknown',
    year: s.year as number | undefined,
    overview: s.overview as string | undefined,
    poster: pickPoster(s.images as ArrImage[], s.remotePoster as string),
    tvdbId: s.tvdbId as number | undefined,
    hasFile: (stats.episodeFileCount ?? 0) > 0,
    monitored: Boolean(s.monitored),
    raw: s,
  }
}

function mapArtist(a: Record<string, unknown>): ArrResult {
  const stats = (a.statistics as { trackFileCount?: number } | undefined) ?? {}
  return {
    kind: 'artist',
    id: (a.id as number) ?? 0,
    title: (a.artistName as string) ?? 'Unknown',
    overview: a.overview as string | undefined,
    poster: pickPoster(a.images as ArrImage[], a.remotePoster as string),
    hasFile: (stats.trackFileCount ?? 0) > 0,
    monitored: Boolean(a.monitored),
    raw: a,
  }
}

/** Search TMDb/TVDb via the *arr lookup endpoint. Results flag what's already
 *  in the library (id > 0), so the UI can show In Library / Requested / Add. */
export async function arrLookup(kind: ArrKind, term: string): Promise<ArrResult[]> {
  const q = encodeURIComponent(term.trim())
  if (kind === 'movie') {
    const data = await arrFetch<Record<string, unknown>[]>('movie', `/movie/lookup?term=${q}`)
    return data.map(mapMovie)
  }
  if (kind === 'artist') {
    const data = await arrFetch<Record<string, unknown>[]>('artist', `/artist/lookup?term=${q}`)
    return data.map(mapArtist)
  }
  const data = await arrFetch<Record<string, unknown>[]>('series', `/series/lookup?term=${q}`)
  return data.map(mapSeries)
}

interface ArrConfig {
  qualityProfileId: number
  rootFolderPath: string
  /** Lidarr only — required on artist adds. */
  metadataProfileId?: number
}

// Resolve the quality profile + root folder from the live *arr config rather than
// hardcoding, so renamed profiles / moved roots don't break adds. Prefer a 1080p
// profile; fall back to whatever exists. Cached for the session.
const configCache: Partial<Record<ArrKind, Promise<ArrConfig>>> = {}

function resolveConfig(kind: ArrKind): Promise<ArrConfig> {
  if (!configCache[kind]) {
    configCache[kind] = (async () => {
      const [profiles, roots] = await Promise.all([
        arrFetch<{ id: number; name: string }[]>(kind, '/qualityprofile'),
        arrFetch<{ path: string }[]>(kind, '/rootfolder'),
      ])
      const prof =
        kind === 'artist'
          ? profiles.find((p) => /lossless/i.test(p.name)) ??
            profiles.find((p) => /standard/i.test(p.name)) ??
            profiles[0]
          : profiles.find((p) => /1080/.test(p.name)) ??
            profiles.find((p) => p.id === 4) ??
            profiles[0]
      const root = roots[0]
      if (!prof || !root) throw new ArrError(0, 'No quality profile or root folder configured')
      const cfg: ArrConfig = { qualityProfileId: prof.id, rootFolderPath: root.path }
      if (kind === 'artist') {
        // Lidarr additionally needs a metadata profile ("Standard" over "None").
        const metas = await arrFetch<{ id: number; name: string }[]>('artist', '/metadataprofile')
        const meta = metas.find((m) => /standard/i.test(m.name)) ?? metas.find((m) => !/none/i.test(m.name)) ?? metas[0]
        if (!meta) throw new ArrError(0, 'No Lidarr metadata profile configured')
        cfg.metadataProfileId = meta.id
      }
      return cfg
    })()
  }
  return configCache[kind]!
}

/** Add the chosen result to Radarr/Sonarr/Lidarr and kick off a search for it. */
export async function arrAdd(result: ArrResult): Promise<void> {
  const cfg = await resolveConfig(result.kind)
  if (result.kind === 'artist') {
    await arrFetch('artist', '/artist', {
      method: 'POST',
      body: {
        ...result.raw,
        qualityProfileId: cfg.qualityProfileId,
        metadataProfileId: cfg.metadataProfileId,
        rootFolderPath: cfg.rootFolderPath,
        monitored: true,
        addOptions: { monitor: 'all', searchForMissingAlbums: true },
      },
    })
    return
  }
  if (result.kind === 'movie') {
    await arrFetch('movie', '/movie', {
      method: 'POST',
      body: {
        ...result.raw,
        qualityProfileId: cfg.qualityProfileId,
        rootFolderPath: cfg.rootFolderPath,
        monitored: true,
        minimumAvailability: 'released',
        addOptions: { searchForMovie: true },
      },
    })
  } else {
    await arrFetch('series', '/series', {
      method: 'POST',
      body: {
        ...result.raw,
        qualityProfileId: cfg.qualityProfileId,
        rootFolderPath: cfg.rootFolderPath,
        monitored: true,
        seasonFolder: true,
        addOptions: { monitor: 'all', searchForMissingEpisodes: true },
      },
    })
  }
}

// ---------- Download queue (request status) ----------

export interface ArrQueueItem {
  /** Unique row key. */
  key: string
  kind: ArrKind
  /** Radarr movieId / Sonarr seriesId / Lidarr artistId — matches a search result's `id`. */
  refId: number
  title: string
  detail?: string
  poster?: string
  /** 0–100 download progress. */
  progress: number
  /** Human status: Downloading / Importing… / Queued / Paused / Needs attention. */
  status: string
  /** True once the file(s) have downloaded (importing or done). */
  done: boolean
  /** Why it's stuck (from *arr status messages), for "Needs attention" rows. */
  reason?: string
  /** *arr queue record ids backing this row (an aggregated series row has several). */
  queueIds: number[]
  /** SABnzbd job ids (only for usenet downloads) — enables per-item pause/resume. */
  nzoIds: string[]
  /** Every backing download is currently paused. */
  paused: boolean
}

interface RawQueueRecord {
  id?: number
  downloadId?: string
  protocol?: string
  movieId?: number
  seriesId?: number
  artistId?: number
  movie?: { title?: string; images?: ArrImage[] }
  series?: { title?: string; images?: ArrImage[] }
  artist?: { artistName?: string; images?: ArrImage[] }
  episode?: { seasonNumber?: number; episodeNumber?: number }
  title?: string
  status?: string
  trackedDownloadStatus?: string
  trackedDownloadState?: string
  errorMessage?: string
  statusMessages?: { title?: string; messages?: string[] }[]
  size?: number
  sizeleft?: number
}

/** The most useful human reason a record is stuck, if any. */
function reasonOf(r: RawQueueRecord): string | undefined {
  if (r.errorMessage) return r.errorMessage
  for (const m of r.statusMessages ?? []) {
    if (m.messages?.length) return m.messages.find((x) => x && x.trim()) ?? m.title
    if (m.title) return m.title
  }
  return undefined
}

/** Usenet downloads live in SABnzbd, keyed by the record's downloadId.
 *  (SAB 4 ids look like "SABnzbd_nzo_…"; SAB 5 uses bare UUIDs — so key off the
 *  protocol, not the id shape.) */
function nzoOf(r: RawQueueRecord): string[] {
  return r.downloadId && r.protocol === 'usenet' ? [r.downloadId] : []
}

function statusLabel(status?: string, state?: string, tracked?: string): { label: string; done: boolean } {
  // A failed import LOOKS like status=completed — check the tracked status first,
  // or a dead import renders as a forever-"Importing…" row.
  if (state === 'importFailed' || tracked === 'warning' || tracked === 'error' || status === 'warning' || status === 'failed')
    return { label: 'Needs attention', done: false }
  if (state === 'importPending' || status === 'completed') return { label: 'Importing…', done: true }
  if (status === 'downloading') return { label: 'Downloading', done: false }
  if (status === 'paused') return { label: 'Paused', done: false }
  if (status === 'queued' || status === 'delay') return { label: 'Queued', done: false }
  return { label: status ?? 'Queued', done: false }
}

function pct(size?: number, left?: number): { size: number; left: number } {
  return { size: size ?? 0, left: left ?? 0 }
}

/** Aggregate multi-record rows (a series' episodes, an artist's albums) into one bar. */
interface Agg {
  rec: RawQueueRecord
  size: number
  left: number
  count: number
  anyDownloading: boolean
  anyWarning: boolean
  allPaused: boolean
  reason?: string
  queueIds: number[]
  nzoIds: string[]
}

function aggregate(records: RawQueueRecord[], idOf: (r: RawQueueRecord) => number): Map<number, Agg> {
  const map = new Map<number, Agg>()
  for (const r of records) {
    const id = idOf(r)
    const cur = map.get(id) ?? { rec: r, size: 0, left: 0, count: 0, anyDownloading: false, anyWarning: false, allPaused: true, queueIds: [], nzoIds: [] }
    const { size, left } = pct(r.size, r.sizeleft)
    cur.size += size
    cur.left += left
    cur.count += 1
    if (r.status === 'downloading') cur.anyDownloading = true
    if (r.trackedDownloadStatus === 'warning' || r.trackedDownloadState === 'importFailed' || r.status === 'failed' || r.status === 'warning') {
      cur.anyWarning = true
      if (!cur.reason) cur.reason = reasonOf(r)
    }
    if (r.status !== 'paused') cur.allPaused = false
    if (r.id) cur.queueIds.push(r.id)
    cur.nzoIds.push(...nzoOf(r))
    map.set(id, cur)
  }
  return map
}

/** Active downloads from Radarr + Sonarr + Lidarr, aggregated per movie / series / artist. */
export async function arrQueue(): Promise<ArrQueueItem[]> {
  const [radarr, sonarr, lidarr] = await Promise.all([
    arrFetch<{ records?: RawQueueRecord[] }>('movie', '/queue?includeMovie=true&pageSize=200').catch(() => ({ records: [] })),
    arrFetch<{ records?: RawQueueRecord[] }>('series', '/queue?includeSeries=true&includeEpisode=true&pageSize=200').catch(() => ({ records: [] })),
    arrFetch<{ records?: RawQueueRecord[] }>('artist', '/queue?includeArtist=true&pageSize=200').catch(() => ({ records: [] })),
  ])

  const items: ArrQueueItem[] = []

  // Radarr: one row per movie.
  for (const r of radarr.records ?? []) {
    const { size, left } = pct(r.size, r.sizeleft)
    const { label, done } = statusLabel(r.status, r.trackedDownloadState, r.trackedDownloadStatus)
    items.push({
      key: `movie-${r.movieId}`,
      kind: 'movie',
      refId: r.movieId ?? 0,
      title: r.movie?.title ?? r.title ?? 'Unknown',
      poster: pickPoster(r.movie?.images),
      progress: size > 0 ? Math.round(((size - left) / size) * 100) : done ? 100 : 0,
      status: label,
      done,
      reason: label === 'Needs attention' ? reasonOf(r) : undefined,
      queueIds: r.id ? [r.id] : [],
      nzoIds: nzoOf(r),
      paused: r.status === 'paused',
    })
  }

  const pushAgg = (kind: ArrKind, id: number, agg: Agg, title: string, detail: string, poster?: string) => {
    // A stuck record must surface even when siblings are still moving.
    const { label, done } = agg.anyWarning
      ? { label: 'Needs attention', done: false }
      : agg.anyDownloading
        ? { label: 'Downloading', done: false }
        : statusLabel(agg.rec.status, agg.rec.trackedDownloadState, agg.rec.trackedDownloadStatus)
    items.push({
      key: `${kind}-${id}`,
      kind,
      refId: id,
      title,
      detail,
      poster,
      progress: agg.size > 0 ? Math.round(((agg.size - agg.left) / agg.size) * 100) : done ? 100 : 0,
      status: label,
      done,
      reason: label === 'Needs attention' ? agg.reason : undefined,
      queueIds: agg.queueIds,
      nzoIds: agg.nzoIds,
      paused: agg.allPaused,
    })
  }

  for (const [id, agg] of aggregate(sonarr.records ?? [], (r) => r.seriesId ?? 0)) {
    pushAgg('series', id, agg, agg.rec.series?.title ?? 'Unknown',
      `${agg.count} episode${agg.count === 1 ? '' : 's'}`, pickPoster(agg.rec.series?.images))
  }
  for (const [id, agg] of aggregate(lidarr.records ?? [], (r) => r.artistId ?? 0)) {
    pushAgg('artist', id, agg, agg.rec.artist?.artistName ?? 'Unknown',
      `${agg.count} album${agg.count === 1 ? '' : 's'}`, pickPoster(agg.rec.artist?.images))
  }

  // Downloading first, then importing, then queued; most-complete first within a group.
  const rank = (i: ArrQueueItem) => (i.status === 'Downloading' ? 0 : i.done ? 1 : 2)
  return items.sort((a, b) => rank(a) - rank(b) || b.progress - a.progress)
}

// ---------- Queue controls ----------

/** Cancel a queued/downloading item: removes it from the *arr queue AND the
 *  download client. Never blocklists, so it can be re-grabbed later. */
export async function arrQueueRemove(item: ArrQueueItem): Promise<void> {
  if (item.queueIds.length === 0) return
  await arrFetch(item.kind, '/queue/bulk?removeFromClient=true&blocklist=false', {
    method: 'DELETE',
    body: { ids: item.queueIds },
  })
}

/** Unstick a "Needs attention" item: drop the bad download, blocklist that
 *  release so it isn't re-grabbed, and immediately search for another one. */
export async function arrQueueRetry(item: ArrQueueItem): Promise<void> {
  if (item.queueIds.length > 0) {
    await arrFetch(item.kind, '/queue/bulk?removeFromClient=true&blocklist=true', {
      method: 'DELETE',
      body: { ids: item.queueIds },
    })
  }
  const command =
    item.kind === 'movie'
      ? { name: 'MoviesSearch', movieIds: [item.refId] }
      : item.kind === 'series'
        ? { name: 'SeriesSearch', seriesId: item.refId }
        : { name: 'ArtistSearch', artistId: item.refId }
  await arrFetch(item.kind, '/command', { method: 'POST', body: command })
}

// ---------- Quality / upgrade / downgrade ----------

function fmtBytes(n?: number): string | undefined {
  if (n == null || !Number.isFinite(n) || n <= 0) return undefined
  const gb = n / 1_000_000_000
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`
  const mb = n / 1_000_000
  return `${mb.toFixed(0)} MB`
}

/** Human line for cards/modals, e.g. "Bluray-1080p · 1920×800 · 8.9 GB". */
export function formatQualityInfo(q: ArrQualityInfo): string {
  const parts: string[] = []
  if (q.qualityRange) parts.push(q.qualityRange)
  else if (q.qualityName) parts.push(q.qualityName)
  if (q.width && q.height) parts.push(`${q.width}×${q.height}`)
  else if (q.resolutionLabel) parts.push(q.resolutionLabel.replace(/x/i, '×'))
  if (q.videoCodec) parts.push(q.videoCodec)
  if (q.fileCount && q.fileCount > 1) parts.push(`${q.fileCount} files`)
  const size = fmtBytes(q.sizeBytes)
  if (size) parts.push(size)
  return parts.join(' · ') || 'On disk'
}

function qualityFromFile(file: Record<string, unknown> | undefined): Partial<ArrQualityInfo> {
  if (!file) return {}
  const q = (file.quality as { quality?: { name?: string; resolution?: number } } | undefined)?.quality
  const mi = (file.mediaInfo as Record<string, unknown> | undefined) ?? {}
  const width = typeof mi.width === 'number' ? mi.width : undefined
  const height = typeof mi.height === 'number' ? mi.height : undefined
  const resolutionLabel =
    typeof mi.resolution === 'string' && mi.resolution.includes('x')
      ? mi.resolution
      : width && height
        ? `${width}x${height}`
        : undefined
  return {
    qualityName: q?.name,
    qualityResolution: q?.resolution,
    width,
    height,
    resolutionLabel,
    videoCodec: typeof mi.videoCodec === 'string' ? mi.videoCodec : undefined,
    sizeBytes: typeof file.size === 'number' ? file.size : undefined,
  }
}

/** Load current on-disk quality for a library movie or series. */
export async function arrLibraryQuality(kind: ArrKind, id: number): Promise<ArrQualityInfo | null> {
  if (kind === 'artist' || !id) return null
  if (kind === 'movie') {
    const m = await arrFetch<Record<string, unknown>>('movie', `/movie/${id}`)
    const file = m.movieFile as Record<string, unknown> | undefined
    if (!file && !m.hasFile) return null
    return qualityFromFile(file) as ArrQualityInfo
  }
  // Series: summarize episode files (most common quality + pixel range if present).
  const files = await arrFetch<Record<string, unknown>[]>('series', `/episodefile?seriesId=${id}`)
  if (!files?.length) return null
  const names = new Map<string, number>()
  let totalSize = 0
  let minW: number | undefined
  let minH: number | undefined
  let maxW: number | undefined
  let maxH: number | undefined
  let codec: string | undefined
  for (const f of files) {
    const partial = qualityFromFile(f)
    if (partial.qualityName) names.set(partial.qualityName, (names.get(partial.qualityName) ?? 0) + 1)
    if (partial.sizeBytes) totalSize += partial.sizeBytes
    if (partial.width && partial.height) {
      minW = minW == null ? partial.width : Math.min(minW, partial.width)
      minH = minH == null ? partial.height : Math.min(minH, partial.height)
      maxW = maxW == null ? partial.width : Math.max(maxW, partial.width)
      maxH = maxH == null ? partial.height : Math.max(maxH, partial.height)
    }
    if (!codec && partial.videoCodec) codec = partial.videoCodec
  }
  const sorted = [...names.entries()].sort((a, b) => b[1] - a[1])
  const top = sorted[0]?.[0]
  const qualityRange =
    sorted.length > 1 ? `${sorted[sorted.length - 1]![0]} – ${sorted[0]![0]}` : top
  const resolutionLabel =
    minW && minH && maxW && maxH
      ? minW === maxW && minH === maxH
        ? `${minW}x${minH}`
        : `${minW}x${minH}–${maxW}x${maxH}`
      : undefined
  return {
    qualityName: top,
    qualityRange,
    width: maxW,
    height: maxH,
    resolutionLabel,
    videoCodec: codec,
    sizeBytes: totalSize || undefined,
    fileCount: files.length,
  }
}

function mapRelease(r: Record<string, unknown>): ArrRelease {
  const q = (r.quality as { quality?: { name?: string; resolution?: number } } | undefined)?.quality
  const rejections = Array.isArray(r.rejections)
    ? (r.rejections as unknown[]).map((x) => (typeof x === 'string' ? x : String(x)))
    : []
  return {
    guid: String(r.guid ?? ''),
    indexerId: Number(r.indexerId ?? 0),
    title: String(r.title ?? 'Unknown release'),
    qualityName: q?.name ?? 'Unknown',
    qualityResolution: q?.resolution,
    size: Number(r.size ?? 0),
    seeders: typeof r.seeders === 'number' ? r.seeders : undefined,
    ageHours: typeof r.ageHours === 'number' ? r.ageHours : typeof r.age === 'number' ? r.age * 24 : undefined,
    rejected: Boolean(r.rejected) || rejections.length > 0,
    rejections,
    customFormatScore: Number(r.customFormatScore ?? 0),
    isUpgrade: typeof r.isUpgrade === 'boolean' ? r.isUpgrade : undefined,
    raw: r,
  }
}

/** Interactive search — list available releases for a movie or series. */
export async function arrSearchReleases(kind: ArrKind, id: number): Promise<ArrRelease[]> {
  if (kind === 'artist') throw new ArrError(0, 'Quality change is only available for movies and shows')
  const path = kind === 'movie' ? `/release?movieId=${id}` : `/release?seriesId=${id}`
  const data = await arrFetch<Record<string, unknown>[]>(kind, path)
  const mapped = (data ?? []).map(mapRelease)
  // Prefer upgrades + higher score first; rejected last.
  return mapped.sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1
    if (Boolean(a.isUpgrade) !== Boolean(b.isUpgrade)) return a.isUpgrade ? -1 : 1
    const res = (b.qualityResolution ?? 0) - (a.qualityResolution ?? 0)
    if (res) return res
    return (b.customFormatScore ?? 0) - (a.customFormatScore ?? 0) || (b.seeders ?? 0) - (a.seeders ?? 0)
  })
}

/** Grab a specific release (works for upgrade or downgrade / force). */
export async function arrGrabRelease(kind: ArrKind, release: ArrRelease): Promise<void> {
  if (kind === 'artist') throw new ArrError(0, 'Not supported for music')
  // Post the original release payload — *arr expects its own shape (guid + indexerId at minimum).
  await arrFetch(kind, '/release', {
    method: 'POST',
    body: release.raw?.guid
      ? release.raw
      : { guid: release.guid, indexerId: release.indexerId },
  })
}

/** Automatic search for a better release within the quality profile (MoviesSearch / SeriesSearch). */
export async function arrAutomaticSearch(kind: ArrKind, id: number): Promise<void> {
  if (kind === 'movie') {
    await arrFetch('movie', '/command', { method: 'POST', body: { name: 'MoviesSearch', movieIds: [id] } })
    return
  }
  if (kind === 'series') {
    await arrFetch('series', '/command', { method: 'POST', body: { name: 'SeriesSearch', seriesId: id } })
    return
  }
  throw new ArrError(0, 'Automatic search is only available for movies and shows')
}
