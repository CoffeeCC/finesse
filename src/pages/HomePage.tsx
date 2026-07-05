import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useGenres, useHomeLayout, useLatest, useViews } from '../api/queries'
import { backdropUrl, logoUrl, saveHomeLayout, type HomeLayout } from '../api/client'
import { formatRuntime } from '../api/types'
import type { JfItem } from '../api/types'
import { HeroSkeleton } from '../components/Skeletons'
import HandoffBanner from '../components/HandoffBanner'
import {
  BecauseRow,
  ComingSoonRow,
  LatestRow,
  NextUpRow,
  QueryRow,
  ResumeRow,
  WatchlistRow,
} from '../components/HomeRows'
import { browseHref } from './BrowsePage'

const HOME_COLLECTIONS = new Set(['movies', 'tvshows'])
const HERO_ROTATE_MS = 9000
const HERO_COUNT = 5

// Fixed at module load = once per app launch.
const LAUNCH_SEED = Math.random()

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr]
  let s = Math.floor(seed * 2147483647) || 1
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const PREFERRED_GENRES = [
  'Action', 'Animation', 'Comedy', 'Science Fiction', 'Horror',
  'Fantasy', 'Adventure', 'Drama', 'Thriller', 'Family',
]
const MAX_GENRE_ROWS = 5

function HeroCarousel({ items }: { items: JfItem[] }) {
  const [index, setIndex] = useState(0)
  const active = items[index]

  useEffect(() => {
    if (items.length < 2) return
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), HERO_ROTATE_MS)
    return () => clearInterval(t)
  }, [items.length])

  const logo = logoUrl(active)

  return (
    <div className="relative h-[52vh] min-h-[360px] md:h-[68vh] md:min-h-[460px] w-full -mt-16 overflow-hidden">
      {items.map((item, i) => {
        const backdrop = backdropUrl(item)
        return (
          <div key={item.Id} className="absolute inset-0 transition-opacity duration-1000 ease-out" style={{ opacity: i === index ? 1 : 0 }}>
            {backdrop && (
              <img key={i === index ? `active-${index}` : `idle-${i}`} src={backdrop} alt="" className={`h-full w-full object-cover ${i === index ? 'kenburns' : ''}`} />
            )}
          </div>
        )
      })}

      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/25 to-ink-950/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/85 via-ink-950/20 to-transparent" />

      <div key={active.Id} className="absolute bottom-0 left-0 p-6 lg:p-12 max-w-2xl hero-content-in">
        {logo ? (
          <img src={logo} alt={active.Name} className="max-h-28 max-w-md object-contain mb-4 drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)]" />
        ) : (
          <h1 className="text-4xl lg:text-6xl font-bold text-white tracking-tight mb-3 drop-shadow-lg">{active.Name}</h1>
        )}
        <div className="flex items-center gap-3 text-sm text-ink-200 mb-4">
          {active.ProductionYear && <span>{active.ProductionYear}</span>}
          {active.RunTimeTicks && <span>{formatRuntime(active.RunTimeTicks)}</span>}
          {active.OfficialRating && <span className="px-1.5 py-0.5 rounded border border-white/20 text-xs">{active.OfficialRating}</span>}
          {active.CommunityRating && (
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
              {active.CommunityRating.toFixed(1)}
            </span>
          )}
        </div>
        {active.Overview && <p className="hidden sm:block text-sm text-ink-200/90 line-clamp-3 mb-6 max-w-xl drop-shadow">{active.Overview}</p>}
        <div className="flex gap-3">
          <Link to={`/play/${active.Id}`} className="inline-flex items-center gap-2 rounded-lg bg-white text-ink-950 px-6 py-2.5 text-sm font-semibold hover:bg-ink-200 hover:shadow-[0_0_28px_rgba(255,255,255,0.25)] active:scale-[0.97] transition-all">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            Play
          </Link>
          <Link to={`/item/${active.Id}`} className="inline-flex items-center gap-2 rounded-lg bg-white/10 backdrop-blur-md px-6 py-2.5 text-sm font-semibold text-white hover:bg-white/20 active:scale-[0.97] transition-all">
            More info
          </Link>
        </div>
      </div>

      {items.length > 1 && (
        <div className="absolute bottom-6 right-6 lg:right-12 flex gap-2">
          {items.map((_, i) => (
            <button key={i} onClick={() => setIndex(i)} aria-label={`Show featured item ${i + 1}`} className={`h-1.5 rounded-full transition-all duration-300 active:scale-90 ${i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'}`} />
          ))}
        </div>
      )}
    </div>
  )
}

