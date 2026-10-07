// Moments: flag a stretch of a title (or recommend a whole one) to people here
// and friends' servers. The server keeps them (server/src/moments.ts).

import { useQuery } from '@tanstack/react-query'
import { mediaBrowserAuthHeader } from './client'
import { finesseApi, useFinesse } from '../lib/finesseServer'

export interface Moment {
  key: string
  /** Null for a whole-title recommendation. */
  start: number | null
  end: number | null
  note: string
  spoiler: boolean
  from: string
  mine?: boolean
  canDelete?: boolean
  created: number
}

export interface InboxMoment extends Moment {
  /** The app's id for the title (a friend's carries "f-<friend>-"). */
  item: string
  title: string
  subtitle: string
  read: boolean
}

export interface MomentTargets {
  people: { id: string; name: string }[]
  friends: { id: string; name: string }[]
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(finesseApi(path), {
    method,
    headers: { Authorization: mediaBrowserAuthHeader(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const d = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new Error(d.error || `Finesse answered ${r.status}`)
  return d
}

export const getMomentTargets = (item: string) => call<MomentTargets>('GET', `/api/moments/targets?item=${encodeURIComponent(item)}`)
export const getItemMoments = async (item: string) => (await call<{ moments: Moment[] }>('GET', `/api/moments/item/${encodeURIComponent(item)}`)).moments
export const getInbox = (fresh = false) => call<{ moments: InboxMoment[]; unread: number }>('GET', `/api/moments/inbox${fresh ? '?fresh=1' : ''}`)
export const markMomentsRead = (keys: string[]) => call('POST', '/api/moments/read', { keys })
export const deleteMoment = (key: string) => call('DELETE', `/api/moments/${encodeURIComponent(key)}`)
export const sendMoment = (m: { item: string; start: number | null; end: number | null; note: string; spoiler: boolean; to: string[] }) => call<{ key: string }>('POST', '/api/moments', m)
export const getMomentSettings = () => call<{ fromFriends: boolean }>('GET', '/api/moments/settings')
export const setMomentSettings = (fromFriends: boolean) => call<{ fromFriends: boolean }>('PUT', '/api/moments/settings', { fromFriends })

/** Whether this server has Moments (older ones don't). */
export function useMomentsOn(): boolean {
  const { info } = useFinesse()
  return Boolean(info?.features?.moments)
}

/** What's been sent to you; checked every minute. */
export function useInbox() {
  const on = useMomentsOn()
  return useQuery({ queryKey: ['moments', 'inbox'], queryFn: () => getInbox(), enabled: on, refetchInterval: 60_000, staleTime: 30_000, retry: false })
}

/** "1:02:15" / "4:05". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}

/** Where opening a moment goes: the player at its start, or the title's page. */
export function momentHref(m: { item: string; start: number | null }): string {
  return m.start == null ? `/item/${m.item}` : `/play/${m.item}?t=${Math.round(Math.max(0, m.start - 2) * 1e7)}`
}
