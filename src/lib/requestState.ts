// After a request: which cached results are the title just requested, and how they change.
// Shared by the Request page, global search, Discover and the movie page (api/queries.ts
// noteRequested), so they all agree straight away. Pure (no imports), so
// server/test/request-state.test.ts can test it.

/** The fields of an ArrResult this looks at. */
export interface RequestableLike {
  kind: 'movie' | 'series' | 'artist'
  id: number
  title: string
  year?: number
  tmdbId?: number
  tvdbId?: number
  monitored: boolean
  raw?: Record<string, unknown>
}

/** The same title, whichever list it came from (search, Discover, a detail page). */
export function sameArrTitle(a: RequestableLike, b: RequestableLike): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'movie' && a.tmdbId && b.tmdbId) return a.tmdbId === b.tmdbId
  if (a.kind === 'series' && a.tvdbId && b.tvdbId) return a.tvdbId === b.tvdbId
  const fa = a.raw?.foreignArtistId
  if (a.kind === 'artist' && fa && b.raw?.foreignArtistId) return fa === b.raw.foreignArtistId
  return a.title === b.title && (a.year ?? 0) === (b.year ?? 0)
}

/** A key for "this title", for keeping one request at a time per title. */
export function requestKey(r: RequestableLike): string {
  const ext = r.kind === 'movie' ? r.tmdbId : r.kind === 'series' ? r.tvdbId : r.raw?.foreignArtistId
  return `${r.kind}:${ext ?? ''}:${r.title}:${r.year ?? ''}`
}

/**
 * `x` as it is now that `requested` was added with the app's id `id` (0 if the app didn't say):
 * it has that id (so it reads as requested) and is monitored; a Discover entry is "existing".
 * Other titles come back unchanged (the same object).
 */
export function markRequested<T extends RequestableLike>(x: T, requested: RequestableLike, id: number): T {
  if (!sameArrTitle(x, requested)) return x
  const newId = x.id > 0 ? x.id : id > 0 ? id : x.id
  if (newId <= 0) return x // the app didn't say: the refetch that follows will
  return { ...x, id: newId, monitored: true, ...('existing' in x ? { existing: true } : {}) }
}
