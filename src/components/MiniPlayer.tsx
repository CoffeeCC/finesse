import { Link } from 'react-router-dom'
import { useAudio } from '../audio/AudioPlayerContext'
import { imageUrl } from '../api/client'
import type { JfItem } from '../api/types'

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function trackArt(t: JfItem): string | null {
  if (t.ImageTags?.Primary) return imageUrl(t.Id, 'Primary', { maxWidth: 120, tag: t.ImageTags.Primary })
  if (t.AlbumId && t.AlbumPrimaryImageTag)
    return imageUrl(t.AlbumId, 'Primary', { maxWidth: 120, tag: t.AlbumPrimaryImageTag })
  return null
}

export default function MiniPlayer() {
  const { current, playing, position, duration, toggle, next, prev, seek, stop, index, queue } = useAudio()
  if (!current) return null

  const art = trackArt(current)
  const pct = duration ? (position / duration) * 100 : 0

  return (
    <div className="fixed inset-x-0 bottom-14 md:bottom-0 z-40 border-t border-white/10 bg-ink-900/90 backdrop-blur-xl">
      {/* Seek line across the very top of the bar */}
      <div
        className="absolute -top-0.5 inset-x-0 h-1 cursor-pointer group/seek"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          seek(((e.clientX - r.left) / r.width) * duration)
        }}
      >
        <div className="h-full bg-white/10">
          <div className="h-full bg-accent-400" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="h-16 px-3 sm:px-6 flex items-center gap-3">
        <div className="h-11 w-11 shrink-0 rounded-md overflow-hidden bg-ink-800 ring-1 ring-white/10">
          {art && <img src={art} alt="" className="h-full w-full object-cover" />}
        </div>

        <Link to={current.AlbumId ? `/album/${current.AlbumId}` : '#'} className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-200 truncate hover:text-white transition-colors">
            {current.Name}
          </p>
          <p className="text-xs text-ink-400 truncate">
            {current.Artists?.join(', ') || current.AlbumArtist || current.Album || ''}
          </p>
        </Link>

        <span className="hidden sm:block text-xs tabular-nums text-ink-400 mr-1">
          {fmt(position)} / {fmt(duration)}
        </span>

        <button
          onClick={prev}
          className="h-9 w-9 flex items-center justify-center text-ink-200 hover:text-white hover:scale-110 transition-all"
          aria-label="Previous"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
        </button>
        <button
          onClick={toggle}
          className="h-10 w-10 flex items-center justify-center rounded-full bg-white text-ink-950 hover:scale-105 active:scale-95 transition-transform"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg>
          ) : (
            <svg className="h-5 w-5 translate-x-px" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <button
          onClick={next}
          disabled={index >= queue.length - 1}
          className="h-9 w-9 flex items-center justify-center text-ink-200 hover:text-white hover:scale-110 disabled:opacity-30 transition-all"
          aria-label="Next"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6zM16 6v12h2V6z" /></svg>
        </button>

        <button
          onClick={stop}
          className="h-9 w-9 hidden sm:flex items-center justify-center text-ink-400 hover:text-white transition-colors"
          aria-label="Close player"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
