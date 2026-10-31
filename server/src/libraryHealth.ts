// Library health (Settings → Server, administrators): a read-only look for things
// that make the library confusing. Nothing here changes, moves or deletes anything;
// it only reads Jellyfin, Radarr and Sonarr and says what it found and where.
//   - duplicate copies: two movies with the same TMDb id, or two episode items
//     for one season/episode of a show (Next Episode and the episode list trip on these);
//   - not followed: movies/shows in Jellyfin that Radarr/Sonarr don't know, so
//     upgrades and re-downloads won't happen for them;
//   - maybe cut short: a movie whose file runs well under half the length
//     Radarr expects (an interrupted download or a sample);
//   - misfiled: episodes without season/episode numbers (shown as unknown).

import type { Endpoint, Settings } from './config.ts'
import { joinUrl } from './http/proxy.ts'

export interface JfLite {
  Id: string
  Name?: string
  Type?: string
  SeriesId?: string
  SeriesName?: string
  ParentIndexNumber?: number | null
  IndexNumber?: number | null
  RunTimeTicks?: number | null
  ProductionYear?: number
  Path?: string
  ProviderIds?: Record<string, string | undefined>
}
interface RadarrMovie {
  tmdbId?: number
  title?: string
  runtime?: number
  hasFile?: boolean
}
interface SonarrSeries {
  tvdbId?: number
  title?: string
}

export type FindingKind = 'duplicate' | 'unfollowed' | 'short' | 'misfiled'
export interface Finding {
  kind: FindingKind
  title: string
  detail: string
  /** Jellyfin ids, to open the titles from the list. */
  items: string[]
}
export interface LibraryHealth {
  checkedAt: string
  findings: Finding[]
  /** What couldn't be checked (an app not answering), said plainly. */
  skipped: string[]
}

const TICKS_PER_MIN = 600_000_000
const fileName = (p?: string) => (p ? p.split(/[\\/]/).pop() ?? p : '')

