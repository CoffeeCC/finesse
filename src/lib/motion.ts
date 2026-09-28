// Continuous motion: shared-element page transitions.
//
// The poster you tap *becomes* the detail page; its backdrop *becomes* the
// player; Back plays it in reverse into the card you came from.
//
// react-router's `viewTransition` prop only works with data routers — Finesse
// uses BrowserRouter/HashRouter, so the old poster morph never actually ran.
// This drives document.startViewTransition itself: the browser snapshots the
// old page, we navigate and wait for the new route to commit, then it morphs
// every element whose view-transition-name appears on both sides.
//
// Names:
//   vt-poster  a poster card ⇄ the detail page's poster (wide screens)
//   vt-hero    a card / home hero / episode still ⇄ the detail backdrop ⇄ the player
// Fixed targets are marked data-vt-static="<name>" (named via CSS); cards carry
// data-vt-id="<item id>" so Back can find the one to land on.
//
// Off on the TV (old engine, and the SoC needs every frame) and for
// reduced-motion users: navigation just happens.

import { IS_TV } from './device'

type VTDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> }
}

export function motionEnabled(): boolean {
  return (
    !IS_TV &&
    typeof (document as VTDocument).startViewTransition === 'function' &&
    !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

let active = false
/** True while a transition is capturing/animating (the page-enter fade stands down). */
export const transitionActive = () => active

// ---- Route commit signal (App calls routeCommitted from a layout effect) ----
let waiters: (() => void)[] = []
export function routeCommitted() {
  const w = waiters
  waiters = []
  w.forEach((fn) => fn())
}
function nextCommit(timeoutMs = 700): Promise<void> {
  return new Promise((resolve) => {
    const t = window.setTimeout(resolve, timeoutMs)
    waiters.push(() => {
      window.clearTimeout(t)
      resolve()
    })
  })
}
// NB: not requestAnimationFrame — the browser suspends rendering (and rAF)
// while a transition captures the new page, so a rAF wait never resolves and
// the transition times out (skipped after ~4s). A macrotask tick is enough:
// React has committed by the time App's layout effect signals routeCommitted.
const tick = () => new Promise<void>((r) => window.setTimeout(r, 0))

/** Give the new page's morph targets a moment to decode their art, so the
 *  morph lands on the picture rather than an empty box (capped — never stall). */
function settleImages(capMs = 300): Promise<void> {
  const imgs = [
    ...document.querySelectorAll<HTMLImageElement>('[data-vt-static] img, img[data-vt-static]'),
    ...named.flatMap((el) => [...el.querySelectorAll('img')]),
  ].filter((img) => !img.complete)
  if (imgs.length === 0) return Promise.resolve()
  return Promise.race([
    Promise.all(imgs.map((img) => img.decode().catch(() => {}))).then(() => {}),
    new Promise<void>((r) => window.setTimeout(r, capMs)),
  ])
}

/** A poster card morphs into the detail page's poster on wide screens; phones
 *  show no poster there, so it grows into the backdrop instead. */
export function posterMorphName(): string {
  return window.matchMedia?.('(min-width: 768px)').matches ? 'vt-poster' : 'vt-hero'
}

// ---- Back: which card to land on ----
let returnMorph: { id: string; name: string } | null = null
/** Pages that were opened from a card register how Back should morph. Returns
 *  a cleanup for unmount. */
export function setReturnMorph(id: string, name: string): () => void {
  const entry = { id, name }
  returnMorph = entry
  return () => {
    if (returnMorph === entry) returnMorph = null
  }
}

const named: HTMLElement[] = []
function nameEl(el: HTMLElement, name: string) {
  el.style.viewTransitionName = name
  named.push(el)
}
function clearNames() {
  for (const el of named.splice(0)) el.style.viewTransitionName = ''
}

function inViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
}
function inViewportRows(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight
}

function run(update: () => Promise<void>) {
  active = true
  const html = document.documentElement
  html.classList.add('vt-active')
  const done = () => {
    active = false
    html.classList.remove('vt-active')
    clearNames()
  }
  try {
    ;(document as VTDocument).startViewTransition!(update).finished.then(done, done)
  } catch {
    done()
    update()
  }
}

/** Is this a plain primary click we may take over (not ctrl/⌘-click etc.)? */
function plainClick(e?: { button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }) {
  return !e || ((e.button ?? 0) === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey)
}

/** Navigate with a morph from `from` (named `name` for the old snapshot).
 *  Pass the click event from a Link so modified clicks keep their default. */
export function morphNavigate(
  go: () => void,
  opts: { from?: HTMLElement | null; name?: string; event?: React.MouseEvent } = {},
) {
  const { from, name, event } = opts
  if (event && !plainClick(event)) return // let the browser open a new tab etc.
  event?.preventDefault()
  if (!motionEnabled()) {
    go()
    return
  }
  if (from && name) {
    // One element per name: silence a fixed target this click supersedes
    // (e.g. an episode still taking over from the detail backdrop).
    document.querySelectorAll<HTMLElement>(`[data-vt-static="${name}"]`).forEach((el) => nameEl(el, 'none'))
    nameEl(from, name)
  }
  run(async () => {
    const committed = nextCommit()
    go()
    await committed
    await tick()
    await settleImages()
  })
}

/** Back with the reverse morph into the card you came from (if it's on screen). */
export function morphBack(go: () => void) {
  if (!motionEnabled()) {
    go()
    return
  }
  const target = returnMorph
  run(async () => {
    const committed = nextCommit()
    go()
    await committed
    await tick()
    if (!target) return
    // The page we land on may have its own fixed target for this name (player →
    // detail backdrop); only otherwise look for the originating card.
    const fixed = [...document.querySelectorAll<HTMLElement>(`[data-vt-static="${target.name}"]`)].some(inViewport)
    if (fixed) return
    const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(target.id) : target.id
    // Scroll restoration (lib/routeMemory) may still be settling — give the
    // card a few ticks to reach the screen's band before settling for a fade.
    let card: HTMLElement | undefined
    for (let i = 0; i < 6 && !card; i++) {
      card = [...document.querySelectorAll<HTMLElement>(`[data-vt-id="${esc}"]`)].find(inViewportRows)
      if (!card) await new Promise((r) => window.setTimeout(r, 30))
    }
    // Rows remount scrolled to their start: slide this one back to your card
    // (you'd scrolled sideways to reach it), then land the morph there.
    // Instant, not the rows' CSS smooth-scroll: smooth scrolling can't progress
    // while the transition holds rendering, so the card would never arrive.
    if (card && !inViewport(card)) card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' as ScrollBehavior })
    if (card && inViewport(card)) {
      nameEl(card, target.name)
      await settleImages()
    }
  })
}
