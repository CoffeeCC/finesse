import { useEffect, useMemo, useRef, useState } from 'react'
import { useAudio } from '../audio/AudioPlayerContext'
import { useLyrics } from '../api/queries'
import { imageUrl } from '../api/client'
import { ticksToSeconds } from '../api/types'
import { getPrefs, setPrefs, VISUALIZER_STYLES, type VisualizerStyle } from '../lib/settings'
import AudioVisualizer from './AudioVisualizer'
import type { JfItem } from '../api/types'

const VIZ_LABEL: Record<VisualizerStyle, string> = {
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

function art(t: JfItem, w = 800): string | null {
  if (t.ImageTags?.Primary) return imageUrl(t.Id, 'Primary', { maxWidth: w, tag: t.ImageTags.Primary })
  if (t.AlbumId && t.AlbumPrimaryImageTag) return imageUrl(t.AlbumId, 'Primary', { maxWidth: w, tag: t.AlbumPrimaryImageTag })
  return null
}

function Lyrics({ itemId, position }: { itemId: string; position: number }) {
  const { data } = useLyrics(itemId)
  const activeRef = useRef<HTMLParagraphElement>(null)
  const lines = data?.Lyrics ?? []
  const synced = lines.length > 0 && lines.every((l) => typeof l.Start === 'number')

  const activeIdx = useMemo(() => {
    if (!synced) return -1
    let idx = -1
    for (let i = 0; i < lines.length; i++) {
      if (ticksToSeconds(lines[i].Start) <= position) idx = i
      else break
    }
    return idx
  }, [synced, lines, position])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIdx])

  if (lines.length === 0) {
    return <p className="text-ink-400 text-sm">No lyrics for this track.</p>
  }

  return (
    <div className="space-y-3 py-[40vh]">
      {lines.map((l, i) => (
        <p
          key={i}
          ref={i === activeIdx ? activeRef : undefined}
          className={`text-lg font-semibold transition-all duration-300 ${
            !synced
              ? 'text-ink-200'
              : i === activeIdx
                ? 'text-white scale-105'
                : 'text-ink-400/60'
          }`}
        >
          {l.Text || ' '}
        </p>
      ))}
    </div>
  )
}

export default function NowPlaying() {
  const { current, expanded, setExpanded, playing, position, duration, toggle, next, prev, seek, index, queue } =
    useAudio()
  const [viz, setViz] = useState<VisualizerStyle>(() => getPrefs().visualizer)
  const pickViz = (v: VisualizerStyle) => {
    setViz(v)
    setPrefs({ visualizer: v })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    if (expanded) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, setExpanded])

  if (!expanded || !current) return null

  const cover = art(current)
  const bg = art(current, 400)
  const pct = duration ? (position / duration) * 100 : 0

  return (
    <div className="fixed inset-0 z-[75] overflow-hidden bg-ink-950">
      {/* Blurred album-art wash */}
      {bg && (
        <img src={bg} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover blur-3xl brightness-[0.25] saturate-150 scale-125" />
      )}
      {/* Visualizer fills the backdrop behind the content */}
      <AudioVisualizer variant={viz} className="absolute inset-0 h-full w-full opacity-60 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/40 via-ink-950/55 to-ink-950/85" />

      {/* Visualizer style picker */}
      <div className="absolute top-5 right-5 z-10 flex gap-1 rounded-full bg-ink-900/70 backdrop-blur border border-white/10 p-1">
        {VISUALIZER_STYLES.map((v) => (
          <button
            key={v}
            onClick={() => pickViz(v)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              v === viz ? 'bg-accent-500 text-white' : 'text-ink-400 hover:text-white'
            }`}
          >
            {VIZ_LABEL[v]}
          </button>
        ))}
      </div>

      {/* Collapse */}
      <button
        onClick={() => setExpanded(false)}
        className="absolute top-5 left-5 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur flex items-center justify-center text-white transition-colors z-10"
        aria-label="Close now playing"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      <div className="relative h-full max-w-6xl mx-auto px-6 lg:px-12 grid lg:grid-cols-2 gap-10 items-center">
        {/* Left: art + controls */}
        <div className="flex flex-col items-center lg:items-start justify-center pt-16 lg:pt-0">
          <div className="w-64 h-64 lg:w-80 lg:h-80 rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-ink-800">
            {cover ? (
              <img src={cover} alt={current.Name} className={`h-full w-full object-cover transition-transform duration-700 ${playing ? 'scale-100' : 'scale-95'}`} />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-7xl text-ink-400">♪</div>
            )}
          </div>

          <div className="mt-6 w-full max-w-sm text-center lg:text-left">
            <h1 className="text-2xl font-bold text-white truncate">{current.Name}</h1>
            <p className="text-ink-300 truncate">
              {current.Artists?.join(', ') || current.AlbumArtist || current.Album || ''}
            </p>

            {/* Seek */}
            <div
              className="group/seek mt-5 h-5 flex items-center cursor-pointer"
              onPointerDown={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                seek(((e.clientX - r.left) / r.width) * duration)
              }}
            >
              <div className="relative w-full h-1 group-hover/seek:h-1.5 rounded-full bg-white/20 transition-all">
                <div className="absolute h-full rounded-full bg-accent-400" style={{ width: `${pct}%` }} />
                <div className="absolute h-3 w-3 rounded-full bg-accent-300 -translate-y-1/2 top-1/2 -translate-x-1/2 opacity-0 group-hover/seek:opacity-100" style={{ left: `${pct}%` }} />
              </div>
            </div>
            <div className="flex justify-between text-xs tabular-nums text-ink-400 mt-1.5">
              <span>{fmt(position)}</span>
              <span>{fmt(duration)}</span>
            </div>

            {/* Transport */}
            <div className="mt-4 flex items-center justify-center lg:justify-start gap-6">
              <button onClick={prev} className="text-ink-200 hover:text-white hover:scale-110 transition-all" aria-label="Previous">
                <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
              </button>
              <button onClick={toggle} className="h-14 w-14 rounded-full bg-white text-ink-950 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform" aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? (
                  <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6zm8-14v14h4V5z" /></svg>
                ) : (
                  <svg className="h-7 w-7 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                )}
              </button>
              <button onClick={next} disabled={index >= queue.length - 1} className="text-ink-200 hover:text-white hover:scale-110 disabled:opacity-30 transition-all" aria-label="Next">
                <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6zM16 6v12h2V6z" /></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Right: lyrics */}
        <div className="hidden lg:block relative h-full overflow-hidden">
          <div className="h-full overflow-y-auto no-scrollbar [mask-image:linear-gradient(transparent,black_20%,black_80%,transparent)]">
            <Lyrics itemId={current.Id} position={position} />
          </div>
        </div>
      </div>
    </div>
  )
}
