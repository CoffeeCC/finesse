import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getSession } from '../api/client'
import { playApi, type PlaySession } from '../api/setup'
import FullscreenButton from '../components/FullscreenButton'
import { finesseRoot } from '../lib/finesseServer'
import { exitFullscreen } from '../lib/fullscreen'

/** The player's page and its video WebSocket can't send our sign-in header, so it rides in a cookie scoped to /game-stream. */
function primePlayAuth() {
  const token = getSession()?.token
  if (token) document.cookie = `finesse_play_token=${encodeURIComponent(token)}; path=/game-stream; SameSite=Lax`
}

// Selkies' touch gamepad (an on-screen controller games see as an Xbox pad): its page listens for these.
const PAD_HOST = 'touch-gamepad-host'
const isTouch = () => typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window)

// An emulator's first start on a device sets itself up (and the server may fetch it): say so, once.
const SET_UP = 'finesse.emulatorStarted.'
function startedBefore(emulator: string): boolean {
  try {
    return localStorage.getItem(SET_UP + emulator) === '1'
  } catch {
    return true
  }
}
function markStarted(emulator: string) {
  try {
    localStorage.setItem(SET_UP + emulator, '1')
  } catch {
    /* private mode */
  }
}

/** Browser play (Beta): the emulator streams from the server into this page with Selkies. */
export default function StreamPlayPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const [s, setS] = useState<PlaySession | null>(null)
  const [err, setErr] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)
  const stopped = useRef(false)
  const [touch] = useState(isTouch)
  const [pad, setPad] = useState<'off' | 'on' | 'hidden'>('off')
  const box = useRef<HTMLDivElement>(null)
  const [firstStart, setFirstStart] = useState(false)
  const focusGame = useCallback(() => frame.current?.focus(), [])

  // Phones and tablets: the touch controller comes up with the game. The player is on our own address, so we can tell it.
  const showPad = (visible: boolean) => {
    const w = frame.current?.contentWindow
    if (!w) return
    const origin = window.location.origin
    if (pad === 'off') w.postMessage({ type: 'TOUCH_GAMEPAD_SETUP', payload: { targetDivId: PAD_HOST, visible } }, origin)
    else w.postMessage({ type: 'TOUCH_GAMEPAD_VISIBILITY', payload: { targetDivId: PAD_HOST, visible } }, origin)
    setPad(visible ? 'on' : 'hidden')
  }

  useEffect(() => {
    primePlayAuth()
    let t = 0
    const poll = () =>
      playApi
        .get(sessionId)
        .then((x) => {
          setS(x)
          if (x.state === 'starting') t = window.setTimeout(poll, 1000)
        })
        .catch((e: Error) => setErr(e.message))
    void poll()
    return () => clearTimeout(t)
  }, [sessionId])

  // Leaving the page ends the game, so the graphics card is free for the next one.
  useEffect(() => {
    const end = () => {
      if (!stopped.current) {
        stopped.current = true
        playApi.stopOnLeave(sessionId)
      }
    }
    window.addEventListener('pagehide', end)
    return () => {
      window.removeEventListener('pagehide', end)
      end()
    }
  }, [sessionId])

  // The note shows while this emulator starts for the first time here; once it's up, never again.
  const emulator = s?.emulator
  const state = s?.state
  useEffect(() => {
    if (!emulator) return
    if (state === 'starting' && !startedBefore(emulator)) setFirstStart(true)
    if (state === 'ready') markStarted(emulator)
  }, [emulator, state])

  // Leaving in full screen: the app behind mustn't stay full screen (or sideways).
  useEffect(() => () => void exitFullscreen(), [])

  const leave = () => navigate(-1)
  const ready = s?.state === 'ready'

  return (
    <div ref={box} className="fixed inset-0 z-50 bg-black">
      {ready ? (
        <iframe
          ref={frame}
          title={s.title}
          src={`${finesseRoot()}${s.url}`}
          className="h-full w-full border-0"
          allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write; keyboard-map"
          allowFullScreen
          onLoad={() => {
            focusGame()
            // Give the player a moment to start its touch controller, then show it.
            if (touch) window.setTimeout(() => showPad(true), 1500)
          }}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          {err || s?.state === 'error' ? (
            <>
              <p className="text-[15px] font-semibold text-white">The game didn’t start</p>
              <p className="max-w-md text-[13px] leading-relaxed text-ink-300">{err || s?.error}</p>
            </>
          ) : (
            <>
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" aria-hidden />
              <p className="text-[15px] font-semibold text-white">{s?.title ?? 'Starting'}</p>
              <p className="text-[13px] text-ink-300">{s?.detail ?? 'Getting ready…'}</p>
              {firstStart && (
                <p className="mt-2 max-w-sm rounded-xl bg-white/[0.06] px-4 py-3 text-[13px] leading-relaxed text-ink-200 ring-1 ring-white/10">
                  The first time an emulator starts can take a minute or two while it sets up.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {/* Top right, out of the game's way: the touch controls, full screen (it takes a tap: a
          controller's buttons can't start full screen), and Quit. */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        {ready && touch && (
          <button
            type="button"
            onClick={() => showPad(pad !== 'on')}
            aria-pressed={pad === 'on'}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-black/55 px-3.5 text-[13px] font-medium text-white ring-1 ring-white/15 hover:bg-black/80"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              <rect x="2.5" y="7" width="19" height="10" rx="5" />
              <path strokeLinecap="round" d="M7 10.5v3M5.5 12h3M16 11h.01M18 13h.01" />
            </svg>
            {pad === 'on' ? 'Hide controls' : 'Controls'}
          </button>
        )}
        <FullscreenButton target={box} refocus={focusGame} />
        <button
          type="button"
          onClick={leave}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-black/55 px-3.5 text-[13px] font-medium text-white ring-1 ring-white/15 hover:bg-black/80"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          {ready ? 'Quit game' : 'Back'}
        </button>
      </div>
    </div>
  )
}
