// Smart collections (server/src/smartCollections.ts keeps the rules; the titles come from
// Jellyfin with this profile's own sign-in, so watched state and limits are theirs).

import { useQuery } from '@tanstack/react-query'
import * as api from './client'
import { finesseCall } from './finesse'
import { checkedHere, FETCH_LIMIT, jellyfinQuery, matches, sortItems, type SmartRules } from '../lib/smartRules'
import { useFinesse } from '../lib/finesseServer'
import type { JfItem } from './types'

export interface SmartCollection {
  id: string
  name: string
  rules: SmartRules
  created: number
  updated: number
}

export const listSmart = async () => (await finesseCall<{ collections: SmartCollection[] }>('GET', '/api/smart-collections')).collections
export const createSmart = (name: string, rules: SmartRules) => finesseCall<SmartCollection>('POST', '/api/smart-collections', { name, rules })
export const updateSmart = (id: string, change: { name?: string; rules?: SmartRules }) => finesseCall<SmartCollection>('PUT', `/api/smart-collections/${encodeURIComponent(id)}`, change)
export const deleteSmart = (id: string) => finesseCall('DELETE', `/api/smart-collections/${encodeURIComponent(id)}`)

/** Whether this server keeps smart collections (older ones don't). */
export function useSmartOn(): boolean {
  const { info } = useFinesse()
  return Boolean(info?.features?.smartCollections)
}

export function useSmartCollections() {
  const on = useSmartOn()
  return useQuery({ queryKey: ['smart', 'list'], queryFn: listSmart, enabled: on, staleTime: 60_000, retry: false })
}

export interface SmartMatches {
  items: JfItem[]
  /** Some rule is checked in the app and Jellyfin had more titles than were looked at. */
  partial: boolean
}

/** The titles a set of rules picks right now, in the collection's order. */
export async function smartMatches(rules: SmartRules): Promise<SmartMatches> {
  const q = jellyfinQuery(rules)
  const res = await api.getItems(q)
  const now = Date.now()
  const items = sortItems(res.Items.filter((i) => matches(i, rules, now)), rules)
  return { items, partial: checkedHere(rules) && res.Items.length >= FETCH_LIMIT && (res.TotalRecordCount ?? 0) > res.Items.length }
}

/** Kept fresh: the "smart" key is refreshed when watch state changes (lib/remoteControl). */
export function useSmartMatches(rules: SmartRules | null | undefined) {
  return useQuery({
    queryKey: ['smart', 'matches', rules],
    queryFn: () => smartMatches(rules!),
    enabled: !!rules,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

/** Genres the library uses for a kind of title (this profile's view). */
export function useGenresFor(kind: SmartRules['kind']) {
  return useQuery({
    queryKey: ['smart', 'genres', kind],
    staleTime: 30 * 60_000,
    queryFn: async () => (await api.getGenresFor(kind)).Items.map((g) => g.Name ?? '').filter(Boolean),
  })
}
