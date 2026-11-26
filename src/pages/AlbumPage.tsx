import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DeleteFromLibrary, useCanDelete } from '../components/DeleteFromLibrary'
import { ActionMenu, type ActionItem } from '../components/Menu'
import { useToast } from '../components/Toast'
import { goBack } from '../lib/back'
import { IS_TV } from '../lib/device'
import ItemUnavailable from '../components/ItemUnavailable'
import { useAlbums, useFriends, useItem, useTracks, useViews } from '../api/queries'
import { getItems, posterUrl, setFavorite } from '../api/client'
import { useAudio } from '../audio/AudioPlayerContext'
import { formatRuntime, ticksToSeconds } from '../api/types'
import type { JfItem } from '../api/types'
import { blurhashAverageColor, primaryBlurhash } from '../lib/blurhash'
import { vividRgb } from '../lib/accent'
import AlbumCard from '../components/AlbumCard'
import { friendViewsQuery, isMusicView } from '../components/FriendAlbums'
import { peerOf } from '../lib/peers'
import { ROW_SCROLLER } from '../components/MediaRow'

function trackLen(ticks?: number): string {
  if (!ticks) return ''
  const s = ticksToSeconds(ticks)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function Equalizer({ paused }: { paused: boolean }) {
  return (
    <span className={`eq ${paused ? 'paused' : ''}`} aria-hidden>
      <span />
      <span />
      <span />
    </span>
  )
}

export default function AlbumPage() {
  const { albumId } = useParams()
  const { data: album, isLoading, isError, error, refetch, isFetching } = useItem(albumId)
  const {
    data: tracks,
    isLoading: tracksLoading,
    isError: tracksError,
    refetch: refetchTracks,
  } = useTracks(albumId)
  const { playQueue, enqueue, current, playing, toggle } = useAudio()
  const { data: views } = useViews()
  const qc = useQueryClient()
  const toast = useToast()
  // An album on a friend's server (Groups): "More by" comes from their library.
  const friendId = peerOf(albumId)
  const { data: friends } = useFriends()
  const { data: friendViews } = useQuery({ ...friendViewsQuery(friendId ?? ''), enabled: !!friendId })
  const friendName = friendId ? friends?.find((f) => f.id === friendId)?.name ?? 'a friend’s server' : null
  const musicView = (friendId ? friendViews : views)?.Items.find(isMusicView)
  // "More by": just this artist's albums. Reading the whole music library for it (as before)
  // cost one huge request per album opened; a friend's album still reads theirs (ids differ).
  const artistId = (album as (JfItem & { AlbumArtists?: { Id?: string }[] }) | undefined)?.AlbumArtists?.[0]?.Id
  const byArtist = useQuery({
    queryKey: ['albumsByArtist', artistId],
    enabled: Boolean(artistId && !friendId),
    staleTime: 10 * 60_000,
    queryFn: () => getItems({ albumArtistIds: artistId, includeItemTypes: 'MusicAlbum', recursive: true, sortBy: 'ProductionYear,SortName', sortOrder: 'Descending', limit: 40 }),
  })
  const { data: libraryAlbums } = useAlbums(album && (friendId || !artistId) ? musicView?.Id : undefined)
  const albums = friendId || !artistId ? libraryAlbums : byArtist.data
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState(false)
  const [favBusy, setFavBusy] = useState(false)
  const canDelete = useCanDelete() && !friendId

  if (!album) {
    if (isLoading || (isFetching && !isError)) return <div className="h-[calc(var(--vh)*40)] shimmer -mt-16" />
    return <ItemUnavailable kind="album" error={error} id={albumId} onRetry={() => void refetch()} retrying={isFetching} />
  }

  const cover = posterUrl(album, 700)
  const items = tracks?.Items ?? []
  const totalTicks = items.reduce((sum, t) => sum + (t.RunTimeTicks ?? 0), 0)
  const avg = blurhashAverageColor(primaryBlurhash(album))
  const mood = avg ? vividRgb(avg[0], avg[1], avg[2]).join(', ') : null
  const thisAlbumPlaying = !!current && current.AlbumId === album.Id
  const moreByArtist = (albums?.Items ?? []).filter((a) => a.AlbumArtist && a.AlbumArtist === album.AlbumArtist && a.Id !== album.Id)
  const multiDisc = new Set(items.map((t) => t.ParentIndexNumber ?? 1)).size > 1
  const isFavorite = album.UserData?.IsFavorite ?? false

  const toggleFavorite = async () => {
    setFavBusy(true)
    try {
      await setFavorite(album.Id, !isFavorite)
      await qc.invalidateQueries({ queryKey: ['item', albumId] })
      toast(isFavorite ? 'Removed from favorites' : 'Added to favorites')
    } catch {
      toast('Could not update favorite', 'error')
    } finally {
      setFavBusy(false)
    }
  }

  const moreItems: ActionItem[] = [
    ...(items.length > 0
      ? [
          {
            label: 'Play next',
            onSelect: () => {
              enqueue(items, 'next')
              toast(`Playing “${album.Name}” next`)
            },
          },
          {
            label: 'Add to queue',
            onSelect: () => {
              enqueue(items, 'end')
              toast(`Added “${album.Name}” to queue`)
            },
          },
        ]
      : []),
    ...(canDelete ? [{ section: 'Admin', label: 'Delete album…', onSelect: () => setDeleting(true) }] : []),
  ]

  return (
    <div className="relative pb-28 -mt-16 supports-[top:max(0px,env(safe-area-inset-top))]:-mt-[calc(4rem+env(safe-area-inset-top))]">
      {/* The album's own colour, washing down from the top */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-[34rem] overflow-hidden pointer-events-none">
        {cover && <img decoding="async" src={cover} alt="" className="h-full w-full object-cover blur-3xl scale-125 opacity-45 saturate-150" />}
        {mood && <div className="absolute inset-0" style={{ background: `radial-gradient(70% 80% at 20% 30%, rgba(${mood}, 0.35), transparent 70%)` }} />}
        <div className="absolute inset-0 bg-gradient-to-b from-ink-950/30 via-ink-950/70 to-ink-950" />
      </div>

      {!IS_TV && (
        <button
          type="button"
          onClick={() => goBack(navigate)}
          aria-label="Back"
          title="Back"
          className="absolute left-[max(0.75rem,env(safe-area-inset-left))] top-[calc(4.75rem+env(safe-area-inset-top))] sm:left-[max(1.5rem,env(safe-area-inset-left))] lg:left-12 sm:top-[calc(5.25rem+env(safe-area-inset-top))] z-20 h-10 w-10 rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/10 flex items-center justify-center text-white active:scale-95 transition-transform"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
      )}

      <div className="relative px-4 sm:px-6 lg:px-12 pt-28 sm:pt-32 flex flex-col sm:flex-row gap-6 sm:gap-10 items-center sm:items-end">
        <div
          className="h-56 w-56 sm:h-64 sm:w-64 lg:h-72 lg:w-72 shrink-0 rounded-2xl overflow-hidden bg-ink-800 ring-1 ring-white/10"
          style={{ boxShadow: mood ? `0 30px 80px -20px rgba(${mood}, 0.5), 0 20px 40px -20px rgba(0,0,0,0.8)` : undefined }}
        >
          {cover ? (
            <img decoding="async" src={cover} alt={album.Name} className="h-full w-full object-cover fade-in" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-6xl text-ink-400">♪</div>
          )}
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/60">
            Album
            {friendName && <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-medium normal-case tracking-normal text-ink-100">From {friendName}</span>}
          </p>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.02] text-white">{album.Name}</h1>
          <p className="mt-3 text-lg font-semibold text-white/85">{album.AlbumArtist}</p>
          <p className="mt-1 text-sm text-white/55">
            {[album.ProductionYear, tracks ? `${items.length} song${items.length === 1 ? '' : 's'}` : null, totalTicks ? formatRuntime(totalTicks) : null, album.Genres?.[0]]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center sm:justify-start gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => (thisAlbumPlaying ? toggle() : playQueue(items, 0))}
              disabled={items.length === 0}
              data-autofocus
              className="inline-flex h-12 items-center gap-2 rounded-full bg-white text-ink-950 px-7 text-[15px] font-semibold hover:bg-ink-200 active:scale-95 disabled:opacity-50 transition-all"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d={thisAlbumPlaying && playing ? 'M6 19h4V5H6zm8-14v14h4V5z' : 'M8 5v14l11-7z'} />
              </svg>
              {thisAlbumPlaying ? (playing ? 'Pause' : 'Resume') : 'Play'}
            </button>
            <button
              type="button"
              onClick={() => playQueue(items, 0, { shuffle: true })}
              disabled={items.length === 0}
              className="inline-flex h-12 items-center gap-2 rounded-full bg-white/10 border border-white/15 backdrop-blur px-6 text-[15px] font-semibold text-white hover:bg-white/15 active:scale-95 disabled:opacity-50 transition-all"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
              Shuffle
            </button>
            {!friendId && (
              <button
                type="button"
                onClick={() => void toggleFavorite()}
                disabled={favBusy}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={isFavorite}
                title={isFavorite ? 'Favorited' : 'Favorite'}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full border transition-all active:scale-95 disabled:opacity-50 ${
                  isFavorite
                    ? 'bg-accent-500/20 border-accent-400/50 text-accent-300'
                    : 'bg-white/10 border-white/15 text-white/85 hover:bg-white/15 hover:text-white'
                }`}
              >
                <svg className="h-5 w-5" fill={isFavorite ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
                </svg>
              </button>
            )}
            <ActionMenu
              label="More album options"
              items={moreItems}
              align="right"
              triggerClassName="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/10 border border-white/15 text-white/85 hover:bg-white/15 hover:text-white transition-colors"
            />
          </div>
          {deleting && <DeleteFromLibrary itemId={album.Id} onClose={() => setDeleting(false)} onDeleted={() => goBack(navigate)} />}
        </div>
      </div>

      <div className="relative mt-10 px-4 sm:px-6 lg:px-12">
        <ol className="rounded-2xl bg-ink-900/40 border border-white/5 overflow-hidden py-1">
          {items.map((t: JfItem, i) => {
            const isCurrent = current?.Id === t.Id
            const showArtist = t.Artists?.length && t.Artists.join(', ') !== album.AlbumArtist
            const discStart = multiDisc && (i === 0 || (items[i - 1].ParentIndexNumber ?? 1) !== (t.ParentIndexNumber ?? 1))
            return (
              <li key={t.Id}>
                {discStart && (
                  <p className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">Disc {t.ParentIndexNumber ?? 1}</p>
                )}
                <div className={`group flex items-center transition-colors ${isCurrent ? 'bg-white/[0.06]' : 'hover:bg-white/5'}`}>
                  <button
                    type="button"
                    onClick={() => (isCurrent ? toggle() : playQueue(items, i))}
                    aria-current={isCurrent ? 'true' : undefined}
                    className="flex-1 min-w-0 flex items-center gap-4 px-4 py-3 text-left"
                  >
                    <span className={`w-6 flex justify-end text-sm tabular-nums ${isCurrent ? 'text-accent-300' : 'text-ink-400'}`}>
                      {isCurrent ? (
                        <Equalizer paused={!playing} />
                      ) : (
                        <>
                          <span className="group-hover:hidden">{t.IndexNumber ?? i + 1}</span>
                          <svg className="hidden group-hover:block h-4 w-4 text-white" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </>
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={`block truncate text-[15px] ${isCurrent ? 'text-accent-300 font-semibold' : 'text-ink-100'}`}>{t.Name}</span>
                      {showArtist && <span className="block truncate text-[13px] text-ink-400">{t.Artists!.join(', ')}</span>}
                    </span>
                    <span className="text-sm tabular-nums text-ink-400">{trackLen(t.RunTimeTicks)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      enqueue([t], 'next')
                      toast(`Playing “${t.Name}” next`)
                    }}
                    aria-label={`Play ${t.Name} next`}
                    title="Play next"
                    className="mr-2 h-8 w-8 shrink-0 flex items-center justify-center rounded-full text-ink-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 hover:bg-white/10 hover:text-white transition"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                  </button>
                </div>
              </li>
            )
          })}
          {/* Loading: rows the shape of tracks. */}
          {tracksLoading &&
            Array.from({ length: 6 }, (_, i) => (
              <li key={`s${i}`} className="flex items-center gap-4 px-4 py-3.5" aria-hidden>
                <span className="h-3 w-6 rounded shimmer" />
                <span className="h-3.5 flex-1 max-w-sm rounded shimmer" />
                <span className="h-3 w-10 rounded shimmer" />
              </li>
            ))}
          {tracksError && !tracks && (
            <li className="px-4 py-6 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-300">
              <span>Couldn’t load tracks for this album.</span>
              <button
                type="button"
                onClick={() => void refetchTracks()}
                className="inline-flex h-8 items-center rounded-full bg-white/10 px-4 text-xs font-semibold text-white hover:bg-white/20 transition-colors"
              >
                Try again
              </button>
            </li>
          )}
          {!tracksLoading && !tracksError && items.length === 0 && <li className="px-4 py-6 text-sm text-ink-400">No tracks found.</li>}
        </ol>
      </div>

      {moreByArtist.length > 0 && (
        <section className="relative mt-12">
          <h2 className="px-4 sm:px-6 lg:px-12 mb-4 row-title text-white">More by {album.AlbumArtist}</h2>
          <div className={ROW_SCROLLER}>
            {moreByArtist.map((a) => (
              <AlbumCard key={a.Id} album={a} width={176} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
