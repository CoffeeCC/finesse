import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import * as api from '../api/client'
import { secondsToTicks } from '../api/types'
import type { JfItem } from '../api/types'

interface AudioState {
  queue: JfItem[]
  index: number
  current: JfItem | null
  playing: boolean
  position: number
  duration: number
  expanded: boolean
  setExpanded: (v: boolean) => void
  getAnalyser: () => AnalyserNode | null
  playQueue: (items: JfItem[], startIndex?: number, opts?: { shuffle?: boolean }) => void
  /** Play the queue's item at this position. */
  jumpTo: (index: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (sec: number) => void
  stop: () => void
  shuffle: boolean
  toggleShuffle: () => void
  repeat: RepeatMode
  cycleRepeat: () => void
}

export type RepeatMode = 'off' | 'all' | 'one'

/** Fisher–Yates, into a new array. */
function shuffled<T>(list: T[]): T[] {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const Ctx = createContext<AudioState | null>(null)

function randomId() {
  try {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* ignore */
  }
  return `s-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const PROGRESS_MS = 10_000

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [queue, setQueue] = useState<JfItem[]>([])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  // The queue as it was before shuffling, so turning shuffle off restores order.
  const unshuffled = useRef<JfItem[] | null>(null)
  const sessionRef = useRef<string>('')

  // Web Audio graph for visualizers (built once; needs crossOrigin audio + CORS)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const ensureGraph = useCallback(() => {
    const a = audioRef.current
    if (!a || sourceRef.current) return
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctor()
      const src = ctx.createMediaElementSource(a)
      const an = ctx.createAnalyser()
      an.fftSize = 512
      an.smoothingTimeConstant = 0.82
      src.connect(an)
      an.connect(ctx.destination)
      audioCtxRef.current = ctx
      analyserRef.current = an
      sourceRef.current = src
    } catch {
      /* analyser unavailable (e.g. CORS) — playback still works */
    }
  }, [])
  const getAnalyser = useCallback(() => analyserRef.current, [])

  const current = queue[index] ?? null

  const report = useCallback(
    (
      fn: (r: {
        itemId: string
        mediaSourceId: string
        playSessionId: string
        positionTicks: number
        isPaused?: boolean
      }) => unknown,
      paused?: boolean,
    ) => {
      const a = audioRef.current
      if (!current || !a) return
      fn({
        itemId: current.Id,
        mediaSourceId: current.Id,
        playSessionId: sessionRef.current,
        positionTicks: secondsToTicks(a.currentTime),
        isPaused: paused,
      })
    },
    [current],
  )

  // Load + play whenever the current track changes
  useEffect(() => {
    const a = audioRef.current
    if (!a || !current) return
    sessionRef.current = randomId()
    ensureGraph()
    audioCtxRef.current?.resume().catch(() => {})
    a.src = api.audioStreamUrl(current.Id)
    a.play().then(
      () => report(api.reportPlaybackStart),
      () => {},
    )
    return () => {
      report(api.reportPlaybackStopped)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.Id])

  // Periodic progress reports
  useEffect(() => {
    if (!current) return
    const t = setInterval(() => report(api.reportPlaybackProgress, !playing), PROGRESS_MS)
    return () => clearInterval(t)
  }, [current, playing, report])

  const next = useCallback(() => {
    // Wraps to the top when repeating the whole queue.
    setIndex((i) => (i + 1 < queue.length ? i + 1 : repeat === 'all' ? 0 : i))
  }, [queue.length, repeat])

  const prev = useCallback(() => {
    const a = audioRef.current
    // Restart the track if we're past 3s, otherwise go to the previous one
    if (a && a.currentTime > 3) {
      a.currentTime = 0
      return
    }
    setIndex((i) => (i > 0 ? i - 1 : i))
  }, [])

  const playQueue = useCallback((items: JfItem[], startIndex = 0, opts: { shuffle?: boolean } = {}) => {
    if (opts.shuffle) {
      unshuffled.current = items
      setShuffle(true)
      setQueue(shuffled(items))
      setIndex(0)
      return
    }
    unshuffled.current = null
    setShuffle(false)
    setQueue(items)
    setIndex(startIndex)
  }, [])

  const jumpTo = useCallback((i: number) => {
    if (i >= 0 && i < queue.length) setIndex(i)
  }, [queue.length])

  // Shuffle keeps the current song playing and reorders everything around it.
  const toggleShuffle = useCallback(() => {
    const cur = queue[index]
    if (!cur) {
      setShuffle((v) => !v)
      return
    }
    if (!shuffle) {
      unshuffled.current = queue
      const rest = shuffled(queue.filter((_, i) => i !== index))
      setQueue([cur, ...rest])
      setIndex(0)
      setShuffle(true)
    } else {
      const original = unshuffled.current ?? queue
      unshuffled.current = null
      setQueue(original)
      setIndex(Math.max(0, original.findIndex((t) => t.Id === cur.Id)))
      setShuffle(false)
    }
  }, [queue, index, shuffle])

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))
  }, [])

  const toggle = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }, [])

  const seek = useCallback((sec: number) => {
    const a = audioRef.current
    if (a) a.currentTime = sec
  }, [])

  const stop = useCallback(() => {
    report(api.reportPlaybackStopped)
    setQueue([])
    setIndex(0)
    setPlaying(false)
  }, [report])

  const onEnded = useCallback(() => {
    const a = audioRef.current
    if (repeat === 'one' && a) {
      a.currentTime = 0
      a.play().catch(() => {})
      return
    }
    report(api.reportPlaybackStopped)
    if (index + 1 < queue.length) setIndex(index + 1)
    else if (repeat === 'all' && queue.length > 0) {
      if (queue.length === 1 && a) {
        a.currentTime = 0
        a.play().catch(() => {})
      } else setIndex(0)
    }
  }, [repeat, index, queue.length, report])

  // Lock screen / notification / hardware media keys (phones, laptops).
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
    if (!ms || !current) return
    const cover = current.AlbumId && current.AlbumPrimaryImageTag
      ? api.imageUrl(current.AlbumId, 'Primary', { maxWidth: 512, tag: current.AlbumPrimaryImageTag })
      : current.ImageTags?.Primary
        ? api.imageUrl(current.Id, 'Primary', { maxWidth: 512, tag: current.ImageTags.Primary })
        : null
    try {
      ms.metadata = new MediaMetadata({
        title: current.Name,
        artist: current.Artists?.join(', ') || current.AlbumArtist || '',
        album: current.Album ?? '',
        artwork: cover ? [{ src: cover, sizes: '512x512' }] : [],
      })
      ms.setActionHandler('play', () => audioRef.current?.play().catch(() => {}))
      ms.setActionHandler('pause', () => audioRef.current?.pause())
      ms.setActionHandler('previoustrack', prev)
      ms.setActionHandler('nexttrack', next)
      ms.setActionHandler('seekto', (d) => {
        if (audioRef.current && d.seekTime != null) audioRef.current.currentTime = d.seekTime
      })
    } catch {
      /* older engines: no MediaMetadata / some actions unsupported */
    }
  }, [current, prev, next])

  return (
    <Ctx.Provider
      value={{
        queue, index, current, playing, position, duration, expanded, setExpanded, getAnalyser,
        playQueue, jumpTo, toggle, next, prev, seek, stop, shuffle, toggleShuffle, repeat, cycleRepeat,
      }}
    >
      {children}
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={onEnded}
      />
    </Ctx.Provider>
  )
}

export function useAudio(): AudioState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAudio outside AudioPlayerProvider')
  return ctx
}