interface RowDesc {
  key: string
  title: string
  render: (hideTitle: boolean) => ReactNode
}

function buildRows(movieLib: JfItem | undefined, showLib: JfItem | undefined, genres: string[]): RowDesc[] {
  const movieTypes = 'Movie'
  const allTypes = 'Movie,Series'
  const rows: RowDesc[] = [
    { key: 'comingSoon', title: 'Coming Soon', render: (h) => <ComingSoonRow hideTitle={h} /> },
    { key: 'resume', title: 'Continue Watching', render: (h) => <ResumeRow hideTitle={h} /> },
    { key: 'nextUp', title: 'Next Up', render: (h) => <NextUpRow hideTitle={h} /> },
    { key: 'watchlist', title: 'Your Watchlist', render: (h) => <WatchlistRow hideTitle={h} /> },
    { key: 'because', title: 'Because you watched…', render: (h) => <BecauseRow hideTitle={h} /> },
  ]
  if (movieLib) rows.push({ key: 'latestMovies', title: `Recently Added · ${movieLib.Name}`, render: (h) => <LatestRow parentId={movieLib.Id} title={`Recently Added · ${movieLib.Name}`} hideTitle={h} /> })
  if (showLib) rows.push({ key: 'latestShows', title: `Recently Added · ${showLib.Name}`, render: (h) => <LatestRow parentId={showLib.Id} title={`Recently Added · ${showLib.Name}`} hideTitle={h} /> })
  rows.push({ key: 'favorites', title: 'Favorites', render: (h) => <QueryRow label="favorites" title="Favorites" query={{ includeItemTypes: allTypes, filters: 'IsFavorite', sortBy: 'SortName' }} seeAllHref={browseHref('Favorites', { includeItemTypes: allTypes, filters: 'IsFavorite', sortBy: 'SortName' })} hideTitle={h} /> })
  if (movieLib) {
    rows.push({ key: 'topRated', title: 'Top Rated', render: (h) => <QueryRow label="topRated" title="Top Rated" query={{ parentId: movieLib.Id, includeItemTypes: movieTypes, sortBy: 'CommunityRating', sortOrder: 'Descending' }} seeAllHref={browseHref('Top Rated', { parentId: movieLib.Id, includeItemTypes: movieTypes, sortBy: 'CommunityRating', sortOrder: 'Descending' })} hideTitle={h} /> })
    rows.push({ key: 'newToYou', title: 'New to You', render: (h) => <QueryRow label="newToYou" title="New to You" query={{ parentId: movieLib.Id, includeItemTypes: movieTypes, filters: 'IsUnplayed', sortBy: 'Random' }} seeAllHref={browseHref('New to You', { parentId: movieLib.Id, includeItemTypes: movieTypes, filters: 'IsUnplayed', sortBy: 'SortName' })} hideTitle={h} /> })
  }
  rows.push({ key: 'anime', title: 'Anime', render: (h) => <QueryRow label="anime" title="Anime" query={{ tags: 'anime', includeItemTypes: allTypes, sortBy: 'Random' }} seeAllHref={browseHref('Anime', { tags: 'anime', includeItemTypes: allTypes, sortBy: 'SortName' })} hideTitle={h} /> })
  for (const g of genres) {
    if (!movieLib) break
    rows.push({ key: `genre-${g}`, title: g, render: (h) => <QueryRow label={`genre-${g}`} title={g} query={{ parentId: movieLib.Id, includeItemTypes: movieTypes, genres: g, sortBy: 'Random' }} seeAllHref={browseHref(g, { parentId: movieLib.Id, includeItemTypes: movieTypes, genres: g, sortBy: 'SortName' })} hideTitle={h} /> })
  }
  if (movieLib) {
    rows.push({ key: 'nineties', title: 'Throwback: the ’90s', render: (h) => <QueryRow label="nineties" title="Throwback: the ’90s" query={{ parentId: movieLib.Id, includeItemTypes: movieTypes, years: '1990,1991,1992,1993,1994,1995,1996,1997,1998,1999', sortBy: 'Random' }} seeAllHref={browseHref('Throwback: the ’90s', { parentId: movieLib.Id, includeItemTypes: movieTypes, years: '1990,1991,1992,1993,1994,1995,1996,1997,1998,1999', sortBy: 'ProductionYear,SortName' })} hideTitle={h} /> })
    rows.push({ key: 'watchAgain', title: 'Watch It Again', render: (h) => <QueryRow label="watchAgain" title="Watch It Again" query={{ parentId: movieLib.Id, includeItemTypes: movieTypes, filters: 'IsPlayed', sortBy: 'Random' }} seeAllHref={browseHref('Watch It Again', { parentId: movieLib.Id, includeItemTypes: movieTypes, filters: 'IsPlayed', sortBy: 'SortName' })} hideTitle={h} /> })
  }
  return rows
}

