import { useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getItems, getViews } from '../api/client'
import { useFriends } from '../api/queries'
import type { Friend } from '../api/setup'
import type { JfItem } from '../api/types'
import { useAudio } from '../audio/AudioPlayerContext'
import AlbumCard from './AlbumCard'
import { ROW_SCROLLER } from './MediaRow'

/** A friend's shared libraries (Groups), cached with the Friends page's. */
export function friendViewsQuery(friendId: string) {
  return { queryKey: ['friend', friendId, 'views'], queryFn: () => getViews(friendId), staleTime: 5 * 60_000, retry: 1 }
}

export const isMusicView = (v: JfItem) => v.CollectionType === 'music'

/** A music library on a friend's server: its newest albums, and Shuffle. */
export function FriendAlbumsRow({ viewId, title }: { viewId: string; title: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['friendAlbums', viewId],
    queryFn: () =>
      getItems({
        parentId: viewId,
        includeItemTypes: 'MusicAlbum',
        recursive: true,
        sortBy: 'DateCreated',
        sortOrder: 'Descending',
        limit: 24,
        fields: 'PrimaryImageAspectRatio,ProductionYear,DateCreated',
      }),
    staleTime: 5 * 60_000,
  })
  const { playQueue } = useAudio()
  const [shuffling, setShuffling] = useState(false)
  const albums = data?.Items ?? []
  if (!isLoading && !albums.length) return null

  const shuffle = async () => {
    setShuffling(true)
    try {
      const songs = await getItems({ parentId: viewId, includeItemTypes: 'Audio', recursive: true, sortBy: 'Random', limit: 200 })
      if (songs.Items.length) playQueue(songs.Items, 0, { shuffle: true })
    } finally {
      setShuffling(false)
    }
  }

  return (
    <section>
      <div className="flex items-center gap-3 px-4 sm:px-6 lg:px-12 mb-3">
        <h2 className="row-title text-white min-w-0 truncate">{title}</h2>
        <button
          type="button"
          onClick={() => void shuffle()}
          disabled={shuffling || !albums.length}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
          {shuffling ? 'Shuffling…' : 'Shuffle'}
        </button>
      </div>
      <div className={ROW_SCROLLER}>
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="shrink-0 w-44 aspect-square rounded-xl shimmer" />)
          : albums.map((a) => <AlbumCard key={a.Id} album={a} width={176} />)}
      </div>
    </section>
  )
}

/** Every music library friends share with this server (Groups), and whether that's still loading. */
export function useFriendMusic(): { rows: { friend: Friend; lib: JfItem; many: boolean }[]; loading: boolean } {
  const { data: friends, isLoading } = useFriends()
  const views = useQueries({ queries: (friends ?? []).map((f) => friendViewsQuery(f.id)) })
  const rows: { friend: Friend; lib: JfItem; many: boolean }[] = []
  ;(friends ?? []).forEach((friend, i) => {
    const libs = (views[i]?.data?.Items ?? []).filter(isMusicView)
    for (const lib of libs) rows.push({ friend, lib, many: libs.length > 1 })
  })
  return { rows, loading: isLoading || views.some((v) => v.isLoading) }
}

/** Music page: a row of albums for every music library friends share (Groups). */
export function FriendMusicRows() {
  const { rows } = useFriendMusic()
  if (!rows.length) return null
  return (
    <div className="space-y-10 mb-10">
      {rows.map(({ friend, lib, many }) => (
        <FriendAlbumsRow key={lib.Id} viewId={lib.Id} title={many ? `${lib.Name} from ${friend.name}` : `From ${friend.name}`} />
      ))}
    </div>
  )
}
