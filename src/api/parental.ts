// Parental limits per profile (server/src/parental.ts enforces them; this only shows them).

import { useQuery } from '@tanstack/react-query'
import { finesseCall } from './finesse'
import { useFinesse } from '../lib/finesseServer'

export interface Limit {
  maxAge: number
  blockUnrated: boolean
  requests: boolean
}

export interface ParentalPerson {
  id: string
  name: string
  admin: boolean
  limit: Limit | null
}

export const getParental = () => finesseCall<{ choices: { age: number; label: string }[]; people: ParentalPerson[] }>('GET', '/api/parental')
export const setParental = (id: string, limit: Limit | null) =>
  finesseCall<{ limit: Limit | null; jellyfin: boolean; warning?: string }>('PUT', `/api/parental/${encodeURIComponent(id)}`, limit ?? { maxAge: null })

/** This profile's own limits (null: none). Older servers: none. */
export function useMyLimits(): Limit | null {
  const { info } = useFinesse()
  const on = Boolean(info?.features?.parental)
  const { data } = useQuery({ queryKey: ['parental', 'me'], queryFn: () => finesseCall<{ limit: Limit | null }>('GET', '/api/parental/me'), enabled: on, staleTime: 5 * 60_000, retry: false })
  return data?.limit ?? null
}
