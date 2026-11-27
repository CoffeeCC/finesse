// Play asks which way, every time. The last way this person used is focused.
// A way that can't run stays focusable, so a remote or a controller can land on
// the reason. Arrow keys are already the D-pad (spatial nav); this dialog
// doesn't listen for them again.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { gameStoreApi, type GameRequest, type PlayChoiceOptions, type PlayWay } from '../../api/gameStore'
import { usePlayOptions, useStoreMode } from '../../api/gameStoreQueries'
import { streamingApi, type StreamApp } from '../../api/setup'
import { pushBackHandler } from '../../lib/back'
import { useFinesse } from '../../lib/finesseServer'
import { switchToHttps } from '../../lib/httpsHandoff'
import { useOverlayFocus } from '../../lib/overlayFocus'
import { PlayIcon, SessionPicker } from '../MoonlightPlay'
import GameStreamOverlay from '../GameStreamOverlay'

const WAY: { way: PlayWay; label: (name: string) => string }[] = [
  { way: 'server', label: (name) => `Play on ${name}` },
  { way: 'stream', label: () => 'Stream' },
]

export default function PlayChoice({ request, onClose }: { request: Pick<GameRequest, 'id' | 'title' | 'cover'>; onClose: () => void }) {
  const mode = useStoreMode()
  const { data, isLoading, isError, error } = usePlayOptions(request.id)
  const [playing, setPlaying] = useState<StreamApp | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [switchingHttps, setSwitchingHttps] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const { info } = useFinesse()
  const here = Boolean(info?.streamPort && info?.httpsPort) && window.location.protocol !== 'file:'
  const httpsPort = info?.httpsPort ?? null

  useEffect(() => (playing ? undefined : pushBackHandler(() => (onClose(), true))), [onClose, playing])
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  useOverlayFocus(!playing, panel)

  if (playing) return <GameStreamOverlay app={playing} onClose={onClose} />
  const preferred: PlayWay = data?.last?.way ?? data?.ways.find((w) => w.ok)?.way ?? 'server'

  const start = async (way: PlayWay, target: string) => {
    if (!mode) throw new Error('The game store isn’t on.')
    setBusy(true)
    setErr(null)
    try {
      const api = await gameStoreApi(mode)
      const started = await api.play(request.id, way, target)
      if (way === 'server') {
        setNote(`Starting on ${data?.serverName ?? 'the server'}’s screen.`)
        return
      }
      if (!started.appId) throw new Error('Game streaming didn’t hand back a game to start.')
      return started.appId
    } finally {
      setBusy(false)
    }
  }

  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : 'That didn’t start.')

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`Play ${request.title}`}>
      <button tabIndex={-1} className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div ref={panel} className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-white/10 bg-ink-900 shadow-2xl sm:max-w-md sm:rounded-2xl">
        <div className="flex items-start gap-4 border-b border-white/5 p-4 sm:p-5">
          <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-ink-800">
            {request.cover && <img src={request.cover} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white">{request.title}</h2>
            <p className="mt-0.5 text-[13px] text-ink-400">Choose where it plays. The last choice is already selected.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-ink-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-3 p-4 sm:p-5">
          {isLoading && <p className="text-sm text-ink-400">Checking what this server can do…</p>}
          {isError && <p className="text-sm text-red-300">{error instanceof Error ? error.message : 'Couldn’t check how to play this.'}</p>}
          {data && (
            <>
              <WayButton
                way="server"
                options={data}
                preferred={preferred}
                busy={busy}
                label={WAY[0]!.label(data.serverName)}
                onPick={() => void start('server', 'server').catch(fail)}
              />
              <StreamWay
                options={data}
                preferred={preferred}
                busy={busy || switchingHttps}
                here={here}
                httpsPort={httpsPort}
                switchingHttps={switchingHttps}
                onSwitchHttps={() => {
                  if (!httpsPort || switchingHttps) return
                  setSwitchingHttps(true)
                  void switchToHttps(httpsPort)
                }}
                onBrowser={() => {
                  void start('stream', 'browser')
                    .then((appId) => {
                      if (appId) setPlaying({ id: appId, title: request.title, hdr: false, icon: false, kind: 'app' })
                    })
                    .catch(fail)
                }}
                onDevice={async (session) => {
                  const appId = await start('stream', session)
                  if (!appId) throw new Error('That didn’t start.')
                  return streamingApi.launch(appId, session)
                }}
              />
            </>
          )}
          {note && <p className="text-[13px] text-emerald-300">{note}</p>}
          {err && <p className="text-[13px] text-red-300">{err}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function WayButton({
  way,
  options,
  preferred,
  busy,
  label,
  onPick,
}: {
  way: PlayWay
  options: PlayChoiceOptions
  preferred: PlayWay
  busy: boolean
  label: string
  onPick: () => void
}) {
  const info = options.ways.find((w) => w.way === way)
  const ok = Boolean(info?.ok)
  const last = options.last?.way === way
  return (
    <button
      type="button"
      data-autofocus={preferred === way ? '' : undefined}
      aria-disabled={!ok || busy}
      onClick={() => {
        if (!ok || busy) return
        onPick()
      }}
      className={`flex w-full flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-white ${
        ok ? 'border-white/15 bg-white text-ink-950' : 'border-white/15 bg-white/5 text-ink-300'
      }`}
    >
      <span className="flex w-full items-center gap-2 text-sm font-semibold">
        {way === 'stream' ? null : <PlayIcon />}
        {label}
        {last && <span className="ml-auto text-[11px] font-medium uppercase tracking-wide opacity-70">Last used</span>}
      </span>
      {!ok && info?.why && <span className="text-[13px] font-normal leading-snug">{info.why}</span>}
    </button>
  )
}

function StreamWay({
  options,
  preferred,
  busy,
  here,
  httpsPort,
  switchingHttps,
  onSwitchHttps,
  onBrowser,
  onDevice,
}: {
  options: PlayChoiceOptions
  preferred: PlayWay
  busy: boolean
  here: boolean
  httpsPort: number | null
  switchingHttps: boolean
  onSwitchHttps: () => void
  onBrowser: () => void
  onDevice: (session: string) => Promise<{ app: string }>
}) {
  const info = options.ways.find((w) => w.way === 'stream')
  const ok = Boolean(info?.ok)
  if (!ok) {
    return <WayButton way="stream" options={options} preferred={preferred} busy={busy} label="Stream" onPick={() => {}} />
  }
  const secure = window.isSecureContext
  return (
    <div
      data-autofocus={preferred === 'stream' && !here ? '' : undefined}
      tabIndex={preferred === 'stream' && !here ? 0 : undefined}
      className="space-y-3 rounded-xl border border-white/10 p-3 outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <p className="px-1 text-sm font-semibold text-white">
        Stream
        {options.last?.way === 'stream' && <span className="ml-2 text-[11px] font-medium uppercase tracking-wide text-ink-400">Last used</span>}
      </p>
      {here && secure && (
        <button
          type="button"
          data-autofocus={preferred === 'stream' ? '' : undefined}
          aria-disabled={busy}
          onClick={() => {
            if (!busy) onBrowser()
          }}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-ink-950 outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <PlayIcon />
          Play here
        </button>
      )}
      {here && !secure && httpsPort && (
        <button
          type="button"
          disabled={switchingHttps}
          onClick={onSwitchHttps}
          data-autofocus={preferred === 'stream' ? '' : undefined}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-ink-950 outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
        >
          <PlayIcon />
          {switchingHttps ? 'Opening secure stream…' : 'Play here'}
        </button>
      )}
      {here && <p className="px-1 text-[12px] text-ink-400">In this window, with a keyboard, a mouse or a controller.</p>}
      <SessionPicker
        intro={here ? 'Or play on a TV: open Moonlight on that screen and pick this server, then choose it here.' : 'Open Moonlight on the screen you’ll play on and pick this server, then choose it here.'}
        start={onDevice}
      />
    </div>
  )
}
