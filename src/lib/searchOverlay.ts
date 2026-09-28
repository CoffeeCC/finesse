// Open/close state for the universal search overlay (components/SearchOverlay),
// so the navbar field, the "/" hotkey and anything else can summon it.

import { useSyncExternalStore } from 'react'

let state: { open: boolean; query: string } = { open: false, query: '' }
const subs = new Set<() => void>()
const emit = () => subs.forEach((fn) => fn())

export function openSearch(query = '') {
  state = { open: true, query }
  emit()
}

export function closeSearch() {
  if (!state.open) return
  state = { ...state, open: false }
  emit()
}

export function useSearchOverlay() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    () => state,
  )
}
