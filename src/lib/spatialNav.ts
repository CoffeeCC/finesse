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

// tabindex="-1" is the universal opt-out (hover-only chevrons etc.) — it must
// exclude an element even when it also matches the tag-based clauses.
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'

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

/** Drop the candidate cache — rows virtualize/reveal on scroll, so the element
 *  set changes whenever anything scrolls (page or a horizontal row). */
export function invalidateNavCache() {
  cachedEls = null
}

function candidates(): HTMLElement[] {
  if (__WEBOS__ && cachedEls && performance.now() - cachedAt < 400) return cachedEls
  const els = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisible)
  if (__WEBOS__) {
    cachedEls = els
    cachedAt = performance.now()
  }
  return els
}

/** Screen (scroll / innerWidth) pixels per getBoundingClientRect pixel. The
 *  TV scales the UI with `zoom` on <html>; Chromium before ~128 (the LG CX runs
 *  68) reports rects unzoomed while scrolling and innerWidth stay in screen
 *  pixels, so a rect distance must be multiplied by the zoom to scroll it.
 *  Newer engines report both zoomed (factor 1). */
function screenPerRectPx(): number {
  const zoom = parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1
  if (zoom === 1) return 1
  const k = window.innerWidth / document.documentElement.getBoundingClientRect().width
  return Math.abs(k - zoom) < 0.05 ? zoom : 1
}

function bestInDirection(current: DOMRect, dir: Dir, els: HTMLElement[], currentEl: Element | null): HTMLElement | null {
  const cx = current.left + current.width / 2
  const cy = current.top + current.height / 2

  // Two passes. Pass 1 considers only elements whose cross-axis span OVERLAPS
  // the current element (for ↓: horizontally overlapping) and picks the NEAREST
  // by edge distance — so moving down always lands on the next row that has
  // anything under you (row headers, small buttons), never skipping it because
  // a farther element was better centre-aligned. Pass 2 is the old weighted
  // fallback for when nothing overlaps (e.g. jumping to the A–Z rail).
  let best: HTMLElement | null = null
  let bestScore = Infinity
  let bestFallback: HTMLElement | null = null
  let bestFallbackScore = Infinity
  // How far the nearest thing that way is. An aligned candidate only wins when
  // it's about that near: otherwise "anything straight above" meant Up from a
  // detail page's tab flew past the Play button to the navbar, and Down from
  // the navbar skipped an album's Play/Shuffle for its first track.
  let nearest = Infinity
  const slack = Math.max(64, 0.75 * (dir === 'up' || dir === 'down' ? current.height : current.width))
  const viewW = window.innerWidth / screenPerRectPx()
  const scored: { el: HTMLElement; primary: number; cross: number; overlap: number }[] = []

  for (const el of els) {
    if (el === currentEl) continue
    const r = el.getBoundingClientRect()
    const dx = r.left + r.width / 2 - cx
    const dy = r.top + r.height / 2 - cy
    let primary = 0 // distance between facing edges along the direction of travel
    let cross = 0
    let overlap = 0
    switch (dir) {
      case 'right':
        primary = r.left - current.right
        cross = Math.abs(dy)
        overlap = Math.min(r.bottom, current.bottom) - Math.max(r.top, current.top)
        break
      case 'left':
        primary = current.left - r.right
        cross = Math.abs(dy)
        overlap = Math.min(r.bottom, current.bottom) - Math.max(r.top, current.top)
        break
      case 'down':
        primary = r.top - current.bottom
        cross = Math.abs(dx)
        overlap = Math.min(r.right, current.right) - Math.max(r.left, current.left)
        break
      case 'up':
        primary = current.top - r.bottom
        cross = Math.abs(dx)
        overlap = Math.min(r.right, current.right) - Math.max(r.left, current.left)
        break
    }
    // Small negative tolerance: elements butted against us (or 4px overlapping,
    // e.g. focus-ring outsets) still count as "in that direction".
    if (primary < -4) continue
    // Never treat an element we're inside of / on top of as a move target.
    if (dir === 'down' && dy <= 0) continue
    if (dir === 'up' && dy >= 0) continue
    if (dir === 'right' && dx <= 0) continue
    if (dir === 'left' && dx >= 0) continue
    nearest = Math.min(nearest, Math.max(0, primary))
    scored.push({ el, primary: Math.max(0, primary), cross, overlap })
  }

  for (const { el, primary, cross, overlap } of scored) {
    // Unaligned fallbacks must be on screen: at the end of a row, Right used to
    // jump to a card scrolled out of view in some other row.
    const r = el.getBoundingClientRect()
    const onScreen = r.left + r.width / 2 >= 0 && r.left + r.width / 2 <= viewW
    if (overlap > 4 && primary <= nearest + slack) {
      // Aligned: nearest edge wins; centre alignment only breaks ties.
      const score = primary * 10 + cross
      if (score < bestScore) {
        bestScore = score
        best = el
      }
    } else if (onScreen) {
      const score = primary + cross * 2
      if (score < bestFallbackScore) {
        bestFallbackScore = score
        bestFallback = el
      }
    }
  }
  return best ?? bestFallback
}

