import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { setInWatchlist } from '../api/client'
import { useMyLimits } from '../api/parental'
import { useWatchlistIds, useWatchlistItems } from '../api/queries'
import type { JfItem } from '../api/types'
import MediaCard from '../components/MediaCard'
import { SelectMenu } from '../components/Menu'
import DownloadsSection from '../components/DownloadsSection'
import { CardSkeleton } from '../components/Skeletons'
import { useToast } from '../components/Toast'
import { DiceIcon, useSurprise } from '../lib/surprise'

type FilterKey = 'all' | 'movies' | 'shows' | 'unwatched'
type SortKey = 'added' | 'title' | 'year' | 'rating'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'movies', label: 'Movies' },
  { key: 'shows', label: 'Shows' },
  { key: 'unwatched', label: 'Unwatched' },
]

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'added', label: 'Recently saved' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'year', label: 'Release year' },
  { value: 'rating', label: 'Rating' },
]

/** My List: the server-synced watchlist, plus what you've asked the server to
 *  download (so a request isn't a fire-and-forget into another page). */
export default function MyListPage() {
  const {
    data: ids,
    isLoading: idsLoading,
    isError: idsError,
    refetch: refetchIds,
  } = useWatchlistIds()
  const {
    data: items,
    isLoading: itemsLoading,
    isError: itemsError,
    refetch: refetchItems,
  } = useWatchlistItems()
  const limits = useMyLimits()
  const canRequest = !limits || limits.requests
  const { surprise, busy } = useSurprise()
  const qc = useQueryClient()
  const toast = useToast()

  const [filter, setFilter] = useState<FilterKey>('all')
  const [sort, setSort] = useState<SortKey>('added')

  const loading = idsLoading || (Boolean(ids?.length) && itemsLoading)
  const failed = (idsError && !ids) || (itemsError && !items)
  const list = items ?? []
  const empty = !loading && !failed && list.length === 0

  const filtered = useMemo(() => {
    const subset = list.filter((it) => {
      if (filter === 'movies') return it.Type === 'Movie'
      if (filter === 'shows') return it.Type === 'Series'
      if (filter === 'unwatched') return !it.UserData?.Played
      return true
    })
    if (sort === 'added') return subset
    return subset.slice().sort((a, b) => {
      if (sort === 'title') return (a.SortName ?? a.Name).localeCompare(b.SortName ?? b.Name)
      if (sort === 'year') return (b.ProductionYear ?? 0) - (a.ProductionYear ?? 0) || a.Name.localeCompare(b.Name)
      return (b.CommunityRating ?? 0) - (a.CommunityRating ?? 0) || a.Name.localeCompare(b.Name)
    })
  }, [list, filter, sort])

  const removeItem = async (item: JfItem) => {
    try {
      const next = await setInWatchlist(item.Id, false)
      qc.setQueryData(['watchlistIds'], next)
      qc.invalidateQueries({ queryKey: ['watchlistItems'] })
      toast(`Removed “${item.Name}” from My List`)
    } catch {
      toast('Couldn’t update My List', 'error')
    }
  }

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-12 py-6">
      <div className="flex flex-wrap items-baseline gap-3 mb-1">
        <h1 className="page-title">My List</h1>
        {!loading && !failed && list.length > 0 && (
          <span className="text-sm text-ink-400">
            {filter === 'all'
              ? `${list.length.toLocaleString()} ${list.length === 1 ? 'title' : 'titles'}`
              : `${filtered.length.toLocaleString()} of ${list.length.toLocaleString()} titles`}
          </span>
        )}
      </div>
      <p className="text-sm text-ink-400 mb-6">Saved to watch later, synced across your devices.</p>

      {failed ? (
        <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-ink-900/50 p-8 text-center">
          <p className="text-lg font-semibold text-white">Couldn’t load My List</p>
          <p className="mt-1 text-sm text-ink-400">Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => {
              void refetchIds()
              void refetchItems()
            }}
            className="mt-5 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
          >
            Try again
          </button>
        </div>
      ) : empty ? (
        <div className="mx-auto rounded-2xl border border-white/5 bg-ink-900/50 px-6 py-10 sm:p-12 text-center max-w-2xl">
          <p className="text-lg font-semibold text-white">Your list is empty</p>
          <p className="text-sm text-ink-300 mt-1.5">
            Tap <span className="font-semibold text-white">My List</span> on any movie or show and it lands here, on every device.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Link
              to="/"
              className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
            >
              See what's new
            </Link>
            <button
              type="button"
              onClick={() => surprise({ includeItemTypes: 'Movie,Series' })}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-white/10 border border-white/15 px-4 text-sm font-semibold text-white hover:bg-white/15 transition-colors disabled:opacity-60"
            >
              <DiceIcon spinning={busy} />
              Surprise me
            </button>
          </div>
        </div>
      ) : (
        <>
          {!loading && list.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <div role="group" aria-label="Filter My List" className="inline-flex max-w-full overflow-x-auto no-scrollbar p-0.5 rounded-full bg-ink-800/80 border border-white/10">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={`h-8 px-3.5 rounded-full text-sm whitespace-nowrap transition-colors ${
                      filter === f.key ? 'bg-white text-ink-950 font-semibold' : 'text-ink-200 hover:text-white font-medium'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <SelectMenu label="Sort My List by" prefix="Sort:" value={sort} options={SORT_OPTIONS} onChange={setSort} align="right" />
            </div>
          )}

          {!loading && filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-base font-semibold text-white">Nothing matches this filter</p>
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="mt-4 inline-flex h-9 items-center rounded-full bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
              >
                Show all
              </button>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:gap-4 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
              {loading
                ? Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)
                : filtered.map((item, i) => (
                    <div key={item.Id} className="cv-card">
                      <MediaCard item={item} onDismiss={removeItem} autoFocus={i === 0} />
                    </div>
                  ))}
            </div>
          )}
        </>
      )}

      {canRequest && (
        <div className="mt-10">
          <DownloadsSection title="Your requests" />
          <Link to="/request" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-300 hover:text-white transition-colors">
            Requests and downloads
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        </div>
      )}
    </div>
  )
}
