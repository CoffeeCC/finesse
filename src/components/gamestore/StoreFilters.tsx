// Sleek horizontal filter & sort bar + expandable chip drawer (replaces the heavy 240px sidebar).
// Every option is a focusable button so keyboard / TV remote D-pad reaches them cleanly.

import { useState } from 'react'
import { SORT_LABEL, type Facet, type GameMode, type GamePlatform, type StoreFacets, type StoreQuery, type StoreSort } from '../../api/gameStore'

const SORTS: StoreSort[] = ['popular', 'new', 'name', 'year']

export function activeFilterCount(q: StoreQuery): number {
  return (q.genres?.length ?? 0) + (q.platform ? 1 : 0) + (q.mode ? 1 : 0)
}

/** Full-width horizontal filter & sort bar with expandable genre/filter chip drawer. */
export function StoreFilterBar({
  facets,
  query,
  onChange,
  total,
  onOpenMobileSheet,
}: {
  facets: StoreFacets | undefined
  query: StoreQuery
  onChange: (q: StoreQuery) => void
  total?: number
  onOpenMobileSheet: () => void
}) {
  const [genresOpen, setGenresOpen] = useState(false)
  const selectedGenres = new Set(query.genres ?? [])
  const filters = activeFilterCount(query)

  const toggleGenre = (v: string) => {
    const next = new Set(selectedGenres)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange({ ...query, genres: [...next] })
  }

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Mobile filter sheet trigger */}
        <button
          type="button"
          onClick={onOpenMobileSheet}
          className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors lg:hidden ${
            filters > 0
              ? 'border-accent-400/50 bg-accent-500/20 text-accent-200'
              : 'border-white/10 bg-white/[0.05] text-ink-200 hover:border-white/20 hover:text-white'
          }`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" d="M3 6h18M6 12h12M10 18h4" />
          </svg>
          Filters{filters > 0 ? ` (${filters})` : ''}
        </button>

        {/* Desktop horizontal filter triggers */}
        <div className="hidden flex-wrap items-center gap-2 lg:flex">
          {facets && facets.genres.length > 0 && (
            <button
              type="button"
              aria-expanded={genresOpen}
              onClick={() => setGenresOpen((v) => !v)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
                selectedGenres.size > 0 || genresOpen
                  ? 'border-accent-400/50 bg-accent-500/15 text-accent-200'
                  : 'border-white/10 bg-white/[0.04] text-ink-200 hover:border-white/20 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <span>Genres</span>
              {selectedGenres.size > 0 && (
                <span className="rounded-full bg-accent-400/25 px-1.5 py-0.5 text-[11px] font-bold leading-none text-accent-100">
                  {selectedGenres.size}
                </span>
              )}
              <svg
                className={`h-3.5 w-3.5 transition-transform ${genresOpen ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          )}

          {facets && facets.platforms.length > 0 && (
            <div className="flex items-center gap-1" role="group" aria-label="Platform filter">
              {facets.platforms.map((f) => {
                const on = query.platform === f.value
                return (
                  <FilterChip
                    key={f.value}
                    active={on}
                    label={f.label}
                    count={f.count}
                    onClick={() => onChange({ ...query, platform: on ? undefined : (f.value as GamePlatform) })}
                  />
                )
              })}
            </div>
          )}

          {facets && facets.modes.length > 0 && (
            <div className="flex items-center gap-1" role="group" aria-label="Players filter">
              {facets.modes.map((f) => {
                const on = query.mode === f.value
                return (
                  <FilterChip
                    key={f.value}
                    active={on}
                    label={f.label}
                    count={f.count}
                    onClick={() => onChange({ ...query, mode: on ? undefined : (f.value as GameMode) })}
                  />
                )
              })}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Sort segmented control: visually distinct from StoreHeader's active white tab pill */}
        <div
          className="flex items-center gap-0.5 overflow-x-auto no-scrollbar rounded-xl border border-white/10 bg-white/[0.035] p-1"
          role="group"
          aria-label="Sort by"
        >
          {SORTS.map((s) => {
            const on = (query.sort ?? 'popular') === s
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...query, sort: s })}
                className={`h-7 shrink-0 rounded-lg px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
                  on ? 'bg-white/15 text-white shadow-sm' : 'text-ink-400 hover:text-ink-100'
                }`}
              >
                {SORT_LABEL[s]}
              </button>
            )
          })}
        </div>

        {total !== undefined && (
          <span className="hidden text-xs font-medium tabular-nums text-ink-400 sm:inline" aria-live="polite">
            {total === 1 ? '1 game' : `${total} games`}
          </span>
        )}
      </div>

      {/* Expandable desktop genres chip drawer */}
      {genresOpen && facets && facets.genres.length > 0 && (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">Genres</span>
            {selectedGenres.size > 0 && (
              <button
                type="button"
                onClick={() => onChange({ ...query, genres: [] })}
                className="text-xs font-semibold text-accent-300 hover:text-accent-200"
              >
                Clear genres
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {facets.genres.map((f) => (
              <FilterChip
                key={f.value}
                active={selectedGenres.has(f.value)}
                label={f.label}
                count={f.count}
                onClick={() => toggleGenre(f.value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Pill-based filter groups used inside the mobile Filters sheet. */
export function StoreFilters({ facets, query, onChange }: { facets: StoreFacets | undefined; query: StoreQuery; onChange: (q: StoreQuery) => void }) {
  const genres = new Set(query.genres ?? [])
  const toggleGenre = (v: string) => {
    const next = new Set(genres)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange({ ...query, genres: [...next] })
  }
  if (!facets) {
    return (
      <div className="flex flex-wrap gap-2" aria-hidden>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-9 w-24 rounded-full shimmer" />
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-5">
      <ChipGroup title="Platform" facets={facets.platforms} isOn={(v) => query.platform === v} onPick={(v) => onChange({ ...query, platform: query.platform === v ? undefined : (v as GamePlatform) })} />
      <ChipGroup title="Players" facets={facets.modes} isOn={(v) => query.mode === v} onPick={(v) => onChange({ ...query, mode: query.mode === v ? undefined : (v as GameMode) })} />
      <ChipGroup title="Genre" facets={facets.genres} isOn={(v) => genres.has(v)} onPick={toggleGenre} />
      {activeFilterCount(query) > 0 && (
        <button type="button" onClick={() => onChange({ q: query.q, sort: query.sort })} className="text-sm font-semibold text-accent-300 hover:text-accent-200">
          Clear all filters
        </button>
      )}
    </div>
  )
}

function ChipGroup({ title, facets, isOn, onPick }: { title: string; facets: Facet[]; isOn: (v: string) => boolean; onPick: (v: string) => void }) {
  if (!facets.length) return null
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">{title}</legend>
      <div className="flex flex-wrap gap-1.5">
        {facets.map((f) => (
          <FilterChip key={f.value} active={isOn(f.value)} label={f.label} count={f.count} onClick={() => onPick(f.value)} />
        ))}
      </div>
    </fieldset>
  )
}

function FilterChip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
        active
          ? 'border-accent-400/60 bg-accent-500/20 text-accent-100'
          : 'border-white/10 bg-white/[0.04] text-ink-200 hover:border-white/20 hover:bg-white/[0.08] hover:text-white'
      }`}
    >
      <span>{label}</span>
      <span className={`font-mono text-[11px] tabular-nums ${active ? 'text-accent-200' : 'text-ink-400'}`}>{count}</span>
    </button>
  )
}
