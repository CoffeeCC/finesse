// Settings → Server → Limits: a rating limit per profile, enforced by the server (parental.ts).
// It says plainly what the limit covers and what it doesn't.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getParental, setParental, type Limit, type ParentalPerson } from '../../api/parental'
import { useFinesse } from '../../lib/finesseServer'

export default function ParentalAdmin() {
  const { info } = useFinesse()
  const on = Boolean(info?.features?.parental)
  const q = useQuery({ queryKey: ['parental', 'all'], queryFn: getParental, enabled: on, retry: false })
  if (!on) return null
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Limits for profiles</h3>
      <div className="space-y-4 rounded-2xl border border-white/5 bg-ink-900/60 px-5 py-4">
        <p className="text-[12.5px] leading-relaxed text-ink-400">
          Limit a profile to titles rated up to an age. Finesse checks it on the server for browsing, search, title pages and links, playing (including titles sent from another device), Moments, shortlists and preview clips, and sets the same limit in Jellyfin. Limited profiles can’t use friends’ servers (their ratings can’t be checked) and can’t request unless you allow it.
        </p>
        <p className="text-[12.5px] leading-relaxed text-amber-200/90">
          Not covered: games and game streaming have no ratings, so they aren’t limited. And a profile without a password can be opened by anyone on a device that shows it, so give the other profiles passwords.
        </p>
        {q.isLoading && <div className="h-16 rounded-xl shimmer" />}
        {q.isError && <p className="text-[12.5px] text-red-300">{(q.error as Error).message}</p>}
        {q.data && (
          <ul className="divide-y divide-white/5">
            {q.data.people.map((p) => (
              <PersonRow key={p.id} p={p} choices={q.data.choices} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function PersonRow({ p, choices }: { p: ParentalPerson; choices: { age: number; label: string }[] }) {
  const [limit, setLimit] = useState<Limit | null>(p.limit)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const qc = useQueryClient()
  const save = async (next: Limit | null) => {
    setLimit(next)
    setBusy(true)
    setNote(null)
    try {
      const r = await setParental(p.id, next)
      setNote(r.warning ? { text: r.warning, bad: true } : { text: next ? 'Saved. It applies right away, on every device.' : 'No limits now.', bad: false })
      void qc.invalidateQueries({ queryKey: ['parental'] })
    } catch (e) {
      setLimit(p.limit)
      setNote({ text: (e as Error).message, bad: true })
    } finally {
      setBusy(false)
    }
  }
  const box = 'h-4 w-4'
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="min-w-[8rem] flex-1 text-[15px] font-semibold text-white">{p.name}</span>
        {p.admin ? (
          <span className="text-[12.5px] text-ink-400">Administrator: can’t be limited</span>
        ) : (
          <select
            value={limit ? String(limit.maxAge) : ''}
            disabled={busy}
            aria-label={`Rating limit for ${p.name}`}
            onChange={(e) => void save(e.target.value === '' ? null : { maxAge: Number(e.target.value), blockUnrated: limit?.blockUnrated ?? true, requests: limit?.requests ?? false })}
            className="h-9 rounded-lg border border-white/15 bg-white/[0.05] px-2 text-[14px] text-white"
          >
            <option value="">No limit</option>
            {choices.map((c) => (
              <option key={c.age} value={c.age}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {limit && !p.admin && (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-200">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className={box} checked={limit.blockUnrated} disabled={busy} onChange={(e) => void save({ ...limit, blockUnrated: e.target.checked })} />
            Block films and shows with no rating
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className={box} checked={limit.requests} disabled={busy} onChange={(e) => void save({ ...limit, requests: e.target.checked })} />
            May request titles
          </label>
        </div>
      )}
      {note && <p className={`mt-1.5 text-[12.5px] ${note.bad ? 'text-amber-200' : 'text-emerald-300'}`}>{note.text}</p>}
    </li>
  )
}
