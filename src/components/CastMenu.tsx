import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCastTargets, playOnSession } from '../api/client'
import { useToast } from './Toast'
import type { JfItem } from '../api/types'

/**
 * "Play on …" — push the current title to another device (the TV) via Jellyfin's
 * Sessions remote-control API. Lists the user's other controllable devices and,
 * on pick, tells that device to start playing now (at the resume point if any).
 */
export default function CastMenu({ item }: { item: JfItem }) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const toast = useToast()

  const { data: targets, isLoading, refetch } = useQuery({
    queryKey: ['castTargets'],
    queryFn: getCastTargets,
    enabled: open,
    staleTime: 15_000,
  })

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const cast = async (sessionId: string, deviceName: string) => {
    setSending(sessionId)
    try {
      const resume = item.UserData?.PlaybackPositionTicks ?? 0
      await playOnSession(sessionId, item.Id, resume)
      toast(`Playing on ${deviceName}`)
      setOpen(false)
    } catch {
      toast(`Couldn’t play on ${deviceName}`, 'error')
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen((v) => !v); if (!open) refetch() }}
        aria-label="Play on another device"
        title="Play on another device"
        className="h-10 w-10 rounded-full flex items-center justify-center backdrop-blur-md bg-white/10 text-white hover:bg-white/20 transition-all active:scale-90"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 6.75A2.25 2.25 0 0 1 5.25 4.5h13.5A2.25 2.25 0 0 1 21 6.75v8.5a2.25 2.25 0 0 1-2.25 2.25H14M3 16.5a4.5 4.5 0 0 1 4.5 4.5M3 13.5a7.5 7.5 0 0 1 7.5 7.5M3 20.25h.008v.008H3v-.008Z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl bg-ink-800 border border-white/10 shadow-2xl py-1.5 text-sm z-50">
          <p className="px-4 py-2 text-xs text-ink-400 border-b border-white/5">Play on…</p>
          {isLoading && <p className="px-4 py-3 text-ink-400">Looking for devices…</p>}
          {!isLoading && (!targets || targets.length === 0) && (
            <p className="px-4 py-3 text-ink-400">
              No other devices found. Open Jellyfin on your TV, then try again.
            </p>
          )}
          {targets?.map((t) => {
            const name = t.DeviceName || t.Client || 'Device'
            return (
              <button
                key={t.Id}
                onClick={() => cast(t.Id, name)}
                disabled={sending !== null}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 text-left text-ink-200 disabled:opacity-50 transition-colors"
              >
                <svg className="h-4 w-4 shrink-0 text-accent-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12M9 16.5v3.75M15 16.5v3.75M3.375 16.5h17.25c.621 0 1.125-.504 1.125-1.125V4.875A1.125 1.125 0 0 0 20.625 3.75H3.375A1.125 1.125 0 0 0 2.25 4.875v10.5c0 .621.504 1.125 1.125 1.125Z" />
                </svg>
                <span className="min-w-0 flex-1 truncate">
                  {name}
                  {t.Client && t.DeviceName && <span className="text-ink-400"> · {t.Client}</span>}
                </span>
                {sending === t.Id && <span className="text-xs text-accent-300 shrink-0">Sending…</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
