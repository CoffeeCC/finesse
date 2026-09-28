import { useEffect, useRef, useState } from 'react'

// TV-only lazy loading. `loading="lazy"` is a no-op on the CX's Chromium 68
// (shipped in 76), so the TV was downloading + decoding EVERY poster on the
// page at once. One shared IntersectionObserver marks elements "near" when
// they come within a screen of the viewport; images render src only then.

let io: IntersectionObserver | null = null
const callbacks = new WeakMap<Element, () => void>()

function observer(): IntersectionObserver {
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const cb = callbacks.get(e.target)
          if (cb) {
            cb()
            io!.unobserve(e.target)
            callbacks.delete(e.target)
          }
        }
      },
      // Load one viewport ahead so scrolling meets ready images.
      { rootMargin: '900px' },
    )
  }
  return io
}

/** [ref, near] — `near` flips true when the element approaches the viewport.
 *  On non-TV builds it's always true (native lazy loading handles the rest). */
export function useTvLazy<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(!__WEBOS__)

  useEffect(() => {
    if (!__WEBOS__ || near) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    callbacks.set(el, () => setNear(true))
    observer().observe(el)
    return () => {
      callbacks.delete(el)
      io?.unobserve(el)
    }
  }, [near])

  return [ref, near]
}
