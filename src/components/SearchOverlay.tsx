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
      className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm px-4 fade-in"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeSearch()
      }}
    >
      <div className="mx-auto mt-[calc(var(--vh)*8)] max-w-3xl rounded-2xl bg-ink-900 border border-white/10 shadow-2xl shadow-black/60 overflow-hidden toast-in">
        <SearchPanel mode="overlay" initialQuery={query} onClose={closeSearch} />
      </div>
    </div>,
    document.body,
  )
}
