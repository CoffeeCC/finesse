import { useEffect, useRef } from 'react'

/** TV-only cursor. The webOS system pointer is unreliable inside this app (shows
 *  intermittently, or trails our old attempt), so we hide it entirely (see the
 *  cursor:none rule in the TV stylesheet) and draw our own accent ring here.
 *
 *  Position is written straight to the element's transform in the mousemove
 *  handler — no React state on the hot path, so it can't lag the pointer. Only
 *  the show/hide (on movement vs. D-pad/idle) touches the DOM class. */
export default function TvPointer() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let hideTimer = 0
    let visible = false

    const show = () => {
      if (!visible) {
        el.style.opacity = '1'
        visible = true
      }
      clearTimeout(hideTimer)
      hideTimer = window.setTimeout(hide, 4000)
    }
    const hide = () => {
      el.style.opacity = '0'
      visible = false
    }
    const move = (e: MouseEvent) => {
      // The whole app is zoomed (uiScale, default 1.3 on TV) via `zoom` on <html>.
      // This element lives inside that zoomed layout, so its translate is scaled
      // by the same factor — divide the pointer coords back out or the ring lands
      // ~1.3x off (usually off-screen), which is why it looked missing.
      const z = parseFloat(document.documentElement.style.zoom) || 1
      el.style.transform = `translate3d(${e.clientX / z - 15}px, ${e.clientY / z - 15}px, 0)`
      show()
    }

    window.addEventListener('mousemove', move, { passive: true })
    window.addEventListener('keydown', hide) // D-pad in use → drop the pointer
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('keydown', hide)
      clearTimeout(hideTimer)
    }
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 30,
        height: 30,
        borderRadius: '50%',
        border: '3px solid var(--color-accent-400, #7a8fd8)',
        background: 'rgba(255,255,255,0.22)',
        boxShadow: '0 0 0 2px rgba(0,0,0,0.6)',
        pointerEvents: 'none',
        zIndex: 100000,
        opacity: 0,
        willChange: 'transform',
      }}
    />
  )
}
