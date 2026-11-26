// Browse the game store: full-width poster grid, horizontal filter & sort bar, URL-synced state,
// infinite scroll, and live Prowlarr PC-game search fallback whenever searching.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MODE_LABEL, paramsToQuery, PLATFORM_LABEL, queryToParams, type StoreQuery } from '../api/gameStore'
import { useGameRequests, useStoreFacets, useStoreMode, useStoreSearch } from '../api/gameStoreQueries'
import { Sheet } from '../components/Sheet'
import { LiveSearchSection, STORE_GRID, StoreCard, StoreGridSkeleton } from '../components/gamestore/StoreCards'
import { activeFilterCount, StoreFilterBar, StoreFilters } from '../components/gamestore/StoreFilters'
import { StoreHeader, StoreSearchBox, StoreUnavailable } from '../components/gamestore/StoreHeader'

export default function GameStoreBrowsePage() {
  const mode = useStoreMode()
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => paramsToQuery(params), [params])
  const [input, setInput] = useState(query.q ?? '')
  const [sheet, setSheet] = useState(false)

  // Keep latest query in a ref so the 350ms search debounce never clobbers a filter click.
  const queryRef = useRef(query)
  queryRef.current = query

  const setQuery = useCallback(
    (q: StoreQuery) => setParams(queryToParams(q), { replace: true }),
    [setParams],
  )

  // Sync input when URL `q` changes externally (Back/Forward, clearing search pill, etc.)
  useEffect(() => {
    setInput(query.q ?? '')
  }, [query.q])

  // Debounce typing into URL params without wiping concurrent filter/sort updates.
  useEffect(() => {
    const t = setTimeout(() => {
      const nextQ = input.trim() || undefined
      const current = queryRef.current
      if (nextQ !== current.q) {
        setQuery({ ...current, q: nextQ })
      }
    }, 350)
    return () => clearTimeout(t)
  }, [input, setQuery])

  const results = useStoreSearch(query)
  const facets = useStoreFacets(query)
  const { data: requests } = useGameRequests()
  const byGame = useMemo(() => new Map((requests ?? []).map((r) => [r.gameId, r])), [requests])
  const games = results.data?.pages.flatMap((p) => p.items) ?? []
  const total = results.data?.pages[0]?.total

  // Infinite scroll sentinel
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = results
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && !isFetchingNextPage && fetchNextPage(), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (!mode) return <StoreUnavailable title="Browse games" />

  const genreName = new Map((facets.data?.genres ?? []).map((g) => [g.value, g.label]))
  const pills: { key: string; label: string; drop: () => void }[] = [
    ...(query.q
      ? [
          {
            key: 'q',
            label: `Search: “${query.q}”`,
            drop: () => {
              setInput('')
              setQuery({ ...query, q: undefined })
            },
          },
        ]
      : []),
    ...(query.genres ?? []).map((g) => ({
      key: `g-${g}`,
      label: genreName.get(g) ?? g,
      drop: () => setQuery({ ...query, genres: query.genres!.filter((x) => x !== g) }),
    })),
    ...(query.platform ? [{ key: 'p', label: PLATFORM_LABEL[query.platform], drop: () => setQuery({ ...query, platform: undefined }) }] : []),
    ...(query.mode ? [{ key: 'm', label: MODE_LABEL[query.mode], drop: () => setQuery({ ...query, mode: undefined }) }] : []),
  ]
  const filters = activeFilterCount(query)

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-12">
      <StoreHeader
        title="Browse games"
        extra={
          <StoreSearchBox
            value={input}
            onChange={setInput}
            onSubmit={() => {
              const nextQ = input.trim() || undefined
              if (nextQ !== query.q) setQuery({ ...query, q: nextQ })
            }}
          />
        }
      />

      <StoreFilterBar
        facets={facets.data}
        query={query}
        onChange={setQuery}
        total={total}
        onOpenMobileSheet={() => setSheet(true)}
      />

      {pills.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {pills.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={p.drop}
              aria-label={`Remove ${p.label}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-500/20 px-3 text-xs font-semibold text-accent-200 transition hover:bg-accent-500/30"
            >
              <span>{p.label}</span>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setInput('')
              setQuery({ sort: query.sort })
            }}
            className="px-2 text-xs font-semibold text-ink-300 hover:text-white"
          >
            Clear all
          </button>
        </div>
      )}

      {results.isError ? (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-white">Couldn’t search the store</p>
          <p className="mt-1 text-sm text-ink-400">The store didn’t answer. Try again in a moment.</p>
          <button
            type="button"
            onClick={() => results.refetch()}
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
          >
            Try again
          </button>
        </div>
      ) : results.isLoading ? (
        <StoreGridSkeleton />
      ) : games.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-12 text-center">
          <p className="text-lg font-semibold text-white">
            {query.q ? `No catalog games match “${query.q}”` : 'No games match'}
          </p>
          <p className="mt-1 text-sm text-ink-400">
            {filters ? 'Try clearing a filter or searching for another title.' : 'Check live PC indexer results below or try another search.'}
          </p>
          {(filters > 0 || query.q) && (
            <button
              type="button"
              onClick={() => {
                setInput('')
                setQuery({ sort: query.sort })
              }}
              className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
            >
              Show every game
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={STORE_GRID}>
            {games.map((g) => (
              <div key={g.id} className="cv-card">
                <StoreCard game={g} request={byGame.get(g.id)} />
              </div>
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

      {/* Live Prowlarr PC-game search whenever the user has an active search term */}
      {query.q && <LiveSearchSection q={query.q} className="mt-10 border-t border-white/10 pt-8" />}

      {sheet && (
        <Sheet title="Filters" onClose={() => setSheet(false)}>
          <StoreFilters facets={facets.data} query={query} onChange={setQuery} />
          <button
            type="button"
            onClick={() => setSheet(false)}
            className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-white text-[15px] font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
          >
            {total === undefined ? 'Done' : total === 1 ? 'Show 1 game' : `Show ${total} games`}
          </button>
        </Sheet>
      )}
    </div>
  )
}
