import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useGenres, useHomeLayout, useLatest, useViews } from '../api/queries'
import { saveHomeLayout, type HomeLayout } from '../api/client'
import type { JfItem } from '../api/types'
import HandoffBanner from '../components/HandoffBanner'
import TvFocusHero from '../components/TvFocusHero'
import { IS_TV } from '../lib/device'
import {
  BecauseRow,
  ComingSoonRow,
  GenreTilesRow,
  QueryRow,
  RecentlyAddedRow,
  TopTenRow,
  UpNextRow,
  WatchlistRow,
} from '../components/HomeRows'
import { RowControlsContext } from '../components/MediaRow'
import NowStage from '../components/os/NowStage'
import { useToast } from '../components/Toast'
import { browseHref } from './BrowsePage'
import { useAuth } from '../auth/AuthContext'
import { useFinesse } from '../lib/finesseServer'
import FriendRows from '../components/FriendRows'

const HOME_COLLECTIONS = new Set(['movies', 'tvshows'])
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
/** Genre tiles in the "Browse by genre" strip (genre *shelves* are opt-in). */
const MAX_GENRE_TILES = 12

interface RowDesc {
  key: string
  title: string
  render: (hideTitle: boolean) => ReactNode
}

function buildRows(
  movieLib: JfItem | undefined,
  showLib: JfItem | undefined,
  addedGenres: string[],
  tileGenres: string[],
): RowDesc[] {
  const movieTypes = 'Movie'
  const allTypes = 'Movie,Series'
  // Curated by default: about eight rows, not twenty. Genre *shelves* are
  // opt-in from Customize; by default genres are one strip of tiles.
  const rows: RowDesc[] = [
    // Phones and computers show it in the stage's Now row (components/os).
    ...(IS_TV ? [{ key: 'upNext', title: 'Up next for you', render: (h: boolean) => <UpNextRow hideTitle={h} /> }] : []),
    { key: 'comingSoon', title: 'Coming Soon', render: (h) => <ComingSoonRow hideTitle={h} /> },
    { key: 'watchlist', title: 'My List', render: (h) => <WatchlistRow hideTitle={h} /> },
    { key: 'topTen', title: 'Top 10 at home', render: (h) => <TopTenRow hideTitle={h} /> },
    { key: 'because', title: 'Because you watched…', render: (h) => <BecauseRow hideTitle={h} /> },
    { key: 'genres', title: 'Browse by genre', render: (h) => <GenreTilesRow genres={tileGenres} hideTitle={h} /> },
  ]
  if (movieLib || showLib) {
    rows.push({ key: 'recent', title: 'Recently added', render: (h) => <RecentlyAddedRow movieLibId={movieLib?.Id} showLibId={showLib?.Id} hideTitle={h} /> })
  }
  if (movieLib) {
    rows.push({ key: 'newToYou', title: 'New to You', render: (h) => <QueryRow label="newToYou" title="New to You" query={{ parentId: movieLib.Id, includeItemTypes: movieTypes, filters: 'IsUnplayed', sortBy: 'Random' }} seeAllHref={browseHref('New to You', { parentId: movieLib.Id, includeItemTypes: movieTypes, filters: 'IsUnplayed', sortBy: 'SortName' })} hideTitle={h} /> })
  }
  rows.push({ key: 'favorites', title: 'Favorites', render: (h) => <QueryRow label="favorites" title="Favorites" query={{ includeItemTypes: allTypes, filters: 'IsFavorite', sortBy: 'SortName' }} seeAllHref={browseHref('Favorites', { includeItemTypes: allTypes, filters: 'IsFavorite', sortBy: 'SortName' })} hideTitle={h} /> })
  rows.push({ key: 'anime', title: 'Anime', render: (h) => <QueryRow label="anime" title="Anime" query={{ tags: 'anime', includeItemTypes: allTypes, sortBy: 'Random' }} seeAllHref={browseHref('Anime', { tags: 'anime', includeItemTypes: allTypes, sortBy: 'SortName' })} hideTitle={h} /> })
  for (const g of addedGenres) {
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
  desc, customizing, collapsed, hidden, first, last, onMove, onToggleCollapse, onToggleHide, onCustomize,
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
  onCustomize: () => void
}) {
  const controls = useMemo(
    () => ({
      onHide: onToggleHide,
      onMoveUp: first ? undefined : () => onMove(-1),
      onMoveDown: last ? undefined : () => onMove(1),
      onCustomize,
    }),
    [onToggleHide, onMove, onCustomize, first, last],
  )
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

  // Each row's own header shows a ⋯ with these (hide / move / customize).
  return <RowControlsContext.Provider value={controls}>{desc.render(false)}</RowControlsContext.Provider>
}

/** Server unreachable: say so plainly, keep trying, and offer a retry — rather
 *  than an empty page of skeletons that never fill. */
