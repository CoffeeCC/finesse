import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useQuery } from '@tanstack/react-query'
import * as api from '../api/client'
import {
  itemTypesForCollection,
  useGenres,
  useItemPages,
  useLibraryIndex,
  useViews,
} from '../api/queries'
import { Link } from 'react-router-dom'
import MediaCard from '../components/MediaCard'
import AlphabetRail from '../components/AlphabetRail'
import { CardSkeleton } from '../components/Skeletons'
import { MultiSelectMenu, SelectMenu } from '../components/Menu'
import { DiceIcon, useSurprise } from '../lib/surprise'
import { formatRuntime } from '../api/types'
import type { JfItem } from '../api/types'
import { peerOf } from '../lib/peers'

const TEXT_BLOCK = 56
const ROW_GAP = 8
const NAV_OFFSET = 88

const SORT_OPTIONS = [
  { label: 'Title A–Z', sortBy: 'SortName', sortOrder: 'Ascending' },
  { label: 'Recently added', sortBy: 'DateCreated,SortName', sortOrder: 'Descending' },
  { label: 'Release date', sortBy: 'ProductionYear,SortName', sortOrder: 'Descending' },
  { label: 'Rating', sortBy: 'CommunityRating,SortName', sortOrder: 'Descending' },
  { label: 'Runtime', sortBy: 'Runtime,SortName', sortOrder: 'Ascending' },
]

/** Watch state: one segmented choice instead of a lone "Unwatched" chip. */
const WATCH_STATES = [
  { key: 'all', label: 'All', filters: undefined },
  { key: 'unwatched', label: 'Unwatched', filters: 'IsUnplayed' },
  { key: 'progress', label: 'In progress', filters: 'IsResumable' },
  { key: 'favorites', label: 'Favorites', filters: 'IsFavorite' },
] as const
type WatchState = (typeof WATCH_STATES)[number]['key']

const LIST_ROW = 104

