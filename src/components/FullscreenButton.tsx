import { useEffect, useRef, useState, type RefObject } from 'react'
import { IS_TV } from '../lib/device'
import { canFullscreen, enterFullscreen, exitFullscreen, isIOS, isStandalone, useIsFullscreen } from '../lib/fullscreen'

const ROUND =
  'inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white/85 ring-1 ring-white/15 transition-colors hover:bg-black/80 hover:text-white active:bg-black/90'

/**
 * Full screen for a game: `target` goes full screen (and sideways on a phone), then focus
 * goes back to the game (`refocus`), so the controller and keyboard keep driving it.
 * iPhone can't put a page in full screen: the button explains Add to Home Screen instead.
 * Nothing on a TV (the app already fills it) or once opened from the Home Screen.
 */
export default function FullscreenButton({ target, refocus, className = ROUND }: { target: RefObject<HTMLElement | null>; refocus?: () => void; className?: string }) {
  const on = useIsFullscreen()
  const [help, setHelp] = useState(false)
  const native = canFullscreen()
  const ios = !native && isIOS()

  // Whichever way it changed (this button, Esc, the Back gesture), the game keeps focus.
  const refocusRef = useRef(refocus)
  refocusRef.current = refocus
  const first = useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    const t = window.setTimeout(() => refocusRef.current?.(), 50)
    return () => window.clearTimeout(t)
  }, [on])

  if (IS_TV || isStandalone() || (!native && !ios)) return null

  const toggle = async () => {
    if (ios) return setHelp((h) => !h)
    if (on) await exitFullscreen()
    else if (target.current) await enterFullscreen(target.current)
    refocus?.()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void toggle()}
        className={className}
        aria-label={on ? 'Exit full screen' : 'Full screen'}
        aria-expanded={ios ? help : undefined}
        title={on ? 'Exit full screen' : 'Full screen'}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          {on ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          )}
        </svg>
      </button>
      {help && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 p-4 pt-16" onClick={() => (setHelp(false), refocus?.())}>
          <div role="dialog" aria-label="Full screen on iPhone" className="max-w-sm rounded-2xl bg-ink-900 p-4 text-left text-[14px] leading-relaxed text-ink-200 shadow-2xl ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-white">Full screen on iPhone</p>
            <p className="mt-1.5">
              iPhone can’t put a web page in full screen. Add Finesse to your Home Screen instead: tap <b className="text-white">Share</b>, then <b className="text-white">Add to Home Screen</b>, and open Finesse from there. It fills the screen, without Safari’s bars.
            </p>
            <button type="button" onClick={() => (setHelp(false), refocus?.())} className="mt-3 rounded-full bg-white/10 px-4 py-1.5 text-[13px] font-semibold text-white ring-1 ring-white/15 hover:bg-white/20">
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
