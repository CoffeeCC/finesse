import { useParams } from 'react-router-dom'
import { useItem, useTracks } from '../api/queries'
import { posterUrl } from '../api/client'
import { useAudio } from '../audio/AudioPlayerContext'
import { formatRuntime, ticksToSeconds } from '../api/types'
import type { JfItem } from '../api/types'

function trackLen(ticks?: number): string {
  const s = ticksToSeconds(ticks)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function AlbumPage() {
  const { albumId } = useParams()
  const { data: album, isLoading } = useItem(albumId)
  const { data: tracks } = useTracks(albumId)
  const { playQueue, current, playing } = useAudio()

  if (isLoading || !album) return <div className="h-[40vh] shimmer -mt-16" />

  const cover = posterUrl(album, 600)
  const items = tracks?.Items ?? []
  const totalTicks = items.reduce((sum, t) => sum + (t.RunTimeTicks ?? 0), 0)

  return (
    <div className="pb-28">
      <div className="px-4 sm:px-6 lg:px-12 pt-8 flex flex-col sm:flex-row gap-6 sm:gap-8 items-start">
        <div className="h-48 w-48 shrink-0 rounded-2xl overflow-hidden bg-ink-800 ring-1 ring-white/10 shadow-2xl">
          {cover ? (
            <img src={cover} alt={album.Name} className="h-full w-full object-cover fade-in" />
          ) : (
            <div className="h-full w-full flex items-center justify-center text-5xl text-ink-400">♪</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-white tracking-tight">{album.Name}</h1>
          <p className="mt-1 text-ink-300">{album.AlbumArtist}</p>
          <p className="mt-1 text-sm text-ink-400">
            {album.ProductionYear ? `${album.ProductionYear} · ` : ''}
            {items.length} track{items.length === 1 ? '' : 's'}
            {totalTicks ? ` · ${formatRuntime(totalTicks)}` : ''}
          </p>
          <button
            onClick={() => playQueue(items, 0)}
            disabled={items.length === 0}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white text-ink-950 px-6 py-2.5 text-sm font-semibold hover:bg-ink-200 active:scale-95 disabled:opacity-50 transition-all"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            Play
          </button>
        </div>
      </div>

      <div className="mt-8 px-4 sm:px-6 lg:px-12">
        <div className="rounded-2xl bg-ink-900/40 border border-white/5 overflow-hidden">
          {items.map((t: JfItem, i) => {
            const isCurrent = current?.Id === t.Id
            return (
              <button
                key={t.Id}
                onClick={() => playQueue(items, i)}
                className={`group w-full flex items-center gap-4 px-4 py-2.5 text-left transition-colors ${
                  isCurrent ? 'bg-accent-500/10' : 'hover:bg-white/5'
                }`}
              >
                <span className={`w-6 text-right text-sm tabular-nums ${isCurrent ? 'text-accent-300' : 'text-ink-400'}`}>
                  {isCurrent && playing ? '♪' : t.IndexNumber ?? i + 1}
                </span>
                <span className={`flex-1 min-w-0 truncate text-sm ${isCurrent ? 'text-accent-300 font-medium' : 'text-ink-200'}`}>
                  {t.Name}
                </span>
                <span className="text-xs tabular-nums text-ink-400">{trackLen(t.RunTimeTicks)}</span>
              </button>
            )
          })}
          {items.length === 0 && <p className="px-4 py-6 text-sm text-ink-400">No tracks found.</p>}
        </div>
      </div>
    </div>
  )
}
