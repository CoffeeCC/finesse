import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getSession } from '../api/client'
import { playApi, type PlaySession } from '../api/setup'
import { finesseRoot } from '../lib/finesseServer'

/** The player's page and its video WebSocket can't send our sign-in header, so it rides in a cookie scoped to /play. */
function primePlayAuth() {
  const token = getSession()?.token
  if (token) document.cookie = `finesse_play_token=${encodeURIComponent(token)}; path=/play; SameSite=Lax`
}

/** Browser play (Beta): the emulator streams from the server into this page with Selkies. */
export default function StreamPlayPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const [s, setS] = useState<PlaySession | null>(null)
  const [err, setErr] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)
  const stopped = useRef(false)

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

  const leave = () => navigate(-1)
  const ready = s?.state === 'ready'

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {ready ? (
        <iframe
          ref={frame}
          title={s.title}
          src={`${finesseRoot()}${s.url}`}
          className="h-full w-full border-0"
          allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write; keyboard-map"
          allowFullScreen
          onLoad={() => frame.current?.focus()}
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
            </>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={leave}
        className="absolute right-3 top-3 z-10 inline-flex h-9 items-center gap-1.5 rounded-lg bg-black/70 px-3 text-[13px] font-medium text-white ring-1 ring-white/15 hover:bg-black/85"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        {ready ? 'Quit game' : 'Back'}
      </button>
    </div>
  )
}
