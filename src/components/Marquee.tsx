import { useEffect, useRef, useState } from 'react'
import TitleLogo from './TitleLogo'
import { useLocation } from 'react-router-dom'
import { backdropUrl, logoUrl } from '../api/client'
import { useMarqueeItems } from '../api/queries'
import { getPrefs } from '../lib/settings'

// Idle "marquee" screensaver: after a stretch of no input, the whole screen
// becomes drifting library art — backdrops with title logos + taglines, slow
// Ken Burns, gentle crossfades, and a clock. Any input dismisses it instantly.
// Never runs during playback or on the full-bleed player.

const IDLE_MS = 120_000 // 2 minutes
const SLIDE_MS = 9_000
const INPUT_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const
/** Inputs that would act on the page underneath (Back, Enter, a tap): the one that wakes the screen is used up. */
const ACTING_EVENTS = ['keydown', 'pointerdown', 'mousedown', 'touchstart'] as const
/** …along with the rest of that same press (its keyup, click, the tap's synthesized click). */
const FOLLOW_EVENTS = ['keyup', 'pointerup', 'mouseup', 'touchend', 'click'] as const
const FOLLOW_MS = 600

function blocked(): boolean {
  const path = window.location.pathname + window.location.hash
  if (path.includes('/play/')) return true
  for (const m of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
    if (!m.paused && m.currentTime > 0) return true
  }
  return false
}

export default function Marquee() {
  const [active, setActive] = useState(false)
  const activeRef = useRef(false)
  activeRef.current = active

  const { data: items = [] } = useMarqueeItems(active)

  // Navigation without input — e.g. a title cast to this TV — wakes the screen.
  const { pathname } = useLocation()
  useEffect(() => setActive(false), [pathname])
  const [idx, setIdx] = useState(0)
  const [now, setNow] = useState(() => new Date())

  // One idle timer; any input re-arms it and dismisses an active screensaver.
  useEffect(() => {
    if (!getPrefs().screensaver) return
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (!blocked()) setActive(true)
      }, IDLE_MS)
    }
    const onInput = () => {
      if (activeRef.current) setActive(false)
      arm()
    }
    // Waking the screen is all the first press does: it never reaches the page
    // (Escape used to wake it AND go back a page). Captured on window, so it runs
    // before the app's own handlers.
    let swallowUntil = 0
    const consume = (e: Event) => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const onActing = (e: Event) => {
      if (!activeRef.current) return
      consume(e)
      swallowUntil = performance.now() + FOLLOW_MS
      onInput()
    }
    const onFollow = (e: Event) => {
      if (performance.now() < swallowUntil) consume(e)
    }
    INPUT_EVENTS.forEach((e) => window.addEventListener(e, onInput, { passive: true }))
    ACTING_EVENTS.forEach((e) => window.addEventListener(e, onActing, { capture: true, passive: false }))
    FOLLOW_EVENTS.forEach((e) => window.addEventListener(e, onFollow, { capture: true, passive: false }))
    arm()
    return () => {
      INPUT_EVENTS.forEach((e) => window.removeEventListener(e, onInput))
      ACTING_EVENTS.forEach((e) => window.removeEventListener(e, onActing, { capture: true }))
      FOLLOW_EVENTS.forEach((e) => window.removeEventListener(e, onFollow, { capture: true }))
      window.clearTimeout(timer)
    }
  }, [])

  // Advance slides + tick the clock only while showing.
  useEffect(() => {
    if (!active || items.length === 0) return
    setIdx((i) => (i < items.length ? i : 0))
    const slide = window.setInterval(() => setIdx((i) => (i + 1) % items.length), SLIDE_MS)
    const clock = window.setInterval(() => setNow(new Date()), 20_000)
    return () => {
      window.clearInterval(slide)
      window.clearInterval(clock)
    }
  }, [active, items.length])

  if (!active || items.length === 0) return null
  const item = items[idx % items.length]
  const backdrop = backdropUrl(item, 1920)
  const logo = logoUrl(item)
  const titleText = <h1 className="text-3xl sm:text-5xl font-bold text-white tracking-tight mb-3 drop-shadow-lg break-words">{item.Name}</h1>
  const tagline = item.Taglines?.[0]
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="fixed inset-0 z-[100] bg-ink-950 marquee-in" aria-hidden>
      {backdrop && (
        <img key={item.Id} src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover marquee-slide" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-ink-950/40" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/70 via-transparent to-transparent" />

      {/* Clock */}
      <div className="absolute top-8 right-10 text-right marquee-fade">
        <div className="text-5xl font-semibold text-white/90 tabular-nums tracking-tight drop-shadow-lg">{time}</div>
        <div className="text-sm text-white/60 mt-1">
          {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {/* Title art */}
      {/* Held inside the screen (right-0 + max width): phones cut the art and tagline off. */}
      <div key={`c-${item.Id}`} className="absolute bottom-0 left-0 right-0 min-w-0 p-6 pb-14 sm:p-10 lg:p-16 max-w-2xl marquee-fade">
        {logo ? (
          <TitleLogo src={logo} alt={item.Name ?? ''} className="max-h-20 sm:max-h-28 max-w-full sm:max-w-md object-contain mb-4 drop-shadow-[0_4px_24px_rgba(0,0,0,0.7)]" fallback={titleText} />
        ) : (
          titleText
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm text-white/70 mb-2">
          {!!item.ProductionYear && <span>{item.ProductionYear}</span>}
          {item.Genres?.slice(0, 3).map((g) => (
            <span key={g}>{g}</span>
          ))}
        </div>
        {tagline && <p className="text-base sm:text-lg italic text-white/80 max-w-lg drop-shadow break-words">{tagline}</p>}
      </div>

      <div className="absolute bottom-6 right-10 text-xs text-white/40 marquee-fade">Move to dismiss</div>
    </div>
  )
}
