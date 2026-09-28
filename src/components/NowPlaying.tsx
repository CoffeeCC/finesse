import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAudio } from '../audio/AudioPlayerContext'
import { prefetchTrackLyrics, useTrackLyrics } from '../api/queries'
import { artBlurhash, artistOf, trackArt } from '../lib/music'
import { ticksToSeconds } from '../api/types'
import type { JfItem } from '../api/types'
import { getPrefs, setPrefs, VISUALIZER_STYLES, type VisualizerStyle } from '../lib/settings'
import { activeLine } from '../lib/lyrics'
import { blurhashAverageColor } from '../lib/blurhash'
import { vividRgb } from '../lib/accent'
import { pushBackHandler } from '../lib/back'
import AudioVisualizer from './AudioVisualizer'
import LyricVideo from './LyricVideo'

// Full-screen "Now Playing": the record on the left, lyrics (or what's up next)
// on the right; on phones the artwork swaps for lyrics / the queue in place.
// The whole room takes the album's colour. The "Lyric video" style takes over
// the whole screen instead (components/LyricVideo), controls fading away.

const VIZ_LABEL: Record<VisualizerStyle, string> = {
  lyrics: 'Lyric video',
  bars: 'Bars',
  waveform: 'Wave',
  radial: 'Radial',
  particles: 'Bloom',
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}


/** "r, g, b" from the artwork's blurhash, for the room's glow. */
function moodOf(t: JfItem): string | null {
  const avg = blurhashAverageColor(artBlurhash(t))
  return avg ? vividRgb(avg[0], avg[1], avg[2]).join(', ') : null
}

function useIsWide(): boolean {
  const q = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mql = window.matchMedia(q)
    const on = () => setWide(mql.matches)
    mql.addListener(on) // addEventListener on MediaQueryList is Chromium 45+ but Safari 14+
    return () => mql.removeListener(on)
  }, [])
  return wide
}

const FADE_MASK = 'linear-gradient(transparent, #000 16%, #000 80%, transparent)'

function Centered({ children }: { children: ReactNode }) {
  return <div className="h-full flex items-center justify-center text-center text-lg text-white/55 px-6">{children}</div>
}

