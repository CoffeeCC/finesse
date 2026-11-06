import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getItems } from '../api/client'
import { withHandDeadline } from './tableDeal'

/** "Surprise me": open a random title — unwatched first, anything as a fallback.
 *  Scope it to a library / item types (the Library page passes its own). */
export function useSurprise() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => { pending.current?.abort();pending.current=null }, [])

  const surprise = async (scope: { parentId?: string; includeItemTypes?: string } = {}, navigationState?: unknown) => {
    if (pending.current) return false
    const request=new AbortController();pending.current=request
    setBusy(true)
    try {
      const pick = async (filters: string | undefined, signal: AbortSignal) =>
        (
          await getItems({
            includeItemTypes: scope.includeItemTypes ?? 'Movie',
            parentId: scope.parentId,
            recursive: true,
            sortBy: 'Random',
            limit: 1,
            filters,
            fields: '',
          },signal)
        ).Items[0]
      const item = await withHandDeadline(async signal => (await pick('IsUnplayed',signal)) ?? (await pick(undefined,signal)),request.signal)
      if (item && !request.signal.aborted) { navigate(`/item/${item.Id}`,{state:navigationState});return true }
      return false
    } catch {
      return false
    } finally {
      if(pending.current===request){pending.current=null;setBusy(false)}
    }
  }

  return { surprise, busy }
}

/** The dice icon used wherever Surprise me appears. */
export function DiceIcon({ className = 'h-4 w-4', spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <svg className={`${className} ${spinning ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="16" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="8" cy="16" r="1.2" fill="currentColor" />
      <circle cx="16" cy="16" r="1.2" fill="currentColor" />
    </svg>
  )
}
