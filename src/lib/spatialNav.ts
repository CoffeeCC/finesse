import { useEffect } from 'react'
import { playNav } from './sound'

// Arrow-key (D-pad) spatial navigation for TV-browser / remote use. It moves
// focus between visible focusable elements by on-screen geometry, then scrolls
// the target into view. Enter/Space activation is native to <a>/<button>, so we
// don't handle it. Only triggers on arrow keys, so mouse/touch users are never
// affected. Most interactive elements are already <a>/<button> with :focus-visible
// rings (see MediaCard + index.css), so they light up automatically.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type Dir = 'up' | 'down' | 'left' | 'right'

// Smooth scrolling janks hard on TV SoCs — jump instantly there.
const SCROLL_BEHAVIOR: ScrollBehavior = __WEBOS__ ? 'auto' : 'smooth'

function isVisible(el: HTMLElement): boolean {
  // Exclude display:none / visibility:hidden / content-visibility, but deliberately
  // NOT opacity:0 — rows animate in from opacity 0 (.reveal) and only get revealed
  // once scrolled into view, so we must be able to target them to scroll there.
  // Genuinely hidden hover-only controls opt out with tabindex="-1" instead.
  const cv = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility
  if (typeof cv === 'function') {
    if (!cv.call(el, { visibilityProperty: true, contentVisibilityAuto: true })) return false
  } else if (el.offsetParent === null) {
    return false
  }
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

// On the TV, holding an arrow key repeats ~30×/s and each press used to re-query
// and visibility-test every focusable on the page — molasses on a TV CPU. Reuse
// the candidate list across key-repeats (rects are still read fresh per press).
let cachedEls: HTMLElement[] | null = null
let cachedAt = 0

function candidates(): HTMLElement[] {
  if (__WEBOS__ && cachedEls && performance.now() - cachedAt < 400) return cachedEls
  const els = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisible)
  if (__WEBOS__) {
    cachedEls = els
    cachedAt = performance.now()
  }
  return els
}

function bestInDirection(current: DOMRect, dir: Dir, els: HTMLElement[], currentEl: Element | null): HTMLElement | null {
  const cx = current.left + current.width / 2
  const cy = current.top + current.height / 2
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of els) {
    if (el === currentEl) continue
    const r = el.getBoundingClientRect()
    const dx = r.left + r.width / 2 - cx
    const dy = r.top + r.height / 2 - cy
    let primary = 0
    let cross = 0
    let inDir = false
    switch (dir) {
      case 'right': inDir = r.left >= current.right - 4; primary = dx; cross = Math.abs(dy); break
      case 'left':  inDir = r.right <= current.left + 4; primary = -dx; cross = Math.abs(dy); break
      case 'down':  inDir = r.top >= current.bottom - 4; primary = dy; cross = Math.abs(dx); break
      case 'up':    inDir = r.bottom <= current.top + 4; primary = -dy; cross = Math.abs(dx); break
    }
    if (!inDir || primary <= 0) continue
    // Weight cross-axis misalignment so we prefer staying in the same row/column.
    const score = primary + cross * 2
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  return best
}

function dirFor(key: string): Dir | null {
  switch (key) {
    case 'ArrowUp': return 'up'
    case 'ArrowDown': return 'down'
    case 'ArrowLeft': return 'left'
    case 'ArrowRight': return 'right'
    default: return null
  }
}

let lastNavAt = 0

function onKeyDown(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey) return
  const dir = dirFor(e.key)
  if (!dir) return
  // The full-bleed player owns the arrow keys (seek / focus its own controls).
  // On the TV build the route lives in the hash (HashRouter), so check both —
  // otherwise global nav fights the player's own D-pad focus handler.
  if (window.location.pathname.includes('/play/') || window.location.hash.includes('/play/')) return

  // TV: cap held-key repeat to ~20 moves/s so focus keeps pace with the screen
  // instead of queueing dozens of moves the SoC can't paint in time.
  if (__WEBOS__) {
    const now = performance.now()
    if (now - lastNavAt < 50) {
      e.preventDefault()
      return
    }
    lastNavAt = now
  }

  const active = document.activeElement as HTMLElement | null
  const tag = active?.tagName
  const isTextField = tag === 'INPUT' || tag === 'TEXTAREA' || (active?.isContentEditable ?? false)
  // In a text field, left/right move the caret; up/down may escape the field.
  if (isTextField && (dir === 'left' || dir === 'right')) return

  const els = candidates()
  if (els.length === 0) return

  let next: HTMLElement | null
  if (!active || active === document.body) {
    next = els[0]
  } else {
    next = bestInDirection(active.getBoundingClientRect(), dir, els, active)
  }

  if (!next) {
    // No focusable target this way. For up/down, nudge-scroll so off-screen rows
    // (which lazy-load / reveal on scroll) come in and become reachable next press.
    if (dir === 'up' || dir === 'down') {
      window.scrollBy({ top: (dir === 'down' ? 1 : -1) * window.innerHeight * 0.7, behavior: SCROLL_BEHAVIOR })
      e.preventDefault()
    }
    return
  }

  e.preventDefault()
  next.focus({ preventScroll: true })
  next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: SCROLL_BEHAVIOR })
  playNav()
}

/** Enable global D-pad/arrow-key spatial navigation for the app. */
export function useSpatialNavigation() {
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
