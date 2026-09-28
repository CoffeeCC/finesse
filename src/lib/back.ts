// Remote/keyboard "Back" handling shared by every screen.
//
// webOS is the tricky one: with appinfo `disableBackHistoryAPI: false` the TV
// calls history.back() itself on the remote's Back key, so an app that ALSO
// navigates on keyCode 461 goes back twice. With `true` (what we ship now) the
// app owns it and must exit at the root itself. Sideloaded installs keep
// whichever appinfo they were packaged with (OTA can't change it), so this
// works in both modes: we wait a beat, and only navigate if the system didn't.

import type { NavigateFunction } from 'react-router-dom'
import { morphBack } from './motion'

let lastPopAt = 0
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastPopAt = performance.now()
  })
}

/** Back on a remote or keyboard: Escape, Backspace, BrowserBack, webOS (461), Tizen (10009). */
export function isBackKey(e: KeyboardEvent): boolean {
  return (
    e.key === 'Escape' ||
    e.key === 'Backspace' ||
    e.key === 'BrowserBack' ||
    e.key === 'GoBack' ||
    e.keyCode === 461 ||
    e.keyCode === 10009
  )
}

/** Typing into a text field — Backspace/Escape belong to the field then. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
  if (el.tagName !== 'INPUT') return false
  const type = (el as HTMLInputElement).type
  return !['range', 'checkbox', 'radio', 'button', 'submit'].includes(type)
}

/** Leave the app (webOS: back to the launcher). */
export function exitApp() {
  const palm = (window as Window & { PalmSystem?: { platformBack?: () => void } }).PalmSystem
  try {
    if (palm?.platformBack) {
      palm.platformBack()
      return
    }
  } catch {
    /* fall through */
  }
  try {
    window.close()
  } catch {
    /* browsers refuse for tabs they didn't open — nothing to do */
  }
}

/** One step back through in-app history; at the root, go Home or exit the app.
 *  Skips its own navigation if the platform already went back (see above). */
export function goBack(navigate: NavigateFunction) {
  const pressedAt = performance.now()
  const run = () => {
    if (lastPopAt >= pressedAt) return
    const idx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof idx === 'number' && idx > 0) {
      // Reverse morph into the card you came from (no-op on TV / reduced motion).
      morphBack(() => navigate(-1))
      return
    }
    const path = __WEBOS__
      ? window.location.hash.replace(/^#/, '')
      : window.location.pathname.slice(import.meta.env.BASE_URL.replace(/\/$/, '').length)
    if (path === '' || path === '/') exitApp()
    else navigate('/', { replace: true })
  }
  if (__WEBOS__) window.setTimeout(run, 90)
  else run()
}

// ---- Overlay back handlers ----
// Menus, sheets and dialogs register here so Back closes them before it
// navigates. Most recent first; a handler returns true when it consumed Back.
type BackHandler = () => boolean
const handlers: BackHandler[] = []

export function pushBackHandler(fn: BackHandler): () => void {
  handlers.push(fn)
  return () => {
    const i = handlers.lastIndexOf(fn)
    if (i >= 0) handlers.splice(i, 1)
  }
}

/** Offer Back to open overlays; true if one of them handled it. */
export function runBackHandlers(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true
  }
  return false
}
