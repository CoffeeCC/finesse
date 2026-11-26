import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { streamingApi, type StreamApp } from '../api/setup'
import { pushBackHandler } from '../lib/back'
import { useFinesse } from '../lib/finesseServer'
import { switchToHttps } from '../lib/httpsHandoff'
import { PLAY_BTN } from './ActionButton'
import GameStreamOverlay from './GameStreamOverlay'
import { PlayIcon, SessionPicker } from './MoonlightPlay'
import { tileImages } from '../lib/streamTiles'

/** Start one of Wolf's apps on a screen that has Moonlight open. */
export default function LaunchDialog({ app, autoPlay = false, onClose }: { app: StreamApp; autoPlay?: boolean; onClose: () => void }) {
  const [n, setN] = useState(0)
  const [playing, setPlaying] = useState(autoPlay && window.isSecureContext)
  const [switching, setSwitching] = useState(false)
  const { info } = useFinesse()
  // In this page: Moonlight-Web on Finesse's stream port. It decodes video only on an https page.
  const here = Boolean(info?.streamPort && info?.httpsPort) && window.location.protocol !== 'file:'
  const src = tileImages(app)[n] ?? null
  useEffect(() => (playing ? undefined : pushBackHandler(() => (onClose(), true))), [onClose, playing])
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  if (playing) return <GameStreamOverlay app={app} onClose={onClose} />
  // On <body>: inside the page, an animated parent turns "fixed" into "wherever the section is".
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`Play ${app.title}`}>
      <button tabIndex={-1} className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div className="relative w-full overflow-hidden rounded-t-2xl border border-white/10 bg-ink-900 shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-start gap-4 border-b border-white/5 p-4 sm:p-5">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-ink-800">
            {src && <img key={src} src={src} alt="" onError={() => setN((i) => i + 1)} className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">{app.title}</h2>
            <p className="mt-0.5 text-[13px] text-ink-400">Runs on the server, streamed to {here ? 'this page or Moonlight' : 'Moonlight'}.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-ink-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {here && (
          <div className="border-b border-white/5 p-4 sm:p-5">
            {window.isSecureContext ? (
              // eslint-disable-next-line jsx-a11y/no-autofocus
              <button type="button" autoFocus className={`${PLAY_BTN} w-full justify-center`} onClick={() => setPlaying(true)}>
                <PlayIcon />
                {app.running ? 'Resume here' : 'Play here'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={switching}
                  onClick={() => {
                    if (!info?.httpsPort) return
                    setSwitching(true)
                    void switchToHttps(info.httpsPort, { autostream: app.id })
                  }}
                  className={`${PLAY_BTN} w-full justify-center disabled:opacity-60`}
                >
                  <PlayIcon />
                  {switching ? 'Opening stream…' : app.running ? 'Resume here' : 'Play here'}
                </button>
                <p className="mt-2 text-[11.5px] text-ink-400">
                  Switches to Finesse’s secure port automatically while keeping you signed in.{' '}
                  <Link to="/settings?s=account&at=secure-connection" onClick={onClose} className="text-accent-300 hover:text-white underline-offset-2 hover:underline">
                    Skip browser warnings once →
                  </Link>
                </p>
              </>
            )}
            <p className="mt-2 text-[12px] text-ink-400">In this window, with keyboard, mouse or a controller.</p>
          </div>
        )}
        <div className="p-4 sm:p-5">
          <SessionPicker
            intro={`${here ? 'Or play on a TV: open' : 'Open'} Moonlight on the screen you’ll play on and pick this server (Wolf UI is fine). Then choose that screen here and ${app.title} starts on it.`}
            start={(session) => streamingApi.launch(app.id, session)}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
