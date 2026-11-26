import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import * as api from '../api/client'
import MediaCard from '../components/MediaCard'
import { SelectMenu } from '../components/Menu'
import { CardSkeleton } from '../components/Skeletons'

const PAGE_LIMIT = 120

const SORT_OPTIONS = [
  { key: 'name', label: 'Title A–Z', sortBy: 'SortName', sortOrder: 'Ascending' },
  { key: 'added', label: 'Newest', sortBy: 'DateCreated,SortName', sortOrder: 'Descending' },
  { key: 'year', label: 'Year', sortBy: 'ProductionYear,SortName', sortOrder: 'Descending' },
  { key: 'rating', label: 'Rating', sortBy: 'CommunityRating,SortName', sortOrder: 'Descending' },
] as const

type SortKey = (typeof SORT_OPTIONS)[number]['key']

function initialSortKey(sortBy: string | null): SortKey {
  if (!sortBy) return 'name'
  if (sortBy.includes('DateCreated')) return 'added'
  if (sortBy.includes('ProductionYear') || sortBy.includes('PremiereDate')) return 'year'
  if (sortBy.includes('CommunityRating')) return 'rating'
  return 'name'
}

// A "see all" hub: every row on the home page can deep-link here with its
// underlying query encoded as URL params, rendered as a full grid.
export default function BrowsePage() {
  const [params] = useSearchParams()
  const title = params.get('title') ?? 'Browse'
  const urlSortBy = params.get('sortBy')
  const urlSortOrder = params.get('sortOrder')
  const urlFilters = params.get('filters') ?? undefined

  const [sortChoice, setSortChoice] = useState<SortKey | null>(null)
  const [unwatchedOnly, setUnwatchedOnly] = useState(false)
  const [filter, setFilter] = useState('')

  const activeSortKey = sortChoice ?? initialSortKey(urlSortBy)
  const activeSort = SORT_OPTIONS.find((s) => s.key === activeSortKey) ?? SORT_OPTIONS[0]

  const effectiveSortBy = sortChoice ? activeSort.sortBy : (urlSortBy ?? activeSort.sortBy)
  const effectiveSortOrder = sortChoice ? activeSort.sortOrder : (urlSortOrder ?? activeSort.sortOrder)

  const effectiveFilters = useMemo(() => {
    const parts = (urlFilters ?? '').split(',').filter(Boolean)
    if (unwatchedOnly && !parts.includes('IsUnplayed')) parts.push('IsUnplayed')
    return parts.length ? parts.join(',') : undefined
  }, [urlFilters, unwatchedOnly])

  const baseQuery: Omit<api.ItemsQuery, 'startIndex'> = {
    parentId: params.get('parentId') ?? undefined,
    includeItemTypes: params.get('includeItemTypes') ?? undefined,
    genres: params.get('genres') ?? undefined,
    filters: effectiveFilters,
    years: params.get('years') ?? undefined,
    tags: params.get('tags') ?? undefined,
    sortBy: effectiveSortBy,
    sortOrder: effectiveSortOrder,
    recursive: true,
    limit: PAGE_LIMIT,
    fields: 'PrimaryImageAspectRatio,ProductionYear',
  }

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['browse', Object.fromEntries(params), effectiveSortBy, effectiveSortOrder, effectiveFilters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.getItems({ ...baseQuery, startIndex: pageParam }),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.Items.length, 0)
      return loaded < lastPage.TotalRecordCount ? loaded : undefined
    },
    staleTime: 5 * 60_000,
  })

  const allItems = useMemo(() => data?.pages.flatMap((p) => p.Items) ?? [], [data])
  const totalCount = data?.pages[0]?.TotalRecordCount ?? 0

  const needle = filter.trim().toLowerCase()
  const visibleItems = useMemo(
    () => (needle ? allItems.filter((it) => it.Name.toLowerCase().includes(needle)) : allItems),
    [allItems, needle],
  )

  return (
    <div className="px-4 sm:px-6 lg:px-12 py-8 pb-16">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-4">
        <div className="flex items-baseline gap-3 mr-auto min-w-0">
          <h1 className="page-title truncate">{title}</h1>
          {data && (
            <span className="shrink-0 text-sm text-ink-400">
              {needle
                ? `${visibleItems.length.toLocaleString()} of ${allItems.length.toLocaleString()}`
                : `${totalCount.toLocaleString()} ${totalCount === 1 ? 'item' : 'items'}`}
            </span>
          )}
        </div>
        <div className="relative w-full sm:w-52">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter titles…"
            aria-label={`Filter ${title}`}
            enterKeyHint="search"
            className="w-full h-9 rounded-full bg-ink-800/80 border border-white/10 pl-4 pr-8 text-sm outline-none focus:border-accent-500 placeholder:text-ink-400"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              aria-label="Clear filter"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full flex items-center justify-center text-ink-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div role="group" aria-label="Watch state" className="inline-flex p-0.5 rounded-full bg-ink-800/80 border border-white/10">
          {[
            { on: false, label: 'All' },
            { on: true, label: 'Unwatched' },
          ].map((w) => (
            <button
              key={w.label}
              type="button"
              aria-pressed={unwatchedOnly === w.on}
              onClick={() => setUnwatchedOnly(w.on)}
              className={`h-8 px-3.5 rounded-full text-sm transition-colors ${
                unwatchedOnly === w.on ? 'bg-white text-ink-950 font-semibold' : 'text-ink-200 hover:text-white font-medium'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <SelectMenu
          label="Sort by"
          prefix="Sort:"
          value={activeSortKey}
          options={SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
          onChange={(k) => setSortChoice(k)}
          align="right"
        />
      </div>

      {isError && !data ? (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-white">Couldn’t load {title.toLowerCase()}</p>
          <p className="mt-1 text-sm text-ink-400">Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-5 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-2.5 sm:gap-4 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {isLoading
              ? Array.from({ length: 18 }).map((_, i) => <CardSkeleton key={i} />)
              : visibleItems.map((item, i) => (
                  <div key={item.Id} className="cv-card">
                    <MediaCard item={item} autoFocus={i === 0} />
                  </div>
                ))}
          </div>

          {!isLoading && visibleItems.length === 0 && (
            <div className="py-16 text-center">
              {needle || unwatchedOnly ? (
                <>
                  <p className="text-lg font-semibold text-white">Nothing matches these filters</p>
                  <p className="mt-1 text-sm text-ink-400">Try clearing the filter or switching back to All.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setFilter('')
                      setUnwatchedOnly(false)
                    }}
                    className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold text-white">Nothing here yet</p>
                  <p className="mt-1 text-sm text-ink-400">Titles show up as they're added to your library.</p>
                  <Link to="/" className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors">
                    Back to Home
                  </Link>
                </>
              )}
            </div>
          )}

          {hasNextPage && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 border border-white/15 px-6 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-50 transition-colors"
              >
                {isFetchingNextPage
                  ? 'Loading…'
                  : `Load more (${(totalCount - allItems.length).toLocaleString()} left)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Build a /browse href from a query + title (used by home rows' "See all"). */
export function browseHref(title: string, q: api.ItemsQuery): string {
  const p = new URLSearchParams({ title })
  if (q.parentId) p.set('parentId', q.parentId)
  if (q.includeItemTypes) p.set('includeItemTypes', q.includeItemTypes)
  if (q.genres) p.set('genres', q.genres)
  if (q.filters) p.set('filters', q.filters)
  if (q.years) p.set('years', q.years)
  if (q.tags) p.set('tags', q.tags)
  if (q.sortBy) p.set('sortBy', q.sortBy)
  if (q.sortOrder) p.set('sortOrder', q.sortOrder)
  return `/browse?${p.toString()}`
}
