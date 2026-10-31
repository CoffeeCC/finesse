// Moments collections (server/src/momentCollections.ts): favourite moments kept together, as
// references (a title, a start and end, a note, who flagged it), shared with chosen people.

import { useQuery } from '@tanstack/react-query'
import { finesseCall } from './finesse'
import { useFinesse } from '../lib/finesseServer'

export interface MomentEntry {
  key: string
  /** False: this profile can't open the title (removed, a friend that stopped sharing, limits). */
  available: boolean
  item: string | null
  title: string
  subtitle: string
  start: number | null
  end: number | null
  note: string
  from: string
  savedAt: number
}

export interface MomentCollection {
  id: string
  name: string
  mine: boolean
  owner: { id: string; name: string }
  sharedWith?: { id: string; name: string }[]
  entries: MomentEntry[]
  updated: number
}

export interface MomentCollectionSummary {
  id: string
  name: string
  entries: number
  owner: string
  shared?: number
  updated: number
}

const base = '/api/moment-collections'
const one = (id: string) => `${base}/${encodeURIComponent(id)}`
export const listMomentCollections = () => finesseCall<{ mine: MomentCollectionSummary[]; shared: MomentCollectionSummary[] }>('GET', base)
export const getMomentCollection = (id: string) => finesseCall<MomentCollection>('GET', one(id))
export const createMomentCollection = (name: string) => finesseCall<MomentCollection>('POST', base, { name })
export const updateMomentCollection = (id: string, change: { name?: string; sharedWith?: string[] }) => finesseCall<MomentCollection>('PUT', one(id), change)
export const deleteMomentCollection = (id: string) => finesseCall('DELETE', one(id))
export const saveToCollection = (
  id: string,
  what: { moment: string } | { from: { collection: string; key: string } } | { item: string; start: number | null; end: number | null; note?: string },
) => finesseCall<MomentCollection>('POST', `${one(id)}/entries`, what)
export const removeFromCollection = (id: string, key: string) => finesseCall<MomentCollection>('DELETE', `${one(id)}/entries/${encodeURIComponent(key)}`)

export function useMomentCollectionsOn(): boolean {
  const { info } = useFinesse()
  return Boolean(info?.features?.momentCollections)
}

export function useMomentCollections() {
  const on = useMomentCollectionsOn()
  return useQuery({ queryKey: ['momentCollections', 'list'], queryFn: listMomentCollections, enabled: on, staleTime: 15_000, retry: false })
}

export function useMomentCollection(id: string | undefined) {
  return useQuery({ queryKey: ['momentCollections', 'one', id], queryFn: () => getMomentCollection(id!), enabled: !!id, retry: false })
}
