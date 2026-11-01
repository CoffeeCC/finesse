// Shortlists: pick something to watch together (server/src/queues.ts).

import { useQuery } from '@tanstack/react-query'
import { finesseCall } from './finesse'
import { useFinesse } from '../lib/finesseServer'

export type Availability = 'yes' | 'no' | 'unknown'

export interface QueueItem {
  key: string
  /** A title this profile can't open: no name, no id. */
  hidden: boolean
  item: string | null
  title: string
  subtitle: string
  addedBy: string | null
  votes: number
  mine: boolean
  canRemove: boolean
  /** Whether this profile can open it, and how many members can ("yes"): never who can't. */
  availability: { state: Availability; canOpen: number; members: number } | null
}

export interface Queue {
  id: string
  name: string
  host: { id: string; name: string }
  isHost: boolean
  archived: boolean
  members: { id: string; name: string }[]
  items: QueueItem[]
  myVote: string | null
  picked: string | null
  updated: number
}

export interface QueueSummary {
  id: string
  name: string
  host: string
  isHost: boolean
  archived: boolean
  members: number
  items: number
  picked: boolean
  updated: number
}

const base = '/api/queues'
const q = (id: string) => `${base}/${encodeURIComponent(id)}`
export const listQueues = async () => (await finesseCall<{ queues: QueueSummary[] }>('GET', base)).queues
export const queuePeople = async () => (await finesseCall<{ people: { id: string; name: string }[] }>('GET', '/api/people')).people
export const getQueue = (id: string) => finesseCall<Queue>('GET', q(id))
export const createQueue = (name: string, members: string[]) => finesseCall<Queue>('POST', base, { name, members })
export const updateQueue = (id: string, change: { name?: string; members?: string[]; archived?: boolean }) => finesseCall<Queue>('PUT', q(id), change)
export const deleteQueue = (id: string) => finesseCall('DELETE', q(id))
export const leaveQueue = (id: string) => finesseCall('POST', `${q(id)}/leave`)
export const addToQueue = (id: string, item: string) => finesseCall<Queue>('POST', `${q(id)}/items`, { item })
export const removeFromQueue = (id: string, key: string) => finesseCall<Queue>('DELETE', `${q(id)}/items/${encodeURIComponent(key)}`)
export const voteInQueue = (id: string, key: string | null) => finesseCall<Queue>('PUT', `${q(id)}/vote`, { key })
export const pickInQueue = (id: string, key: string | null) => finesseCall<Queue>('POST', `${q(id)}/pick`, { key })

export function useQueuesOn(): boolean {
  const { info } = useFinesse()
  return Boolean(info?.features?.queues)
}

export function useQueues() {
  const on = useQueuesOn()
  return useQuery({ queryKey: ['queues', 'list'], queryFn: listQueues, enabled: on, staleTime: 15_000, retry: false })
}

/** One shortlist, kept fresh while it's open (votes come in from others). */
export function useQueue(id: string | undefined) {
  return useQuery({ queryKey: ['queues', 'one', id], queryFn: () => getQueue(id!), enabled: !!id, refetchInterval: 15_000, retry: false })
}
