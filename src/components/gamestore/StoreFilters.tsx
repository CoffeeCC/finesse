// Browse's filters: genre (any of several), platform, ways to play. Every option is a button, so
// a remote or controller reaches them like anything else. Counts come from the store's facets
// (each counted with the other filters as they are), and an option with no games is hidden.

import { useState } from 'react'
import type { Facet, GameMode, GamePlatform, StoreFacets, StoreQuery } from '../../api/gameStore'

export function activeFilterCount(q: StoreQuery): number {
  return (q.genres?.length ?? 0) + (q.platform ? 1 : 0) + (q.mode ? 1 : 0)
}

export function StoreFilters({ facets, query, onChange }: { facets: StoreFacets | undefined; query: StoreQuery; onChange: (q: StoreQuery) => void }) {
  const genres = new Set(query.genres ?? [])
  const toggleGenre = (v: string) => {
    const next = new Set(genres)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange({ ...query, genres: [...next] })
  }
  if (!facets)
    return (
      <div className="space-y-3" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-8 rounded-lg shimmer" />
        ))}
      </div>
    )
  return (
    <div className="space-y-6">
      <Group title="Genre" facets={facets.genres} isOn={(v) => genres.has(v)} onPick={toggleGenre} max={8} />
      <Group title="Platform" facets={facets.platforms} isOn={(v) => query.platform === v} onPick={(v) => onChange({ ...query, platform: query.platform === v ? undefined : (v as GamePlatform) })} />
      <Group title="Players" facets={facets.modes} isOn={(v) => query.mode === v} onPick={(v) => onChange({ ...query, mode: query.mode === v ? undefined : (v as GameMode) })} />
      {activeFilterCount(query) > 0 && (
        <button type="button" onClick={() => onChange({ q: query.q, sort: query.sort })} className="text-sm font-semibold text-accent-300 hover:text-accent-200">
          Clear filters
        </button>
      )}
    </div>
  )
}

function Group({ title, facets, isOn, onPick, max }: { title: string; facets: Facet[]; isOn: (v: string) => boolean; onPick: (v: string) => void; max?: number }) {
  const [all, setAll] = useState(false)
  // Picked options always show, even past the cut.
  const shown = !max || all ? facets : facets.filter((f, i) => i < max || isOn(f.value))
  if (!facets.length) return null
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">{title}</legend>
      <div className="flex flex-col gap-0.5">
        {shown.map((f) => {
          const on = isOn(f.value)
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(f.value)}
              className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
                on ? 'bg-white/10 text-white' : 'text-ink-200 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-accent-400 bg-accent-500' : 'border-white/25'}`} aria-hidden>
                {on && (
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{f.label}</span>
              <span className="text-xs text-ink-400">{f.count}</span>
            </button>
          )
        })}
      </div>
      {max && facets.length > max && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 px-2.5 text-xs font-semibold text-accent-300 hover:text-accent-200">
          {all ? 'Fewer' : `All ${facets.length} genres`}
        </button>
      )}
    </fieldset>
  )
}
