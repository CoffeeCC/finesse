import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'
import { setCastTarget, useCastTarget } from '../lib/castTarget'
import { ticksToSeconds } from '../api/types'

const POLL_MS = 2000
const SEEK_STEP_TICKS = 10 * 10_000_000

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

/** Mini remote for the device you cast to: what's playing there, play/pause,
 *  ±10s, stop, tap-to-seek. Follows the target's session (polled), and closes
 *  itself once playback there ends. */
export default function CastRemote() {
  const target = useCastTarget()
  const queryClient = useQueryClient()
  const { data: remote, isFetched } = useQuery({
    queryKey: ['castSession', target?.sessionId],
    enabled: !!target,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    queryFn: async () => (await api.getSessions()).find((s) => s.Id === target!.sessionId) ?? null,
  })

  // Smooth the clock between polls.
  const [, setTick] = useState(0)
  const polledAt = useRef(0)
  useEffect(() => {
    polledAt.current = performance.now()
  }, [remote])
  const item = remote?.NowPlayingItem
  const paused = remote?.PlayState?.IsPaused ?? false
  useEffect(() => {
    if (!item || paused) return
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [item, paused])

  // Close once playback there has ended (or the device went away) — but give a
  // freshly-cast device time to actually start.
  const seenPlaying = useRef(false)
  const idlePolls = useRef(0)
  const castAt = useRef(performance.now())
  useEffect(() => {
    seenPlaying.current = false
    idlePolls.current = 0
    castAt.current = performance.now()
  }, [target?.sessionId, target?.itemId])
  useEffect(() => {
    if (!target || !isFetched) return
    if (item) {
      seenPlaying.current = true
      idlePolls.current = 0
      return
    }
    idlePolls.current++
    const gaveUp = !seenPlaying.current && performance.now() - castAt.current > 45_000
    if ((seenPlaying.current && idlePolls.current >= 2) || gaveUp || remote === null) setCastTarget(null)
  }, [remote, item, isFetched, target])

  if (!target) return null

  const runtime = ticksToSeconds(item?.RunTimeTicks)
  const polledPos = ticksToSeconds(remote?.PlayState?.PositionTicks)
  const pos = Math.min(
    runtime || Infinity,
    polledPos + (item && !paused ? (performance.now() - polledAt.current) / 1000 : 0),
  )
  const frac = runtime ? Math.min(1, pos / runtime) : 0
  const title = item
    ? item.Type === 'Episode'
      ? `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? '?'}:E${item.IndexNumber ?? '?'}`
      : item.Name
    : `Starting on ${target.deviceName}…`
  const art = item ? api.backdropUrl(item, 320) ?? api.posterUrl(item, 160) : null

  const send = async (cmd: api.PlaystateCommand, seekTicks?: number) => {
    try {
      await api.sendPlaystate(target.sessionId, cmd, seekTicks)
    } catch {
      /* the next poll shows the truth */
    }
    if (cmd === 'Stop') setCastTarget(null)
    else window.setTimeout(() => queryClient.invalidateQueries({ queryKey: ['castSession'] }), 400)
  }
  const seekBy = (deltaTicks: number) =>
    send('Seek', Math.max(0, Math.round(pos * 10_000_000) + deltaTicks))

  const btn =
    'h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-ink-200 hover:text-white hover:bg-white/10 active:scale-90 transition disabled:opacity-30'

  return (
    <div
      role="region"
      aria-label={`Remote for ${target.deviceName}`}
      className="fixed z-40 inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:inset-x-auto md:right-5 md:bottom-5 md:w-[27rem] overflow-hidden rounded-2xl border border-white/10 bg-ink-900/95 backdrop-blur-xl shadow-2xl shadow-black/50 toast-in"
    >
      <div className="flex items-center gap-1.5 sm:gap-3 p-2.5 pr-2">
        <div className="relative hidden sm:block h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-ink-800">
          {art && <img src={art} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1 pl-1 sm:pl-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-accent-300 truncate">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 6.75A2.25 2.25 0 0 1 5.25 4.5h13.5A2.25 2.25 0 0 1 21 6.75v8.5a2.25 2.25 0 0 1-2.25 2.25H14M3 16.5a4.5 4.5 0 0 1 4.5 4.5M3 13.5a7.5 7.5 0 0 1 7.5 7.5M3 20.25h.008v.008H3v-.008Z" />
            </svg>
            Playing on {target.deviceName}
          </p>
          <p className="text-sm font-medium text-white truncate">{title}</p>
          {item && runtime > 0 && (
            <p className="text-[11px] tabular-nums text-ink-400">
              {fmt(pos)} / {fmt(runtime)}
            </p>
          )}
        </div>
        <button onClick={() => seekBy(-SEEK_STEP_TICKS)} disabled={!item} className={btn} aria-label="Back 10 seconds on the TV">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </svg>
        </button>
        <button
          onClick={() => send(paused ? 'Unpause' : 'Pause')}
          disabled={!item}
          className="h-11 w-11 shrink-0 rounded-full bg-white text-ink-950 flex items-center justify-center hover:scale-105 active:scale-95 transition disabled:opacity-40"
          aria-label={paused ? 'Resume on the TV' : 'Pause on the TV'}
        >
          {paused || !item ? (
            <svg className="h-5 w-5 translate-x-px" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          ) : (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          )}
        </button>
        <button onClick={() => seekBy(SEEK_STEP_TICKS)} disabled={!item} className={btn} aria-label="Forward 10 seconds on the TV">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path transform="matrix(-1 0 0 1 24 0)" d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </svg>
        </button>
        <button onClick={() => send('Stop')} className={btn} aria-label="Stop playback on the TV" title="Stop">
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
        </button>
        <button onClick={() => setCastTarget(null)} className={`${btn} !h-8 !w-8`} aria-label="Hide remote" title="Hide">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {/* Tap anywhere on the bar to jump there */}
      <div
        className="h-2 -mt-1 flex items-end cursor-pointer"
        onClick={(e) => {
          if (!item || !runtime) return
          const r = e.currentTarget.getBoundingClientRect()
          send('Seek', Math.round(((e.clientX - r.left) / r.width) * runtime * 10_000_000))
        }}
      >
        <div className="h-1 w-full bg-white/10">
          <div className="h-full bg-accent-400 transition-[width] duration-1000 ease-linear" style={{ width: `${frac * 100}%` }} />
        </div>
      </div>
    </div>
  )
}
