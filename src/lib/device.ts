// Input/form-factor detection. Static flags cover initial paint; `useIsTouch()`
// adapts live for hybrid devices (iPad + Magic Keyboard, Surface, Steam Deck,
// foldable phones) as input mode changes.

import { useSyncExternalStore } from 'react'

/** A TV or 10-foot living-room browser: packaged webOS app, Smart TVs, set-top
 *  boxes, game consoles, and SteamOS/Big Picture. Gets D-pad-first behavior:
 *  landing focus, remote seeking, no hover-only UI. */
export const IS_TV: boolean =
  __WEBOS__ ||
  (typeof navigator !== 'undefined' &&
    /Web0S|webOS|Tizen|SMART-TV|SmartTV|NetCast|HbbTV|BRAVIA|AFT[A-Z]|SHIELD|Android TV|AndroidTV|GoogleTV|Google TV|CrKey|VIDAA|Hisense|NETTV|Viera|AQUOSBrowser|Vestel|Opera TV|OPR\/[\d.]+ TV|AppleTV|Roku|PlayStation|Xbox|SteamOS|Valve Steam|Steam Deck|Nintendo Switch/i.test(
      navigator.userAgent,
    ))

const coarseQuery = () =>
  !IS_TV &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: none) and (pointer: coarse)').matches

/** Touch-first device (phone/tablet): no hover, coarse pointer (initial snapshot). */
export const TOUCH_UI: boolean = coarseQuery()

// Live touch state for hybrid devices (iPad + trackpad, Surface, Steam Deck).
let liveTouch = TOUCH_UI
const touchListeners = new Set<() => void>()
let touchListening = false

function setLiveTouch(next: boolean) {
  if (IS_TV || next === liveTouch) return
  liveTouch = next
  for (const fn of touchListeners) fn()
}

function startTouchListening() {
  if (touchListening || typeof window === 'undefined' || IS_TV) return
  touchListening = true
  try {
    const mql = window.matchMedia('(hover: none) and (pointer: coarse)')
    const onChange = () => setLiveTouch(mql.matches)
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange)
    else mql.addListener?.(onChange)
  } catch {
    /* ignore */
  }
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') setLiveTouch(true)
      else if (e.pointerType === 'mouse') setLiveTouch(false)
    },
    { passive: true, capture: true },
  )
}

function subscribeTouch(fn: () => void): () => void {
  startTouchListening()
  touchListeners.add(fn)
  return () => touchListeners.delete(fn)
}

/** Reactive touch-UI flag: tracks media-query changes and live touch/mouse switches on hybrids. */
export function useIsTouch(): boolean {
  return useSyncExternalStore(subscribeTouch, () => liveTouch, () => TOUCH_UI)
}

/** True once the user is steering with arrows/D-pad (set by spatialNav). */
export function inSpatialMode(): boolean {
  return IS_TV || document.documentElement.dataset.navMode === 'spatial'
}