/** The best target from `from`, respecting layers: an open menu or dialog keeps
 *  focus inside it, and the fixed navbar sits above all page content (once the
 *  page scrolls, content above the screen used to count as "above" the navbar,
 *  and a row tucked under the navbar lost to it on Up). */
function pick(from: HTMLElement, dir: Dir, els: HTMLElement[]): HTMLElement | null {
  const rect = from.getBoundingClientRect()
  const trap = from.closest<HTMLElement>('[role="menu"], [role="listbox"], [role="dialog"], [aria-modal="true"]')
  if (trap) return bestInDirection(rect, dir, els.filter((el) => trap.contains(el)), from)
  const header = document.querySelector('header')
  const inHeader = (el: Element) => !!header && header.contains(el)
  if (inHeader(from)) {
    if (dir === 'up') return null
    if (dir !== 'down') return bestInDirection(rect, dir, els.filter(inHeader), from)
    const below = header!.getBoundingClientRect().bottom
    return bestInDirection(rect, dir, els.filter((el) => !inHeader(el) && el.getBoundingClientRect().bottom > below), from)
  }
  const content = els.filter((el) => !inHeader(el))
  const next = bestInDirection(rect, dir, content, from)
  // Up reaches the navbar only once nothing on the page is above. (The library
  // grid keeps rows above the screen mounted — overscan — so there's always a
  // row to go to until the real top.)
  if (!next && dir === 'up') return bestInDirection(rect, dir, els.filter(inHeader), from)
  return next
}

/** Entering a tab list lands on its selected tab, not whichever tab is nearest. */
function preferSelectedTab(next: HTMLElement, from: Element | null): HTMLElement {
  if (next.getAttribute('role') !== 'tab') return next
  const list = next.closest('[role="tablist"]')
  if (!list || (from && list.contains(from))) return next
  return list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? next
}

const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

// The last D-pad move, so the opposite key goes straight back where you came
// from (down then up returns to the same card, even when geometry would pick a
// neighbour).
let lastMove: { from: HTMLElement; to: HTMLElement; dir: Dir } | null = null

// Where focus last was on this page, for when a re-render drops it to <body>.
let lastFocus: { route: string; x: number; y: number } | null = null

function route(): string {
  return window.location.pathname + window.location.hash
}

function rememberFocus(el: Element) {
  const r = el.getBoundingClientRect()
  const k = screenPerRectPx()
  lastFocus = { route: route(), x: r.left + r.width / 2 + window.scrollX / k, y: r.top + r.height / 2 + window.scrollY / k }
}

/** The candidate nearest to where focus last was, if it was on this page. */
function nearLastFocus(els: HTMLElement[]): HTMLElement | null {
  if (!lastFocus || lastFocus.route !== route()) return null
  let best: HTMLElement | null = null
  let bestD = Infinity
  const k = screenPerRectPx()
  for (const el of els) {
    const r = el.getBoundingClientRect()
    const d = Math.hypot(r.left + r.width / 2 + window.scrollX / k - lastFocus.x, r.top + r.height / 2 + window.scrollY / k - lastFocus.y)
    if (d < bestD) {
      bestD = d
      best = el
    }
  }
  return best
}

