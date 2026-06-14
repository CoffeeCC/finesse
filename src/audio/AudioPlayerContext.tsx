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
  playQueue: (items: JfItem[], startIndex?: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  seek: (sec: number) => void
  stop: () => void
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
    setIndex((i) => (i + 1 < queue.length ? i + 1 : i))
  }, [queue.length])

  const prev = useCallback(() => {
    const a = audioRef.current
    // Restart the track if we're past 3s, otherwise go to the previous one
    if (a && a.currentTime > 3) {
      a.currentTime = 0
      return
    }
    setIndex((i) => (i > 0 ? i - 1 : i))
  }, [])

  const playQueue = useCallback((items: JfItem[], startIndex = 0) => {
    setQueue(items)
    setIndex(startIndex)
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

  return (
    <Ctx.Provider
      value={{ queue, index, current, playing, position, duration, expanded, setExpanded, getAnalyser, playQueue, toggle, next, prev, seek, stop }}
    >
      {children}
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => {
          report(api.reportPlaybackStopped)
          next()
        }}
      />
    </Ctx.Provider>
  )
}

export function useAudio(): AudioState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAudio outside AudioPlayerProvider')
  return ctx
}
