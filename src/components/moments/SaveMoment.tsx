import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { createMomentCollection, saveToCollection, useMomentCollections } from '../../api/momentCollections'
import { Sheet } from '../Sheet'

type What = { moment: string } | { from: { collection: string; key: string } }

/** Save a moment into one of your collections (or a new one). It saves a reference, not the video. */
export default function SaveMoment({ what, label, onClose }: { what: What; label: string; onClose: () => void }) {
  const { data, isLoading, isError } = useMomentCollections()
  const [state, setState] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [making, setMaking] = useState(false)
  const qc = useQueryClient()
  const save = async (id: string) => {
    setState((s) => ({ ...s, [id]: 'saving' }))
    try {
      await saveToCollection(id, what)
      setState((s) => ({ ...s, [id]: 'saved' }))
      void qc.invalidateQueries({ queryKey: ['momentCollections'] })
    } catch (e) {
      setState((s) => ({ ...s, [id]: (e as Error).message }))
    }
  }
  return (
    <Sheet title="Save to a collection" onClose={onClose}>
      <p className="text-[13.5px] text-ink-300">
        {label}. Collections keep where it is in the title and the note, not a copy of the video.
      </p>
      {isLoading ? (
        <div className="mt-4 h-14 rounded-xl shimmer" />
      ) : isError ? (
        <p className="mt-4 text-sm text-amber-200">Couldn’t load your collections. Try again in a moment.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {(data?.mine ?? []).map((c) => {
            const st = state[c.id]
            return (
              <li key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-white">{c.name}</span>
                  <span className={`block truncate text-[12.5px] ${st && !['saving', 'saved'].includes(st) ? 'text-amber-200' : 'text-ink-400'}`}>
                    {st && !['saving', 'saved'].includes(st) ? st : `${c.entries} ${c.entries === 1 ? 'moment' : 'moments'}`}
                  </span>
                </span>
                {st === 'saved' ? (
                  <Link to={`/moments/${c.id}`} onClick={onClose} className="text-sm font-semibold text-emerald-300 hover:text-white">
                    Saved · Open
                  </Link>
                ) : (
                  <button type="button" disabled={st === 'saving'} onClick={() => void save(c.id)} className="h-9 rounded-lg border border-white/15 bg-white/10 px-3.5 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60">
                    {st === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return
          setMaking(true)
          try {
            const c = await createMomentCollection(name)
            await saveToCollection(c.id, what)
            setState((s) => ({ ...s, [c.id]: 'saved' }))
            setName('')
            await qc.invalidateQueries({ queryKey: ['momentCollections'] })
          } catch (err) {
            setState((s) => ({ ...s, new: (err as Error).message }))
          } finally {
            setMaking(false)
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="New collection, like “Best openings”" aria-label="New collection name" className="h-10 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/[0.05] px-3 text-[15px] text-white outline-none focus:border-white/40" />
        <button type="submit" disabled={making || !name.trim()} className="h-10 shrink-0 rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-60">
          {making ? 'Saving…' : 'Make and save'}
        </button>
      </form>
      {state.new && <p className="mt-2 text-sm text-amber-200">{state.new}</p>}
    </Sheet>
  )
}
