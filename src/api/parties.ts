// Watch parties (server/src/parties.ts; the rules are in lib/partySync).

import { useQuery } from '@tanstack/react-query'
import { finesseCall } from './finesse'
import { useFinesse } from '../lib/finesseServer'
import type { Clock } from '../lib/partySync'

export interface PartyView {
  id: string
  /** Null: this profile can't open the title (it's shown as "A title you can't open"). */
  item: string | null
  title: string
  host: { id: string; name: string }
  isHost: boolean
  joined: boolean
  ended: boolean
  clock: Clock
  serverNow: number
  waitingFor: string[]
  members: { id: string; name: string; inStep: boolean; buffering: boolean }[]
  max: number
}

export interface PartyInvite {
  id: string
  title: string
  /** Null: this profile can't open the title. */
  item: string | null
  host: string
  people: number
  joined: boolean
}

const one = (id: string) => `/api/parties/${encodeURIComponent(id)}`
export const startParty = (item: string, invite: string[], position: number) => finesseCall<PartyView>('POST', '/api/parties', { item, invite, position })
export const listParties = async () => (await finesseCall<{ parties: PartyInvite[] }>('GET', '/api/parties')).parties
export const joinParty = (id: string) => finesseCall<PartyView>('POST', `${one(id)}/join`)
export const beatParty = (id: string, position: number, buffering: boolean) => finesseCall<PartyView>('POST', `${one(id)}/beat`, { position, buffering })
export const controlParty = (id: string, action: 'play' | 'pause' | 'seek', position?: number) => finesseCall<PartyView>('POST', `${one(id)}/control`, { action, position })
export const leaveParty = (id: string) => finesseCall('POST', `${one(id)}/leave`).catch(() => {})
export const endParty = (id: string) => finesseCall('DELETE', one(id))

export function usePartiesOn(): boolean {
  const { info } = useFinesse()
  return Boolean(info?.features?.parties)
}

/** Parties you're invited to (checked every 20 s). */
export function usePartyInvites(enabled = true) {
  const on = usePartiesOn()
  return useQuery({ queryKey: ['parties', 'list'], queryFn: listParties, enabled: on && enabled, refetchInterval: 20_000, retry: false })
}
