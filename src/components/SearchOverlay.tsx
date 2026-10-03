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
      if (/^\/(play|games\/play)\//.test(window.location.hash.replace(/^#/, '') || window.location.pathname.replace(/^\/finesse/, ''))) return
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
    return () => {
      pop()
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      // Glass like the Quick menu: the page blurs behind, the panel frosts over
      // it, and it never runs past the bottom of what's visible.
      className="os-qm-scrim fixed inset-0 z-[90] flex flex-col bg-black/45 backdrop-blur-md px-3 pb-3 pt-[calc(var(--vh)*6)] sm:px-4 sm:pt-[calc(var(--vh)*8)] fade-in"
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
