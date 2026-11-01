import { useQuery, useQueries, useQueryClient, type QueryClient } from '@tanstack/react-query'
import * as api from './client'
import { arrFailures, arrLookup, arrQueue, arrRequested, type ArrResult } from './arr'
import { useEffect } from 'react'
import { markRequested } from '../lib/requestState'
import { isSameTitle, lookupTitles, matchesTerm } from '../lib/discovery'
import { sabStatus } from './sab'
import { CONTENT_BASE } from '../lib/contentOrigin'
import { type ClipManifest } from '../lib/preview'
import * as romm from './romm'
import { findLyrics } from '../lib/lyrics'
import type { JfItem } from './types'
import { groupsApi } from './setup'

export const PAGE_SIZE = 100

const CARD_FIELDS = 'PrimaryImageAspectRatio,ProductionYear'

/** Friends' servers this one watches (Groups); empty when there are none or it can't tell. */
export function useFriends() {
  return useQuery({
    queryKey: ['friends'],
    queryFn: async () => (await groupsApi.friends()).friends,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useViews() {
  return useQuery({
    queryKey: ['views'],
    queryFn: () => api.getViews(),
    staleTime: 10 * 60_000,
  })
}

export function useResume() {
  return useQuery({ queryKey: ['resume'], queryFn: () => api.getResume() })
}

/** Detect another of the user's devices currently playing something → handoff. */
export function useHandoff() {
  const me = api.getSession()
  return useQuery({
    queryKey: ['handoff'],
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const sessions = await api.getSessions()
      const cand = sessions
        .filter(
          (s) =>
            s.UserId === me?.userId &&
            s.DeviceId !== api.DEVICE_ID &&
            s.NowPlayingItem &&
            s.NowPlayingItem.Type !== 'Audio',
        )
        .sort((a, b) => (b.LastActivityDate ?? '').localeCompare(a.LastActivityDate ?? ''))[0]
      return cand ?? null
    },
  })
}

export function useCollectionItems(boxSetId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['collectionItems', boxSetId],
    enabled: !!boxSetId && enabled,
    staleTime: 10 * 60_000,
    queryFn: () =>
      api.getItems({
        parentId: boxSetId,
        sortBy: 'ProductionYear,SortName',
        sortOrder: 'Ascending',
        fields: CARD_FIELDS,
        limit: 200,
      }),
  })
}

export function useAlbums(musicViewId: string | undefined) {
  return useQuery({
    queryKey: ['albums', musicViewId],
    enabled: !!musicViewId,
    staleTime: 10 * 60_000,
    queryFn: () =>
      api.getItems({
        parentId: musicViewId,
        includeItemTypes: 'MusicAlbum',
        recursive: true,
        sortBy: 'SortName',
        sortOrder: 'Ascending',
        limit: 100_000,
        fields: 'PrimaryImageAspectRatio,ProductionYear,DateCreated',
      }),
  })
}

/** Which items have a locally-generated preview clip, and at which resolutions.
 *  Served by the app's own nginx: manifest.json (base 480 ids) + optional
 *  manifest-hd.json ({ id: [720,1080] }). Both are fetched and merged. */
export function useClipManifest() {
  // Signed in only: fetched without a session it's refused, and that empty
  // answer used to stick, so no clip played until it went stale.
  const userId = api.getSession()?.userId
  return useQuery({
    queryKey: ['clipManifest', userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClipManifest> => {
      // The sign-in rides in a header, not the address.
      const init: RequestInit = { cache: 'no-cache', headers: { Authorization: api.mediaBrowserAuthHeader() } }
      const base = await fetch(`${CONTENT_BASE}previews/manifest.json`, init)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
      const hdRaw = await fetch(`${CONTENT_BASE}previews/manifest-hd.json`, init)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))
      const has = new Set<string>(Array.isArray(base) ? base : [])
      const hd = new Map<string, number[]>()
      if (hdRaw && typeof hdRaw === 'object') {
        for (const [id, heights] of Object.entries(hdRaw)) {
          if (Array.isArray(heights)) {
            hd.set(id, (heights as unknown[]).map(Number).filter((n) => n > 0))
          }
        }
      }
      return { has, hd }
    },
  })
}

