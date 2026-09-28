import { useEffect, useRef, useState } from 'react'
import { useItem } from '../api/queries'
import { backdropUrl } from '../api/client'
import { formatRuntime } from '../api/types'
import type { JfItem } from '../api/types'

// TV home, focus-driven (the Apple TV / Google TV pattern): the top of the
// screen describes whatever the remote is resting on — title, year, rating,
// synopsis — while the rows move underneath. The full-screen art behind it is
// FocusBackdrop's. Replaces the rotating carousel on the TV, where a hero you
// had to navigate *past* just added D-pad presses.

// A third of the screen. Sized in --vh (index.css): plain vh is scaled by the
// app's 130% zoom on the TV, so "34vh" really covered 44% of the screen.
const PANEL_VH = 34

export default function TvFocusHero({ initial }: { initial?: JfItem }) {
  const [focusId, setFocusId] = useState<string | undefined>(initial?.Id)
  const timer = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!focusId && initial) setFocusId(initial.Id)
  }, [initial, focusId])

  // Follow the focused card (after a short dwell, so a held key doesn't fetch
  // every card it passes).
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      // Cards focus their <a>; the id rides on the poster inside it.
      const t = e.target as HTMLElement | null
      const id = (t?.closest?.('[data-vt-id]') ?? t?.querySelector?.('[data-vt-id]'))?.getAttribute('data-vt-id')
      window.clearTimeout(timer.current)
      if (!id) return
      timer.current = window.setTimeout(() => setFocusId(id), 220)
    }
    window.addEventListener('focusin', onFocus)
    return () => {
      window.removeEventListener('focusin', onFocus)
      window.clearTimeout(timer.current)
    }
  }, [])

  // Reserve the top of the screen so D-pad scrolling keeps focus below the
  // panel. Measured, not computed: under the TV's page zoom the panel's real
  // edge sits well below 64px + PANEL_VH, and spatial nav compares against
  // element rects in that same (zoomed) space.
  useEffect(() => {
    const set = () => {
      const bottom = panelRef.current?.getBoundingClientRect().bottom
      if (bottom) document.documentElement.dataset.reserveTop = String(Math.round(bottom))
    }
    set()
    requestAnimationFrame(set)
    window.addEventListener('resize', set)
    return () => {
      window.removeEventListener('resize', set)
      delete document.documentElement.dataset.reserveTop
    }
  }, [])

  const { data: item } = useItem(focusId)
  const show = item ?? initial
  const art = show ? backdropUrl(show, 1280) : null

  return (
    <>
      <div
        ref={panelRef}
        aria-live="polite"
        className="fixed inset-x-0 z-30 pointer-events-none"
        style={{ top: 64, height: `calc(var(--vh) * ${PANEL_VH})` }}
      >
        {/* Opaque: rows scroll up underneath the panel, so it paints the focused
            title's own art (crossfading per title) over a solid base. */}
        <div className="absolute inset-0 bg-ink-950" />
        {art && <img key={art} src={art} alt="" className="absolute inset-0 h-full w-full object-cover backdrop-fade-in" />}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/75 to-ink-950/15" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ink-950 to-transparent" />
        {show && (
          <div key={show.Id} className="relative h-full flex flex-col justify-end pb-8 px-12 max-w-[60%] hero-content-in">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-accent-300 mb-2">{eyebrow(show)}</p>
            <h1 className="font-display text-6xl leading-[0.95] text-white line-clamp-2">
              {show.Type === 'Episode' ? show.SeriesName ?? show.Name : show.Name}
            </h1>
            <p className="mt-3 text-lg text-ink-200">{meta(show)}</p>
            {show.Overview && <p className="mt-3 text-lg leading-relaxed text-ink-200 line-clamp-2">{show.Overview}</p>}
          </div>
        )}
      </div>
      {/* The panel is pinned; this keeps the rows starting below it. */}
      <div aria-hidden style={{ height: `calc(var(--vh) * ${PANEL_VH} - 2rem)` }} />
    </>
  )
}

function eyebrow(i: JfItem): string {
  if (i.Type === 'Episode') {
    const code = i.ParentIndexNumber != null && i.IndexNumber != null ? `S${i.ParentIndexNumber}:E${i.IndexNumber}` : 'Episode'
    return i.UserData?.PlaybackPositionTicks ? `Resume ${code}` : `${code} · ${i.Name}`
  }
  if (i.Type === 'Series') return 'Series'
  return i.UserData?.PlaybackPositionTicks && !i.UserData.Played ? 'Resume' : 'Movie'
}

function meta(i: JfItem): string {
  return [
    i.ProductionYear,
    i.OfficialRating,
    i.Type !== 'Series' && i.RunTimeTicks ? formatRuntime(i.RunTimeTicks) : null,
    i.CommunityRating ? `★ ${i.CommunityRating.toFixed(1)}` : null,
    ...(i.Genres?.slice(0, 2) ?? []),
  ]
    .filter(Boolean)
    .join('  ·  ')
}
