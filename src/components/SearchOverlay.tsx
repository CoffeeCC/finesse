import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import SearchPanel from './SearchPanel'
import { closeSearch, openSearch, useSearchOverlay } from '../lib/searchOverlay'
import { isTypingTarget, pushBackHandler } from '../lib/back'

/** Desktop universal search: "/" (or ⌘K / Ctrl+K) from anywhere, or the navbar
 *  field. Closes on Escape / Back, a click outside, or opening a result. */
export default function SearchOverlay() {
  const { open, query } = useSearchOverlay()
  const location = useLocation()

  // Opening a result navigates — the overlay goes with it.
  useEffect(() => {
    closeSearch()
  }, [location.key])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target)
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      if (!slash && !cmdK) return
      // Not over the player / game screens (they're outside the main layout).
      if (/^\/(play|games\/play|games\/stream)\//.test(window.location.hash.replace(/^#/, '') || window.location.pathname.replace(/^\/finesse/, ''))) return
      e.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const pop = pushBackHandler(() => {
      closeSearch()
      return true
    })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // The page behind holds still while search is up (index.css pauses the stage and aurora
    // animations under [data-overlay]): nothing moving under the glass to re-blur every frame.
    const html = document.documentElement
    const prevOverlay = html.dataset.overlay
    html.dataset.overlay = 'open'
    return () => {
      pop()
      document.body.style.overflow = prev
      if (prevOverlay === undefined) delete html.dataset.overlay
      else html.dataset.overlay = prevOverlay
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      // A plain dark scrim (one blur, the panel's own frost, is plenty: a second full-screen
      // blur under it cost every frame), clear of notches and rounded corners, and the panel
      // never runs past the bottom of what's visible.
      className="os-qm-scrim fixed inset-0 z-[90] flex flex-col bg-black/65 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(calc(var(--vh)*6),env(safe-area-inset-top))] sm:pl-[max(1rem,env(safe-area-inset-left))] sm:pr-[max(1rem,env(safe-area-inset-right))] sm:pt-[max(calc(var(--vh)*8),env(safe-area-inset-top))] fade-in"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeSearch()
      }}
    >
      <div className="os-glass mx-auto flex max-h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-[28px] toast-in">
        <SearchPanel mode="overlay" initialQuery={query} onClose={closeSearch} />
      </div>
    </div>,
    document.body,
  )
}
