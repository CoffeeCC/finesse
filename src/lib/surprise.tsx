import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getItems } from '../api/client'

/** "Surprise me": open a random title — unwatched first, anything as a fallback.
 *  Scope it to a library / item types (the Library page passes its own). */
export function useSurprise() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const surprise = async (scope: { parentId?: string; includeItemTypes?: string } = {}) => {
    if (busy) return
    setBusy(true)
    try {
      const pick = async (filters?: string) =>
        (
          await getItems({
            includeItemTypes: scope.includeItemTypes ?? 'Movie',
            parentId: scope.parentId,
            recursive: true,
            sortBy: 'Random',
            limit: 1,
            filters,
            fields: '',
          })
        ).Items[0]
      const item = (await pick('IsUnplayed')) ?? (await pick())
      if (item) navigate(`/item/${item.Id}`)
    } catch {
      /* offline or no titles — nothing to open */
    } finally {
      setBusy(false)
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
