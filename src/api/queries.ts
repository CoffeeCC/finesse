import { useQuery, useQueries } from '@tanstack/react-query'
import * as api from './client'
import { arrQueue } from './arr'
import { sabStatus } from './sab'
import { CONTENT_BASE } from '../lib/contentOrigin'
import { type ClipManifest } from '../lib/preview'
import * as romm from './romm'
import type { JfItem } from './types'

export const PAGE_SIZE = 100

const CARD_FIELDS = 'PrimaryImageAspectRatio,ProductionYear'

export function useViews() {
  return useQuery({
    queryKey: ['views'],
    queryFn: api.getViews,
    staleTime: 10 * 60_000,
  })
}

export function useResume() {
  return useQuery({ queryKey: ['resume'], queryFn: api.getResume })
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
        fields: 'PrimaryImageAspectRatio,ProductionYear',
      }),
  })
}

/** Which items have a locally-generated preview clip, and at which resolutions.
 *  Served by the app's own nginx: manifest.json (base 480 ids) + optional
 *  manifest-hd.json ({ id: [720,1080] }). Both are fetched and merged. */
export function useClipManifest() {
  return useQuery({
    queryKey: ['clipManifest'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClipManifest> => {
      const base = await fetch(`${CONTENT_BASE}previews/manifest.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
      const hdRaw = await fetch(`${CONTENT_BASE}previews/manifest-hd.json`, { cache: 'no-cache' })
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

export function useLyrics(itemId: string | undefined) {
  return useQuery({
    queryKey: ['lyrics', itemId],
    enabled: !!itemId,
    staleTime: 30 * 60_000,
    queryFn: () => api.getLyrics(itemId!),
  })
}

export function useTracks(albumId: string | undefined) {
  return useQuery({
    queryKey: ['tracks', albumId],
    enabled: !!albumId,
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
  })
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

/** Active Radarr/Sonarr downloads, polled so progress bars move on their own. */
export function useArrQueue() {
  return useQuery({
    queryKey: ['arrQueue'],
    queryFn: arrQueue,
    refetchInterval: 15_000,
    staleTime: 5_000,
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

export function useItem(itemId: string | undefined) {
  return useQuery({
    queryKey: ['item', itemId],
    queryFn: () => api.getItem(itemId!),
    enabled: !!itemId,
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
        fields: CARD_FIELDS,
      }),
  })
}
