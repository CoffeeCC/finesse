// Where a request stands, in one place: searching, not out yet, queued, downloading (with %),
// adding to the library, stuck, searching again after a failed download, or ready. Built only
// from what Radarr/Sonarr/Lidarr report (their queue, the title's files, failed-download
// history), so a percentage only shows when a download really reports one.
// Pure (no imports), so server/test/request-status.test.ts can test it.

export type RequestStage = 'none' | 'searching' | 'not-out' | 'queued' | 'downloading' | 'paused' | 'importing' | 'stuck' | 'retrying' | 'ready'

export interface RequestFacts {
  /** The app has the title (it was requested, here or elsewhere). */
  requested: boolean
  /** Something of it is on disk. */
  hasFile: boolean
  /** False while it isn't out yet (announced, in cinemas, no episodes aired). */
  available?: boolean
  /** Its row in the download queue (api/arr.ts ArrQueueItem), if any. */
  queue?: { status: string; progress: number; done: boolean; paused?: boolean; reason?: string }
  /** A recent failed download for it (the app's history). */
  failure?: { message?: string; date?: string }
}

export interface RequestStatus {
  stage: RequestStage
  /** Short words for a badge: "Downloading 42%". */
  label: string
  /** A second line when there's more to say (why it's stuck, what failed). */
  detail?: string
  /** 0–100, only while downloading or paused with a real size. */
  progress?: number
  /** ok = ready, busy = moving, wait = waiting on something, bad = needs someone. */
  tone: 'ok' | 'busy' | 'wait' | 'bad'
}

export function requestStatus(f: RequestFacts): RequestStatus {
  if (f.hasFile) return { stage: 'ready', label: 'Ready to watch', tone: 'ok' }
  const q = f.queue
  if (q) {
    if (q.status === 'Needs attention')
      return { stage: 'stuck', label: 'Download stuck', detail: q.reason ? `${q.reason}` : 'The download needs a look from whoever runs the server.', tone: 'bad' }
    if (q.done) return { stage: 'importing', label: 'Almost ready', detail: 'Downloaded, adding it to the library', tone: 'busy' }
    const pct = Math.max(0, Math.min(100, Math.round(q.progress)))
    if (q.paused || q.status === 'Paused') return { stage: 'paused', label: `Paused at ${pct}%`, progress: pct, tone: 'wait' }
    if (q.status === 'Downloading') return { stage: 'downloading', label: `Downloading ${pct}%`, progress: pct, tone: 'busy' }
    return { stage: 'queued', label: 'Queued to download', tone: 'wait' }
  }
  if (!f.requested) return { stage: 'none', label: 'Not requested', tone: 'wait' }
  if (f.available === false) return { stage: 'not-out', label: 'Not out yet', detail: 'It downloads as soon as it’s released.', tone: 'wait' }
  if (f.failure)
    return {
      stage: 'retrying',
      label: 'Searching again',
      detail: f.failure.message ? `The last download failed: ${f.failure.message}` : 'The last download failed.',
      tone: 'wait',
    }
  return { stage: 'searching', label: 'Searching for a release', tone: 'wait' }
}

/** Keys failed-download records by title (`movie-7`), keeping each title's newest. */
export function failuresByTitle(
  records: { kind: 'movie' | 'series' | 'artist'; movieId?: number; seriesId?: number; artistId?: number; date?: string; message?: string }[],
): Map<string, { message?: string; date?: string }> {
  const out = new Map<string, { message?: string; date?: string }>()
  for (const r of records) {
    const id = r.kind === 'movie' ? r.movieId : r.kind === 'series' ? r.seriesId : r.artistId
    if (!id) continue
    const key = `${r.kind}-${id}`
    const cur = out.get(key)
    const t = (d?: string) => (d && Number.isFinite(Date.parse(d)) ? Date.parse(d) : -Infinity)
    if (!cur || t(r.date) > t(cur.date)) out.set(key, { message: r.message, date: r.date })
  }
  return out
}
