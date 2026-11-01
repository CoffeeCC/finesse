import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePartyInvites } from '../api/parties'

/** A card for watch parties you're invited to (not in the player). Join plays it here, in step. */
export default function PartyInvites() {
  const { pathname } = useLocation()
  const inPlayer = pathname.startsWith('/play/')
  const { data } = usePartyInvites(!inPlayer)
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('finesse.partiesDismissed') ?? '[]') as string[]
    } catch {
      return []
    }
  })
  const navigate = useNavigate()
  const p = (data ?? []).find((x) => !x.joined && !dismissed.includes(x.id))
  if (inPlayer || !p) return null
  const dismiss = () => {
    const next = [...dismissed, p.id]
    setDismissed(next)
    try {
      sessionStorage.setItem('finesse.partiesDismissed', JSON.stringify(next))
    } catch {
      /* private mode */
    }
  }
  return (
    <div role="status" className="toast-in fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-3 z-[70] w-[22rem] max-w-[calc(100%-1.5rem)] rounded-2xl border border-white/10 bg-ink-900/95 p-4 shadow-2xl md:bottom-6">
      <p className="text-[14px] text-white">
        <span className="font-semibold">{p.host}</span> started a watch party: <span className="font-semibold">{p.title}</span>
      </p>
      <p className="mt-0.5 text-[12.5px] text-ink-400">{p.people} watching. Joining plays it here, in step with them.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => navigate(`/play/${p.item}?party=${encodeURIComponent(p.id)}`)} className="h-9 rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200">
          Join
        </button>
        <button type="button" onClick={dismiss} className="h-9 rounded-lg border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15">
          Not now
        </button>
      </div>
    </div>
  )
}
