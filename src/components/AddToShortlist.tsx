import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { addToQueue, useQueues } from '../api/queues'
import { Sheet } from './Sheet'

/** A title's More → Add to a shortlist: the shortlists you're in, each with Add. */
export default function AddToShortlist({ itemId, title, onClose }: { itemId: string; title: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQueues()
  const [done, setDone] = useState<Record<string, 'adding' | 'added' | string>>({})
  const qc = useQueryClient()
  const open = (data ?? []).filter((q) => !q.archived)
  return (
    <Sheet title="Add to a shortlist" onClose={onClose}>
      <p className="text-[13.5px] text-ink-300">“{title}” goes on the shortlist for everyone in it to vote on.</p>
      {isLoading ? (
        <div className="mt-4 h-16 rounded-xl shimmer" />
      ) : isError ? (
        <p className="mt-4 text-sm text-amber-200">Couldn’t load your shortlists. Try again in a moment.</p>
      ) : open.length === 0 ? (
        <p className="mt-4 text-[14px] text-ink-300">
          You’re not in a shortlist yet.{' '}
          <Link to="/together" onClick={onClose} className="font-semibold text-accent-300 hover:text-white">
            Start one in Watch together
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {open.map((q) => {
            const st = done[q.id]
            return (
              <li key={q.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-white">{q.name}</span>
                  {st && st !== 'adding' && st !== 'added' ? <span className="block text-[12.5px] text-amber-200">{st}</span> : <span className="block truncate text-[12.5px] text-ink-400">{q.members} {q.members === 1 ? 'person' : 'people'} · {q.items} {q.items === 1 ? 'title' : 'titles'}</span>}
                </span>
                {st === 'added' ? (
                  <Link to={`/together/shortlist/${q.id}`} onClick={onClose} className="text-sm font-semibold text-emerald-300 hover:text-white">
                    Added · Open
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled={st === 'adding'}
                    className="h-9 rounded-lg border border-white/15 bg-white/10 px-3.5 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60"
                    onClick={async () => {
                      setDone((d) => ({ ...d, [q.id]: 'adding' }))
                      try {
                        await addToQueue(q.id, itemId)
                        setDone((d) => ({ ...d, [q.id]: 'added' }))
                        void qc.invalidateQueries({ queryKey: ['queues'] })
                      } catch (e) {
                        setDone((d) => ({ ...d, [q.id]: (e as Error).message }))
                      }
                    }}
                  >
                    {st === 'adding' ? 'Adding…' : 'Add'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Sheet>
  )
}
