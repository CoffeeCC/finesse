// The game store's hooks. Pages use only these; which store answers (the server's or the demo)
// is decided once, from the server's features (api/gameStore.ts gameStoreMode).

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useFinesse } from '../lib/finesseServer'
import { gameStoreApi, gameStoreMode, isActive, type GameRequest, type StoreMode, type StoreQuery } from './gameStore'

const PAGE = 24

/** "server", "demo", or null while unknown / when this server has no store. */
export function useStoreMode(): StoreMode | null {
  const { info } = useFinesse()
  return gameStoreMode(info)
}

const api = (mode: StoreMode | null) => gameStoreApi(mode!)

export function useStoreHome() {
  const mode = useStoreMode()
  return useQuery({
    queryKey: ['gameStore', mode, 'home'],
    enabled: Boolean(mode),
    staleTime: 10 * 60_000,
    queryFn: async () => (await api(mode)).home(),
  })
}

/** Browse results, a page at a time. */
export function useStoreSearch(q: StoreQuery) {
  const mode = useStoreMode()
  const key = { ...q, offset: undefined, limit: undefined }
  return useInfiniteQuery({
    queryKey: ['gameStore', mode, 'search', key],
    enabled: Boolean(mode),
    staleTime: 5 * 60_000,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => (await api(mode)).search({ ...key, offset: pageParam, limit: PAGE }),
    getNextPageParam: (last) => last.nextOffset,
  })
}

export function useStoreFacets(q: StoreQuery) {
  const mode = useStoreMode()
  const key = { ...q, sort: undefined, offset: undefined, limit: undefined }
  return useQuery({
    queryKey: ['gameStore', mode, 'facets', key],
    enabled: Boolean(mode),
    staleTime: 5 * 60_000,
    // Keep the old counts on screen while the new ones load, so the filters don't jump.
    placeholderData: (prev) => prev,
    queryFn: async () => (await api(mode)).facets(key),
  })
}

export function useStoreGame(id: string | undefined) {
  const mode = useStoreMode()
  return useQuery({
    queryKey: ['gameStore', mode, 'game', id],
    enabled: Boolean(mode && id),
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => (await api(mode)).game(id!),
  })
}

/** Every game request on this server. Polls every 2 s while something is moving, else 30 s. */
export function useGameRequests() {
  const mode = useStoreMode()
  return useQuery({
    queryKey: ['gameStore', mode, 'requests'],
    enabled: Boolean(mode),
    queryFn: async () => (await api(mode)).requests(),
    refetchInterval: (q) => ((q.state.data ?? []).some(isActive) ? 2000 : 30_000),
  })
}

/** This game's request, if there is one. */
export function useGameRequest(gameId: string | undefined): GameRequest | undefined {
  const { data } = useGameRequests()
  return gameId ? data?.find((r) => r.gameId === gameId) : undefined
}

/** Request, cancel, retry and "I finished the installer", each refreshing the list after. */
export function useGameRequestActions() {
  const mode = useStoreMode()
  const qc = useQueryClient()
  const key = ['gameStore', mode, 'requests']
  const put = (r: GameRequest) => qc.setQueryData<GameRequest[]>(key, (list) => [r, ...(list ?? []).filter((x) => x.id !== r.id)])
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  return {
    request: useMutation({
      mutationFn: async (v: { gameId: string; sourceId: string }) => (await api(mode)).request(v.gameId, v.sourceId),
      onSuccess: put,
      onSettled: refresh,
    }),
    cancel: useMutation({
      mutationFn: async (id: string) => (await api(mode)).cancel(id),
      onSuccess: (_, id) => qc.setQueryData<GameRequest[]>(key, (list) => (list ?? []).filter((x) => x.id !== id)),
      onSettled: refresh,
    }),
    retry: useMutation({
      mutationFn: async (id: string) => (await api(mode)).retry(id),
      onSuccess: put,
      onSettled: refresh,
    }),
    installerDone: useMutation({
      mutationFn: async (id: string) => (await api(mode)).installerDone(id),
      onSuccess: put,
      onSettled: refresh,
    }),
  }
}
