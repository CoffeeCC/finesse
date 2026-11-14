// Browsing the store: search, the filters' counts and the front page, over the games the
// catalogue holds. The same rules as the demo store the pages were built on
// (src/api/gameStore.demo.ts), so the real store behaves the way the demo did. Pure.

import type { CatalogueGame, Facet, GameMode, GamePlatform, StoreFacets, StoreGame, StoreHome, StorePage, StoreQuery, StoreShelf } from './types.ts'

export const PLATFORM_LABEL: Record<GamePlatform, string> = { windows: 'Windows', linux: 'Linux' }
export const MODE_LABEL: Record<GameMode, string> = { single: 'Single-player', local: 'Local multiplayer', online: 'Online' }

/** The same slug the app makes (src/api/gameStore.ts genreSlug). */
export function genreSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** What the app gets: the catalogue's own fields (popularity, provider) stay on the server. */
export function publicGame(g: CatalogueGame): StoreGame {
  const { popularity: _p, provider: _v, ...game } = g
  return game
}

type Filter = Omit<StoreQuery, 'sort' | 'offset' | 'limit'>

export function matches(g: StoreGame, f: Filter): boolean {
  if (f.q?.trim()) {
    const t = f.q.trim().toLowerCase()
    const hay = `${g.title} ${g.developer ?? ''} ${g.genres.join(' ')}`.toLowerCase()
    if (!hay.includes(t)) return false
  }
  if (f.genres?.length && !g.genres.some((x) => f.genres!.includes(genreSlug(x)))) return false
  if (f.platform && !g.platforms.includes(f.platform)) return false
  if (f.mode && !g.modes.includes(f.mode)) return false
  return true
}

function sorted(list: CatalogueGame[], sort: StoreQuery['sort']): CatalogueGame[] {
  const out = [...list]
  if (sort === 'name') out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  else if (sort === 'new') out.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  else if (sort === 'year') out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  else out.sort((a, b) => b.popularity - a.popularity || a.title.localeCompare(b.title))
  return out
}

export function search(games: CatalogueGame[], q: StoreQuery): StorePage {
  const all = sorted(games.filter((g) => matches(g, q)), q.sort)
  const offset = Math.max(0, q.offset ?? 0)
  const limit = Math.max(1, Math.min(100, q.limit ?? 24))
  return { items: all.slice(offset, offset + limit).map(publicGame), total: all.length, ...(offset + limit < all.length ? { nextOffset: offset + limit } : {}) }
}

function count<T extends string>(values: T[], label: (v: T) => string, has: (g: StoreGame, v: T) => boolean, base: StoreGame[]): Facet[] {
  return values
    .map((v) => ({ value: v, label: label(v), count: base.filter((g) => has(g, v)).length }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** Each filter's choices, counted with every other filter applied, so picking one never empties the others. */
export function facets(games: CatalogueGame[], q: StoreQuery): StoreFacets {
  const without = (k: keyof Filter) => games.filter((g) => matches(g, { ...q, [k]: undefined }))
  const bySlug = new Map([...new Set(games.flatMap((g) => g.genres))].map((n) => [genreSlug(n), n]))
  return {
    genres: count([...bySlug.keys()], (s) => bySlug.get(s)!, (g, s) => g.genres.some((x) => genreSlug(x) === s), without('genres')),
    platforms: count<GamePlatform>(['windows', 'linux'], (p) => PLATFORM_LABEL[p], (g, p) => g.platforms.includes(p), without('platform')),
    modes: count<GameMode>(['single', 'local', 'online'], (m) => MODE_LABEL[m], (g, m) => g.modes.includes(m), without('mode')),
  }
}

/** The front page: what's popular up top, then shelves; a shelf with nothing in it is left out. */
export function home(games: CatalogueGame[]): StoreHome {
  // The two biggest genres get a shelf each, whatever this store happens to hold.
  const top = facets(games, {}).genres.slice(0, 2)
  const shelves: Omit<StoreShelf, 'items'>[] = [
    { id: 'popular', title: 'Popular right now', query: { sort: 'popular' } },
    { id: 'new', title: 'New in the store', query: { sort: 'new' } },
    { id: 'friends', title: 'Play with friends', query: { mode: 'online' } },
    { id: 'couch', title: 'On one couch', query: { mode: 'local' } },
    ...top.map((g) => ({ id: `genre-${g.value}`, title: g.label, query: { genres: [g.value] } })),
    { id: 'linux', title: 'Linux builds', query: { platform: 'linux' as const, sort: 'name' as const } },
  ]
  return {
    featured: search(games, { sort: 'popular', limit: 5 }).items,
    shelves: shelves.map((s) => ({ ...s, items: search(games, { ...s.query, limit: 16 }).items })).filter((s) => s.items.length > 0),
  }
}

/** Games sharing a genre with this one, most popular first. */
export function similar(games: CatalogueGame[], g: StoreGame, limit = 12): StoreGame[] {
  const mine = new Set(g.genres.map(genreSlug))
  return sorted(games.filter((x) => x.id !== g.id && x.genres.some((n) => mine.has(genreSlug(n)))), 'popular').slice(0, limit).map(publicGame)
}
