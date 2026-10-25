import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { streamingApi, type StreamApp } from '../api/setup'
import { pushBackHandler } from '../lib/back'
import { SessionPicker } from './MoonlightPlay'

/** Start one of Wolf's apps on a screen that has Moonlight open. */
export default function LaunchDialog({ app, onClose }: { app: StreamApp; onClose: () => void }) {
  const [broken, setBroken] = useState(false)
  const src = app.steam ? streamingApi.steamArtUrl(app.steam) : app.icon ? streamingApi.iconUrl(app.id) : null
  useEffect(() => pushBackHandler(() => (onClose(), true)), [onClose])
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  // On <body>: inside the page, an animated parent turns "fixed" into "wherever the section is".
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`Play ${app.title}`}>
      <button tabIndex={-1} className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div className="relative w-full overflow-hidden rounded-t-2xl border border-white/10 bg-ink-900 shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-start gap-4 border-b border-white/5 p-4 sm:p-5">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-ink-800">
            {src && !broken && <img src={src} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">{app.title}</h2>
            <p className="mt-0.5 text-[13px] text-ink-400">Runs on the server, streamed to Moonlight.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-ink-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4 sm:p-5">
          <SessionPicker
            intro={`Open Moonlight on the screen you’ll play on and pick this server (Wolf UI is fine). Then choose that screen here and ${app.title} starts on it.`}
            start={(session) => streamingApi.launch(app.id, session)}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}
