import { lazy, type ComponentType } from 'react'

// A page in a file of its own, loaded the first time it's opened. If that file is gone (the
// server updated while this tab was open, so the old file names no longer exist), reload once
// to pick up the new app instead of showing an error; a second failure in a row is a real one.

const KEY = 'finesse.chunkReload'

export function lazyPage<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const m = await load()
      try {
        sessionStorage.removeItem(KEY)
      } catch {
        /* ignore */
      }
      return m
    } catch (e) {
      let tried = false
      try {
        tried = sessionStorage.getItem(KEY) === '1'
        if (!tried) sessionStorage.setItem(KEY, '1')
      } catch {
        tried = true
      }
      if (!tried) {
        window.location.reload()
        // Never settles: the page is reloading.
        return new Promise<{ default: T }>(() => {})
      }
      throw e
    }
  })
}
