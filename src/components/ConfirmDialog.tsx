import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { pushBackHandler } from '../lib/back'
import { useOverlayFocus } from '../lib/overlayFocus'

/**
 * A plain "are you sure?" dialog: a title that names what happens, a line or two on what it
 * means, and two buttons. It stays open until someone answers. Back, Escape or a tap outside
 * is "Cancel"; focus starts on Cancel so a stray Enter never confirms. It renders into <body>, so
 * a transformed ancestor (a page's entrance animation) can't pull it off screen.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlayFocus(true, ref)
  useEffect(
    () =>
      pushBackHandler(() => {
        if (!busy) onCancel()
        return true
      }),
    [busy, onCancel],
  )
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-5" onClick={() => !busy && onCancel()}>
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="font-display text-[24px] leading-tight text-white">
          {title}
        </h2>
        {children && (
          <div id="confirm-body" className="mt-3 space-y-2 text-[14px] leading-relaxed text-ink-200">
            {children}
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" data-autofocus onClick={onCancel} disabled={busy} className="h-10 rounded-full px-5 text-[14px] font-medium text-ink-200 hover:text-white disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`h-10 rounded-full px-6 text-[14px] font-semibold text-white disabled:opacity-60 ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-accent-fill hover:brightness-110'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
