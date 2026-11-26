// Settings → Health → Library health: duplicate copies, titles Radarr/Sonarr don't
// follow, files that look cut short, and episodes without numbers. Read-only: it
// says what it found and where; nothing is changed, moved or deleted from here.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { libraryHealthApi, type LibraryFinding } from '../../api/setup'

const GROUPS: { kind: LibraryFinding['kind']; label: string }[] = [
  { kind: 'duplicate', label: 'Duplicate copies' },
  { kind: 'short', label: 'Maybe cut short' },
  { kind: 'misfiled', label: 'Episodes without numbers' },
  { kind: 'unfollowed', label: 'Not followed for upgrades' },
]

export default function LibraryHealth() {
  // Reads whole libraries, so only when asked.
  const q = useQuery({ queryKey: ['libraryHealth'], queryFn: () => libraryHealthApi.get(true), enabled: false, retry: false, staleTime: Infinity })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const d = q.data
  const checkedLabel = d?.checkedAt ? new Date(d.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Library health</h3>
          {checkedLabel && <span className="text-[11.5px] text-ink-500">Checked {checkedLabel}</span>}
        </div>
        <button
          type="button"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
          className="h-8 rounded-full border border-white/10 bg-white/5 px-3 text-[12.5px] font-medium text-ink-200 hover:text-white disabled:opacity-60"
        >
          {q.isFetching ? 'Looking…' : d ? 'Look again' : 'Check the library'}
        </button>
      </div>
      <div className="rounded-2xl border border-white/5 bg-ink-900/60 px-5 py-4">
        {!d && !q.isError && (
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            Looks for duplicate copies, files that seem cut short, episodes without numbers, and titles Radarr or Sonarr don’t follow. It only looks: nothing is changed or deleted.
          </p>
        )}
        {q.isError && <p className="text-[12.5px] text-red-300">{(q.error as Error).message}</p>}
        {d && d.findings.length === 0 && <p className="text-[13px] text-emerald-300">Nothing to tidy up.</p>}
        {d &&
          GROUPS.map((g) => {
            const list = d.findings.filter((f) => f.kind === g.kind)
            if (!list.length) return null
            const showAll = Boolean(expanded[g.kind])
            const shown = showAll ? list : list.slice(0, 50)
            return (
              <section key={g.kind} className="mt-3 first:mt-0 min-w-0">
                <p className="text-[13px] font-semibold text-white">
                  {g.label} <span className="font-normal text-ink-400">({list.length})</span>
                </p>
                <ul className="mt-1 space-y-1.5">
                  {shown.map((f, i) => (
                    <li key={i} className="min-w-0 text-[12.5px] leading-relaxed">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        {f.items.length === 1 ? (
                          <Link to={`/item/${f.items[0]}`} className="font-medium text-ink-100 hover:underline">
                            {f.title}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink-100">{f.title}</span>
                        )}
                        {f.items.length > 1 && (
                          <span className="inline-flex flex-wrap items-center gap-1.5 text-[11.5px]">
                            {f.items.map((id, idx) => (
                              <Link
                                key={`${id}-${idx}`}
                                to={`/item/${id}`}
                                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-accent-300 hover:border-white/25 hover:text-white transition-colors"
                              >
                                {f.kind === 'duplicate' ? `Copy ${idx + 1}` : `Open #${idx + 1}`}
                              </Link>
                            ))}
                          </span>
                        )}
                      </div>
                      <span className="block break-words text-ink-400">{f.detail}</span>
                    </li>
                  ))}
                </ul>
                {list.length > 50 && (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [g.kind]: !e[g.kind] }))}
                    className="mt-2 text-[12px] font-medium text-accent-300 hover:text-accent-200"
                  >
                    {showAll ? 'Show fewer' : `Show all ${list.length.toLocaleString()}`}
                  </button>
                )}
              </section>
            )
          })}
        {d?.skipped.map((s) => (
          <p key={s} className="mt-2 text-[12px] text-amber-200">
            {s}
          </p>
        ))}
      </div>
    </div>
  )
}
