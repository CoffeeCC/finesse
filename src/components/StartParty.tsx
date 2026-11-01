import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { startParty } from '../api/parties'
import PeoplePicker from './PeoplePicker'
import { Sheet } from './Sheet'

/** A title's More → Watch party: invite people here, then play it together. */
export default function StartParty({ itemId, title, position, onClose }: { itemId: string; title: string; position: number; onClose: () => void }) {
  const [who, setWho] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  return (
    <Sheet title="Watch party" onClose={onClose}>
      <p className="text-[13.5px] leading-relaxed text-ink-300">
        Watch “{title}” at the same time as people here, each on their own screen. Anyone in the party can play, pause or skip, and it happens for everyone. Each person joins only if their own profile can open it. Up to 8 people.
      </p>
      <div className="mt-4">
        <PeoplePicker chosen={who} onChange={setWho} />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-amber-200">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !who.length}
        className="mt-4 h-10 rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-60"
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const p = await startParty(itemId, who, position)
            onClose()
            navigate(`/play/${itemId}?party=${encodeURIComponent(p.id)}${position > 0 ? `&t=${Math.round(position * 1e7)}` : ''}`)
          } catch (e) {
            setError((e as Error).message)
            setBusy(false)
          }
        }}
      >
        {busy ? 'Starting…' : who.length ? `Start, and invite ${who.length}` : 'Pick who to invite'}
      </button>
      <p className="mt-2 text-[12px] text-ink-400">They get an invitation in Finesse. Starting a party doesn’t play anything on their devices until they join.</p>
    </Sheet>
  )
}
