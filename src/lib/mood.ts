// "The app wears the film": the colour of whatever you're looking at tints the
// room. Cards carry data-mood="r, g, b" (their poster's graded colour); resting
// on one — mouse or D-pad — sets the mood, and detail pages set their film's
// own. Consumers: the full-screen wash (components/MoodWash), loading
// placeholders (via --mood-rgb), and the nav sound's pitch.

import { useSyncExternalStore } from 'react'
import { IS_TV } from './device'

let current: string | null = null
const subs = new Set<() => void>()

export function setMood(rgb: string | null) {
  if (rgb === current) return
  current = rgb
  // One style write per change (not per frame) for the small CSS consumers.
  if (!IS_TV) {
    if (rgb) document.documentElement.style.setProperty('--mood-rgb', rgb)
    else document.documentElement.style.removeProperty('--mood-rgb')
  }
  subs.forEach((fn) => fn())
}

export function useMood(): string | null {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    () => current,
  )
}

/** Hue (0–360) of an "r, g, b" mood string. */
export function moodHue(rgb: string): number | null {
  const [r, g, b] = rgb.split(',').map((n) => Number(n) / 255)
  if ([r, g, b].some((n) => !Number.isFinite(n))) return null
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return null
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}
