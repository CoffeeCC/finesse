// Browse the game store: search, filters and sort, all kept in the address (so Back, a shared
// link and a store-front shelf's "See all" land on the same view), and more games as you scroll.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MODE_LABEL, paramsToQuery, PLATFORM_LABEL, queryToParams, SORT_LABEL, type StoreQuery, type StoreSort } from '../api/gameStore'
import { useGameRequests, useStoreFacets, useStoreMode, useStoreSearch } from '../api/gameStoreQueries'
import { Sheet } from '../components/Sheet'
import { STORE_GRID, StoreCard, StoreGridSkeleton } from '../components/gamestore/StoreCards'
import { activeFilterCount, StoreFilters } from '../components/gamestore/StoreFilters'
import { StoreHeader, StoreSearchBox } from '../components/gamestore/StoreHeader'

const SORTS: StoreSort[] = ['popular', 'new', 'name', 'year']

export default function GameStoreBrowsePage() {
  const mode = useStoreMode()
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => paramsToQuery(params), [params])
  const [input, setInput] = useState(query.q ?? '')
  const [sheet, setSheet] = useState(false)

  const setQuery = (q: StoreQuery) => setParams(queryToParams(q), { replace: true })

  // Typing goes into the address after a pause.
  useEffect(() => {
    const t = setTimeout(() => {
      if (input.trim() !== (query.q ?? '')) setQuery({ ...query, q: input.trim() || undefined })
    }, 350)
    return () => clearTimeout(t)
  }, [input]) // eslint-disable-line react-hooks/exhaustive-deps

  const results = useStoreSearch(query)
  const facets = useStoreFacets(query)
  const { data: requests } = useGameRequests()
  const byGame = useMemo(() => new Map((requests ?? []).map((r) => [r.gameId, r])), [requests])
  const games = results.data?.pages.flatMap((p) => p.items) ?? []
  const total = results.data?.pages[0]?.total

  // More as the end of the grid comes near.
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && !isFetchingNextPage && fetchNextPage(), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (!mode) return null

  const genreName = new Map((facets.data?.genres ?? []).map((g) => [g.value, g.label]))
  const pills = [
    ...(query.genres ?? []).map((g) => ({ key: `g-${g}`, label: genreName.get(g) ?? g, drop: () => setQuery({ ...query, genres: query.genres!.filter((x) => x !== g) }) })),
    ...(query.platform ? [{ key: 'p', label: PLATFORM_LABEL[query.platform], drop: () => setQuery({ ...query, platform: undefined }) }] : []),
    ...(query.mode ? [{ key: 'm', label: MODE_LABEL[query.mode], drop: () => setQuery({ ...query, mode: undefined }) }] : []),
  ]
  const filters = activeFilterCount(query)

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-12">
      <StoreHeader title="Browse games" extra={<StoreSearchBox value={input} onChange={setInput} />} />

      <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-10">
        <aside className="hidden lg:block" aria-label="Filters">
          <div className="sticky top-24">
            <StoreFilters facets={facets.data} query={query} onChange={setQuery} />
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm font-medium text-ink-200 hover:text-white lg:hidden"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" d="M3 6h18M6 12h12M10 18h4" />
              </svg>
              Filters{filters ? ` (${filters})` : ''}
            </button>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar" role="group" aria-label="Sort by">
              {SORTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={query.sort === s}
                  onClick={() => setQuery({ ...query, sort: s })}
                  className={`h-9 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors ${query.sort === s ? 'bg-[#f5f3ee] text-ink-950' : 'text-ink-300 hover:text-white'}`}
                >
                  {SORT_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            {total !== undefined && (
              <span className="text-sm text-ink-400" aria-live="polite">
                {total === 1 ? '1 game' : `${total} games`}
              </span>
            )}
          </div>

          {pills.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {pills.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={p.drop}
                  aria-label={`Remove ${p.label}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-500/20 px-3 text-sm font-medium text-accent-200 hover:bg-accent-500/30"
                >
                  {p.label}
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              ))}
              <button type="button" onClick={() => setQuery({ q: query.q, sort: query.sort })} className="px-2 text-sm font-semibold text-ink-300 hover:text-white">
                Clear all
              </button>
            </div>
          )}

          {results.isError ? (
            <p className="py-12 text-center text-sm text-ink-400">Couldn’t search the store. Try again in a moment.</p>
          ) : results.isLoading ? (
            <StoreGridSkeleton />
          ) : games.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-lg font-semibold text-white">No games match</p>
              <p className="mt-1 text-sm text-ink-400">{filters ? 'Clear a filter or search for something else.' : 'Search for something else.'}</p>
              {(filters > 0 || query.q) && (
                <button
                  type="button"
                  onClick={() => {
                    setInput('')
                    setQuery({ sort: query.sort })
                  }}
                  className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200"
                >
                  Show every game
                </button>
              )}
            </div>
          ) : (
            <>
              <div className={STORE_GRID}>
                {games.map((g) => (
                  <StoreCard key={g.id} game={g} request={byGame.get(g.id)} />
                ))}
              </div>
              <div ref={sentinel} />
              {hasNextPage && (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="inline-flex h-10 items-center rounded-lg border border-white/15 bg-white/10 px-5 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-60"
                  >
                    {isFetchingNextPage ? 'Loading…' : 'Show more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {sheet && (
        <Sheet title="Filters" onClose={() => setSheet(false)}>
          <StoreFilters facets={facets.data} query={query} onChange={setQuery} />
          <button type="button" onClick={() => setSheet(false)} className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-white text-[15px] font-semibold text-ink-950 hover:bg-ink-200">
            {total === undefined ? 'Done' : total === 1 ? 'Show 1 game' : `Show ${total} games`}
          </button>
        </Sheet>
      )}
    </div>
  )
}

