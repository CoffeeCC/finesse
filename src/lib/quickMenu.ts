// Open/close state for the quick menu (components/os/QuickMenu): the system
// layer over everything — who's playing what, the server, downloads, friends.

import { useSyncExternalStore } from 'react'

let open = false
const subs = new Set<() => void>()
const emit = () => subs.forEach((fn) => fn())

export function openQuickMenu() {
  if (open) return
  open = true
  emit()
}

export function closeQuickMenu() {
  if (!open) return
  open = false
  emit()
}

export function toggleQuickMenu() {
  open = !open
  emit()
}

export function useQuickMenuOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    () => open,
  )
}