const PAD = 'px-4 sm:px-6 lg:px-12'

function RowFrame({
  desc, customizing, collapsed, hidden, first, last, onMove, onToggleCollapse, onToggleHide,
}: {
  desc: RowDesc
  customizing: boolean
  collapsed: boolean
  hidden: boolean
  first: boolean
  last: boolean
  onMove: (dir: number) => void
  onToggleCollapse: () => void
  onToggleHide: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  if (customizing) {
    const ctrl = 'h-7 px-2 rounded-md bg-white/5 hover:bg-white/15 text-xs font-medium text-ink-200 disabled:opacity-30 transition-colors'
    return (
      <div className={`rounded-xl border border-dashed border-white/10 overflow-hidden ${hidden ? 'opacity-50' : ''}`}>
        <div className={`flex items-center gap-1.5 py-2 ${PAD} bg-white/[0.03]`}>
          <span className="flex-1 text-sm font-semibold text-ink-200 truncate">{desc.title}</span>
          <button className={ctrl} onClick={() => onMove(-1)} disabled={first} aria-label="Move up">↑</button>
          <button className={ctrl} onClick={() => onMove(1)} disabled={last} aria-label="Move down">↓</button>
          <button className={ctrl} onClick={onToggleCollapse}>{collapsed ? 'Collapsed' : 'Collapse'}</button>
          <button className={`${ctrl} ${hidden ? 'text-accent-300' : ''}`} onClick={onToggleHide}>{hidden ? 'Hidden' : 'Hide'}</button>
        </div>
      </div>
    )
  }

  if (hidden) return null

  if (collapsed) {
    return (
      <section>
        <button onClick={() => setExpanded((e) => !e)} className={`w-full flex items-center justify-between ${PAD} py-2 text-left`}>
          <h2 className="text-lg font-semibold text-white tracking-tight">{desc.title}</h2>
          <svg className={`h-5 w-5 text-ink-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {expanded && desc.render(true)}
      </section>
    )
  }

  return <>{desc.render(false)}</>
}

export default function HomePage() {
  const { data: views, isLoading: viewsLoading } = useViews()
  const queryClient = useQueryClient()

  const libraries = useMemo(
    () => views?.Items.filter((v) => HOME_COLLECTIONS.has(v.CollectionType ?? '')) ?? [],
    [views],
  )
  const movieLib = libraries.find((l) => l.CollectionType === 'movies')
  const showLib = libraries.find((l) => l.CollectionType === 'tvshows')

  const { data: latestMovies, isLoading: moviesLoading } = useLatest(movieLib?.Id)
  const { data: latestShows, isLoading: showsLoading } = useLatest(showLib?.Id)
  const heroItems = useMemo(() => {
    const candidates = [...(latestMovies ?? []), ...(latestShows ?? [])]
    // Shuffled with a per-launch seed: a fresh hero lineup every time the app
    // starts, but stable while navigating around within a session.
    return seededShuffle(candidates.filter((i) => i.BackdropImageTags?.length), LAUNCH_SEED).slice(0, HERO_COUNT)
  }, [latestMovies, latestShows])
  const heroLoading = viewsLoading || (moviesLoading && showsLoading)

  const { data: genreList } = useGenres(movieLib?.Id)
  const allGenres = useMemo(() => genreList?.Items.map((g) => g.Name) ?? [], [genreList])
  const defaultGenres = useMemo(() => {
    const present = new Set(allGenres)
    return PREFERRED_GENRES.filter((g) => present.has(g)).slice(0, MAX_GENRE_ROWS)
  }, [allGenres])

  // ---- Layout (per account) ----
  const { data: serverLayout } = useHomeLayout()
  const [draft, setDraft] = useState<HomeLayout | null>(null)
  const layout = draft ?? serverLayout ?? { hidden: [], collapsed: [], order: [], added: [] }
  const [customizing, setCustomizing] = useState(false)

  // Persist edits (debounced), and keep the cache in sync.
  useEffect(() => {
    if (!draft) return
    const t = setTimeout(() => {
      saveHomeLayout(draft).catch(() => {})
      queryClient.setQueryData(['homeLayout'], draft)
    }, 700)
    return () => clearTimeout(t)
  }, [draft, queryClient])

  const shownGenres = useMemo(() => [...new Set([...defaultGenres, ...layout.added])], [defaultGenres, layout.added])
  const allRows = useMemo(() => buildRows(movieLib, showLib, shownGenres), [movieLib, showLib, shownGenres])

  const orderedKeys = useMemo(() => {
    const keys = allRows.map((r) => r.key)
    const inOrder = layout.order.filter((k) => keys.includes(k))
    const rest = keys.filter((k) => !layout.order.includes(k))
    return [...inOrder, ...rest]
  }, [allRows, layout.order])

  const byKey = useMemo(() => new Map(allRows.map((r) => [r.key, r])), [allRows])
  const orderedRows = orderedKeys.map((k) => byKey.get(k)!).filter(Boolean)
  const visibleRows = customizing ? orderedRows : orderedRows.filter((r) => !layout.hidden.includes(r.key))

  const move = (key: string, dir: number) => {
    const keys = orderedKeys.slice()
    const i = keys.indexOf(key)
    const j = i + dir
    if (j < 0 || j >= keys.length) return
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
    setDraft({ ...layout, order: keys })
  }
  const toggle = (list: keyof HomeLayout, key: string) => {
    const cur = layout[list] as string[]
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
    setDraft({ ...layout, [list]: next })
  }
  const addGenre = (g: string) => setDraft({ ...layout, added: [...layout.added, g] })
  const resetLayout = () => setDraft({ hidden: [], collapsed: [], order: [], added: [] })

  const availableGenres = allGenres.filter((g) => !shownGenres.includes(g))

  return (
    <div className="pb-16">
      <div className="aurora" aria-hidden><div /><div /><div /></div>

      {heroLoading ? <HeroSkeleton /> : heroItems.length > 0 ? <HeroCarousel items={heroItems} /> : null}

      <HandoffBanner />

      {/* Customize toggle */}
      <div className={`${PAD} mt-8 flex items-center justify-end gap-2`}>
        {customizing && (
          <button onClick={resetLayout} className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-400 hover:text-white transition-colors">
            Reset
          </button>
        )}
        <button
          onClick={() => setCustomizing((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${customizing ? 'bg-accent-600 text-white hover:bg-accent-500' : 'bg-white/10 text-ink-200 hover:bg-white/20'}`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.03 7.03 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.93 6.93 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          {customizing ? 'Done' : 'Customize'}
        </button>
      </div>

      <div className={`mt-2 ${customizing ? `${PAD} space-y-2` : 'space-y-10'}`}>
        {visibleRows.map((r, i) => (
          <RowFrame
            key={r.key}
            desc={r}
            customizing={customizing}
            collapsed={layout.collapsed.includes(r.key)}
            hidden={layout.hidden.includes(r.key)}
            first={i === 0}
            last={i === visibleRows.length - 1}
            onMove={(dir) => move(r.key, dir)}
            onToggleCollapse={() => toggle('collapsed', r.key)}
            onToggleHide={() => toggle('hidden', r.key)}
          />
        ))}

        {customizing && availableGenres.length > 0 && (
          <div className="rounded-xl border border-dashed border-white/10 p-4">
            <p className="text-sm font-semibold text-ink-200 mb-2">Add a category</p>
            <div className="flex flex-wrap gap-2">
              {availableGenres.map((g) => (
                <button key={g} onClick={() => addGenre(g)} className="rounded-full bg-white/5 hover:bg-accent-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:text-white transition-colors">
                  + {g}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
