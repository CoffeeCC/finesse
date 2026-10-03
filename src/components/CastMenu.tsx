import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { getCastTargets, playOnSession } from '../api/client'
import { useToast } from './Toast'
import { pushBackHandler } from '../lib/back'
import { setCastTarget } from '../lib/castTarget'
import type { JfItem } from '../api/types'
import { ACTION_BTN, actionCircle } from './ActionButton'

const CAST_ICON =
  'M3 6.75A2.25 2.25 0 0 1 5.25 4.5h13.5A2.25 2.25 0 0 1 21 6.75v8.5a2.25 2.25 0 0 1-2.25 2.25H14M3 16.5a4.5 4.5 0 0 1 4.5 4.5M3 13.5a7.5 7.5 0 0 1 7.5 7.5M3 20.25h.008v.008H3v-.008Z'

function CastIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={CAST_ICON} />
    </svg>
  )
}

/**
 * "Play on …" — push a title to another device (the TV) via Jellyfin's Sessions
 * remote-control API. Lists the user's other controllable devices and, on pick,
 * tells that device to start playing now (at the resume point, or wherever the
 * player here has got to).
 *
 * Looks: `labelled` (a title's page), `os` (the home stage's glass circle),
 * `player` (the player's bar), or a plain round icon. The list floats over the
 * page (a portal), so a clipped parent like the home stage can't cut it off.
 */
export default function CastMenu({
  item,
  labelled = false,
  variant,
  startTicks,
  onCast,
  className = '',
}: {
  item: JfItem
  labelled?: boolean
  variant?: 'os' | 'player'
  /** Where to start on the other device (the player: its current position). */
  startTicks?: () => number
  /** After the other device has been told to play (the player pauses and steps back). */
  onCast?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties | null>(null)
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
      const t = e.target as Node
      if (ref.current && !ref.current.contains(t) && !popRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  useEffect(() => {
    if (!open) return
    return pushBackHandler(() => {
      setOpen(false)
      return true
    })
  }, [open])

  // Pin the list to the button: below it, or above when there's no room (the player's bar).
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.min(272, window.innerWidth - 24)
      const left = Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12))
      const up = window.innerHeight - r.bottom < 260 && r.top > window.innerHeight - r.bottom
      setPos(up ? { left, width, bottom: window.innerHeight - r.top + 10 } : { left, width, top: r.bottom + 10 })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const cast = async (sessionId: string, deviceName: string) => {
    setSending(sessionId)
    try {
      const resume = startTicks ? startTicks() : (item.UserData?.PlaybackPositionTicks ?? 0)
      await playOnSession(sessionId, item.Id, resume)
      setCastTarget({ sessionId, deviceName, itemId: item.Id })
      toast(`Playing on ${deviceName}`)
      setOpen(false)
      onCast?.()
    } catch {
      toast(`Couldn’t play on ${deviceName}`, 'error')
    } finally {
      setSending(null)
    }
  }

  const toggle = () => {
    setOpen((v) => !v)
    if (!open) void refetch()
  }

  const trigger =
    variant === 'os' ? (
      <button type="button" onClick={toggle} aria-label="Play on another device" aria-expanded={open} title="Play on another device" className={`os-btn os-glass max-sm:w-12 max-sm:px-0 ${className}`}>
        <CastIcon />
        <span className="hidden sm:inline">Play on…</span>
      </button>
    ) : variant === 'player' ? (
      <button type="button" onClick={toggle} aria-label="Play on another device" aria-expanded={open} title="Play on another device" className={className}>
        <CastIcon className="h-6 w-6" />
      </button>
    ) : labelled ? (
      <button type="button" onClick={toggle} aria-label="Play on another device" aria-expanded={open} title="Play on another device" className={ACTION_BTN}>
        <span className={actionCircle(open)}>
          <CastIcon />
        </span>
        <span className="leading-tight text-center">Play on…</span>
      </button>
    ) : (
      <button
        type="button"
        onClick={toggle}
        aria-label="Play on another device"
        aria-expanded={open}
        title="Play on another device"
        className="h-10 w-10 rounded-full flex items-center justify-center backdrop-blur-md bg-white/10 text-white hover:bg-white/20 transition-all active:scale-90"
      >
        <CastIcon />
      </button>
    )

  return (
    <div className="relative" ref={ref}>
      {trigger}
      {open &&
        pos &&
        createPortal(
          <div ref={popRef} role="menu" aria-label="Play on" className="os-menu toast-in fixed z-[95] rounded-[24px] p-1.5 text-sm" style={pos}>
            <p className="px-3 pb-2 pt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-white/50">Play on</p>
            {isLoading && <p className="px-3 py-3 text-white/60">Looking for devices…</p>}
            {!isLoading && (!targets || targets.length === 0) && (
              <p className="px-3 py-3 leading-relaxed text-white/70">
                No other devices found. Open Finesse (or Jellyfin) on your TV, then try again.
              </p>
            )}
            {targets?.map((t) => {
              const name = t.DeviceName || t.Client || 'Device'
              return (
                <button
                  key={t.Id}
                  type="button"
                  onClick={() => cast(t.Id, name)}
                  disabled={sending !== null}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-[15px] text-white/90 transition-colors hover:bg-white/[0.08] disabled:opacity-50 [@media(hover:none)]:py-3"
                >
                  <svg className="h-[18px] w-[18px] shrink-0 text-white/55" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12M9 16.5v3.75M15 16.5v3.75M3.375 16.5h17.25c.621 0 1.125-.504 1.125-1.125V4.875A1.125 1.125 0 0 0 20.625 3.75H3.375A1.125 1.125 0 0 0 2.25 4.875v10.5c0 .621.504 1.125 1.125 1.125Z" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate">
                    {name}
                    {t.Client && t.DeviceName && <span className="text-white/45"> · {t.Client}</span>}
                  </span>
                  {sending === t.Id && <span className="shrink-0 text-xs text-white/60">Sending…</span>}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
