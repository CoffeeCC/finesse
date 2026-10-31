// Focus for an overlay (a sheet, popover or dialog) while it's open: it moves inside
// when the overlay opens ([data-autofocus], else the first control), Tab stays inside,
// and it goes back to whatever opened it when it closes. The D-pad already stays
// inside [role="dialog"] once focus is there (lib/spatialNav); Back is lib/back's
// pushBackHandler.

import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
}

export function useOverlayFocus(open: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // After the overlay has rendered.
    const t = window.setTimeout(() => {
      const root = ref.current
      if (!root || root.contains(document.activeElement)) return
      const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(root)[0]
      first?.focus({ preventScroll: true })
    }, 0)
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current
      if (e.key !== 'Tab' || !root) return
      const els = focusables(root)
      if (!els.length) return
      const i = els.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && i <= 0) {
        e.preventDefault()
        els[els.length - 1]!.focus()
      } else if (!e.shiftKey && (i === -1 || i === els.length - 1)) {
        e.preventDefault()
        els[0]!.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      // Back to what opened it, unless focus has already gone somewhere on purpose.
      const now = document.activeElement
      const lost = !now || now === document.body || !now.isConnected || Boolean(ref.current?.contains(now))
      if (opener?.isConnected && lost) opener.focus({ preventScroll: true })
    }
  }, [open, ref])
}
