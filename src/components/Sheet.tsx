import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { pushBackHandler } from '../lib/back'
import { useOverlayFocus } from '../lib/overlayFocus'

/**
 * A small dialog with a title, whatever goes in it, and Close. Back, Escape or a tap outside
 * closes it; focus goes in when it opens and back where it was after. Rendered into <body>.
 */
export function Sheet({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useOverlayFocus(true, ref)
  useEffect(
    () =>
      pushBackHandler(() => {
        onClose()
        return true
      }),
    [onClose],
  )
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={`flex max-h-[calc(var(--vh,1vh)*88)] w-full ${wide ? 'max-w-xl' : 'max-w-md'} flex-col rounded-2xl border border-white/10 bg-ink-900 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
          <h2 id={id} className="font-display text-[22px] leading-tight text-white">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-ink-200 hover:bg-white/20 hover:text-white">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-1">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
