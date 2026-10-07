import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { clock, getInbox, markMomentsRead, momentHref, useInbox, useMomentsOn, type InboxMoment } from '../../api/moments'

// The bell in the top bar: moments and recommendations sent to you. Opening one
// marks it read and goes to it (the player at that moment, or the title's page).

export function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

export function MomentLine({ m, onOpen, compact }: { m: InboxMoment; onOpen: () => void; compact?: boolean }) {
  const [reveal, setReveal] = useState(false)
  return (
    <div className={`flex gap-3 rounded-xl px-3 py-2.5 ${m.read ? '' : 'bg-white/[0.04]'} hover:bg-white/[0.07]`}>
      <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-400/20 text-[13px] font-semibold text-accent-200">
        {m.from.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="block w-full text-left">
          <p className="text-[13.5px] leading-snug text-ink-200">
            <span className="font-semibold text-white">{m.from}</span> {m.start == null ? 'recommends' : 'flagged a moment in'}{' '}
            <span className="font-semibold text-white">{m.title}</span>
            {m.subtitle && <span className="text-ink-400"> · {m.subtitle}</span>}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-400">
            {m.start != null && m.end != null && <span className="mr-2 rounded bg-white/10 px-1.5 py-px font-mono text-[11.5px] text-ink-200">{clock(m.start)}–{clock(m.end)}</span>}
            {ago(m.created)}
          </p>
          {m.note && (!m.spoiler || reveal) && <p className={`mt-1 text-[13.5px] text-white ${compact ? 'line-clamp-2' : ''}`}>“{m.note}”</p>}
        </button>
        {m.note && m.spoiler && !reveal && (
          <button type="button" onClick={() => setReveal(true)} className="mt-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-medium text-ink-200 hover:bg-white/20">
            Spoiler · show the note
          </button>
        )}
      </div>
      {!m.read && <span aria-label="New" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent-300" />}
    </div>
  )
}

export default function MomentsBell({ lux }: { lux: boolean }) {
  const on = useMomentsOn()
  const { data } = useInbox()
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Opening the list asks friends' servers for anything new first.
    void getInbox(true).then((d) => qc.setQueryData(['moments', 'inbox'], d), () => {})
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, qc])

  if (!on) return null
  const list = data?.moments ?? []
  const unread = data?.unread ?? 0

  const openOne = async (m: InboxMoment) => {
    setOpen(false)
    if (!m.read) await markMomentsRead([m.key]).catch(() => {})
    void qc.invalidateQueries({ queryKey: ['moments', 'inbox'] })
    navigate(momentHref(m))
  }
  const allRead = async () => {
    await markMomentsRead(list.filter((m) => !m.read).map((m) => m.key)).catch(() => {})
    void qc.invalidateQueries({ queryKey: ['moments', 'inbox'] })
  }

  return (
    <div className="relative ml-1 shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Moments${unread ? ` (${unread} new)` : ''}`}
        aria-expanded={open}
        title="Moments sent to you"
        className={
          lux
            ? 'relative flex h-10 w-10 items-center justify-center rounded-full os-glass text-white/85 hover:text-white transition-colors'
            : 'relative flex h-9 w-9 items-center justify-center rounded-full text-ink-300 hover:text-white hover:bg-white/10 transition-colors'
        }
      >
        <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent-300 text-ink-950 text-[10.5px] font-bold leading-[18px] text-center">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
      {open && (
        <div className="fixed right-2 sm:right-4 top-16 z-[75] w-[min(24rem,calc(var(--vw,1vw)*100_-_1rem))] rounded-2xl border border-white/10 bg-ink-900/95 p-2 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between px-3 pb-1.5 pt-1">
            <p className="text-[15px] font-semibold text-white">Moments</p>
            {unread > 0 && (
              <button type="button" onClick={allRead} className="text-[12.5px] font-medium text-ink-300 hover:text-white">
                Mark all read
              </button>
            )}
          </div>
          {list.length ? (
            <div className="max-h-[calc(var(--vh,1vh)*65)] overflow-y-auto">
              {list.map((m) => (
                <MomentLine key={m.key} m={m} onOpen={() => void openOne(m)} />
              ))}
            </div>
          ) : (
            <p className="px-3 pb-3 pt-1 text-[13.5px] leading-relaxed text-ink-400">
              Nothing yet. While you watch, tap the flag in the player to send someone a moment, or Recommend a title from its page.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** A card that slides in when something new arrives (not in the player, which shows its own). */
export function MomentArrivals() {
  const { data } = useInbox()
  const seen = useRef<Set<string> | null>(null)
  const [card, setCard] = useState<InboxMoment | null>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()

  useEffect(() => {
    if (!data) return
    const unread = data.moments.filter((m) => !m.read)
    if (!seen.current) {
      // What was already waiting when the app opened is in the bell, not a pop-up.
      seen.current = new Set(data.moments.map((m) => m.key))
      return
    }
    const fresh = unread.find((m) => !seen.current!.has(m.key))
    for (const m of data.moments) seen.current.add(m.key)
    if (fresh) setCard(fresh)
  }, [data])

  useEffect(() => {
    if (!card) return
    const t = setTimeout(() => setCard(null), 8000)
    return () => clearTimeout(t)
  }, [card])

  if (!card) return null
  return (
    <div role="status" className="toast-in fixed bottom-24 md:bottom-6 right-3 sm:right-6 z-[72] w-[min(22rem,calc(var(--vw,1vw)*100_-_1.5rem))] rounded-2xl border border-white/10 bg-ink-900/95 p-1.5 shadow-2xl backdrop-blur-xl">
      <MomentLine
        m={card}
        compact
        onOpen={() => {
          const m = card
          setCard(null)
          void markMomentsRead([m.key]).catch(() => {})
          void qc.invalidateQueries({ queryKey: ['moments', 'inbox'] })
          navigate(momentHref(m))
        }}
      />
    </div>
  )
}