function LyricsPanel({ track, position, onSeek, compact }: { track: JfItem; position: number; onSeek: (sec: number) => void; compact?: boolean }) {
  const { data, isLoading, isError, refetch } = useTrackLyrics(track)
  const lines = data?.lines ?? []
  const active = data?.synced ? activeLine(lines, position) : -1
  const box = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([])
  // Scrolling the lyrics yourself pauses the follow for a few seconds.
  const userScrolledAt = useRef(0)

  useEffect(() => {
    if (active < 0 || Date.now() - userScrolledAt.current < 4000) return
    const el = lineRefs.current[active]
    const c = box.current
    if (!el || !c) return
    c.scrollTo({ top: el.offsetTop - c.clientHeight * 0.38 + el.clientHeight / 2, behavior: 'smooth' })
  }, [active])

  useEffect(() => {
    box.current?.scrollTo({ top: 0 })
    lineRefs.current = []
  }, [track.Id])

  if (isLoading) return <Centered><span className="animate-pulse">Finding lyrics…</span></Centered>
  if (data?.instrumental) return <Centered>♪ Instrumental</Centered>
  if (isError) {
    return (
      <Centered>
        <span>
          Couldn’t look up lyrics just now
          <button
            type="button"
            onClick={() => void refetch()}
            className="block mx-auto mt-4 rounded-full bg-white/10 hover:bg-white/20 px-4 py-1.5 text-sm font-semibold text-white/85 transition-colors"
          >
            Try again
          </button>
        </span>
      </Centered>
    )
  }
  if (!lines.length) {
    return (
      <Centered>
        <span>
          No lyrics for this song
          {!getPrefs().onlineLyrics && (
            <span className="block mt-2 text-sm text-white/40">Turn on “Find lyrics online” in Settings → Sound to look them up.</span>
          )}
        </span>
      </Centered>
    )
  }

  return (
    <div
      ref={box}
      onWheel={() => (userScrolledAt.current = Date.now())}
      onTouchMove={() => (userScrolledAt.current = Date.now())}
      className="relative h-full overflow-y-auto no-scrollbar"
      style={{ WebkitMaskImage: FADE_MASK, maskImage: FADE_MASK }}
      aria-label="Lyrics"
    >
      <div className={`${compact ? 'py-[40%] space-y-4' : 'py-[calc(var(--vh)*32)] space-y-6'}`}>
        {lines.map((l, i) => {
          const state = !data?.synced ? 'plain' : i === active ? 'now' : i < active ? 'past' : 'next'
          const seekable = data?.synced && l.start != null
          return (
            <p
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el
              }}
              onClick={seekable ? () => onSeek(l.start!) : undefined}
              data-state={state}
              className={`font-semibold leading-snug origin-left transition-all duration-500 ${
                compact ? 'text-2xl' : 'text-3xl xl:text-[2.5rem]'
              } ${
                state === 'now'
                  ? 'text-white scale-[1.02]'
                  : state === 'past'
                    ? 'text-white/25'
                    : state === 'next'
                      ? 'text-white/45'
                      : 'text-white/85'
              } ${seekable ? 'cursor-pointer hover:text-white/80' : ''}`}
            >
              {l.text || '♪'}
            </p>
          )
        })}
        {(data?.source === 'lrclib' || !data?.synced) && (
          <p className="pt-6 text-xs font-medium text-white/35">
            {[!data?.synced && 'Not timed, so these won’t follow along', data?.source === 'lrclib' && 'Lyrics from LRCLIB'].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  )
}

function QueueRow({ track, active, onClick }: { track: JfItem; active?: boolean; onClick?: () => void }) {
  const art = trackArt(track, 120)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
        active ? 'bg-white/10' : 'hover:bg-white/5'
      }`}
    >
      <span className="h-11 w-11 shrink-0 rounded-md overflow-hidden bg-white/10">
        {art && <img src={art} alt="" loading="lazy" className="h-full w-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[15px] font-semibold ${active ? 'text-white' : 'text-white/85'}`}>{track.Name}</span>
        <span className="block truncate text-[13px] text-white/50">{artistOf(track)}</span>
      </span>
      <span className="text-xs tabular-nums text-white/45">{fmt(ticksToSeconds(track.RunTimeTicks))}</span>
    </button>
  )
}

function QueuePanel({ queue, index, onJump }: { queue: JfItem[]; index: number; onJump: (i: number) => void }) {
  const upcoming = queue.slice(index + 1)
  return (
    <div className="h-full overflow-y-auto no-scrollbar pr-1" aria-label="Up next">
      <p className="px-2 mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/45">Now playing</p>
      {queue[index] && <QueueRow track={queue[index]} active />}
      <p className="px-2 mt-6 mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
        Up next{upcoming.length ? ` · ${upcoming.length}` : ''}
      </p>
      {upcoming.map((t, k) => (
        <QueueRow key={`${t.Id}-${k}`} track={t} onClick={() => onJump(index + 1 + k)} />
      ))}
      {upcoming.length === 0 && <p className="px-2 text-sm text-white/45">That’s the end of the queue.</p>}
    </div>
  )
}

const I = {
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  next: 'M6 18l8.5-6L6 6zM16 6v12h2V6z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6zm8-14v14h4V5z',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
}