/** Pure: what's worth a look, from what each app returned (null: that app wasn't asked). */
export function analyse(movies: JfLite[], episodes: JfLite[], series: JfLite[], radarr: RadarrMovie[] | null, sonarr: SonarrSeries[] | null): Finding[] {
  const out: Finding[] = []

  // Duplicate movies: one TMDb id, several items.
  const byTmdb = new Map<string, JfLite[]>()
  for (const m of movies) {
    const t = m.ProviderIds?.Tmdb
    if (t) byTmdb.set(t, [...(byTmdb.get(t) ?? []), m])
  }
  for (const group of byTmdb.values()) {
    if (group.length < 2) continue
    const m = group[0]!
    out.push({ kind: 'duplicate', title: `${m.Name ?? 'A movie'}${m.ProductionYear ? ` (${m.ProductionYear})` : ''}`, detail: `${group.length} copies: ${group.map((g) => fileName(g.Path) || g.Name).join(', ')}. Keep one, or let Jellyfin group them as versions (same folder).`, items: group.map((g) => g.Id) })
  }

  // Duplicate episodes, and episodes without numbers.
  const byEp = new Map<string, JfLite[]>()
  const unnumbered = new Map<string, JfLite[]>()
  for (const e of episodes) {
    if (e.ParentIndexNumber == null || e.IndexNumber == null) {
      unnumbered.set(e.SeriesId ?? '', [...(unnumbered.get(e.SeriesId ?? '') ?? []), e])
      continue
    }
    const k = `${e.SeriesId}:${e.ParentIndexNumber}:${e.IndexNumber}`
    byEp.set(k, [...(byEp.get(k) ?? []), e])
  }
  for (const group of byEp.values()) {
    if (group.length < 2) continue
    const e = group[0]!
    out.push({ kind: 'duplicate', title: `${e.SeriesName ?? 'A show'} S${e.ParentIndexNumber}:E${e.IndexNumber}`, detail: `${group.length} copies of one episode: ${group.map((g) => fileName(g.Path) || g.Name).join(', ')}.`, items: group.map((g) => g.Id) })
  }
  for (const group of unnumbered.values()) {
    const e = group[0]!
    out.push({ kind: 'misfiled', title: e.SeriesName ?? 'A show', detail: `${group.length} episode${group.length > 1 ? 's' : ''} without a season or episode number (${group.slice(0, 3).map((g) => fileName(g.Path) || g.Name).join(', ')}${group.length > 3 ? ', …' : ''}). Rename them like “Show S01E02”, or fix the match in Jellyfin.`, items: group.map((g) => g.Id) })
  }

  // Movies Radarr doesn't follow; files much shorter than Radarr expects.
  if (radarr) {
    const known = new Map(radarr.filter((r) => r.tmdbId).map((r) => [String(r.tmdbId), r]))
    const notFollowed = movies.filter((m) => m.ProviderIds?.Tmdb && !known.has(m.ProviderIds.Tmdb))
    if (notFollowed.length)
      out.push({ kind: 'unfollowed', title: `${notFollowed.length} movie${notFollowed.length > 1 ? 's' : ''} Radarr doesn’t know`, detail: `${notFollowed.slice(0, 5).map((m) => m.Name).join(', ')}${notFollowed.length > 5 ? ', …' : ''}. Radarr won’t upgrade or replace these; add them in Radarr (Library Import) if you want it to.`, items: notFollowed.map((m) => m.Id) })
    for (const m of movies) {
      const r = m.ProviderIds?.Tmdb ? known.get(m.ProviderIds.Tmdb) : undefined
      const expected = r?.runtime ?? 0
      const actual = (m.RunTimeTicks ?? 0) / TICKS_PER_MIN
      if (expected >= 20 && actual > 0 && actual < expected * 0.5)
        out.push({ kind: 'short', title: m.Name ?? 'A movie', detail: `The file runs ${Math.round(actual)} min, but the movie is ${expected} min. It may be cut short (an interrupted download, or a sample): ${fileName(m.Path)}.`, items: [m.Id] })
    }
  }
  if (sonarr) {
    const known = new Set(sonarr.filter((s) => s.tvdbId).map((s) => String(s.tvdbId)))
    const notFollowed = series.filter((s) => s.ProviderIds?.Tvdb && !known.has(s.ProviderIds.Tvdb))
    if (notFollowed.length)
      out.push({ kind: 'unfollowed', title: `${notFollowed.length} show${notFollowed.length > 1 ? 's' : ''} Sonarr doesn’t know`, detail: `${notFollowed.slice(0, 5).map((s) => s.Name).join(', ')}${notFollowed.length > 5 ? ', …' : ''}. Sonarr won’t fetch new episodes for these; add them in Sonarr (Library Import) if you want it to.`, items: notFollowed.map((s) => s.Id) })
  }
  return out
}

type Get = (url: string | URL, headers: Record<string, string>) => Promise<unknown>
const liveGet: Get = async (url, headers) => {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!r.ok) throw new Error(`answered ${r.status}`)
  return r.json()
}

/** Reads (only) Jellyfin through `jf`, and Radarr/Sonarr with their keys. */
export async function libraryHealth(s: Settings, jf: <T>(path: string) => Promise<T>, get: Get = liveGet): Promise<LibraryHealth> {
  const skipped: string[] = []
  const items = (type: string) =>
    jf<{ Items?: JfLite[] }>(`/Items?Recursive=true&IncludeItemTypes=${type}&Fields=ProviderIds,Path&EnableImages=false&EnableUserData=false`).then((r) => r.Items ?? [])
  const [movies, episodes, series] = await Promise.all([items('Movie'), items('Episode'), items('Series')])
  const arr = async <T>(svc: Endpoint | undefined, name: string, path: string): Promise<T | null> => {
    if (!svc?.url || !svc.apiKey) return null
    try {
      return (await get(joinUrl(svc.url, path), { 'x-api-key': svc.apiKey })) as T
    } catch {
      skipped.push(`${name} didn’t answer, so titles it doesn’t know weren’t checked.`)
      return null
    }
  }
  const [radarr, sonarr] = await Promise.all([arr<RadarrMovie[]>(s.services.radarr, 'Radarr', '/api/v3/movie'), arr<SonarrSeries[]>(s.services.sonarr, 'Sonarr', '/api/v3/series')])
  return { checkedAt: new Date().toISOString(), findings: analyse(movies, episodes, series, radarr, sonarr), skipped }
}
