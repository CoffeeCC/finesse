// Full screen for the game pages (browser play, Moonlight in the page).
//
// Browsers only go full screen from a tap or click (user activation): a controller's
// buttons don't count, so this always hangs off a real button. On a phone the screen
// also turns sideways, where the browser allows it (Android Chrome, once full screen).
// iPhone has no full screen for a page at all, only for a video: there the way is
// Add to Home Screen, which opens Finesse without the browser's bars.

import { useEffect, useState } from 'react'

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitFullscreenEnabled?: boolean
  webkitExitFullscreen?: () => Promise<void> | void
}
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }
type Orientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void }

const doc = () => document as FsDoc

/** The browser can put an element in full screen (not iPhone Safari). */
export function canFullscreen(): boolean {
  return typeof document !== 'undefined' && Boolean(document.fullscreenEnabled || doc().webkitFullscreenEnabled)
}

export function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement || doc().webkitFullscreenElement)
}

/** iPhone, iPad and iPod (iPads say they're Macs, but Macs have no touch screen). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** Opened from the Home Screen (no browser bars already). */
export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/** Full screen on `el`, then landscape where the browser lets a page turn the screen. False if it didn't go full screen. */
export async function enterFullscreen(el: HTMLElement): Promise<boolean> {
  const e = el as FsEl
  try {
    if (e.requestFullscreen) await e.requestFullscreen({ navigationUI: 'hide' })
    else if (e.webkitRequestFullscreen) await e.webkitRequestFullscreen()
    else return false
  } catch {
    return false
  }
  // Only phones and tablets can (and only in full screen); computers refuse, which is fine.
  try {
    await (screen.orientation as Orientation | undefined)?.lock?.('landscape')
  } catch {
    /* not supported here */
  }
  return true
}

export async function exitFullscreen(): Promise<void> {
  try {
    ;(screen.orientation as Orientation | undefined)?.unlock?.()
  } catch {
    /* never locked */
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else if (doc().webkitFullscreenElement) await doc().webkitExitFullscreen?.()
  } catch {
    /* already out */
  }
}

/** Whether the page is full screen now (Esc, the system Back gesture and the button all change it). */
export function useIsFullscreen(): boolean {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && isFullscreen())
  useEffect(() => {
    const sync = () => setOn(isFullscreen())
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])
  return on
}
