import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { streamingApi, type StreamApp } from '../api/setup'
import { useAuth } from '../auth/AuthContext'
import { pushBackHandler } from '../lib/back'
import { finesseRoot } from '../lib/finesseServer'
import { giveControllerToGame } from '../lib/gamepad'

type Phase = 'ticket' | 'signing-in' | 'starting' | 'launching' | 'playing' | 'ended' | 'quitting' | 'error'

const SAY: Record<Phase, string> = {
  ticket: 'Getting ready…',
  'signing-in': 'Signing in to the stream…',
  starting: 'Connecting to the server…',
  launching: 'Starting the game…',
  playing: '',
  ended: 'The game ended. Back to Finesse…',
  quitting: 'Closing the game…',
  error: '',
}

/** One of Wolf's apps, played in this page: Moonlight-Web from Finesse's stream port, filling the window. */
export default function GameStreamOverlay({ app, onClose }: { app: StreamApp; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('ticket')
  const [error, setError] = useState<string | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [stats, setStats] = useState(false)
  const [hint, setHint] = useState(false)
  const { session } = useAuth()
  const [restarting, setRestarting] = useState<string | null>(null)
  const playId = useRef<string | null>(null)
  const frameOrigin = useRef('')
  // The parent's onClose changes with its renders; the stream mustn't restart for that.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const host = new URL(finesseRoot(), window.location.href).hostname

  useEffect(() => pushBackHandler(() => (onClose(), true)), [onClose])
  useEffect(() => giveControllerToGame(), [])
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  useEffect(() => {
    let alive = true
    let origin = ''
    let ticket: { play: string; join: boolean } | null = null
    const fail = (m: string) => alive && (setError(m), setPhase('error'))
    const launch = async () => {
      // Wolf may need a moment to list the new stream's session.
      for (let i = 0; ; i++) {
        try {
          await streamingApi.launch(app.id, `browser:${ticket!.play}`)
          return alive && setPhase('playing')
        } catch (e) {
          if (i >= 5) return fail((e as Error).message)
          await new Promise((r) => setTimeout(r, 1500))
        }
      }
    }
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.data?.source !== 'finesse-stream') return
      const state = String(e.data.state)
      if (state === 'signing-in' || state === 'starting') setPhase(state)
      else if (state === 'streaming') {
        frame.current?.focus()
        setStats(Boolean(e.data.stats))
        if (ticket?.join) {
          setPhase('launching')
          void launch()
        } else setPhase('playing')
      } else if (state === 'ended') {
        // Steam or the game closed: back to Finesse by itself.
        setPhase('ended')
        window.setTimeout(() => alive && closeRef.current(), 2500)
      } else if (state === 'leave') closeRef.current()
      else if (state === 'quit') {
        setPhase('quitting')
        const close = () => alive && closeRef.current()
        if (ticket) void streamingApi.quitBrowser(ticket.play).then(close, close)
        else close()
      } else if (state === 'stats') setStats(Boolean(e.data.on))
      else if (state === 'error') fail(String(e.data.error ?? 'The stream didn’t start'))
    }
    window.addEventListener('message', onMessage)
    streamingApi
      .browser(app.id)
      .then((t) => {
        if (!alive) return
        ticket = t
        playId.current = t.play
        origin = frameOrigin.current = `https://${host}:${t.port}`
        setSrc(`${origin}/__finesse/enter?t=${encodeURIComponent(t.ticket)}`)
      })
      .catch((e: Error) => fail(e.message))
    // Say every 30 s that this page still shows the game; Finesse ends Wolf's session for a page that stops saying so.
    const beat = window.setInterval(() => ticket && void streamingApi.browserAlive(ticket.play).catch(() => {}), 30_000)
    return () => {
      alive = false
      window.clearInterval(beat)
      window.removeEventListener('message', onMessage)
      // Done here (Back to Finesse, Quit, closed): end the stream on the server too, or Wolf keeps it, and the memory it holds.
      if (ticket) void streamingApi.closeBrowser(ticket.play).catch(() => {})
    }
  }, [app.id, host])

  // How to get out, shown for a few seconds once the game is up.
  useEffect(() => {
    if (phase !== 'playing') return
    setHint(true)
    const t = window.setTimeout(() => setHint(false), 7000)
    return () => window.clearTimeout(t)
  }, [phase])
  const toFrame = (cmd: string) => {
    frame.current?.contentWindow?.postMessage({ source: 'finesse', cmd }, frameOrigin.current || '*')
    frame.current?.focus()
  }

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void box.current?.requestFullscreen().catch(() => {})
    frame.current?.focus()
  }
  const busy = phase !== 'playing' && phase !== 'error'

  return createPortal(
    <div ref={box} className="fixed inset-0 z-[100] bg-black" role="dialog" aria-modal="true" aria-label={`Playing ${app.title}`}>
      {src && (
        <iframe
          ref={frame}
          src={src}
          title={app.title}
          allow="fullscreen; gamepad; autoplay; clipboard-read; clipboard-write; keyboard-map"
          allowFullScreen
          className="absolute inset-x-0 bottom-0 top-11 h-[calc(100%-2.75rem)] w-full border-0"
        />
      )}
      {phase !== 'playing' && (
        // Over the stream, not instead of it: a frame hidden from the browser falls behind decoding.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 p-6 text-center">
          <p className="text-xl font-semibold text-white">{app.title}</p>
          {busy ? (
            <>
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" aria-hidden />
              <p className="text-[14px] text-ink-300">{SAY[phase]}</p>
            </>
          ) : (
            <>
              <p className="max-w-md text-[14px] text-red-300">{error}</p>
              {session?.isAdmin && (
                // Wolf can hold on to the graphics card's memory until streams fail; a restart gives it back.
                <button
                  type="button"
                  disabled={Boolean(restarting)}
                  className="rounded-full bg-white/10 px-4 py-2 text-[13px] font-medium text-white ring-1 ring-white/15 hover:bg-white/20 disabled:opacity-60"
                  onClick={() => {
                    setRestarting('Restarting Wolf…')
                    streamingApi.restartWolf().then(
                      () => setRestarting('Wolf restarted. Close this and play again in a few seconds.'),
                      (e: Error) => setRestarting(e.message),
                    )
                  }}
                >
                  Restart Wolf
                </button>
              )}
              {restarting && <p className="text-[13px] text-ink-300">{restarting}</p>}
            </>
          )}
        </div>
      )}
      {/* A bar of its own above the stream: over the stream it sat on Moonlight-Web's buttons, and a
          stream that has the mouse (pointer lock) takes every click. */}
      <div className="absolute inset-x-0 top-0 z-10 flex h-11 items-center gap-2 border-b border-white/10 bg-ink-950 px-3">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">
          {app.title}
          {phase === 'playing' && <span className="ml-2 hidden text-ink-400 sm:inline">Esc frees the mouse · hold View + Menu for the menu</span>}
        </p>
        {phase === 'playing' && (
          <>
            <button
              type="button"
              onClick={() => toFrame('stats')}
              aria-pressed={stats}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 ring-white/15 ${stats ? 'bg-white text-ink-950' : 'bg-white/5 text-white hover:bg-white/15'}`}
              title="Performance stats: frame rate, bitrate, lost frames, latency"
            >
              Stats
            </button>
            <button type="button" onClick={() => toFrame('menu')} className="rounded-full bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white ring-1 ring-white/15 hover:bg-white/15" title="Menu (hold View + Menu on a controller)">
              Menu
            </button>
          </>
        )}
        <button type="button" onClick={fullscreen} className="rounded-full bg-white/5 p-1.5 text-white ring-1 ring-white/15 hover:bg-white/15" aria-label="Full screen" title="Full screen">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-full bg-white/5 py-1.5 pl-2 pr-3 text-[12px] font-semibold text-white ring-1 ring-white/15 hover:bg-white/15"
          aria-label="Stop watching"
          title="Close (the game keeps running for 10 minutes, so you can come back)"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
          Back to Finesse
        </button>
      </div>
      {hint && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-[13px] text-white ring-1 ring-white/15">
          Hold <b>View + Menu</b> on your controller (or Ctrl+Alt+Shift+M) for the menu
        </div>
      )}
    </div>,
    document.body,
  )
}
