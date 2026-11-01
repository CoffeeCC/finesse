// The Activity page's list: what's happening on the server, from data the app already reads
// (and this account may already see): what's playing (Jellyfin's sessions: an administrator
// sees the whole house, anyone else their own), downloads (the download queue), requests
// still waiting (Radarr/Sonarr/Lidarr), and what was just added (Jellyfin, this account's
// libraries). Moments stay in their own inbox: this is the server's progress, not messages.
// Pure (no imports), so server/test/activity.test.ts can test it.

export type ActivityType = 'playing' | 'downloading' | 'requested' | 'added'

export interface ActivityEntry {
  key: string
  type: ActivityType
  title: string
  /** A second line: who and where, the download's state, the request's status. */
  detail: string
  /** When it happened (ISO); none for things happening now. */
  at?: string
  /** Where tapping it goes. */
  to: string
  /** Happened since the last visit to Activity. */
  isNew?: boolean
  /** Download progress 0–100, when there's a real one. */
  progress?: number
  tone?: 'ok' | 'busy' | 'wait' | 'bad'
}

export interface ActivitySources {
  playing?: { id: string; itemId: string; title: string; who?: string; device?: string; paused?: boolean }[]
  downloads?: { key: string; title: string; status: string; progress: number; done: boolean; reason?: string }[]
  requested?: { key: string; title: string; year?: number; added: string; status: string; tone?: ActivityEntry['tone'] }[]
  added?: { id: string; title: string; at?: string; kind?: string }[]
}

const time = (iso?: string) => (iso && Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : -Infinity)

/**
 * One list: what's happening now first (playing, then downloads), then requests and new
 * titles, newest first. `seenAt` (ms) marks what's new since the last visit. A request whose
 * download is in the queue shows once, as the download.
 */
export function buildActivity(src: ActivitySources, seenAt: number | null): { now: ActivityEntry[]; recent: ActivityEntry[] } {
  const now: ActivityEntry[] = []
  for (const p of src.playing ?? []) {
    now.push({
      key: `play-${p.id}`,
      type: 'playing',
      title: p.title,
      detail: [p.paused ? 'Paused' : 'Playing', p.who && `by ${p.who}`, p.device && `on ${p.device}`].filter(Boolean).join(' '),
      to: `/item/${p.itemId}`,
      tone: 'busy',
    })
  }
  const downloading = new Set<string>()
  for (const d of src.downloads ?? []) {
    downloading.add(d.key)
    const pct = Math.max(0, Math.min(100, Math.round(d.progress)))
    const stuck = d.status === 'Needs attention'
    now.push({
      key: `dl-${d.key}`,
      type: 'downloading',
      title: d.title,
      detail: stuck ? `Download stuck${d.reason ? `: ${d.reason}` : ''}` : d.done ? 'Downloaded, adding it to the library' : d.status === 'Downloading' ? `Downloading ${pct}%` : d.status,
      to: '/request',
      progress: !stuck && !d.done && d.status === 'Downloading' ? pct : undefined,
      tone: stuck ? 'bad' : 'busy',
    })
  }
  const recent: ActivityEntry[] = []
  for (const r of src.requested ?? []) {
    if (downloading.has(r.key)) continue
    recent.push({ key: `req-${r.key}`, type: 'requested', title: r.year ? `${r.title} (${r.year})` : r.title, detail: `Requested · ${r.status}`, at: r.added, to: '/request', tone: r.tone ?? 'wait' })
  }
  for (const a of src.added ?? []) {
    recent.push({ key: `add-${a.id}`, type: 'added', title: a.title, detail: a.kind ? `New ${a.kind.toLowerCase()} in the library` : 'New in the library', at: a.at, to: `/item/${a.id}`, tone: 'ok' })
  }
  recent.sort((a, b) => time(b.at) - time(a.at))
  if (seenAt != null) for (const e of recent) e.isNew = time(e.at) > seenAt
  return { now, recent }
}

/** "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export function agoLabel(iso: string | undefined, nowMs = Date.now()): string {
  const t = time(iso)
  if (t === -Infinity) return ''
  const mins = Math.max(0, Math.round((nowMs - t) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
