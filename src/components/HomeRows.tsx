import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import MediaRow, { RowHeader, ROW_SCROLLER, useRevealOnce } from './MediaRow'
import DownloadsSection from './DownloadsSection'
import {
  useBecauseYouWatched,
  useItemsRow,
  useLatest,
  useMostWatchedAtHome,
  useNextUp,
  useResume,
  useWatchlistItems,
} from '../api/queries'
import * as api from '../api/client'
import type { ItemsQuery } from '../api/client'
import type { JfItem } from '../api/types'
import { browseHref } from '../pages/BrowsePage'

// Each home row is self-contained — it fetches its own data and renders a
// MediaRow (which renders nothing when empty). That lets HomePage render an
// arbitrary, reorderable list of rows without violating React's hook rules.
// `hideTitle` is set when an outer collapse-frame already shows the title.

/** Discovery shelves with fewer titles than this fold away (a one-title
 *  "Watch it again" shelf looked broken, not curated). */
const MIN_SHELF = 4

export function ComingSoonRow({ hideTitle }: { hideTitle?: boolean }) {
  return (
    <div className="px-4 sm:px-6 lg:px-12">
      <DownloadsSection title={hideTitle ? '' : 'Coming Soon'} limit={6} />
    </div>
  )
}

/** "Up next for you": what you're partway through, then the next episode of
 *  every show you're following — one card per show (Continue Watching and
 *  Next Up used to list the same series twice, side by side). */
export function UpNextRow({ hideTitle }: { hideTitle?: boolean }) {
  const resume = useResume()
  const nextUp = useNextUp()
  const qc = useQueryClient()

  const items = useMemo(() => {
    const out: JfItem[] = []
    const shows = new Set<string>()
    const add = (i: JfItem) => {
      const key = i.Type === 'Episode' ? i.SeriesId ?? i.Id : i.Id
      if (shows.has(key)) return
      shows.add(key)
      out.push(i)
    }
    resume.data?.Items.forEach(add)
    nextUp.data?.Items.forEach(add)
    return out
  }, [resume.data, nextUp.data])

  const dismiss = async (item: JfItem) => {
    // Optimistic: pull the card immediately, then confirm with the server.
    qc.setQueryData(['resume'], (prev: typeof resume.data) =>
      prev ? { ...prev, Items: prev.Items.filter((i) => i.Id !== item.Id) } : prev,
    )
    try {
      await api.clearResumePosition(item.Id)
    } finally {
      qc.invalidateQueries({ queryKey: ['resume'] })
      qc.invalidateQueries({ queryKey: ['nextUp'] })
    }
  }

  return (
    <MediaRow
      title="Up next for you"
      items={items}
      loading={resume.isLoading || nextUp.isLoading}
      hideTitle={hideTitle}
      onDismissItem={dismiss}
      // Only a resume point can be cleared; a next episode just is next.
      canDismiss={(i) => !!i.UserData?.PlaybackPositionTicks}
      variant="wide"
    />
  )
}

export function WatchlistRow({ hideTitle }: { hideTitle?: boolean }) {
  const { data, isLoading } = useWatchlistItems()
  return <MediaRow title="My List" items={data} loading={isLoading} seeAllHref="/mylist" hideTitle={hideTitle} />
}

export function BecauseRow({ hideTitle }: { hideTitle?: boolean }) {
  const because = useBecauseYouWatched()
  if (!because.seedName) return null
  return (
    <MediaRow
      title={
        <>
          Because you watched <span className="not-italic text-accent-300">{because.seedName}</span>
        </>
      }
      items={because.items}
      loading={because.loading}
      hideTitle={hideTitle}
      minItems={MIN_SHELF}
    />
  )
}

/** Top 10 with big numerals — what the household has watched most (hours,
 *  across every profile; see api.getMostWatchedAtHome). */
export function TopTenRow({ hideTitle }: { hideTitle?: boolean }) {
  const { data, isLoading } = useMostWatchedAtHome()
  return (
    <MediaRow
      title="Top 10 at home"
      items={data}
      loading={isLoading}
      hideTitle={hideTitle}
      variant="ranked"
      minItems={5}
    />
  )
}

/** One "Recently added" shelf with an All / Movies / Shows switch, instead of
 *  a shelf per library. */