/** List layout: poster, title, year · runtime · rating, and watch state. */
function ListRow({ item }: { item: JfItem }) {
  const played = item.UserData?.Played
  const pos = item.UserData?.PlaybackPositionTicks ?? 0
  const pct = pos && item.RunTimeTicks ? Math.min(100, (pos / item.RunTimeTicks) * 100) : 0
  const meta = [item.ProductionYear, item.RunTimeTicks ? formatRuntime(item.RunTimeTicks) : null, item.OfficialRating]
    .filter(Boolean)
    .join(' · ')
  return (
    <Link
      to={`/item/${item.Id}`}
      className="group flex items-center gap-4 w-full h-[96px] rounded-xl px-2 hover:bg-white/5 focus-visible:bg-white/10 outline-none transition-colors"
    >
      <span className="relative h-[84px] w-14 shrink-0 rounded-lg overflow-hidden bg-ink-800 ring-1 ring-white/5">
        {api.posterUrl(item, 120) && <img src={api.posterUrl(item, 120)!} alt="" loading="lazy" className="h-full w-full object-cover" />}
        {pct > 0 && (
          <span className="absolute bottom-0 inset-x-0 h-1 bg-black/60">
            <span className="block h-full bg-accent-400" style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-white truncate">{item.Name}</span>
        <span className="block text-sm text-ink-400 truncate">{meta}</span>
      </span>
      {item.CommunityRating ? <span className="hidden sm:block text-sm text-ink-300 tabular-nums">★ {item.CommunityRating.toFixed(1)}</span> : null}
      <span className="w-24 text-right text-xs text-ink-400">{played ? 'Watched' : pct > 0 ? 'In progress' : ''}</span>
    </Link>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export default function LibraryPage() {
  const { viewId } = useParams()
  // A friend's library (Groups) is described by their server, not ours.
  const friend = peerOf(viewId)
  const { data: ownViews } = useViews()
  const { data: friendViews } = useQuery({ queryKey: ['friend', friend, 'views'], queryFn: () => api.getViews(friend!), enabled: Boolean(friend), staleTime: 5 * 60_000 })
  const views = friend ? friendViews : ownViews
  const view = views?.Items.find((v) => v.Id === viewId)
  const includeItemTypes = itemTypesForCollection(view?.CollectionType)

  const [sortIdx, setSortIdx] = useState(0)
  const [filter, setFilter] = useState('')
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set())
  const [watchState, setWatchState] = useState<WatchState>('all')
  const [layout, setLayout] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem('finesse.libraryLayout') === 'list' ? 'list' : 'grid'
    } catch {
      return 'grid'
    }
  })
  const { surprise, busy: surprising } = useSurprise()
  const debouncedFilter = useDebounced(filter, 300)
  const sort = SORT_OPTIONS[sortIdx]
  const isNameSort = sortIdx === 0

  // Reset filters when switching libraries
  useEffect(() => {
    setFilter('')
    setSortIdx(0)
    setSelectedGenres(new Set())
    setWatchState('all')
  }, [viewId])
  useEffect(() => {
    try {
      localStorage.setItem('finesse.libraryLayout', layout)
    } catch {
      /* private mode */
    }
  }, [layout])

  const genresParam = selectedGenres.size ? [...selectedGenres].join('|') : undefined
  const filtersParam = WATCH_STATES.find((w) => w.key === watchState)?.filters

  const { data: genreList } = useGenres(viewId)
  const { data: index } = useLibraryIndex(viewId, includeItemTypes, genresParam, filtersParam)
  const total = index?.total ?? 0


  // Floating letter chip while scrolling the name-sorted grid
  const [scrolling, setScrolling] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const onScroll = () => {
      setScrolling(true)
      clearTimeout(timer)
      timer = setTimeout(() => setScrolling(false), 700)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [])

  // --- Responsive columns ---
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridWidth, setGridWidth] = useState(0)
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setGridWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Phones get 3 compact columns (2 giant posters wasted the screen); larger
  // screens keep ~180px cards.
  const compact = gridWidth > 0 && gridWidth < 600
  const GAP = compact ? 10 : 16
  const minCard = compact ? 104 : 180
  const listMode = layout === 'list'
  const columns = listMode ? 1 : Math.max(compact ? 3 : 2, Math.floor((gridWidth + GAP) / (minCard + GAP)))
  const cardWidth = columns > 0 ? (gridWidth - (columns - 1) * GAP) / columns : minCard
  const rowHeight = listMode ? LIST_ROW : cardWidth * 1.5 + TEXT_BLOCK + ROW_GAP
  const rowCount = Math.ceil(total / columns)

  // --- Virtualizer (window scroll) ---
  const [scrollMargin, setScrollMargin] = useState(0)
  useLayoutEffect(() => {
    if (gridRef.current) setScrollMargin(gridRef.current.offsetTop)
  }, [gridWidth, total])

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan: 4,
    scrollMargin,
  })
  // Recompute row sizes when layout changes
  useEffect(() => {
    virtualizer.measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowHeight, rowCount])

  const virtualRows = virtualizer.getVirtualItems()
  const visibleStart = virtualRows.length ? virtualRows[0].index * columns : 0
  const visibleEnd = virtualRows.length
    ? (virtualRows[virtualRows.length - 1].index + 1) * columns - 1
    : 0

  const itemMap = useItemPages(
    viewId,
    includeItemTypes,
    sort.sortBy,
    sort.sortOrder,
    visibleStart,
    visibleEnd,
    genresParam,
    filtersParam,
  )

  // --- Alphabet rail ---
  // Use the actual scroll position (not overscanned virtual rows) so the
  // active letter matches what's at the top of the viewport.
  const scrollOffset = virtualizer.scrollOffset ?? 0
  const topIndex =
    rowHeight > 0
      ? Math.max(0, Math.floor((scrollOffset - scrollMargin + NAV_OFFSET) / rowHeight)) * columns
      : 0
  const activeLetter = useMemo(() => {
    if (!index || !isNameSort) return undefined
    let current: string | undefined
    for (const [letter, offset] of index.letterOffsets) {
      if (offset <= topIndex) current = letter
      else break
    }
    return current
  }, [index, topIndex, isNameSort])

  const jumpToLetter = (letter: string) => {
    const offset = index?.letterOffsets.get(letter)
    if (offset == null) return
    const rowIndex = Math.floor(offset / columns)
    window.scrollTo({ top: scrollMargin + rowIndex * rowHeight - NAV_OFFSET, behavior: 'instant' as ScrollBehavior })
  }

  // --- Search within library ---
  const searching = debouncedFilter.trim().length > 1
  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['libSearch', viewId, debouncedFilter],
    enabled: searching && !!viewId,
    queryFn: () =>
      api.getItems({
        parentId: viewId,
        includeItemTypes,
        recursive: true,
        searchTerm: debouncedFilter.trim(),
        limit: 100,
        fields: 'PrimaryImageAspectRatio,ProductionYear',
      }),
  })

  return (
    <div className="px-4 sm:px-6 lg:px-12 pb-16">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-5 sm:pt-6 pb-3">
        <h1 className="page-title">{view?.Name ?? 'Library'}</h1>
        {total > 0 && <span className="text-sm text-ink-400">{total.toLocaleString()} {filtersParam || genresParam ? 'match' : 'titles'}</span>}
        <div className="flex-1" />
        <div className="flex w-full sm:w-auto items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${view?.Name?.toLowerCase() ?? ''}…`}
            aria-label={`Filter ${view?.Name ?? 'library'} by title`}
            enterKeyHint="search"
            className="min-w-0 flex-1 sm:flex-none sm:w-48 h-9 rounded-full bg-ink-800/80 border border-white/10 px-4 text-sm outline-none focus:border-accent-500 placeholder:text-ink-400"
          />
          <button
            type="button"
            onClick={() => surprise({ parentId: viewId, includeItemTypes })}
            disabled={surprising}
            className="shrink-0 inline-flex h-9 items-center gap-2 rounded-full bg-ink-800/80 border border-white/10 px-3.5 text-sm text-ink-200 hover:text-white hover:border-white/20 disabled:opacity-60 transition-colors"
          >
            <DiceIcon spinning={surprising} />
            <span className="hidden sm:inline">Surprise me</span>
          </button>
          <div role="group" aria-label="Layout" className="shrink-0 hidden sm:inline-flex p-0.5 rounded-full bg-ink-800/80 border border-white/10">
            {(['grid', 'list'] as const).map((l) => (
              <button
                key={l}
                type="button"
                aria-label={l === 'grid' ? 'Grid' : 'List'}
                aria-pressed={layout === l}
                onClick={() => setLayout(l)}
                className={`h-8 w-9 rounded-full flex items-center justify-center transition-colors ${layout === l ? 'bg-white/15 text-white' : 'text-ink-400 hover:text-white'}`}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  {l === 'grid' ? (
                    <path strokeLinejoin="round" d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" />
                  ) : (
                    <path strokeLinecap="round" d="M8.5 6H20M8.5 12H20M8.5 18H20M4 6h.01M4 12h.01M4 18h.01" />
                  )}
                </svg>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filters: watch state, genres, sort — the app's own menus, not native selects. */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-4 -mx-1 px-1">
        <div role="group" aria-label="Watch state" className="shrink-0 inline-flex p-0.5 rounded-full bg-ink-800/80 border border-white/10">
          {WATCH_STATES.map((w) => (
            <button
              key={w.key}
              type="button"
              aria-pressed={watchState === w.key}
              onClick={() => setWatchState(w.key)}
              className={`h-8 px-3.5 rounded-full text-sm whitespace-nowrap transition-colors ${
                watchState === w.key ? 'bg-white text-ink-950 font-semibold' : 'text-ink-200 hover:text-white font-medium'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        {genreList && genreList.Items.length > 0 && (
          <MultiSelectMenu
            label="Genre"
            values={selectedGenres}
            options={genreList.Items.map((g) => g.Name)}
            onChange={setSelectedGenres}
          />
        )}
        <div className="flex-1" />
        <SelectMenu
          label="Sort by"
          prefix="Sort:"
          value={sortIdx}
          options={SORT_OPTIONS.map((o, i) => ({ value: i, label: o.label }))}
          onChange={setSortIdx}
          align="right"
        />
      </div>

      {searching ? (
        <div className="grid gap-2.5 sm:gap-4 grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {searchLoading
            ? Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)
            : searchResults?.Items.map((item) => <MediaCard key={item.Id} item={item} />)}
          {!searchLoading && searchResults?.Items.length === 0 && (
            <p className="col-span-full text-ink-400 py-12 text-center">
              Nothing matches “{debouncedFilter}”
            </p>
          )}
        </div>
      ) : index && total === 0 && (filtersParam || genresParam) ? (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-white">Nothing matches these filters</p>
          <p className="mt-1 text-sm text-ink-400">Try another genre or watch state.</p>
          <button
            type="button"
            onClick={() => {
              setWatchState('all')
              setSelectedGenres(new Set())
            }}
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div ref={gridRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {gridWidth > 0 &&
              virtualRows.map((vRow) => (
                <div
                  key={vRow.key}
                  // Grid, not flex + gap: flex gap is ignored on older TV engines
                  // (LG CX = Chromium 68), which butted every poster together.
                  className="absolute left-0 w-full grid"
                  style={{
                    transform: `translateY(${vRow.start - scrollMargin}px)`,
                    gap: GAP,
                    gridTemplateColumns: listMode ? '1fr' : `repeat(${columns}, ${cardWidth}px)`,
                  }}
                >
                  {Array.from({ length: columns }).map((_, col) => {
                    const itemIndex = vRow.index * columns + col
                    if (itemIndex >= total) return <div key={col} style={{ width: cardWidth }} />
                    const item = itemMap.get(itemIndex)
                    if (listMode) {
                      return item ? (
                        <ListRow key={item.Id} item={item} />
                      ) : (
                        <div key={`s${col}`} className="h-[96px] w-full rounded-xl shimmer" />
                      )
                    }
                    return item ? (
                      <MediaCard key={item.Id} item={item} width={cardWidth} autoFocus={itemIndex === 0} />
                    ) : (
                      <CardSkeleton key={`s${col}`} width={cardWidth} />
                    )
                  })}
                </div>
              ))}
          </div>

          {index && isNameSort && index.letters.length > 1 && (
            <AlphabetRail
              available={new Set(index.letters)}
              active={activeLetter}
              onJump={jumpToLetter}
            />
          )}

          {/* Floating letter chip while fast-scrolling. Portaled for the same
              reason as AlphabetRail: position:fixed breaks inside the animated
              .page-enter wrapper (transform = containing block). */}
          {scrolling &&
            isNameSort &&
            activeLetter &&
            createPortal(
              <div className="letter-pop fixed right-16 top-1/2 -translate-y-1/2 z-40 hidden lg:flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-900/85 backdrop-blur-xl border border-white/10 shadow-2xl text-3xl font-bold text-white pointer-events-none">
                {activeLetter}
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  )
}
