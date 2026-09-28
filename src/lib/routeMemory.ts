// Per-history-entry scroll + focus memory.
//
// Going Back should put you where you were: same scroll position (web/phone)
// and, on TV, focus back on the card you opened — not the top of the page, and
// not the navbar logo (where D-pad focus used to land after every navigation,
// because the focused card had unmounted and "first focusable" is the logo).
// New pages get focus on their primary action ([data-autofocus]) instead.

import { useLayoutEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { inSpatialMode } from './device'

interface FocusKey {
  sel: string
  nth: number
}
interface Memo {
  y: number
  focus?: FocusKey
}

const memory = new Map<string, Memo>()
let currentKey = ''
let lastPathname = ''
let lastEntryKey = ''
let lastUserInput = 0

function memo(): Memo {
  let m = memory.get(currentKey)
  if (!m) {
    m = { y: 0 }
    memory.set(currentKey, m)
  }
  return m
}

function focusKeyOf(el: Element): FocusKey | undefined {
  const esc = (s: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'))
  const fk = el.getAttribute('data-focus-key')
  const href = el.getAttribute('href')
  const label = el.getAttribute('aria-label')
  let sel: string
  if (fk) sel = `[data-focus-key="${esc(fk)}"]`
  else if (href) sel = `${el.tagName.toLowerCase()}[href="${esc(href)}"]`
  else if (label) sel = `[aria-label="${esc(label)}"]`
  else return undefined
  return { sel, nth: Math.max(0, [...document.querySelectorAll(sel)].indexOf(el)) }
}

if (typeof window !== 'undefined') {
  try {
    window.history.scrollRestoration = 'manual'
  } catch {
    /* read-only on some engines */
  }
  window.addEventListener('focusin', (e) => {
    if (!currentKey || !(e.target instanceof Element)) return
    const k = focusKeyOf(e.target)
    if (k) memo().focus = k
  })
  let raf = 0
  window.addEventListener(
    'scroll',
    () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (currentKey) memo().y = window.scrollY
      })
    },
    { passive: true },
  )
  const onInput = () => {
    lastUserInput = performance.now()
  }
  window.addEventListener('keydown', onInput, true)
  window.addEventListener('pointerdown', onInput, true)
}

function isVisible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

function firstFocusable(root: ParentNode): HTMLElement | null {
  const els = root.querySelectorAll<HTMLElement>(
    'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]',
  )
  for (const el of els) if (isVisible(el)) return el
  return null
}

/** Mount once inside the router. */
export function useRouteMemory() {
  const location = useLocation()
  const navType = useNavigationType()

  useLayoutEffect(() => {
    const prevPath = lastPathname
    const prevKey = lastEntryKey
    currentKey = location.key
    lastPathname = location.pathname
    lastEntryKey = location.key
    const saved = navType === 'POP' ? memory.get(location.key) : undefined
    // Same-page URL edits (search box, filters) are new entries on the same
    // path — leave scroll and focus alone for those.
    if (!saved && prevPath === location.pathname && prevKey !== location.key) return

    if (!saved) window.scrollTo(0, 0)
    const startedAt = performance.now()
    const spatial = inSpatialMode()
    let scrollDone = !saved
    let focusDone = !spatial
    let tries = 0

    const attempt = () => {
      tries++
      // The user took over — stop steering.
      if (lastUserInput > startedAt) return true
      if (!scrollDone && saved) {
        window.scrollTo(0, saved.y)
        // Rows/grids may still be arriving; keep going until the page is tall enough.
        scrollDone = Math.abs(window.scrollY - saved.y) < 4
      }
      if (!focusDone) {
        const main = document.querySelector('main')
        let target: HTMLElement | null = null
        if (saved?.focus) {
          const el = document.querySelectorAll<HTMLElement>(saved.focus.sel)[saved.focus.nth]
          if (el && isVisible(el)) target = el
        }
        // No memory (or its card is gone): the page's primary action, else the
        // first thing in the content — never the navbar. Give async content
        // (series Play button, grid cards) a moment to show up first.
        if (!target && main && (!saved?.focus || tries > 12)) {
          target = main.querySelector<HTMLElement>('[data-autofocus]')
          if (!target && tries > 8) target = firstFocusable(main)
        }
        if (target) {
          target.focus({ preventScroll: true })
          if (saved) target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          focusDone = true
        }
      }
      // Nothing to focus yet (rows still loading over a slow link — the TV home
      // has no hero button to land on): keep looking a while longer, else the
      // remote starts on nothing.
      return (scrollDone && focusDone) || tries > (focusDone ? 20 : 80)
    }

    if (attempt()) return
    const iv = window.setInterval(() => {
      if (attempt()) window.clearInterval(iv)
    }, 75)
    return () => window.clearInterval(iv)
  }, [location.key, location.pathname, navType])
}
