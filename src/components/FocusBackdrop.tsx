import { useEffect, useState } from 'react'

/** Living backdrop ("lean-back mode"): rest focus — or the pointer — on any
 *  card for a moment and the page background crossfades to that title's
 *  backdrop, heavily dimmed behind the content. Cards advertise their art via
 *  data-backdrop; anything without it simply doesn't react.
 *
 *  Opacity-only animation on one dimmed layer = composited and TV-cheap. */
export default function FocusBackdrop() {
  const [layer, setLayer] = useState<{ url: string; key: number } | null>(null)

  useEffect(() => {
    let timer = 0
    let lastUrl = ''

    const consider = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      const url = el?.closest?.('[data-backdrop]')?.getAttribute('data-backdrop')
      window.clearTimeout(timer)
      if (!url || url === lastUrl) return
      timer = window.setTimeout(() => {
        lastUrl = url
        setLayer({ url, key: Date.now() })
      }, 1500)
    }

    const onFocus = (e: FocusEvent) => consider(e.target)
    const onOver = (e: MouseEvent) => consider(e.target)
    window.addEventListener('focusin', onFocus)
    window.addEventListener('mouseover', onOver)
    return () => {
      window.removeEventListener('focusin', onFocus)
      window.removeEventListener('mouseover', onOver)
      window.clearTimeout(timer)
    }
  }, [])

  if (!layer) return null

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 bottom-0 pointer-events-none"
      style={{ zIndex: -1 }}
    >
      <img
        key={layer.key}
        src={layer.url}
        alt=""
        className="h-full w-full object-cover backdrop-fade-in"
      />
      <div
        className="absolute top-0 left-0 right-0 bottom-0"
        style={{ background: 'linear-gradient(rgba(11,13,18,.55), rgba(11,13,18,.92) 80%, #0b0d12)' }}
      />
    </div>
  )
}
