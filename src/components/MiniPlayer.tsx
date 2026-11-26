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

function VolumeIcon({ muted, volume }: { muted: boolean; volume: number }) {
  if (muted || volume === 0) {
    return (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5 6 9H3v6h3l5 4V5Zm6.5 4.5-4 4m0-4 4 4" />
      </svg>
    )
  }
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5 6 9H3v6h3l5 4V5Z" />
      {volume > 0.01 && <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 8.5a5 5 0 0 1 0 7" />}
      {volume > 0.5 && <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 5.5a9 9 0 0 1 0 13" />}
    </svg>
  )
}

export default function MiniPlayer() {
  const {
    current, playing, position, duration, volume, muted, setVolume, toggleMute,
    toggle, next, prev, seek, stop, index, queue, expanded, setExpanded, repeat,
  } = useAudio()
  if (!current || expanded) return null

  const art = trackArt(current)
  const known = Number.isFinite(duration) && duration > 0
  const pct = known ? Math.min(100, (position / duration) * 100) : 0
  // Before the length is known a tap on the line would have sent the song back to 0.
  const seekAt = (clientX: number, el: HTMLElement) => {
    if (!known) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return
    seek(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration)
  }
  const btn = 'h-8 w-8 sm:h-9 sm:w-9 shrink-0 flex items-center justify-center rounded-full text-ink-200 hover:text-white hover:bg-white/10 active:scale-90 transition'

  return (
    // Plain offsets first (the TV's Chromium 68 has no env()/max(): those rules would drop and
    // leave the bar unplaced), the notch-aware ones where they work. Solid, not blurred: it's a
    // fixed bar over everything that scrolls.
    <div className="fixed left-3 right-3 bottom-[4.6rem] supports-[top:max(0px,env(safe-area-inset-top))]:left-[max(0.75rem,env(safe-area-inset-left))] supports-[top:max(0px,env(safe-area-inset-top))]:right-[max(0.75rem,env(safe-area-inset-right))] supports-[top:max(0px,env(safe-area-inset-top))]:bottom-[calc(4.6rem+env(safe-area-inset-bottom))] rounded-2xl border border-white/10 md:left-0 md:right-0 md:bottom-0 md:supports-[top:max(0px,env(safe-area-inset-top))]:left-0 md:supports-[top:max(0px,env(safe-area-inset-top))]:right-0 md:supports-[top:max(0px,env(safe-area-inset-top))]:bottom-0 md:supports-[top:max(0px,env(safe-area-inset-top))]:pb-[env(safe-area-inset-bottom)] md:rounded-none md:border-x-0 md:border-b-0 z-40 bg-ink-900/[0.97] shadow-2xl shadow-black/40 overflow-hidden">
      {/* Seek line across the very top of the bar: a taller hit area than it looks, drag to scrub. */}
      <div
        role="slider"
        tabIndex={-1}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration) || 0}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${fmt(position)} of ${fmt(duration)}`}
        className={`absolute -top-1 inset-x-0 h-3 touch-none group/seek ${known ? 'cursor-pointer' : ''}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId)
          seekAt(e.clientX, e.currentTarget)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) seekAt(e.clientX, e.currentTarget)
        }}
      >
        <div className="mt-1 h-1 bg-white/10 transition-[height] group-hover/seek:h-1.5">
          <div className="h-full bg-accent-400" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="h-16 px-2.5 sm:px-6 flex items-center gap-1.5 sm:gap-3">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 text-left group/np rounded-lg"
          title="Open now playing"
        >
          <div className="h-11 w-11 shrink-0 rounded-md overflow-hidden bg-ink-800 ring-1 ring-white/10 group-hover/np:ring-accent-400 transition-all">
            {art && <img src={art} alt="" decoding="async" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-200 truncate group-hover/np:text-white transition-colors">
              {current.Name}
            </p>
            <p className="text-xs text-ink-400 truncate">
              {current.Artists?.join(', ') || current.AlbumArtist || current.Album || ''}
            </p>
          </div>
        </button>

        <span className="hidden sm:block text-xs tabular-nums text-ink-400 mr-1">
          {fmt(position)} / {fmt(duration)}
        </span>

        <button type="button" onClick={prev} className={`${btn} hidden min-[380px]:flex`} aria-label="Previous">
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
        </button>
        <button
          type="button"
          onClick={toggle}
          className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 flex items-center justify-center rounded-full bg-white text-ink-950 hover:scale-105 active:scale-95 transition-transform"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg>
          ) : (
            <svg className="h-5 w-5 translate-x-px" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <button type="button" onClick={next} disabled={index >= queue.length - 1 && repeat !== 'all'} className={`${btn} disabled:opacity-30 disabled:active:scale-100`} aria-label="Next">
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6zM16 6v12h2V6z" /></svg>
        </button>

        <div className="hidden md:flex items-center gap-1.5 ml-1">
          <button
            type="button"
            onClick={toggleMute}
            className="h-8 w-8 flex items-center justify-center rounded-full text-ink-300 hover:text-white hover:bg-white/10 transition"
            aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
            title={muted || volume === 0 ? 'Unmute' : 'Mute'}
          >
            <VolumeIcon muted={muted} volume={volume} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
            className="w-20 accent-[var(--color-accent-400,#7589d8)] cursor-pointer"
          />
        </div>

        <button
          type="button"
          onClick={stop}
          className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 flex items-center justify-center rounded-full text-ink-400 hover:text-white hover:bg-white/10 active:scale-90 transition"
          aria-label="Stop and close player"
          title="Stop"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
