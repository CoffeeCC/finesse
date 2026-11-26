import { useMemo, useRef, useState } from 'react'
import { useAlbums, useItemsRow, useViews } from '../api/queries'
import * as api from '../api/client'
import { useAudio } from '../audio/AudioPlayerContext'
import AlbumCard from '../components/AlbumCard'
import { FriendMusicRows, useFriendMusic } from '../components/FriendAlbums'
import { SelectMenu } from '../components/Menu'
import { ROW_SCROLLER } from '../components/MediaRow'
import type { JfItem } from '../api/types'
import { useToast } from '../components/Toast'

type Sort = 'title' | 'artist' | 'year' | 'added'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'year', label: 'Year' },
  { value: 'added', label: 'Recently added' },
]
const SORT_KEY = 'finesse.musicSort'

function AlbumSkeleton() {
  return (
    <div className="shrink-0">
      <div className="aspect-square rounded-xl shimmer" />
      <div className="mt-2 h-4 w-3/4 rounded shimmer" />
      <div className="mt-1.5 h-3 w-1/2 rounded shimmer" />
    </div>
  )
}

function sortAlbums(list: JfItem[], sort: Sort): JfItem[] {
  const by = (f: (a: JfItem) => string | number, desc = false) =>
    list.slice().sort((a, b) => {
      const x = f(a)
      const y = f(b)
      const c = x < y ? -1 : x > y ? 1 : 0
      return desc ? -c : c
    })
  if (sort === 'artist') {
    return by((a) => `${a.AlbumArtist?.trim().toLowerCase() || '\uffff'} ${String(a.ProductionYear ?? 0).padStart(4, '0')} ${a.Name.toLowerCase()}`)
  }
  if (sort === 'year') return by((a) => a.ProductionYear ?? 0, true)
  if (sort === 'added') return by((a) => a.DateCreated ?? '', true)
  return list
}

const ARROW = 'h-8 w-8 rounded-full bg-ink-800 hover:bg-ink-700 flex items-center justify-center text-ink-200 transition-colors'