// ---- Games (RomM) ----
export function useGamePlatforms() {
  return useQuery({
    queryKey: ['gamePlatforms'],
    queryFn: romm.getPlatforms,
    staleTime: 5 * 60_000,
  })
}

export function useGames(platformId?: number, search?: string) {
  return useQuery({
    queryKey: ['games', platformId ?? 'all', search ?? ''],
    queryFn: () => romm.getRoms({ platformId, search, limit: 500 }),
    staleTime: 60_000,
  })
}

export function useGame(id: string | undefined) {
  return useQuery({
    queryKey: ['game', id],
    enabled: !!id,
    queryFn: () => romm.getRom(id!),
    staleTime: 5 * 60_000,
  })
}

/** Random library titles with backdrops for the idle marquee screensaver.
 *  Only fetched once the screensaver actually activates (enabled). */
export function useMarqueeItems(enabled: boolean) {
  return useQuery({
    queryKey: ['marquee'],
    enabled,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const res = await api.getItems({
        includeItemTypes: 'Movie,Series',
        recursive: true,
        sortBy: 'Random',
        limit: 40,
        fields: 'Taglines,Overview,Genres',
      })
      return res.Items.filter((it) => (it.BackdropImageTags?.length ?? 0) > 0)
    },
  })
}

/** A song's lyrics — the library's, else LRCLIB's (lib/lyrics). */
export function useTrackLyrics(track: JfItem | null | undefined) {
  return useQuery({
    queryKey: ['lyrics', track?.Id],
    enabled: !!track,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    queryFn: () => findLyrics(track!),
  })
}

/** Warm the next song's lyrics so they're there the moment it starts. */
export function prefetchTrackLyrics(qc: QueryClient, track: JfItem | null | undefined) {
  if (!track) return
  qc.prefetchQuery({ queryKey: ['lyrics', track.Id], queryFn: () => findLyrics(track), staleTime: Infinity })
}

/** An album's tracks in play order — shared by the album page and every
 *  "play this album" button (usePlayAlbum). */
export function tracksQuery(albumId: string) {
  return {
    queryKey: ['tracks', albumId],
    staleTime: 10 * 60_000,
    queryFn: () =>
      api.getItems({
        parentId: albumId,
        includeItemTypes: 'Audio',
        sortBy: 'ParentIndexNumber,IndexNumber,SortName',
        sortOrder: 'Ascending',
        limit: 500,
        fields: 'PrimaryImageAspectRatio',
      }),
  }
}

export function useTracks(albumId: string | undefined) {
  return useQuery({ ...tracksQuery(albumId ?? ''), enabled: !!albumId })
}

export function usePersonItems(personId: string | undefined) {
  return useQuery({
    queryKey: ['personItems', personId],
    enabled: !!personId,
    staleTime: 10 * 60_000,
    queryFn: () =>
      api.getItems({
        personIds: personId,
        recursive: true,
        includeItemTypes: 'Movie,Series',
        sortBy: 'ProductionYear,SortName',
        sortOrder: 'Descending',
        limit: 200,
        fields: CARD_FIELDS,
      }),
  })
}

export function useNextUp() {
  return useQuery({ queryKey: ['nextUp'], queryFn: api.getNextUp })
}

/** The user's per-account home layout (hidden/collapsed/order/added rows). */
export function useHomeLayout() {
  return useQuery({ queryKey: ['homeLayout'], queryFn: api.getHomeLayout, staleTime: 60_000 })
}

// The queue rows seen last (shared by every useArrQueue, so one of them acts per change).
let lastQueue: Set<string> | null = null

/** Active Radarr/Sonarr downloads, polled so progress bars move on their own. When a
 *  download leaves the queue (imported, or failed), what the request screens know about
 *  that title is fetched again, so a finished one reads Ready rather than "searching". */
export function useArrQueue(enabled = true) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['arrQueue'],
    enabled,
    queryFn: arrQueue,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: false,
  })
  useEffect(() => {
    if (!q.data) return
    const now = new Set(q.data.map((i) => i.key))
    const gone = lastQueue ? [...lastQueue].some((k) => !now.has(k)) : false
    lastQueue = now
    if (gone) for (const key of [['arrLookup'], ['arrLookupAll'], ['arrDiscover'], ['arrMovieDetails'], ['arrRequested'], ['arrFailures'], ['jfByProvider']]) void qc.invalidateQueries({ queryKey: key })
  }, [q.data, qc])
  return q
}

