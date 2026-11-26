// Speculative route-chunk & data prefetching on hover/focus/touchstart so clicking
// into any screen feels instant (0ms lazy chunk wait, zero skeleton flash).
// Respects Data Saver and skips speculative work on webOS TVs (single bundle + tight RAM).

import type { QueryClient } from '@tanstack/react-query'
import * as api from '../api/client'

function saveData(): boolean {
  if (__WEBOS__ || typeof navigator === 'undefined') return true
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return Boolean(conn?.saveData)
}

const LOADERS: [RegExp, () => Promise<unknown>][] = [
  [/^\/play\//, () => import('../pages/PlayerPage')],
  [/^\/music(?:\/|$)/, () => import('../pages/MusicPage')],
  [/^\/album\//, () => import('../pages/AlbumPage')],
  [/^\/games\/store\/browse/, () => import('../pages/GameStoreBrowsePage')],
  [/^\/games\/store\/game\//, () => import('../pages/GameStoreGamePage')],
  [/^\/games\/store\/requests\/[^/]+\/installer/, () => import('../pages/GameInstallerPage')],
  [/^\/games\/store\/requests/, () => import('../pages/GameRequestsPage')],
  [/^\/games\/store/, () => import('../pages/GameStorePage')],
  [/^\/games\/game\//, () => import('../pages/GameDetailPage')],
  [/^\/games\/play\//, () => import('../pages/PlayGamePage')],
  [/^\/games\/stream\//, () => import('../pages/StreamPlayPage')],
  [/^\/games(?:\/|$)/, () => import('../pages/GamesPage')],
  [/^\/request\/movie\//, () => import('../pages/RequestMoviePage')],
  [/^\/request(?:\/|$)/, () => import('../pages/RequestPage')],
  [/^\/activity(?:\/|$)/, () => import('../pages/ActivityPage')],
  [/^\/friends(?:\/|$)/, () => import('../pages/FriendsPage')],
  [/^\/together(?:\/|$)/, () => import('../pages/TogetherPage')],
  [/^\/moments(?:\/|$)/, () => import('../pages/MomentsPage')],
  [/^\/smart(?:\/|$)/, () => import('../pages/SmartCollectionsPage')],
  [/^\/person\//, () => import('../pages/PersonPage')],
  [/^\/settings(?:\/|$)/, () => import('../pages/SettingsPage')],
  [/^\/add-media(?:\/|$)/, () => import('../pages/AddMediaPage')],
  [/^\/remote(?:\/|$)/, () => import('../pages/RemotePage')],
]

const warmed = new Set<number>()

/** Warm the lazy JS chunk for a route path (deduplicated, safe to call repeatedly). */
export function prefetchRoute(to: string): void {
  if (saveData()) return
  const path = to.split('?')[0] || '/'
  for (let i = 0; i < LOADERS.length; i++) {
    if (!LOADERS[i][0].test(path)) continue
    if (warmed.has(i)) return
    warmed.add(i)
    void LOADERS[i][1]().catch(() => {
      warmed.delete(i)
    })
    return
  }
}

/** Warm the PlayerPage chunk ahead of pressing Play/Resume. */
export function prefetchPlayer(): void {
  prefetchRoute('/play/0')
}

/** Warm an item's detail query in TanStack Query (respects existing fresh cache). */
export function prefetchItem(qc: QueryClient, itemId: string | undefined): void {
  if (!itemId || saveData()) return
  void qc.prefetchQuery({
    queryKey: ['item', itemId],
    queryFn: () => api.getItem(itemId),
    staleTime: 5 * 60_000,
  })
}
