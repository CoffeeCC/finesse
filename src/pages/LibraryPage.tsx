import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useQuery } from '@tanstack/react-query'
import * as api from '../api/client'
import {
  itemTypesForCollection,
  useItemPages,
  useLibraryIndex,
  useViews,
} from '../api/queries'
import MediaCard from '../components/MediaCard'
import AlphabetRail from '../components/AlphabetRail'
import { CardSkeleton } from '../components/Skeletons'

const GAP = 16
const TEXT_BLOCK = 56
const ROW_GAP = 8
const NAV_OFFSET = 88

const SORT_OPTIONS = [
  { label: 'Name', sortBy: 'SortName', sortOrder: 'Ascending' },
  { label: 'Recently Added', sortBy: 'DateCreated,SortName', sortOrder: 'Descending' },
  { label: 'Release Year', sortBy: 'ProductionYear,SortName', sortOrder: 'Descending' },
  { label: 'Rating', sortBy: 'CommunityRating,SortName', sortOrder: 'Descending' },
]

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
  const { data: views } = useViews()
  const view = views?.Items.find((v) => v.Id === viewId)
  const includeItemTypes = itemTypesForCollection(view?.CollectionType)

  const [sortIdx, setSortIdx] = useState(0)
  const [filter, setFilter] = useState('')
  const debouncedFilter = useDebounced(filter, 300)
  const sort = SORT_OPTIONS[sortIdx]
  const isNameSort = sortIdx === 0

  // Reset filter when switching libraries
  useEffect(() => {
    setFilter('')
    setSortIdx(0)
  }, [viewId])

  const { data: index } = useLibraryIndex(viewId, includeItemTypes)
  const total = index?.total ?? 0

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

  const columns = Math.max(2, Math.floor((gridWidth + GAP) / (180 + GAP)))
  const cardWidth = columns > 0 ? (gridWidth - (columns - 1) * GAP) / columns : 180
  const rowHeight = cardWidth * 1.5 + TEXT_BLOCK + ROW_GAP
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
    <div className="px-6 lg:px-12 pb-16">
      <div className="flex flex-wrap items-center gap-4 py-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">{view?.Name ?? 'Library'}</h1>
        {total > 0 && <span className="text-sm text-ink-400">{total.toLocaleString()} items</span>}
        <div className="flex-1" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${view?.Name?.toLowerCase() ?? ''}…`}
          className="w-52 rounded-full bg-ink-800/80 border border-white/10 px-4 py-1.5 text-sm outline-none focus:border-accent-500 placeholder:text-ink-400"
        />
        <select
          value={sortIdx}
          onChange={(e) => setSortIdx(Number(e.target.value))}
          className="rounded-full bg-ink-800/80 border border-white/10 px-3 py-1.5 text-sm outline-none focus:border-accent-500 text-ink-200"
        >
          {SORT_OPTIONS.map((opt, i) => (
            <option key={opt.label} value={i}>
              Sort: {opt.label}
            </option>
          ))}
        </select>
      </div>

      {searching ? (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(180px, 1fr))` }}
        >
          {searchLoading
            ? Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)
            : searchResults?.Items.map((item) => <MediaCard key={item.Id} item={item} />)}
          {!searchLoading && searchResults?.Items.length === 0 && (
            <p className="col-span-full text-ink-400 py-12 text-center">
              Nothing matches “{debouncedFilter}”
            </p>
          )}
        </div>
      ) : (
        <>
          <div ref={gridRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {gridWidth > 0 &&
              virtualRows.map((vRow) => (
                <div
                  key={vRow.key}
                  className="absolute left-0 w-full flex gap-4"
                  style={{ transform: `translateY(${vRow.start - scrollMargin}px)` }}
                >
                  {Array.from({ length: columns }).map((_, col) => {
                    const itemIndex = vRow.index * columns + col
                    if (itemIndex >= total) return <div key={col} style={{ width: cardWidth }} />
                    const item = itemMap.get(itemIndex)
                    return item ? (
                      <MediaCard key={item.Id} item={item} width={cardWidth} />
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
        </>
      )}
    </div>
  )
}