/** The library's copy of a requestable title (same TMDb/TVDb id), so Ready can open it. */
export function useLibraryMatch(r: ArrResult | undefined, enabled = true) {
  return useQuery({
    queryKey: ['jfByProvider', r?.kind, r?.tmdbId ?? r?.tvdbId ?? r?.title, r?.year],
    enabled: enabled && Boolean(r) && r!.kind !== 'artist',
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await api.getItems({ searchTerm: r!.title, includeItemTypes: r!.kind === 'movie' ? 'Movie' : 'Series', recursive: true, fields: 'ProviderIds,ProductionYear', limit: 30 })
      return res.Items.find((i) => isSameTitle(i, r!)) ?? null
    },
  })
}

/** Recent failed downloads by title (`movie-7`), for "searching again" on a request. */
export function useArrFailures(enabled = true) {
  return useQuery({
    queryKey: ['arrFailures'],
    enabled,
    queryFn: () => arrFailures(),
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * A title was just requested: every list that shows it (Request search, global search,
 * Discover, the movie's own page) says so at once, and each is fetched again for the truth.
 * Without this, a cached search kept offering Request for something already requested.
 */
export function noteRequested(qc: QueryClient, r: ArrResult, id: number): void {
  const mark = <T extends ArrResult>(x: T): T => markRequested(x, r, id)
  const patchList = (old: unknown) => (Array.isArray(old) ? (old as ArrResult[]).map(mark) : old)
  for (const key of [['arrLookup'], ['arrLookupAll'], ['arrDiscover']]) qc.setQueriesData({ queryKey: key }, patchList)
  if (r.kind === 'movie' && r.tmdbId) qc.setQueryData(['arrMovieDetails', r.tmdbId], (old: ArrResult | undefined) => (old ? mark(old) : old))
  for (const key of [['arrLookup'], ['arrLookupAll'], ['arrDiscover'], ['arrMovieDetails'], ['arrRequested'], ['arrQueue']]) void qc.invalidateQueries({ queryKey: key })
}

/** Recent requests still waiting for a release (nothing on disk yet). */
export function useArrRequested(enabled = true) {
  return useQuery({
    queryKey: ['arrRequested'],
    enabled,
    queryFn: () => arrRequested(),
    refetchInterval: 60_000,
    staleTime: 15_000,
    retry: false,
  })
}

/** SABnzbd global status (speed / disk / pause state) for the downloads panel.
 *  Errors quietly — the panel simply doesn't render if SAB is unreachable. */
export function useSabStatus() {
  return useQuery({
    queryKey: ['sabStatus'],
    queryFn: sabStatus,
    refetchInterval: 10_000,
    staleTime: 5_000,
    retry: false,
  })
}

/** The user's watchlist item IDs (server-synced via DisplayPreferences). */
export function useWatchlistIds() {
  return useQuery({ queryKey: ['watchlistIds'], queryFn: api.getWatchlistIds, staleTime: 30_000 })
}

/** Full watchlist items, re-ordered to match the stored (newest-first) id order. */
export function useWatchlistItems() {
  const { data: ids } = useWatchlistIds()
  return useQuery({
    queryKey: ['watchlistItems', ids],
    enabled: !!ids,
    queryFn: async (): Promise<JfItem[]> => {
      if (!ids || ids.length === 0) return []
      const res = await api.getItems({ ids: ids.join(','), fields: CARD_FIELDS, limit: 500 })
      const byId = new Map(res.Items.map((i) => [i.Id, i]))
      // Preserve watchlist order; drop ids whose item no longer exists.
      return ids.map((id) => byId.get(id)).filter((i): i is JfItem => !!i)
    },
  })
}

export function useLatest(parentId: string | undefined) {
  return useQuery({
    queryKey: ['latest', parentId],
    queryFn: () => api.getLatest(parentId!),
    enabled: !!parentId,
  })
}

/** An item some list/row already fetched (cards carry enough to draw a hero). */
export function findCachedItem(qc: QueryClient, id: string): JfItem | undefined {
  const pick = (list: unknown) =>
    Array.isArray(list) ? (list as JfItem[]).find((x) => x && x.Id === id) : undefined
  for (const q of qc.getQueryCache().getAll()) {
    const d = q.state.data as { Items?: unknown; Id?: string; Type?: string } | unknown[] | undefined
    if (!d || typeof d !== 'object') continue
    const hit = Array.isArray(d) ? pick(d) : pick(d.Items) ?? (d.Id === id && d.Type ? (d as JfItem) : undefined)
    if (hit) return hit
  }
  return undefined
}

export function useItem(itemId: string | undefined) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['item', itemId],
    queryFn: () => api.getItem(itemId!),
    enabled: !!itemId,
    // Draw the page at once from whatever card/row already has this item, then
    // fill in the details — so a page-to-page morph lands on a real hero, not a
    // loading skeleton.
    placeholderData: () => (itemId ? findCachedItem(qc, itemId) : undefined),
  })
}

export function useSeasons(seriesId: string | undefined) {
  return useQuery({
    queryKey: ['seasons', seriesId],
    queryFn: () => api.getSeasons(seriesId!),
    enabled: !!seriesId,
  })
}

export function useEpisodes(seriesId: string | undefined, seasonId: string | undefined) {
  return useQuery({
    queryKey: ['episodes', seriesId, seasonId],
    queryFn: () => api.getEpisodes(seriesId!, seasonId!),
    enabled: !!seriesId && !!seasonId,
  })
}

/** All episodes in a series (every season), ordered for prev/next navigation. */
export function useSeriesEpisodes(seriesId: string | undefined) {
  return useQuery({
    queryKey: ['seriesEpisodes', seriesId],
    enabled: !!seriesId,
    staleTime: 5 * 60_000,
    queryFn: () =>
      api.getItems({
        parentId: seriesId,
        includeItemTypes: 'Episode',
        recursive: true,
        sortBy: 'ParentIndexNumber,IndexNumber',
        sortOrder: 'Ascending',
        fields: 'PrimaryImageAspectRatio,Overview',
        isMissing: false,
        limit: 100_000,
      }),
  })
}

export function itemTypesForCollection(collectionType?: string): string {
  switch (collectionType) {
    case 'movies':
      return 'Movie'
    case 'tvshows':
      return 'Series'
    default:
      return ''
  }
}

/**
 * Lightweight index of an entire library: IDs + SortNames only, sorted by name.
 * Powers the alphabet rail (letter -> first index), total count, and instant
 * scrollbar sizing without paginating metadata.
 */
export interface LibraryIndex {
  total: number
  letterOffsets: Map<string, number>
  letters: string[]
}

export function useLibraryIndex(
  parentId: string | undefined,
  includeItemTypes: string,
  genres?: string,
  filters?: string,
) {
  return useQuery({
    queryKey: ['libIndex', parentId, includeItemTypes, genres, filters],
    enabled: !!parentId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<LibraryIndex> => {
      const res = await api.getItems({
        parentId,
        includeItemTypes,
        genres,
        filters,
        recursive: true,
        sortBy: 'SortName',
        sortOrder: 'Ascending',
        fields: 'SortName',
        enableImages: false,
        enableUserData: false,
        limit: 100_000,
      })
      const letterOffsets = new Map<string, number>()
      res.Items.forEach((item, i) => {
        const name = item.SortName || item.Name || ''
        const first = name.charAt(0).toUpperCase()
        const letter = first >= 'A' && first <= 'Z' ? first : '#'
        if (!letterOffsets.has(letter)) letterOffsets.set(letter, i)
      })
      return {
        total: res.TotalRecordCount,
        letterOffsets,
        letters: [...letterOffsets.keys()],
      }
    },
  })
}

/**
 * Sparse page cache: given the visible index range from the virtualizer,
 * fetch only the pages that cover it. Random access (alphabet jumps,
 * scrollbar drags) just loads different pages — no sequential pagination.
 */
export function useItemPages(
  parentId: string | undefined,
  includeItemTypes: string,
  sortBy: string,
  sortOrder: string,
  visibleStart: number,
  visibleEnd: number,
  genres?: string,
  filters?: string,
): Map<number, JfItem> {
  const firstPage = Math.max(0, Math.floor(visibleStart / PAGE_SIZE))
  const lastPage = Math.max(firstPage, Math.floor(visibleEnd / PAGE_SIZE))
  const pageIndexes: number[] = []
  for (let p = firstPage; p <= lastPage; p++) pageIndexes.push(p)

  const results = useQueries({
    queries: pageIndexes.map((page) => ({
      queryKey: ['itemPage', parentId, includeItemTypes, sortBy, sortOrder, genres, filters, page],
      enabled: !!parentId,
      staleTime: 5 * 60_000,
      queryFn: () =>
        api.getItems({
          parentId,
          includeItemTypes,
          genres,
          filters,
          recursive: true,
          sortBy,
          sortOrder,
          startIndex: page * PAGE_SIZE,
          limit: PAGE_SIZE,
          fields: CARD_FIELDS,
        }),
    })),
  })

  const map = new Map<number, JfItem>()
  results.forEach((res, i) => {
    const base = pageIndexes[i] * PAGE_SIZE
    res.data?.Items.forEach((item, j) => map.set(base + j, item))
  })
  return map
}

// ---------- Home browse rows ----------

export function useGenres(parentId: string | undefined) {
  return useQuery({
    queryKey: ['genres', parentId],
    queryFn: () => api.getGenres(parentId!),
    enabled: !!parentId,
    staleTime: 30 * 60_000,
  })
}

/** A generic items row keyed by label; random-sorted rows reshuffle every 5 min. */
export function useItemsRow(label: string, query: api.ItemsQuery | null) {
  return useQuery({
    queryKey: ['row', label, query],
    enabled: !!query,
    staleTime: 5 * 60_000,
    queryFn: () =>
      api.getItems({
        recursive: true,
        limit: 20,
        fields: 'PrimaryImageAspectRatio,ProductionYear',
        ...query!,
      }),
  })
}

/** "Because you watched X" — most recent resume item (or last played), then Similar. */
export function useBecauseYouWatched() {
  const lastPlayed = useQuery({
    queryKey: ['lastPlayed'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const resume = await api.getResume()
      if (resume.Items.length) return resume.Items[0]
      const played = await api.getItems({
        recursive: true,
        includeItemTypes: 'Movie,Series',
        filters: 'IsPlayed',
        sortBy: 'DatePlayed',
        sortOrder: 'Descending',
        limit: 1,
        fields: '',
      })
      return played.Items[0] ?? null
    },
  })

  // Episodes should seed from their series for better similarity
  const seed = lastPlayed.data
  const seedId = seed ? (seed.Type === 'Episode' ? seed.SeriesId ?? seed.Id : seed.Id) : undefined
  const seedName = seed ? (seed.Type === 'Episode' ? seed.SeriesName ?? seed.Name : seed.Name) : ''

  const similar = useQuery({
    queryKey: ['similar', seedId],
    enabled: !!seedId,
    staleTime: 5 * 60_000,
    queryFn: () => api.getSimilar(seedId!),
  })

  return { seedName, items: similar.data?.Items, loading: lastPlayed.isLoading || similar.isLoading }
}

export function useSearch(term: string) {
  return useQuery({
    queryKey: ['search', term],
    enabled: term.trim().length > 1,
    queryFn: () =>
      api.getItems({
        searchTerm: term.trim(),
        recursive: true,
        includeItemTypes: 'Movie,Series,Episode',
        limit: 60,
        // ProviderIds: search matches requestable titles to these by TMDb/TVDb id.
        fields: `${CARD_FIELDS},ProviderIds`,
      }),
  })
}

export interface MusicSearch {
  /** Albums whose name matches, then albums by matching artists. */
  albums: JfItem[]
  songs: JfItem[]
}

/** Albums and songs for a search term. Jellyfin matches item names only, so
 *  matching artists are looked up too and their albums added after the
 *  albums named like the term. Kept apart from useSearch so a big music
 *  library can't push films and shows out of its results. */
export function useMusicSearch(term: string) {
  const q = term.trim()
  return useQuery({
    queryKey: ['searchMusic', q],
    enabled: q.length > 1,
    staleTime: 60_000,
    queryFn: async (): Promise<MusicSearch> => {
      const none = { Items: [] as JfItem[], TotalRecordCount: 0 }
      const [named, artists] = await Promise.all([
        api.getItems({ searchTerm: q, recursive: true, includeItemTypes: 'MusicAlbum,Audio', limit: 40, fields: CARD_FIELDS }),
        api.searchArtists(q).catch(() => none),
      ])
      const artistIds = artists.Items.map((a) => a.Id)
      const byArtist = artistIds.length
        ? await api
            .getItems({
              albumArtistIds: artistIds.join(','),
              recursive: true,
              includeItemTypes: 'MusicAlbum',
              sortBy: 'ProductionYear,SortName',
              sortOrder: 'Descending',
              limit: 24,
              fields: CARD_FIELDS,
            })
            .catch(() => none)
        : none
      const namedAlbums = named.Items.filter((i) => i.Type === 'MusicAlbum')
      const seen = new Set(namedAlbums.map((a) => a.Id))
      return {
        albums: [...namedAlbums, ...byArtist.Items.filter((a) => !seen.has(a.Id))],
        songs: named.Items.filter((i) => i.Type === 'Audio'),
      }
    },
  })
}

/** "Top 10 at home" — see api.getMostWatchedAtHome. Changes slowly; cached. */
export function useMostWatchedAtHome() {
  const session = api.getSession()
  return useQuery({
    queryKey: ['mostWatchedAtHome', session?.userId],
    queryFn: () => api.getMostWatchedAtHome(10),
    enabled: !!session,
    staleTime: 30 * 60_000,
  })
}

/** Search every friend's server (Groups) too; each hit knows whose it is. */
/** Films and shows on friends' servers (Groups) for a term, each server asked on its own through
 *  the friend proxy: one that doesn't answer is listed in `failed`, the rest still show. */
export function useFriendSearch(term: string): { hits: { item: JfItem; friend: { id: string; name: string } }[]; failed: string[] } {
  const { data: friends } = useFriends()
  const q = term.trim()
  const results = useQueries({
    queries: (friends ?? []).map((f) => ({
      queryKey: ['search', 'friend', f.id, q],
      enabled: q.length > 1,
      retry: false,
      staleTime: 60_000,
      queryFn: async () =>
        // ProviderIds: a friend's title joins ours (or another friend's) only by TMDb/TVDb id.
        (await api.getItems({ searchTerm: q, recursive: true, includeItemTypes: 'Movie,Series', limit: 8, fields: `${CARD_FIELDS},ProviderIds`, peer: f.id })).Items.map((item) => ({ item, friend: { id: f.id, name: f.name } })),
    })),
  })
  return {
    hits: results.flatMap((r) => r.data ?? []),
    failed: q.length > 1 ? (friends ?? []).filter((_, i) => results[i]?.isError).map((f) => f.name) : [],
  }
}

/** People matching a search term (cast / crew). */
export function useSearchPeople(term: string) {
  return useQuery({
    queryKey: ['searchPeople', term],
    enabled: term.trim().length > 1,
    staleTime: 60_000,
    queryFn: () => api.searchPeople(term.trim()),
  })
}

/** Movies + shows Radarr / Sonarr know of for a term — the "Not in your
 *  library" half of universal search. Quietly empty if the *arr proxy is down. */
export function useRequestLookup(term: string) {
  return useQuery({
    queryKey: ['arrLookupAll', term],
    enabled: term.trim().length > 2,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<ArrResult[]> => {
      const [movies, shows] = await Promise.allSettled([arrLookup('movie', term), arrLookup('series', term)])
      // Only results that answer the term (the lookups are fuzzy and return something for anything).
      const pick = (r: PromiseSettledResult<ArrResult[]>) => (r.status === 'fulfilled' ? r.value.filter((x) => matchesTerm(lookupTitles(x), term)).slice(0, 5) : [])
      return [...pick(movies), ...pick(shows)]
    },
  })
}