export default function MusicPage() {
  const { data: views, isError: viewsError, refetch: refetchViews } = useViews()
  const musicView = views?.Items.find((v) => v.CollectionType === 'music')
  // Someone may have no music of their own but listen to a friend's (Groups).
  const ownMusic = !views || !!musicView
  const friendMusic = useFriendMusic()
  const { data: albums, isLoading, isError: albumsError, refetch: refetchAlbums } = useAlbums(musicView?.Id)
  const { data: recent } = useItemsRow(
    'music-recent',
    musicView ? { parentId: musicView.Id, includeItemTypes: 'MusicAlbum', sortBy: 'DateCreated', sortOrder: 'Descending', limit: 12 } : null,
  )
  const { playQueue } = useAudio()
  const toast = useToast()
  const recentRef = useRef<HTMLDivElement>(null)
  const [shuffling, setShuffling] = useState(false)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<Sort>(() => {
    try {
      // A stored value from an older build (or a hand edit) falls back to Title, not to no sort.
      const v = localStorage.getItem(SORT_KEY)
      return SORTS.some((x) => x.value === v) ? (v as Sort) : 'title'
    } catch {
      return 'title'
    }
  })
  const chooseSort = (s: Sort) => {
    setSort(s)
    try {
      localStorage.setItem(SORT_KEY, s)
    } catch {
      /* private mode */
    }
  }
  const sorted = useMemo(() => sortAlbums(albums?.Items ?? [], sort), [albums, sort])
  const needle = filter.trim().toLowerCase()
  const visible = useMemo(
    () =>
      needle
        ? sorted.filter(
            (a) =>
              a.Name.toLowerCase().includes(needle) ||
              (a.AlbumArtist ?? '').toLowerCase().includes(needle),
          )
        : sorted,
    [sorted, needle],
  )

  const scrollRecent = (dir: number) => {
    recentRef.current?.scrollBy({ left: dir * recentRef.current.clientWidth * 0.8, behavior: 'smooth' })
  }

  const shuffleAll = async () => {
    if (!musicView) return
    if (shuffling) return
    setShuffling(true)
    try {
      const res = await api.getItems({ parentId: musicView.Id, includeItemTypes: 'Audio', recursive: true, sortBy: 'Random', limit: 200 })
      if (res.Items.length) playQueue(res.Items, 0, { shuffle: true })
      else toast('There are no songs to shuffle yet')
    } catch {
      toast('Couldn’t start shuffling. Try again in a moment.', 'error')
    } finally {
      setShuffling(false)
    }
  }

  const totalCount = albums?.TotalRecordCount ?? 0
  const failed = (viewsError && !views) || (albumsError && !albums)

  return (
    <div className="pt-8 pb-24">
      <div className="px-4 sm:px-6 lg:px-12 flex flex-wrap items-center gap-x-4 gap-y-3 mb-8">
        <div className="flex items-baseline gap-3 mr-auto">
          <h1 className="page-title">Music</h1>
          {albums && (
            <span className="text-sm text-ink-400">
              {needle
                ? `${visible.length.toLocaleString()} of ${totalCount.toLocaleString()} ${totalCount === 1 ? 'album' : 'albums'}`
                : `${totalCount.toLocaleString()} ${totalCount === 1 ? 'album' : 'albums'}`}
            </span>
          )}
        </div>
        {ownMusic && (
          <div className="flex w-full sm:w-auto items-center gap-2">
            <div className="relative flex-1 min-w-0 sm:flex-none sm:w-52">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter albums or artists…"
                aria-label="Filter albums or artists"
                enterKeyHint="search"
                className="w-full h-10 rounded-full bg-ink-800/80 border border-white/10 pl-4 pr-8 text-sm outline-none focus:border-accent-500 placeholder:text-ink-400"
              />
              {filter && (
                <button
                  type="button"
                  onClick={() => setFilter('')}
                  aria-label="Clear filter"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full flex items-center justify-center text-ink-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => void shuffleAll()}
              disabled={!musicView || shuffling}
              className="shrink-0 inline-flex h-10 items-center gap-2 rounded-full bg-white text-ink-950 px-5 text-sm font-semibold hover:bg-ink-200 active:scale-95 disabled:opacity-50 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
              {shuffling ? 'Shuffling…' : 'Shuffle all'}
            </button>
          </div>
        )}
      </div>

      {!needle && (recent?.Items.length ?? 0) >= 4 && sort !== 'added' && (
        <section className="group/row mb-10">
          <div className="flex items-center justify-between px-4 sm:px-6 lg:px-12 mb-4">
            <h2 className="row-title text-white">Recently added</h2>
            <div className="hidden md:flex gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
              <button type="button" onClick={() => scrollRecent(-1)} tabIndex={-1} className={ARROW} aria-label="Scroll left">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
              </button>
              <button type="button" onClick={() => scrollRecent(1)} tabIndex={-1} className={ARROW} aria-label="Scroll right">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
          <div ref={recentRef} className={ROW_SCROLLER}>
            {recent!.Items.map((a) => (
              <AlbumCard key={a.Id} album={a} width={176} />
            ))}
          </div>
        </section>
      )}

      {!needle && <FriendMusicRows />}

      {failed ? (
        <div className="px-4 sm:px-6 lg:px-12 py-12 text-center">
          <p className="text-lg font-semibold text-white">Couldn’t load your music</p>
          <p className="mt-1 text-sm text-ink-400">Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => {
              void refetchViews()
              void refetchAlbums()
            }}
            className="mt-5 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
          >
            Try again
          </button>
        </div>
      ) : ownMusic ? (
        <div className="px-4 sm:px-6 lg:px-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="row-title text-white">{needle ? 'Matching albums' : 'All albums'}</h2>
            <SelectMenu label="Sort albums by" prefix="Sort:" value={sort} options={SORTS} onChange={chooseSort} align="right" />
          </div>
          <div className="grid gap-3 sm:gap-5 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
            {isLoading || !views
              ? Array.from({ length: 18 }).map((_, i) => <AlbumSkeleton key={i} />)
              : visible.map((a) => (
                  <div key={a.Id} className="cv-card">
                    <AlbumCard album={a} />
                  </div>
                ))}
          </div>
          {!isLoading && albums && visible.length === 0 && (
            <p className="text-ink-400 py-12 text-center">
              {needle ? `Nothing matches “${filter}”` : 'No albums in your music library.'}
            </p>
          )}
        </div>
      ) : (
        !friendMusic.loading && !friendMusic.rows.length && <p className="text-ink-400 py-12 text-center">There’s no music here yet.</p>
      )}
    </div>
  )
}