export function RecentlyAddedRow({
  movieLibId,
  showLibId,
  hideTitle,
}: {
  movieLibId?: string
  showLibId?: string
  hideTitle?: boolean
}) {
  const [tab, setTab] = useState<'all' | 'movies' | 'shows'>('all')
  const movies = useLatest(movieLibId)
  const shows = useLatest(showLibId)

  const items = useMemo(() => {
    if (tab === 'movies') return movies.data
    if (tab === 'shows') return shows.data
    // Both lists are newest-first; interleave so neither library buries the other.
    const a = movies.data ?? []
    const b = shows.data ?? []
    const out: JfItem[] = []
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) out.push(a[i])
      if (b[i]) out.push(b[i])
    }
    return out
  }, [tab, movies.data, shows.data])

  const both = !!movieLibId && !!showLibId
  const seg = (t: typeof tab, label: string) => (
    <button
      type="button"
      aria-pressed={tab === t}
      onClick={() => setTab(t)}
      className={`h-7 px-3 rounded-full text-xs transition-colors ${
        tab === t ? 'bg-white text-ink-950 font-semibold' : 'text-ink-200 hover:text-white font-medium'
      }`}
    >
      {label}
    </button>
  )

  return (
    <MediaRow
      title="Recently added"
      items={items}
      loading={(movies.isLoading && !!movieLibId) || (shows.isLoading && !!showLibId)}
      hideTitle={hideTitle}
      headerExtra={
        both ? (
          <div role="group" aria-label="Show" className="inline-flex shrink-0 p-0.5 rounded-full bg-ink-900 border border-white/10">
            {seg('all', 'All')}
            {seg('movies', 'Movies')}
            {seg('shows', 'Shows')}
          </div>
        ) : undefined
      }
    />
  )
}

/** Genres as a strip of tiles (each with a random title's art) instead of a
 *  dozen identical poster shelves. */
export function GenreTilesRow({ genres, hideTitle }: { genres: string[]; hideTitle?: boolean }) {
  const [ref, visible] = useRevealOnce<HTMLElement>()
  const arts = useQueries({
    queries: genres.map((g) => ({
      queryKey: ['genreArt', g],
      staleTime: 30 * 60_000,
      queryFn: async () => {
        const res = await api.getItems({
          genres: g,
          includeItemTypes: 'Movie,Series',
          recursive: true,
          sortBy: 'Random',
          limit: 4,
          fields: '',
        })
        const hit = res.Items.find((i) => i.BackdropImageTags?.length)
        return hit ? api.imageUrl(hit.Id, 'Backdrop', { maxWidth: 480, tag: hit.BackdropImageTags![0] }) : null
      },
    })),
  })
  if (genres.length === 0) return null
  const hue = (g: string) => [...g].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

  return (
    <section ref={ref} className={`depth-row group/row relative reveal ${visible ? 'is-visible' : ''}`}>
      {!hideTitle && <RowHeader title="Browse by genre" />}
      <div className={ROW_SCROLLER}>
        {genres.map((g, i) => {
          const art = arts[i]?.data
          return (
            <Link
              key={g}
              to={browseHref(g, { includeItemTypes: 'Movie,Series', genres: g, sortBy: 'SortName' })}
              className="group relative shrink-0 snap-start h-24 w-44 sm:h-28 sm:w-56 rounded-xl overflow-hidden ring-1 ring-white/5 hover:ring-accent-400/70 focus-visible:ring-2 focus-visible:ring-accent-400 outline-none transition-all"
              style={{ background: `hsl(${hue(g)}, 32%, 26%)` }}
            >
              {art && <img src={art} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-60 group-hover:opacity-80 group-hover:scale-105 transition-all duration-500 fade-in" />}
              <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <span className="absolute left-3 bottom-2.5 font-display text-2xl sm:text-[1.7rem] leading-none text-white">{g}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

export function QueryRow({
  label,
  title,
  query,
  seeAllHref,
  hideTitle,
  minItems = MIN_SHELF,
}: {
  label: string
  title: string
  query: ItemsQuery | null
  seeAllHref?: string
  hideTitle?: boolean
  minItems?: number
}) {
  const { data, isLoading } = useItemsRow(label, query)
  return (
    <MediaRow
      title={title}
      items={data?.Items}
      loading={isLoading}
      seeAllHref={seeAllHref}
      hideTitle={hideTitle}
      minItems={minItems}
    />
  )
}