function ServerDown({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="min-h-[calc(var(--vh)*70)] flex items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <p className="font-display text-4xl sm:text-5xl text-white">Can't reach your server</p>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-300">
          Finesse will keep trying. If you're away from home, your server's public address may work — switch it from the sign-in screen.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            data-autofocus
            className="inline-flex h-11 items-center rounded-lg bg-white px-5 text-sm font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-60 transition-colors"
          >
            {retrying ? 'Trying…' : 'Try again'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** A brand-new server: nothing to show yet, so say what to do instead of a blank page. */
function EmptyLibrary() {
  const { session } = useAuth()
  const { info } = useFinesse()
  const canRequest = Boolean(info?.features.requests)
  return (
    <div className={`${PAD} pt-16 sm:pt-24`}>
      <div className="card-in max-w-2xl">
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent-300">Welcome{session?.userName ? `, ${session.userName}` : ''}</p>
        <h1 className="mt-2 font-display text-5xl leading-[1.05] text-white sm:text-7xl">No movies or shows yet</h1>
        <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink-300">
          {canRequest
            ? 'Search for anything and press Request — Finesse finds it, downloads it and puts it here on its own.'
            : 'Add files to your server’s media folders and they’ll appear here within a minute or two.'}
          {session?.isAdmin ? ' You can also copy files you already have into the Movies, TV or Music folders (Settings → Server shows where).' : ''}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {canRequest && (
            <Link to="/request" data-autofocus className="inline-flex h-11 items-center rounded-full bg-accent-fill px-6 text-[15px] font-semibold text-white hover:brightness-110">
              Request something
            </Link>
          )}
          <Link to="/search" className="inline-flex h-11 items-center rounded-full bg-white/10 px-5 text-[15px] font-semibold text-white hover:bg-white/15">
            Search
          </Link>
          {session?.isAdmin && (
            <Link to="/settings#settings-server" className="inline-flex h-11 items-center rounded-full px-5 text-[15px] font-medium text-ink-200 hover:bg-white/[0.07] hover:text-white">
              Invite people
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  const { data: views, isLoading: viewsLoading, isError: viewsError, refetch: refetchViews, isFetching: viewsFetching } = useViews()
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
  const tileGenres = useMemo(() => {
    const present = new Set(allGenres)
    const preferred = PREFERRED_GENRES.filter((g) => present.has(g))
    return [...preferred, ...allGenres.filter((g) => !preferred.includes(g))].slice(0, MAX_GENRE_TILES)
  }, [allGenres])

  // ---- Layout (per account) ----
  const { data: serverLayout } = useHomeLayout()
  const [draft, setDraft] = useState<HomeLayout | null>(null)
  const layout = draft ?? serverLayout ?? { hidden: [], collapsed: [], order: [], added: [] }
  const [customizing, setCustomizing] = useState(false)
  const toast = useToast()

  // Persist edits (debounced), and keep the cache in sync.
  useEffect(() => {
    if (!draft) return
    const t = setTimeout(() => {
      saveHomeLayout(draft).catch(() => {})
      queryClient.setQueryData(['homeLayout'], draft)
    }, 700)
    return () => clearTimeout(t)
  }, [draft, queryClient])

  const shownGenres = layout.added
  const allRows = useMemo(() => buildRows(movieLib, showLib, layout.added, tileGenres), [movieLib, showLib, layout.added, tileGenres])

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

  if (viewsError && !views) {
    return <ServerDown onRetry={() => refetchViews()} retrying={viewsFetching} />
  }

  return (
    <div className="pb-16">
      <div className="aurora" aria-hidden><div /><div /><div /></div>

      {/* TV: a focus-driven hero (describes whatever the remote rests on);
          elsewhere the 2.0 stage, with everything that's "now" in the house. */}
      {IS_TV ? <TvFocusHero initial={heroItems[0]} /> : <NowStage />}

      {IS_TV && <HandoffBanner />}

      {!IS_TV && !customizing && !heroLoading && !moviesLoading && !showsLoading && !(latestMovies?.length ?? 0) && !(latestShows?.length ?? 0) && <EmptyLibrary />}

      <div className={`mt-6 sm:mt-8 ${customizing ? `${PAD} space-y-2` : 'space-y-8 sm:space-y-10'}`}>
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
            onToggleHide={() => {
              const hiding = !layout.hidden.includes(r.key)
              toggle('hidden', r.key)
              if (hiding && !customizing) toast(`Hid “${r.title}”. Bring it back from Customize Home.`)
            }}
            onCustomize={() => {
              setCustomizing(true)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
        ))}

        {!customizing && <FriendRows />}

        {customizing && availableGenres.length > 0 && (
          <div className="rounded-xl border border-dashed border-white/10 p-4">
            <p className="text-sm font-semibold text-ink-200 mb-2">Add a category</p>
            <div className="flex flex-wrap gap-2">
              {availableGenres.map((g) => (
                <button key={g} onClick={() => addGenre(g)} className="rounded-full bg-white/5 hover:bg-accent-fill px-3 py-1.5 text-xs font-medium text-ink-200 hover:text-white transition-colors">
                  + {g}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Customize lives at the end: a once-in-a-while action shouldn't push
          Continue Watching below the fold on phones. */}
      <div
        className={`${PAD} mt-12 flex items-center justify-center gap-2 ${
          customizing ? 'sticky bottom-24 md:bottom-6 z-30 py-2' : ''
        }`}
      >
        {customizing && (
          <button onClick={resetLayout} className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-400 hover:text-white transition-colors">
            Reset
          </button>
        )}
        <button
          onClick={() => setCustomizing((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${customizing ? 'bg-accent-fill text-white hover:brightness-110' : 'bg-white/5 text-ink-400 hover:text-white hover:bg-white/10'}`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.03 7.03 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.93 6.93 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          {customizing ? 'Done' : 'Customize Home'}
        </button>
      </div>
    </div>
  )
}
