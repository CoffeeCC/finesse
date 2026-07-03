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
      if (text) detail = text
    } catch {
      /* ignore */
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
  size?: number
  sizeleft?: number
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
    if (r.trackedDownloadStatus === 'warning' || r.trackedDownloadState === 'importFailed' || r.status === 'failed' || r.status === 'warning')
      cur.anyWarning = true
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
