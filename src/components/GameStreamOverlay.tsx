import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { streamingApi, type StreamApp } from '../api/setup'
import { pushBackHandler } from '../lib/back'
import { finesseRoot } from '../lib/finesseServer'
import { giveControllerToGame } from '../lib/gamepad'

type Phase = 'ticket' | 'signing-in' | 'starting' | 'launching' | 'playing' | 'ended' | 'error'

const SAY: Record<Phase, string> = {
  ticket: 'Getting ready…',
  'signing-in': 'Signing in to the stream…',
  starting: 'Connecting to the server…',
  launching: 'Starting the game…',
  playing: '',
  ended: 'The stream ended.',
  error: '',
}

/** One of Wolf's apps, played in this page: Moonlight-Web from Finesse's stream port, filling the window. */
export default function GameStreamOverlay({ app, onClose }: { app: StreamApp; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('ticket')
  const [error, setError] = useState<string | null>(null)
  const [src, setSrc] = useState<string | null>(null)
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
        if (ticket?.join) {
          setPhase('launching')
          void launch()
        } else setPhase('playing')
      } else if (state === 'ended') setPhase('ended')
      else if (state === 'error') fail(String(e.data.error ?? 'The stream didn’t start'))
    }
    window.addEventListener('message', onMessage)
    streamingApi
      .browser(app.id)
      .then((t) => {
        if (!alive) return
        ticket = t
        origin = `https://${host}:${t.port}`
        setSrc(`${origin}/__finesse/enter?t=${encodeURIComponent(t.ticket)}`)
      })
      .catch((e: Error) => fail(e.message))
    return () => {
      alive = false
      window.removeEventListener('message', onMessage)
    }
  }, [app.id, host])

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void box.current?.requestFullscreen().catch(() => {})
    frame.current?.focus()
  }
  const busy = phase !== 'playing' && phase !== 'error' && phase !== 'ended'

  return createPortal(
    <div ref={box} className="fixed inset-0 z-[100] bg-black" role="dialog" aria-modal="true" aria-label={`Playing ${app.title}`}>
      {src && (
        <iframe
          ref={frame}
          src={src}
          title={app.title}
          allow="fullscreen; gamepad; autoplay; clipboard-read; clipboard-write; keyboard-map"
          allowFullScreen
          className={`absolute inset-0 h-full w-full border-0 transition-opacity duration-500 ${phase === 'playing' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {phase !== 'playing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-xl font-semibold text-white">{app.title}</p>
          {busy ? (
            <>
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" aria-hidden />
              <p className="text-[14px] text-ink-300">{SAY[phase]}</p>
            </>
          ) : (
            <p className={`max-w-md text-[14px] ${phase === 'error' ? 'text-red-300' : 'text-ink-300'}`}>{phase === 'error' ? error : 'The stream ended. The game keeps running for 10 minutes: open it again to pick up where you were.'}</p>
          )}
        </div>
      )}
      <div className="group absolute right-3 top-3 z-10 flex gap-2 opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={fullscreen} className="rounded-full bg-black/60 p-2 text-white ring-1 ring-white/15 hover:bg-black/80" aria-label="Full screen" title="Full screen">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-black/60 p-2 text-white ring-1 ring-white/15 hover:bg-black/80"
          aria-label="Stop watching"
          title="Close (the game keeps running for 10 minutes, so you can come back)"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>,
    document.body,
  )
}
