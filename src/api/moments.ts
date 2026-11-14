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

/** One of your own, in the bell's "Saved by you". */
export interface MyMoment extends InboxMoment {
  /** Who it went to; empty when it's just for you. */
  to: string[]
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
/** The inbox, in the shape the app expects whatever the server sent (an older or newer one, or an error page in between). */
export const getInbox = async (fresh = false): Promise<{ moments: InboxMoment[]; unread: number; mine?: MyMoment[] }> => {
  const d = await call<{ moments?: unknown; unread?: unknown; mine?: unknown }>('GET', `/api/moments/inbox${fresh ? '?fresh=1' : ''}`)
  return { moments: Array.isArray(d.moments) ? (d.moments as InboxMoment[]) : [], unread: Number(d.unread) || 0, mine: Array.isArray(d.mine) ? (d.mine as MyMoment[]) : [] }
}
export const markMomentsRead = (keys: string[]) => call('POST', '/api/moments/read', { keys })
export const deleteMoment = (key: string) => call('DELETE', `/api/moments/${encodeURIComponent(key)}`)
export const sendMoment = (m: { item: string; start: number | null; end: number | null; note: string; spoiler: boolean; to: string[] }) => call<{ key: string }>('POST', '/api/moments', m)
export const getMomentSettings = () => call<{ fromFriends: boolean }>('GET', '/api/moments/settings')
export const setMomentSettings = (fromFriends: boolean) => call<{ fromFriends: boolean }>('PUT', '/api/moments/settings', { fromFriends })

// ---------- Reactions and comments (server/src/momentSocial.ts) ----------

export interface MomentThread {
  reactions: { emoji: string; count: number; mine: boolean; who: string[] }[]
  comments: { id: string; from: string; text: string; created: number; mine: boolean; canDelete: boolean }[]
}

export const getThreads = (keys: string[]) => call<{ threads: Record<string, MomentThread>; reactions: string[] }>('GET', `/api/moments/social?keys=${keys.map(encodeURIComponent).join(',')}`)
export const reactToMoment = async (key: string, emoji: string | null) => (await call<{ thread: MomentThread }>('POST', '/api/moments/react', { key, emoji })).thread
export const commentOnMoment = async (key: string, text: string) => (await call<{ thread: MomentThread }>('POST', '/api/moments/comment', { key, text })).thread
export const deleteMomentComment = async (key: string, id: string) => (await call<{ thread: MomentThread }>('POST', '/api/moments/comment/delete', { key, id })).thread

/** Something someone else did on a moment you flagged. */
export interface MomentActivity {
  kind: 'comment' | 'reaction'
  key: string
  title: string
  from: string
  /** The comment, or the reaction. */
  what: string
  created: number
  fresh: boolean
}
export const getActivity = async (): Promise<{ items: MomentActivity[]; unread: number }> => {
  const d = await call<{ items?: unknown; unread?: unknown }>('GET', '/api/moments/activity')
  return { items: Array.isArray(d.items) ? (d.items as MomentActivity[]) : [], unread: Number(d.unread) || 0 }
}
export const markActivitySeen = () => call('POST', '/api/moments/activity/seen')

/** Comments and reactions on your moments, for the bell. Empty on a server that doesn't have them yet. */
export function useActivity() {
  const on = useMomentsOn()
  return useQuery({ queryKey: ['moments', 'activity'], queryFn: getActivity, enabled: on, refetchInterval: 60_000, staleTime: 30_000, retry: false })
}

/** The threads of the moments on screen, looked at again every 15 seconds while the feed is open.
 *  On a server that doesn't have them yet (an older Finesse) this is simply empty. */
export function useThreads(keys: string[]) {
  const on = useMomentsOn()
  const id = keys.join(',')
  return useQuery({ queryKey: ['moments', 'social', id], queryFn: () => getThreads(keys), enabled: on && keys.length > 0, refetchInterval: 15_000, staleTime: 8_000, retry: false, placeholderData: (prev) => prev })
}

/** Whether this server has Moments (older ones don't). */
export function useMomentsOn(): boolean {
  const { info, loading } = useFinesse()
  // Until the server has answered, go by last time: the bell is in the top bar from the
  // first paint instead of arriving late and pushing its neighbours along.
  if (loading) {
    try {
      return localStorage.getItem('finesse.momentsOn') === '1'
    } catch {
      return false
    }
  }
  const on = Boolean(info?.features?.moments)
  try {
    localStorage.setItem('finesse.momentsOn', on ? '1' : '0')
  } catch {
    /* no storage: the bell just arrives a moment later */
  }
  return on
}

/** What's been sent to you (and your own, apart); checked every minute. */
export function useInbox(live = false) {
  const on = useMomentsOn()
  // The feed is open (live): look every 20 seconds, so what people flag turns up while you're there.
  return useQuery({ queryKey: ['moments', 'inbox'], queryFn: () => getInbox(), enabled: on, refetchInterval: live ? 20_000 : 60_000, staleTime: live ? 10_000 : 30_000, retry: false })
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
