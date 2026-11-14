// Light under the glass: tells the card under the mouse where the pointer is (--mx/--my, 0…1),
// so index.css can paint a highlight there. One listener for the whole app, one write per
// frame, mouse only. The card itself never moves with the pointer.

import { IS_TV } from './device'

export function initCardLight(): () => void {
  if (IS_TV || typeof window === 'undefined') return () => {}
  let raf = 0
  let el: HTMLElement | null = null
  let x = 0
  let y = 0
  const apply = () => {
    raf = 0
    if (!el) return
    const b = el.getBoundingClientRect()
    if (!b.width || !b.height) return
    el.style.setProperty('--mx', ((x - b.left) / b.width).toFixed(3))
    el.style.setProperty('--my', ((y - b.top) / b.height).toFixed(3))
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const group = (e.target as Element | null)?.closest?.('.group')
    el = group ? group.querySelector<HTMLElement>('.tilt') : null
    if (!el) return
    x = e.clientX
    y = e.clientY
    if (!raf) raf = requestAnimationFrame(apply)
  }
  window.addEventListener('pointermove', onMove, { passive: true })
  return () => {
    window.removeEventListener('pointermove', onMove)
    cancelAnimationFrame(raf)
  }
}
