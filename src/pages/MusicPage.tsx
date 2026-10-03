import { useMemo, useState } from 'react'
import { useAlbums, useItemsRow, useViews } from '../api/queries'
import * as api from '../api/client'
import { useAudio } from '../audio/AudioPlayerContext'
import { CardSkeleton } from '../components/Skeletons'
import AlbumCard from '../components/AlbumCard'
import { FriendMusicRows, useFriendMusic } from '../components/FriendAlbums'
import { SelectMenu } from '../components/Menu'
import { ROW_SCROLLER } from '../components/MediaRow'
import type { JfItem } from '../api/types'

type Sort = 'title' | 'artist' | 'year' | 'added'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'year', label: 'Year' },
  { value: 'added', label: 'Recently added' },
]
const SORT_KEY = 'finesse.musicSort'

function sortAlbums(list: JfItem[], sort: Sort): JfItem[] {
  const by = (f: (a: JfItem) => string | number, desc = false) =>
    list.slice().sort((a, b) => {
      const x = f(a)
      const y = f(b)
      const c = x < y ? -1 : x > y ? 1 : 0
      return desc ? -c : c
    })
  if (sort === 'artist') return by((a) => `${(a.AlbumArtist ?? '').toLowerCase()} ${a.ProductionYear ?? 0}`)
  if (sort === 'year') return by((a) => a.ProductionYear ?? 0, true)
  if (sort === 'added') return by((a) => a.DateCreated ?? '', true)
  return list
}

export default function MusicPage() {
  const { data: views } = useViews()
  const musicView = views?.Items.find((v) => v.CollectionType === 'music')
  // Someone may have no music of their own but listen to a friend's (Groups).
  const ownMusic = !views || !!musicView
  const friendMusic = useFriendMusic()
  const { data: albums, isLoading } = useAlbums(musicView?.Id)
  const { data: recent } = useItemsRow(
    'music-recent',
    musicView ? { parentId: musicView.Id, includeItemTypes: 'MusicAlbum', sortBy: 'DateCreated', sortOrder: 'Descending', limit: 12 } : null,
  )
  const { playQueue } = useAudio()
  const [shuffling, setShuffling] = useState(false)
  const [sort, setSort] = useState<Sort>(() => {
    try {
      return (localStorage.getItem(SORT_KEY) as Sort | null) ?? 'title'
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

  const shuffleAll = async () => {
    if (!musicView) return
    setShuffling(true)
    try {
      const res = await api.getItems({ parentId: musicView.Id, includeItemTypes: 'Audio', recursive: true, sortBy: 'Random', limit: 200 })
      if (res.Items.length) playQueue(res.Items, 0, { shuffle: true })
    } finally {
      setShuffling(false)
    }
  }

  return (
    <div className="py-8">
      <div className="px-4 sm:px-6 lg:px-12 flex flex-wrap items-end gap-x-4 gap-y-3 mb-8">
        <div className="flex items-baseline gap-3 mr-auto">
          <h1 className="page-title">Music</h1>
          {albums && <span className="text-sm text-ink-400">{albums.TotalRecordCount} albums</span>}
        </div>
        {ownMusic && (
          <button
            type="button"
            onClick={() => void shuffleAll()}
            disabled={!musicView || shuffling}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-white text-ink-950 px-5 text-sm font-semibold hover:bg-ink-200 active:scale-95 disabled:opacity-50 transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
            {shuffling ? 'Shuffling…' : 'Shuffle all'}
          </button>
        )}
      </div>

      {(recent?.Items.length ?? 0) >= 4 && sort !== 'added' && (
        <section className="mb-10">
          <h2 className="px-4 sm:px-6 lg:px-12 mb-4 row-title text-white">Recently added</h2>
          <div className={ROW_SCROLLER}>
            {recent!.Items.map((a) => (
              <AlbumCard key={a.Id} album={a} width={176} />
            ))}
          </div>
        </section>
      )}

      <FriendMusicRows />

      {ownMusic ? (
        <div className="px-4 sm:px-6 lg:px-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="row-title text-white">All albums</h2>
            <SelectMenu label="Sort albums by" prefix="Sort:" value={sort} options={SORTS} onChange={chooseSort} align="right" />
          </div>
          <div className="grid gap-3 sm:gap-5 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]">
            {isLoading ? Array.from({ length: 18 }).map((_, i) => <CardSkeleton key={i} />) : sorted.map((a) => <AlbumCard key={a.Id} album={a} />)}
          </div>
          {!isLoading && albums?.Items.length === 0 && <p className="text-ink-400 py-12 text-center">No albums in your music library.</p>}
        </div>
      ) : (
        !friendMusic.loading && !friendMusic.rows.length && <p className="text-ink-400 py-12 text-center">There’s no music here yet.</p>
      )}
    </div>
  )
}
