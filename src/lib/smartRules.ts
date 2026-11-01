// Smart collections: a saved set of rules ("unwatched films under 100 minutes") that picks titles
// from the library each time it's opened, so it stays up to date as titles are added and watched.
//
// Only fields Jellyfin keeps reliably are offered: the kind of title, genres, year, running time
// (films), when it was added, and watched state (films and shows, per profile). The server stores
// the rules (server/src/smartCollections.ts) and checks them with cleanRules; the app asks
// Jellyfin with the viewer's own sign-in (jellyfinQuery), so watched state is theirs and their
// profile's limits apply, then checks every rule again here (matches) and says why each title
// is in (reasons). Pure (no imports), so the server and server/test can use it.

export type SmartKind = 'Movie' | 'Series' | 'MusicAlbum'
export type WatchedRule = 'unwatched' | 'watched' | 'in-progress'
export type SmartSort = 'added' | 'title' | 'year' | 'runtime'

export interface SmartRules {
  kind: SmartKind
  /** Any of these genres (Jellyfin's names). Empty: any genre. */
  genres: string[]
  yearFrom: number | null
  yearTo: number | null
  /** Films only. */
  minMinutes: number | null
  maxMinutes: number | null
  /** Added to the library in the last N days. */
  addedWithinDays: number | null
  /** Films and shows only (albums have no reliable watched state). */
  watched: WatchedRule | null
  sort: SmartSort
}

export const KIND_LABEL: Record<SmartKind, string> = { Movie: 'Movies', Series: 'Shows', MusicAlbum: 'Albums' }

/** Which rules make sense for a kind of title. Fields that aren't here aren't offered. */
export function fieldsFor(kind: SmartKind): { runtime: boolean; watched: WatchedRule[] } {
  if (kind === 'Movie') return { runtime: true, watched: ['unwatched', 'in-progress', 'watched'] }
  if (kind === 'Series') return { runtime: false, watched: ['unwatched', 'watched'] }
  return { runtime: false, watched: [] }
}

export const WATCHED_LABEL: Record<SmartKind, Record<WatchedRule, string>> = {
  Movie: { unwatched: 'Not watched yet', 'in-progress': 'Started, not finished', watched: 'Watched' },
  Series: { unwatched: 'Not finished', 'in-progress': 'Not finished', watched: 'Watched every episode' },
  MusicAlbum: { unwatched: '', 'in-progress': '', watched: '' },
}

export const ADDED_CHOICES = [7, 30, 90, 365]

export const PRESETS: { id: string; name: string; rules: Partial<SmartRules> & { kind: SmartKind } }[] = [
  { id: 'short', name: 'Short films for tonight', rules: { kind: 'Movie', watched: 'unwatched', maxMinutes: 100, sort: 'runtime' } },
  { id: 'unfinished', name: 'Films to finish', rules: { kind: 'Movie', watched: 'in-progress', sort: 'added' } },
  { id: 'new-albums', name: 'Albums added this month', rules: { kind: 'MusicAlbum', addedWithinDays: 30, sort: 'added' } },
  { id: 'new-shows', name: 'Shows not finished, added lately', rules: { kind: 'Series', watched: 'unwatched', addedWithinDays: 90, sort: 'added' } },
  { id: 'nineties', name: '90s films', rules: { kind: 'Movie', yearFrom: 1990, yearTo: 1999, sort: 'year' } },
]

export const NAME_MAX = 60
const GENRES_MAX = 12

export function emptyRules(kind: SmartKind = 'Movie'): SmartRules {
  return { kind, genres: [], yearFrom: null, yearTo: null, minMinutes: null, maxMinutes: null, addedWithinDays: null, watched: null, sort: 'added' }
}

const KINDS: SmartKind[] = ['Movie', 'Series', 'MusicAlbum']
const SORTS: SmartSort[] = ['added', 'title', 'year', 'runtime']