/** Keep a newly focused element clear of the fixed navbar / pinned panels and
 *  off the very bottom edge, so it and its focus ring are fully on screen. */
function keepClear(el: HTMLElement) {
  if (el.closest('header')) return
  let top = Number(document.documentElement.dataset.reserveTop || 0)
  const header = document.querySelector('header')
  if (header) {
    const pos = getComputedStyle(header).position
    if (pos === 'fixed' || pos === 'sticky') top = Math.max(top, header.getBoundingClientRect().bottom)
  }
  const r = el.getBoundingClientRect()
  const k = screenPerRectPx()
  const viewH = window.innerHeight / k
  const margin = 24
  if (r.top < top + margin) {
    window.scrollBy({ top: (r.top - top - margin) * k, behavior: 'auto' })
  } else if (r.bottom > viewH - margin && r.height < viewH - top - 2 * margin) {
    window.scrollBy({ top: (r.bottom - viewH + margin * 2) * k, behavior: 'auto' })
  }
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
  // Not on webOS: there 19 is the remote's Pause button, and pressing Pause
  // used to yank focus up a row.
  if (!__WEBOS__) {
    switch (e.keyCode) {
      case 19: return 'up'
      case 20: return 'down'
      case 21: return 'left'
      case 22: return 'right'
    }
  }
  switch (e.keyCode) {
    case 38: return 'up'
    case 40: return 'down'
    case 37: return 'left'
    case 39: return 'right'
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
  const from = active && active !== document.body && els.includes(active) ? active : null
  if (!from) {
    // Focus was dropped (a row re-rendered under it): carry on from where it
    // was. Nothing focused yet: start in the page content (its primary action
    // if it marks one), not on the navbar logo that happens to be first.
    const main = document.querySelector('main')
    const primary = main?.querySelector<HTMLElement>('[data-autofocus]')
    next =
      nearLastFocus(els) ??
      (primary && els.includes(primary) ? primary : null) ??
      els.find((el) => main?.contains(el)) ??
      els[0]
  } else if (lastMove && lastMove.to === from && lastMove.dir === OPPOSITE[dir] && els.includes(lastMove.from)) {
    next = lastMove.from
  } else {
    next = pick(from, dir, els)
    if (next) next = preferSelectedTab(next, from)
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
  // A pinned panel (the TV home's focus-driven hero, via data-reserve-top) or
  // the fixed navbar can cover the top of the screen: keep the focus below it.
  keepClear(next)
  lastMove = from ? { from, to: next, dir } : null
  rememberFocus(next)
  // Physical depth: CSS leans the newly focused card toward the direction of travel.
  document.documentElement.dataset.navDir = dir
  playNav(next)
}

/** Enable global D-pad/arrow-key spatial navigation for the app. */
export function useSpatialNavigation() {
  useEffect(() => {
    const opts: AddEventListenerOptions = { capture: true }
    const scrollOpts: AddEventListenerOptions = { capture: true, passive: true }
    const onScroll = () => invalidateNavCache()
    // Pointer / programmatic focus counts too (Magic Remote clicks, routeMemory).
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement && e.target !== document.body) rememberFocus(e.target)
    }
    window.addEventListener('keydown', onKeyDown, opts)
    window.addEventListener('focusin', onFocusIn, opts)
    // Any scroll (window or a horizontal row) can mount/unmount virtualized
    // cards — a stale cached candidate list is what made held-key nav skip them.
    window.addEventListener('scroll', onScroll, scrollOpts)
    // Landing focus on each page (TV) is handled by lib/routeMemory.
    return () => {
      window.removeEventListener('keydown', onKeyDown, opts)
      window.removeEventListener('focusin', onFocusIn, opts)
      window.removeEventListener('scroll', onScroll, scrollOpts)
    }
  }, [])
}
