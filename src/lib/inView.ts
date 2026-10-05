import { useEffect, useState } from 'react'

/** Whether an element is at least `threshold` on screen and the tab is in front.
 *  Preview clips use it to pause (and not start) while you've scrolled past them.
 *  Returns a ref callback (so it attaches whenever the element appears) and the answer. */
export function useInView<T extends Element>(threshold = 0.25): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null)
  const [visible, setVisible] = useState(true)
  const [front, setFront] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.intersectionRatio >= threshold), { threshold: [0, threshold, 1] })
    io.observe(el)
    return () => io.disconnect()
  }, [el, threshold])
  useEffect(() => {
    const on = () => setFront(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return [setEl, visible && front]
}