function int(v: unknown, min: number, max: number, what: string): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${what} must be a whole number from ${min} to ${max}`)
  return n
}

/** Rules as saved: checked and tidied. Throws an Error that says what to fix. Fields a kind doesn't offer are dropped. */
export function cleanRules(input: unknown): SmartRules {
  if (!input || typeof input !== 'object') throw new Error('Pick what the collection holds')
  const r = input as Record<string, unknown>
  const kind = r.kind as SmartKind
  if (!KINDS.includes(kind)) throw new Error('Pick movies, shows or albums')
  const f = fieldsFor(kind)
  const genres = Array.isArray(r.genres)
    ? [...new Set(r.genres.map((g) => String(g).replace(/[\u0000-\u001f|]/g, '').trim().slice(0, 40)).filter(Boolean))]
    : []
  if (genres.length > GENRES_MAX) throw new Error(`Pick at most ${GENRES_MAX} genres`)
  const yearFrom = int(r.yearFrom, 1870, 2100, 'The first year')
  const yearTo = int(r.yearTo, 1870, 2100, 'The last year')
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error('The first year comes after the last one')
  const minMinutes = f.runtime ? int(r.minMinutes, 1, 1000, 'The shortest running time') : null
  const maxMinutes = f.runtime ? int(r.maxMinutes, 1, 1000, 'The longest running time') : null
  if (minMinutes !== null && maxMinutes !== null && minMinutes > maxMinutes) throw new Error('The shortest running time is longer than the longest')
  const addedWithinDays = int(r.addedWithinDays, 1, 3650, 'Added within (days)')
  const w = r.watched === null || r.watched === undefined || r.watched === '' ? null : (r.watched as WatchedRule)
  if (w !== null && !f.watched.includes(w)) throw new Error(kind === 'MusicAlbum' ? 'Albums can’t be picked by watched state' : 'Pick a watched state from the list')
  const sort = SORTS.includes(r.sort as SmartSort) ? (r.sort as SmartSort) : 'added'
  return { kind, genres, yearFrom, yearTo, minMinutes, maxMinutes, addedWithinDays, watched: w, sort: sort === 'runtime' && !f.runtime ? 'added' : sort }
}

/** A collection's name, tidied; throws when there's nothing left. */
export function cleanName(v: unknown): string {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX)
  if (!s) throw new Error('Give the collection a name')
  return s
}

/** The fields of a Jellyfin item the rules look at. */
export interface SmartItem {
  Type?: string
  Name?: string
  SortName?: string
  ProductionYear?: number | null
  Genres?: string[] | null
  RunTimeTicks?: number | null
  DateCreated?: string | null
  UserData?: { Played?: boolean; PlaybackPositionTicks?: number; UnplayedItemCount?: number } | null
}

/** How many titles a collection asks Jellyfin for before the last rules are checked here. */
export const FETCH_LIMIT = 400

/**
 * What to ask Jellyfin (as getItems options): the kind, genres, years and watched state narrow
 * it there. Running time and date added are checked by `matches` (Jellyfin can't filter on
 * them), so the list is fetched in the order that puts the titles those rules keep first (newest,
 * shortest or longest), and `sortItems` puts it in the collection's own order afterwards.
 */
export function jellyfinQuery(r: SmartRules): {
  includeItemTypes: string
  recursive: true
  genres?: string
  years?: string
  filters?: string
  sortBy: string
  sortOrder: string
  limit: number
  fields: string
} {
  let years: number[] = []
  if (r.yearFrom !== null || r.yearTo !== null) {
    const from = r.yearFrom ?? 1870
    const to = r.yearTo ?? new Date().getFullYear() + 1
    for (let y = from; y <= to; y++) years.push(y)
    // A wide span is left to `matches`, not spelled out year by year in the address.
    if (years.length > 60) years = []
  }
  // Jellyfin's Filters: IsPlayed / IsUnplayed / IsResumable (per profile).
  const filters = r.watched === 'watched' ? 'IsPlayed' : r.watched === 'unwatched' ? 'IsUnplayed' : r.watched === 'in-progress' ? 'IsResumable' : undefined
  const order: [string, string] =
    r.addedWithinDays !== null
      ? ['DateCreated,SortName', 'Descending']
      : r.maxMinutes !== null
        ? ['Runtime,SortName', 'Ascending']
        : r.minMinutes !== null
          ? ['Runtime,SortName', 'Descending']
          : r.sort === 'title'
            ? ['SortName', 'Ascending']
            : r.sort === 'year'
              ? ['ProductionYear,SortName', 'Ascending']
              : r.sort === 'runtime'
                ? ['Runtime,SortName', 'Ascending']
                : ['DateCreated,SortName', 'Descending']
  return {
    includeItemTypes: r.kind,
    recursive: true,
    ...(r.genres.length ? { genres: r.genres.join('|') } : {}),
    ...(years.length ? { years: years.join(',') } : {}),
    ...(filters ? { filters } : {}),
    sortBy: order[0],
    sortOrder: order[1],
    limit: FETCH_LIMIT,
    fields: 'PrimaryImageAspectRatio,ProductionYear,Genres,DateCreated',
  }
}

/** Whether some rule is only checked here, so a full fetch (FETCH_LIMIT titles) may have left matches out. */
export function checkedHere(r: SmartRules): boolean {
  return r.addedWithinDays !== null || r.minMinutes !== null || r.maxMinutes !== null
}

/** The matches in the collection's order. */
export function sortItems<T extends SmartItem>(items: T[], r: SmartRules): T[] {
  const name = (i: SmartItem) => (i.SortName || i.Name || '').toLowerCase()
  const byName = (a: SmartItem, b: SmartItem) => name(a).localeCompare(name(b))
  const out = [...items]
  if (r.sort === 'title') out.sort(byName)
  else if (r.sort === 'year') out.sort((a, b) => (a.ProductionYear ?? 9999) - (b.ProductionYear ?? 9999) || byName(a, b))
  else if (r.sort === 'runtime') out.sort((a, b) => (a.RunTimeTicks ?? Infinity) - (b.RunTimeTicks ?? Infinity) || byName(a, b))
  else out.sort((a, b) => (Date.parse(b.DateCreated ?? '') || 0) - (Date.parse(a.DateCreated ?? '') || 0) || byName(a, b))
  return out
}

const DAY = 86400e3
const minutesOf = (it: SmartItem) => (it.RunTimeTicks ? Math.round(it.RunTimeTicks / 6e8) : null)
const sameGenre = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0

function watchedState(it: SmartItem): 'watched' | 'in-progress' | 'unwatched' {
  if (it.UserData?.Played) return 'watched'
  if ((it.UserData?.PlaybackPositionTicks ?? 0) > 0) return 'in-progress'
  return 'unwatched'
}

/** Whether a title meets every rule. Unknown values (no year, no running time) never match a rule about them. */
export function matches(it: SmartItem, r: SmartRules, now = Date.now()): boolean {
  if (it.Type !== r.kind) return false
  if (r.genres.length && !(it.Genres ?? []).some((g) => r.genres.some((x) => sameGenre(g, x)))) return false
  if (r.yearFrom !== null && !(it.ProductionYear && it.ProductionYear >= r.yearFrom)) return false
  if (r.yearTo !== null && !(it.ProductionYear && it.ProductionYear <= r.yearTo)) return false
  const min = minutesOf(it)
  if (r.minMinutes !== null && !(min !== null && min >= r.minMinutes)) return false
  if (r.maxMinutes !== null && !(min !== null && min <= r.maxMinutes)) return false
  if (r.addedWithinDays !== null) {
    const at = it.DateCreated ? Date.parse(it.DateCreated) : NaN
    if (!Number.isFinite(at) || now - at > r.addedWithinDays * DAY) return false
  }
  if (r.watched) {
    const w = watchedState(it)
    // A show: "not finished" is anything not fully watched.
    if (r.watched === 'unwatched' ? w === 'watched' : r.watched === 'watched' ? w !== 'watched' : w !== 'in-progress') return false
  }
  return true
}

function agoDays(days: number): string {
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 60) return `${Math.floor(days)} days ago`
  return `${Math.round(days / 30)} months ago`
}

/** Why a title is in the collection, in a few words per rule ("Comedy", "94 min", "Added 3 days ago"). */
export function reasons(it: SmartItem, r: SmartRules, now = Date.now()): string[] {
  const out: string[] = []
  if (r.watched) out.push(WATCHED_LABEL[r.kind][r.watched])
  if (r.genres.length) {
    const g = (it.Genres ?? []).find((x) => r.genres.some((y) => sameGenre(x, y)))
    if (g) out.push(g)
  }
  if ((r.yearFrom !== null || r.yearTo !== null) && it.ProductionYear) out.push(String(it.ProductionYear))
  if ((r.minMinutes !== null || r.maxMinutes !== null) && minutesOf(it) !== null) out.push(`${minutesOf(it)} min`)
  if (r.addedWithinDays !== null && it.DateCreated) out.push(`Added ${agoDays((now - Date.parse(it.DateCreated)) / DAY)}`)
  return out
}

/** The rules in one plain line ("Movies · Comedy · not watched yet · under 100 min"). */
export function describe(r: SmartRules): string {
  const parts: string[] = [KIND_LABEL[r.kind]]
  if (r.genres.length) parts.push(r.genres.length > 3 ? `${r.genres.slice(0, 3).join(', ')} and more` : r.genres.join(' or '))
  if (r.yearFrom !== null && r.yearTo !== null) parts.push(r.yearFrom === r.yearTo ? `from ${r.yearFrom}` : `${r.yearFrom}–${r.yearTo}`)
  else if (r.yearFrom !== null) parts.push(`${r.yearFrom} or later`)
  else if (r.yearTo !== null) parts.push(`${r.yearTo} or earlier`)
  if (r.minMinutes !== null && r.maxMinutes !== null) parts.push(`${r.minMinutes}–${r.maxMinutes} min`)
  else if (r.maxMinutes !== null) parts.push(`${r.maxMinutes} min or shorter`)
  else if (r.minMinutes !== null) parts.push(`${r.minMinutes} min or longer`)
  if (r.addedWithinDays !== null) parts.push(`added in the last ${r.addedWithinDays} days`)
  if (r.watched) parts.push(WATCHED_LABEL[r.kind][r.watched].toLowerCase())
  return parts.join(' · ')
}
