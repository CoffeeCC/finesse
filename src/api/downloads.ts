// What Finesse is doing about stuck downloads (server/src/downloadRescue.ts), and which way of
// downloading goes first.

import { useQuery } from '@tanstack/react-query'
import { mediaBrowserAuthHeader } from './client'
import { finesseApi } from '../lib/finesseServer'

export type RescueProblem = 'stalled' | 'slow' | 'failed' | 'import' | 'not-needed' | 'needs-person'

export interface RescueWatch {
  /** `movie-12`, `series-4`, `artist-9`: the queue's own keys. */
  key: string
  title: string
  problem: RescueProblem
  action: 'swap' | 'drop' | 'report'
  reason: string
  /** When Finesse acts, if it will. */
  dueAt?: string
  swaps: number
  exhausted: boolean
}

export interface RescueEvent {
  at: string
  key: string
  title: string
  what: 'swapped' | 'dropped' | 'gave-up'
  problem: RescueProblem
  reason: string
  via?: string
}

export interface DownloadsAuto {
  enabled: boolean
  /** How long a stalled download gets before it's swapped (minutes). */
  stalledMinutes: number
  lastRun: string | null
  maxSwaps: number
  watching: RescueWatch[]
  log: RescueEvent[]
  prefer: 'usenet' | 'torrent' | null
  /** Both Usenet and torrents are set up (so there is an order to choose). */
  both: boolean
}

async function call(method: string, body?: unknown): Promise<DownloadsAuto> {
  const res = await fetch(finesseApi('/api/downloads/auto'), {
    method,
    headers: { Accept: 'application/json', Authorization: mediaBrowserAuthHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = (await res.json().catch(() => null)) as (DownloadsAuto & { error?: string }) | null
  if (!res.ok || !data) throw new Error(data?.error || 'Couldn’t reach Finesse')
  return data
}

export const getDownloadsAuto = () => call('GET')
export const setDownloadsAuto = (change: { enabled?: boolean; prefer?: 'usenet' | 'torrent'; stalledMinutes?: number }) => call('PUT', change)

/** Null on servers that don't have it yet (an older Finesse): the page just shows less. */
export function useDownloadsAuto(enabled = true) {
  return useQuery({ queryKey: ['downloadsAuto'], queryFn: getDownloadsAuto, enabled, refetchInterval: 60_000, staleTime: 20_000, retry: false })
}
