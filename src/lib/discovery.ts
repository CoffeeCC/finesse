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

// ---------- Relevance of what Radarr / Sonarr / Lidarr's lookup returns ----------
//
// Their lookups are fuzzy (TMDb / TVDb / MusicBrainz search): a query that matches nothing
// still comes back with unrelated titles. A result is kept when every word of the query is
// in one of its titles: as a word or the start of one, with a typo allowed in longer words,
// or the query written without spaces ("spiderman" for "Spider-Man"). Little words ("the",
// "of") and years don't have to match. An id lookup (tmdb:603, imdb:tt0133093) keeps all.

const LITTLE = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'at', 'for', 'la', 'le', 'les', 'el', 'los', 'der', 'die', 'das'])

/** Edit distance with a cap: anything over `max` comes back as max + 1. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j]! < best) best = cur[j]!
    }
    if (best > max) return false
    prev = cur
  }
  return prev[b.length]! <= max
}

function wordMatches(token: string, word: string): boolean {
  if (word.startsWith(token)) return true
  // A typo only in longer words, and not in the first letter ("bean" isn't "mean").
  const typos = token.length >= 9 ? 2 : token.length >= 5 ? 1 : 0
  if (!typos || token[0] !== word[0]) return false
  // The whole word, or its start (someone still typing).
  return within(token, word, typos) || within(token, word.slice(0, token.length), typos)
}

/** Whether one of `titles` (a result's title, original title, alternate titles) answers `term`. */
export function matchesTerm(titles: (string | null | undefined)[], term: string): boolean {
  if (/^\s*(tmdb|tvdb|imdb|mbid|lidarr|spotify)\s*:|^\s*tt\d{5,}\s*$/i.test(term)) return true
  const q = normTitle(term)
  if (!q) return true
  const all = q.split(' ')
  const words = all.filter((t) => !LITTLE.has(t) && !/^(19|20)\d\d$/.test(t) && (t.length > 1 || all.length === 1))
  const tokens = words.length ? words : all
  const squashed = q.replace(/ /g, '')
  for (const t of titles) {
    if (!t) continue
    const name = normTitle(t)
    if (!name) continue
    if (squashed.length >= 4 && name.replace(/ /g, '').includes(squashed)) return true
    const parts = name.split(' ')
    if (tokens.every((tok) => parts.some((w) => wordMatches(tok, w)))) return true
  }
  return false
}

/** Every title a lookup result goes by: its own, the original, and the alternates *arr lists. */
export function lookupTitles(r: { title: string; raw?: Record<string, unknown> }): string[] {
  const raw = r.raw ?? {}
  const out = [r.title]
  if (typeof raw.originalTitle === 'string') out.push(raw.originalTitle)
  if (typeof raw.sortTitle === 'string') out.push(raw.sortTitle)
  if (Array.isArray(raw.alternateTitles)) for (const a of raw.alternateTitles) if (a && typeof (a as { title?: unknown }).title === 'string') out.push((a as { title: string }).title)
  return out
}
