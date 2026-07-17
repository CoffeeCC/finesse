import { useEffect } from 'react'
import { playNav } from './sound'

// Arrow-key (D-pad) spatial navigation for TV-browser / remote use. It moves
// focus between visible focusable elements by on-screen geometry, then scrolls
// the target into view. Enter/Space activation is native to <a>/<button>, so we
// don't handle it. Mouse/touch users are unaffected until an arrow/D-pad key is
// actually pressed. Most interactive elements are already <a>/<button> with
// focus rings (see MediaCard + index.css).
//
// IMPORTANT: many TV *browsers* (Fire TV Silk, some Android TV Chromes) put the
// remote into cursor/pointer mode and only inject mouse events — spatial nav
// cannot run until the browser delivers real Arrow/D-pad key events. Fire TV
// Phone Remote often moves a cursor, not focus.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type Dir = 'up' | 'down' | 'left' | 'right'

// Smooth scrolling janks hard on TV SoCs — jump instantly there. Also use
// instant scroll when the user has already entered spatial-nav mode (TV browser).
const SCROLL_BEHAVIOR: ScrollBehavior = __WEBOS__ ? 'auto' : 'smooth'

function scrollBehavior(): ScrollBehavior {
  if (__WEBOS__) return 'auto'
  if (document.documentElement.dataset.navMode === 'spatial') return 'auto'
  return SCROLL_BEHAVIOR
}

/** Mark the document as D-pad navigated so CSS can show always-on focus rings. */
function enterSpatialMode() {
  if (document.documentElement.dataset.navMode === 'spatial') return
  document.documentElement.dataset.navMode = 'spatial'
}

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

function dirFor(e: KeyboardEvent): Dir | null {
  switch (e.key) {
    case 'ArrowUp': return 'up'
    case 'ArrowDown': return 'down'
    case 'ArrowLeft': return 'left'
    case 'ArrowRight': return 'right'
  }
  // Android / Fire TV WebViews often report D-pad via keyCode, not e.key.
  // 19–22 = DPAD_UP/DOWN/LEFT/RIGHT; 37–40 = classic arrow keyCodes.
  switch (e.keyCode) {
    case 19: case 38: return 'up'
    case 20: case 40: return 'down'
    case 21: case 37: return 'left'
    case 22: case 39: return 'right'
  }
  return null
}

let lastNavAt = 0

function onKeyDown(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey) return
  const dir = dirFor(e)
  if (!dir) return
  // The full-bleed player owns the arrow keys (seek / focus its own controls).
  // On the TV build the route lives in the hash (HashRouter), so check both —
  // otherwise global nav fights the player's own D-pad focus handler.
  if (window.location.pathname.includes('/play/') || window.location.hash.includes('/play/')) return

  enterSpatialMode()

  // Cap held-key repeat on lean-back devices so focus keeps pace with paint.
  const leanBack = __WEBOS__ || document.documentElement.dataset.navMode === 'spatial'
  if (leanBack) {
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
  if (!active || active === document.body || !els.includes(active)) {
    next = els[0]
  } else {
    next = bestInDirection(active.getBoundingClientRect(), dir, els, active)
  }

  if (!next) {
    // No focusable target this way. For up/down, nudge-scroll so off-screen rows
    // (which lazy-load / reveal on scroll) come in and become reachable next press.
    if (dir === 'up' || dir === 'down') {
      window.scrollBy({ top: (dir === 'down' ? 1 : -1) * window.innerHeight * 0.7, behavior: scrollBehavior() })
      e.preventDefault()
    }
    return
  }

  e.preventDefault()
  next.focus({ preventScroll: true })
  next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: scrollBehavior() })
  playNav()
}

/** If nothing is focused, land on the first visible focusable (TV needs a start). */
function ensureInitialFocus() {
  const active = document.activeElement as HTMLElement | null
  if (active && active !== document.body && active !== document.documentElement) {
    const tag = active.tagName
    if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || active.tabIndex >= 0) return
  }
  const first = candidates()[0]
  if (first) first.focus({ preventScroll: true })
}

/** Enable global D-pad/arrow-key spatial navigation for the app. */
export function useSpatialNavigation() {
  useEffect(() => {
    const opts: AddEventListenerOptions = { capture: true }
    window.addEventListener('keydown', onKeyDown, opts)
    // Give the first paint a beat, then focus something so the first D-pad press
    // has a current rect to navigate from (body-focus is a poor start point).
    const t = window.setTimeout(ensureInitialFocus, 300)
    return () => {
      window.removeEventListener('keydown', onKeyDown, opts)
      clearTimeout(t)
    }
  }, [])
}