function StrokeIcon({ d, className = 'h-6 w-6' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}
function FillIcon({ d, className = 'h-7 w-7' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d={d} />
    </svg>
  )
}

export default function NowPlaying() {
  const {
    current, expanded, setExpanded, playing, position, duration, toggle, next, prev, seek, index, queue, jumpTo,
    shuffle, toggleShuffle, repeat, cycleRepeat,
  } = useAudio()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const wide = useIsWide()
  const [viz, setViz] = useState<VisualizerStyle>(() => getPrefs().visualizer)
  const [panel, setPanel] = useState<'lyrics' | 'queue'>('lyrics')
  // Phones: what fills the space above the controls.
  const [phoneView, setPhoneView] = useState<'art' | 'lyrics' | 'queue'>('art')
  const pickViz = (v: VisualizerStyle) => {
    if (viz !== 'lyrics') lastCanvasViz.current = viz
    setViz(v)
    setPrefs({ visualizer: v })
  }
  // Leaving the lyric video returns to the visualizer you had before it.
  const lastCanvasViz = useRef<VisualizerStyle>(viz === 'lyrics' ? 'bars' : viz)
  const lyricVideo = viz === 'lyrics'
  // Lyric video: controls fade out after a few idle seconds; any input brings them back.
  const [chrome, setChrome] = useState(true)
  useEffect(() => {
    if (!expanded || !lyricVideo) {
      setChrome(true)
      return
    }
    let timer = 0
    const wake = () => {
      setChrome(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setChrome(false), 3500)
    }
    wake()
    const evs = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const
    evs.forEach((e) => window.addEventListener(e, wake, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      evs.forEach((e) => window.removeEventListener(e, wake))
    }
  }, [expanded, lyricVideo])

  // Escape / remote Back collapses the overlay (instead of also navigating away).
  useEffect(() => {
    if (!expanded) return
    return pushBackHandler(() => {
      setExpanded(false)
      return true
    })
  }, [expanded, setExpanded])

  // Have the next song's lyrics ready before it starts.
  useEffect(() => {
    if (expanded) prefetchTrackLyrics(qc, queue[index + 1])
  }, [expanded, qc, queue, index])

  if (!expanded || !current) return null

  const cover = trackArt(current, 900)
  const bg = trackArt(current, 400)
  const mood = moodOf(current)
  const pct = duration ? Math.min(100, (position / duration) * 100) : 0
  const openAlbum = current.AlbumId
    ? () => {
        setExpanded(false)
        navigate(`/album/${current.AlbumId}`)
      }
    : undefined

  const artMax = Math.round(wide ? Math.min(window.innerHeight * 0.5, 480) : Math.min(window.innerHeight * 0.44, 416))
  const artwork = (
    <div
      className="aspect-square w-full rounded-2xl overflow-hidden bg-white/10 ring-1 ring-white/10"
      style={{
        // Computed, not CSS min(): that's Chromium 79+ and the LG CX runs 68.
        maxWidth: artMax,
        boxShadow: mood ? `0 30px 90px -20px rgba(${mood}, 0.55), 0 20px 50px -20px rgba(0,0,0,0.8)` : undefined,
      }}
    >
      {cover ? (
        <img src={cover} alt={current.Album ?? current.Name} className={`h-full w-full object-cover transition-transform duration-700 ${playing ? 'scale-100' : 'scale-[0.94]'}`} />
      ) : (
        <div className="h-full w-full flex items-center justify-center text-7xl text-white/40">♪</div>
      )}
    </div>
  )

  const tabBtn = (active: boolean) =>
    `h-9 px-4 rounded-full text-sm font-semibold transition-colors ${active ? 'bg-white text-ink-950' : 'text-white/70 hover:text-white hover:bg-white/10'}`

  const topBar = (
      <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-3 px-4 sm:px-6 pt-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <button
          onClick={() => setExpanded(false)}
          className="h-10 w-10 shrink-0 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur flex items-center justify-center transition-colors"
          aria-label="Close now playing"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        <p className="flex-1 min-w-0 text-center text-xs font-semibold uppercase tracking-[0.14em] text-white/55 truncate">
          {current.Album ? `Playing from ${current.Album}` : 'Now playing'}
        </p>
        <div className="hidden sm:flex shrink-0 gap-0.5 rounded-full bg-black/30 backdrop-blur border border-white/10 p-0.5" aria-label="Visualizer">
          {VISUALIZER_STYLES.map((v) => (
            <button
              key={v}
              onClick={() => pickViz(v)}
              aria-pressed={v === viz}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${v === viz ? 'bg-white/90 text-ink-950' : 'text-white/60 hover:text-white'}`}
            >
              {VIZ_LABEL[v]}
            </button>
          ))}
        </div>
        <span className="sm:hidden w-10" />
      </div>
  )

  if (lyricVideo) {
    return (
      <div className={`fixed inset-0 z-[75] overflow-hidden bg-black text-white ${chrome ? '' : 'cursor-none'}`} role="dialog" aria-label="Now playing">
        <LyricVideo track={current} />
        <div className={`transition-opacity duration-500 ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          {topBar}
          <div className="absolute bottom-0 inset-x-0 z-10 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 sm:px-8 pt-20 pb-5" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
            <div
              className="group/seek h-4 flex items-center cursor-pointer"
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(position)}
              onPointerDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                seek(((e.clientX - r.left) / r.width) * duration)
              }}
            >
              <div className="relative w-full h-1 rounded-full bg-white/25">
                <div className="absolute h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {bg && <img src={bg} alt="" className="h-11 w-11 rounded-md object-cover ring-1 ring-white/15" />}
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">{current.Name}</p>
                  <p className="truncate text-[13px] text-white/60">{artistOf(current)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-3">
                <button onClick={prev} className="h-11 w-11 flex items-center justify-center text-white/85 hover:text-white" aria-label="Previous">
                  <FillIcon d={I.prev} className="h-7 w-7" />
                </button>
                <button
                  onClick={toggle}
                  className="h-12 w-12 rounded-full bg-white text-ink-950 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
                  aria-label={playing ? 'Pause' : 'Play'}
                >
                  <FillIcon d={playing ? I.pause : I.play} className={`h-6 w-6 ${playing ? '' : 'translate-x-0.5'}`} />
                </button>
                <button
                  onClick={next}
                  disabled={index >= queue.length - 1 && repeat !== 'all'}
                  className="h-11 w-11 flex items-center justify-center text-white/85 hover:text-white disabled:opacity-30"
                  aria-label="Next"
                >
                  <FillIcon d={I.next} className="h-7 w-7" />
                </button>
              </div>
              <div className="flex-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => pickViz(lastCanvasViz.current)}
                  className="h-9 px-4 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur text-sm font-semibold transition-colors"
                >
                  <span className="hidden sm:inline">Exit lyric video</span>
                  <span className="sm:hidden">Exit</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[75] overflow-hidden bg-ink-950 text-white" role="dialog" aria-label="Now playing">
      {/* The room takes the record's colour */}
      {bg && <img src={bg} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover blur-3xl brightness-[0.3] saturate-150 scale-125" />}
      {mood && (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: `radial-gradient(60% 55% at 25% 45%, rgba(${mood}, 0.28), transparent 70%)` }}
        />
      )}
      <AudioVisualizer variant={viz} className="absolute inset-0 h-full w-full opacity-40 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/30 via-ink-950/45 to-ink-950/85" />

      {topBar}

      <div className="relative h-full max-w-7xl mx-auto px-5 sm:px-8 lg:px-14 pt-16 lg:pt-0 pb-5 flex flex-col lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
        {/* Record + controls */}
        <section className="flex-1 min-h-0 flex flex-col lg:justify-center">
          <div className="flex-1 min-h-0 flex items-center justify-center lg:flex-none lg:justify-start">
            {wide || phoneView === 'art' ? (
              artwork
            ) : phoneView === 'lyrics' ? (
              <div className="h-full w-full">
                <LyricsPanel track={current} position={position} onSeek={seek} compact />
              </div>
            ) : (
              <div className="h-full w-full py-2">
                <QueuePanel queue={queue} index={index} onJump={jumpTo} />
              </div>
            )}
          </div>

          <div className="mt-6 lg:mt-8 w-full" style={wide ? { maxWidth: artMax } : undefined}>
            <h1 className="font-display text-3xl sm:text-4xl leading-tight truncate">{current.Name}</h1>
            <p className="mt-1 text-[15px] text-white/65 truncate">
              {artistOf(current)}
              {current.Album && (
                <>
                  <span className="text-white/35"> · </span>
                  <button type="button" onClick={openAlbum} className="hover:text-white hover:underline underline-offset-2">
                    {current.Album}
                  </button>
                </>
              )}
            </p>

            {/* Seek */}
            <div
              className="group/seek mt-5 h-5 flex items-center cursor-pointer"
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(position)}
              onPointerDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                seek(((e.clientX - r.left) / r.width) * duration)
              }}
            >
              <div className="relative w-full h-1.5 rounded-full bg-white/20">
                <div className="absolute h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
                <div
                  className="absolute h-3.5 w-3.5 rounded-full bg-white shadow -translate-y-1/2 top-1/2 -translate-x-1/2 opacity-0 group-hover/seek:opacity-100 transition-opacity"
                  style={{ left: `${pct}%` }}
                />
              </div>
            </div>
            <div className="flex justify-between text-xs tabular-nums text-white/50 mt-1.5">
              <span>{fmt(position)}</span>
              <span>-{fmt(Math.max(0, duration - position))}</span>
            </div>

            {/* Transport */}
            <div className="mt-3 flex items-center justify-between max-w-sm mx-auto lg:mx-0">
              <button
                onClick={toggleShuffle}
                aria-label="Shuffle"
                aria-pressed={shuffle}
                className={`h-11 w-11 flex items-center justify-center rounded-full transition-colors ${shuffle ? 'text-white bg-white/15' : 'text-white/55 hover:text-white'}`}
              >
                <StrokeIcon d={I.shuffle} className="h-5 w-5" />
              </button>
              <button onClick={prev} className="h-12 w-12 flex items-center justify-center text-white/85 hover:text-white active:scale-90 transition" aria-label="Previous">
                <FillIcon d={I.prev} className="h-8 w-8" />
              </button>
              <button
                onClick={toggle}
                className="h-16 w-16 rounded-full bg-white text-ink-950 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                <FillIcon d={playing ? I.pause : I.play} className={`h-8 w-8 ${playing ? '' : 'translate-x-0.5'}`} />
              </button>
              <button
                onClick={next}
                disabled={index >= queue.length - 1 && repeat !== 'all'}
                className="h-12 w-12 flex items-center justify-center text-white/85 hover:text-white active:scale-90 disabled:opacity-30 transition"
                aria-label="Next"
              >
                <FillIcon d={I.next} className="h-8 w-8" />
              </button>
              <button
                onClick={cycleRepeat}
                aria-label={repeat === 'one' ? 'Repeat this song' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}
                aria-pressed={repeat !== 'off'}
                className={`relative h-11 w-11 flex items-center justify-center rounded-full transition-colors ${repeat !== 'off' ? 'text-white bg-white/15' : 'text-white/55 hover:text-white'}`}
              >
                <StrokeIcon d={I.repeat} className="h-5 w-5" />
                {repeat === 'one' && (
                  <span className="absolute top-1 right-1 h-4 w-4 rounded-full bg-white text-ink-950 text-[10px] font-bold leading-4 text-center">1</span>
                )}
              </button>
            </div>

            {/* Phones: swap the artwork for lyrics / the queue */}
            {!wide && (
              <div className="mt-4 flex justify-center gap-2">
                <button type="button" onClick={() => setPhoneView((v) => (v === 'lyrics' ? 'art' : 'lyrics'))} aria-pressed={phoneView === 'lyrics'} className={tabBtn(phoneView === 'lyrics')}>
                  Lyrics
                </button>
                <button type="button" onClick={() => setPhoneView((v) => (v === 'queue' ? 'art' : 'queue'))} aria-pressed={phoneView === 'queue'} className={tabBtn(phoneView === 'queue')}>
                  Up next
                </button>
                <button type="button" onClick={() => pickViz('lyrics')} className={tabBtn(false)}>
                  ✦ Video
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Lyrics / Up next */}
        {wide && (
          <section className="h-[calc(var(--vh)*78)] flex flex-col min-h-0">
            <div className="flex gap-2 mb-4">
              <button type="button" onClick={() => setPanel('lyrics')} aria-pressed={panel === 'lyrics'} className={tabBtn(panel === 'lyrics')}>
                Lyrics
              </button>
              <button type="button" onClick={() => setPanel('queue')} aria-pressed={panel === 'queue'} className={tabBtn(panel === 'queue')}>
                Up next
              </button>
              <button type="button" onClick={() => pickViz('lyrics')} className={`${tabBtn(false)} ml-auto`}>
                ✦ Lyric video
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {panel === 'lyrics' ? (
                <LyricsPanel track={current} position={position} onSeek={seek} />
              ) : (
                <QueuePanel queue={queue} index={index} onJump={jumpTo} />
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
