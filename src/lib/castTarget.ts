// The device this Finesse is currently remote-controlling ("Play on…" target).
// A tiny external store so the cast menu can set it and the mini remote (and
// the handoff banner) can react, without threading context through the app.

import { useSyncExternalStore } from 'react'

export interface CastTarget {
  sessionId: string
  deviceName: string
  itemId: string
}

const KEY = 'finesse.castTarget'
let current: CastTarget | null = (() => {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as CastTarget) : null
  } catch {
    return null
  }
})()
const subs = new Set<() => void>()

export function setCastTarget(t: CastTarget | null) {
  current = t
  try {
    if (t) sessionStorage.setItem(KEY, JSON.stringify(t))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* private mode */
  }
  subs.forEach((fn) => fn())
}

export function useCastTarget(): CastTarget | null {
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
