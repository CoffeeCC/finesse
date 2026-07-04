import { useEffect, useRef, useState } from 'react'

/** TV-only: our own pointer cursor for Magic Remote / air-mouse input.
 *
 *  webOS is supposed to overlay a system cursor inside web apps, but on this
 *  sideloaded app it never showed. We don't need it: the remote still delivers
 *  real mouse events, so we draw a themed accent ring that follows them —
 *  transform-only updates, composited, cheap even on the TV SoC.
 *
 *  Appears on pointer movement, hides on D-pad use or after a few idle seconds
 *  (matching how the system cursor is supposed to behave). */
export default function TvPointer() {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    let hideTimer = 0
    const move = (e: MouseEvent) => {
      const el = ref.current
      if (!el) return
      el.style.transform = `translate(${e.clientX - 16}px, ${e.clientY - 16}px)`
      setActive(true)
      clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => setActive(false), 4000)
    }
    const keys = () => setActive(false) // D-pad takes over — hide the pointer
    window.addEventListener('mousemove', move, { passive: true })
    window.addEventListener('keydown', keys)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('keydown', keys)
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
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: '3px solid var(--color-accent-400, #7a8fd8)',
        background: 'rgba(255,255,255,0.18)',
        boxShadow: '0 0 0 2px rgba(0,0,0,0.55)',
        pointerEvents: 'none',
        zIndex: 9999,
        opacity: active ? 1 : 0,
        transition: 'opacity 0.2s ease',
      }}
    />
  )
}
