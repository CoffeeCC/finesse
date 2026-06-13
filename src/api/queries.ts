import { useQuery, useQueries } from '@tanstack/react-query'
import * as api from './client'
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
