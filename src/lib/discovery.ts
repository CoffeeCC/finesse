// One title, wherever it turns up: in the library (Jellyfin) or requestable (Radarr/Sonarr).
// Matched by TMDb / TVDb id when both sides have one; only when either lacks ids does a
// title + year match decide. Pure (no imports), so server/test/discovery.test.ts can test it.

/** The fields of a Jellyfin item this looks at. */
export interface LibraryLike {
  Id: string
  Type?: string
  Name?: string
  ProductionYear?: number | null
  ProviderIds?: Record<string, string> | null
}

/** The fields of an ArrResult this looks at. */
export interface RequestableLike {
  kind: 'movie' | 'series' | 'artist'
  title: string
  year?: number
  tmdbId?: number
  tvdbId?: number
}

export const normTitle = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const pid = (ids: Record<string, string> | null | undefined, name: string): string => {
  if (!ids) return ''
  for (const [k, v] of Object.entries(ids)) if (k.toLowerCase() === name && v) return String(v).trim()
  return ''
}

/** Whether a library item is the requestable title `r`. */
export function isSameTitle(item: LibraryLike, r: RequestableLike): boolean {
  if (r.kind === 'movie' ? item.Type !== 'Movie' : r.kind === 'series' ? item.Type !== 'Series' : true) return false
  const ext = r.kind === 'movie' ? r.tmdbId : r.tvdbId
  const mine = pid(item.ProviderIds, r.kind === 'movie' ? 'tmdb' : 'tvdb')
  if (ext && mine) return String(ext) === mine
  // A show may carry only a TMDb id in Jellyfin, and Sonarr results usually have one too.
  if (r.kind === 'series' && r.tmdbId && pid(item.ProviderIds, 'tmdb')) return String(r.tmdbId) === pid(item.ProviderIds, 'tmdb')
  return normTitle(item.Name ?? '') === normTitle(r.title) && (!r.year || !item.ProductionYear || r.year === item.ProductionYear)
}

export type DiscoveryEntry<L, R> = { source: 'library'; item: L } | { source: 'request'; r: R }

/**
 * One list of titles for a search: what the library has first (in the order given), then
 * requestable titles the library doesn't have. A requestable title that is the same as a library
 * item (by id, see isSameTitle) is dropped, and so is one its app already has on disk (the
 * library will show it once scanned). `limitRequest` caps the requestable part.
 */
export function mergeTitles<L extends LibraryLike, R extends RequestableLike & { id: number; hasFile: boolean }>(
  library: L[],
  requestable: R[],
  limitRequest = 6,
): DiscoveryEntry<L, R>[] {
  const out: DiscoveryEntry<L, R>[] = library.map((item) => ({ source: 'library', item }))
  const titles = library.filter((i) => i.Type === 'Movie' || i.Type === 'Series')
  let n = 0
  for (const r of requestable) {
    if (n >= limitRequest) break
    if (r.kind === 'artist') continue
    if (r.id > 0 && r.hasFile) continue
    if (titles.some((i) => isSameTitle(i, r))) continue
    out.push({ source: 'request', r })
    n++
  }
  return out
}
