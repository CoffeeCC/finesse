import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { playApi, streamingApi, type StreamEmulator } from '../api/setup'
import { useAuth } from '../auth/AuthContext'
import { useFinesse } from '../lib/finesseServer'

/** The emulator app (in Wolf) that plays a RomM console, if this server has one. Shares the Games page's list. */
export function useMoonlightApp(slug: string | undefined): { app: StreamEmulator | null; launcher: string | null; profiles: string[] } {
  const { info } = useFinesse()
  const on = Boolean(info?.features.streaming)
  const { data } = useQuery({ queryKey: ['streaming', 'apps'], queryFn: streamingApi.apps, staleTime: 60_000, retry: 1, enabled: on })
  const s = slug?.toLowerCase() ?? ''
  const app = (on && s && data?.emulators?.find((e) => e.consoles.includes(s))) || null
  return { app, launcher: data?.apps.find((a) => a.launcher)?.title ?? null, profiles: data?.profiles?.map((p) => p.name) ?? [] }
}

const link = 'text-accent-300 underline-offset-2 hover:underline'
const smallBtn =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[13px] font-medium text-ink-200 hover:border-white/25 hover:text-white disabled:opacity-50 transition-colors'

/** Start the game in a Moonlight session that's already open (Wolf starts the emulator with it). */
function StartHere({ rom, app }: { rom: number; app: StreamEmulator }) {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState(app.profiles.length === 1 ? app.profiles[0]! : '')
  const [state, setState] = useState<{ busy?: string; done?: string; err?: string }>({})
  const { data, isLoading, refetch } = useQuery({ queryKey: ['streaming', 'sessions'], queryFn: streamingApi.sessions, enabled: open, refetchInterval: open ? 5000 : false })
  const { data: list } = useQuery({ queryKey: ['streaming', 'apps'], queryFn: streamingApi.apps, staleTime: 60_000 })
  // Wolf's profile ids, by the names the household sees.
  const profileId = list?.profiles?.find((p) => p.name === profile)?.id

  if (!open)
    return (
      <button type="button" className={smallBtn} onClick={() => setOpen(true)}>
        Start it in Moonlight from here
      </button>
    )
  const sessions = data?.sessions ?? []
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-ink-950/50 px-4 py-3">
      <p className="text-[13px] text-ink-300">Open Moonlight on the device first (Wolf UI is fine), then pick it here. The game starts on that screen.</p>
      {app.profiles.length > 1 && (
        <label className="block text-[12.5px] text-ink-300">
          Whose saves?{' '}
          <select className="ml-1 rounded-md border border-white/10 bg-ink-900 px-2 py-1 text-[13px] text-white" value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="">Pick a profile</option>
            {app.profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      {isLoading ? (
        <p className="text-[12.5px] text-ink-400">Looking for open Moonlight sessions…</p>
      ) : !data?.ok ? (
        <p className="text-[12.5px] text-amber-200">{data?.error ?? 'Game streaming isn’t answering right now.'}</p>
      ) : sessions.length === 0 ? (
        <p className="text-[12.5px] text-ink-400">
          No Moonlight session is open.{' '}
          <button type="button" className={link} onClick={() => void refetch()}>
            Look again
          </button>
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] text-white">
                {s.ip || 'A device'}
                {s.app && <span className="text-ink-400"> · in {s.app}</span>}
              </span>
              <button
                type="button"
                className={smallBtn}
                disabled={Boolean(state.busy) || (app.profiles.length > 1 && !profileId)}
                onClick={() => {
                  setState({ busy: s.id })
                  streamingApi
                    .play(rom, s.id, profileId)
                    .then((r) => setState({ done: `Starting in ${r.app}. Look at the screen with Moonlight.` }))
                    .catch((e: Error) => setState({ err: e.message }))
                }}
              >
                {state.busy === s.id ? 'Starting…' : 'Play here'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.done && <p className="text-[12.5px] text-emerald-300">{state.done}</p>}
      {state.err && <p className="text-[12.5px] text-red-300">{state.err}</p>}
    </div>
  )
}

/** Browser play (Beta): the emulator streams into Finesse itself, for screens without Moonlight. */
function PlayInBrowser({ rom, app }: { rom: number; app: StreamEmulator }) {
  const navigate = useNavigate()
  const { info } = useFinesse()
  const { data: list } = useQuery({ queryKey: ['streaming', 'apps'], queryFn: streamingApi.apps, staleTime: 60_000 })
  const [profile, setProfile] = useState(app.profiles.length === 1 ? app.profiles[0]! : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const profileId = list?.profiles?.find((p) => p.name === profile)?.id
  const pick = app.profiles.length > 1
  // The player decodes video with WebCodecs, which browsers only allow on https pages.
  if (!window.isSecureContext) {
    const port = info?.httpsPort
    const secure = port ? `https://${window.location.hostname}:${port}${window.location.pathname}${window.location.search}` : null
    return (
      <div className="space-y-2 rounded-xl border border-white/10 bg-ink-950/40 px-4 py-3">
        <p className="text-[13px] font-medium text-white">
          Play in the browser <span className="ml-1 rounded-md bg-amber-300/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200">Beta</span>
        </p>
        <p className="text-[12.5px] leading-relaxed text-ink-300">
          Browsers only play games streamed like this on a secure (https) page.{' '}
          {secure
            ? 'Open Finesse’s https address. The first time, your browser warns that it doesn’t know Finesse’s certificate: continue to the page, then sign in there.'
            : 'Whoever runs this server can turn on Finesse’s https address (FINESSE_HTTPS_PORT).'}
        </p>
        {secure && (
          <a href={secure} className="inline-flex h-9 items-center rounded-lg bg-white px-4 text-[13px] font-semibold text-ink-950 hover:bg-ink-200">
            Open the https address
          </a>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || (pick && !profileId)}
          onClick={() => {
            setBusy(true)
            setErr('')
            playApi
              .start(rom, profileId)
              .then((s) => navigate(`/games/stream/${s.id}`))
              .catch((e: Error) => setErr(e.message))
              .finally(() => setBusy(false))
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-50 active:scale-[0.98] transition-all"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
          {busy ? 'Starting…' : 'Play in the browser'}
        </button>
        <span className="rounded-md bg-amber-300/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-200">Beta</span>
        {pick && (
          <select className="rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-[13px] text-white" value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Whose saves">
            <option value="">Whose saves?</option>
            {app.profiles.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="text-[12px] leading-relaxed text-ink-400">Plays right here with a controller or keyboard. Moonlight has less delay, so use it on the TV.</p>
      {err && <p className="text-[12.5px] text-red-300">{err}</p>}
    </div>
  )
}

/** Game page: a console the browser can't play, played through Wolf and Moonlight instead. */
export default function MoonlightPlay({ rom, console: consoleName, app, launcher }: { rom: number; console: string; app: StreamEmulator; launcher: string | null }) {
  const { session } = useAuth()
  const { info } = useFinesse()
  const isAdmin = Boolean(session?.isAdmin)
  const one = app.profiles.length === 1 ? app.profiles[0]! : null
  return (
    <div className="max-w-xl space-y-4 rounded-2xl border border-white/10 bg-ink-900/60 px-5 py-4">
      {!__WEBOS__ && info?.features.play && <PlayInBrowser rom={rom} app={app} />}
      <div>
        <p className="text-[15px] font-semibold text-white">Play on Moonlight</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-300">
          {consoleName} games run on the server in <b className="font-semibold text-white">{app.title}</b>, and you play on your TV, phone or computer with Moonlight.
        </p>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink-300">
        <li>
          Open Moonlight (
          <a className={link} href="https://moonlight-stream.org" target="_blank" rel="noreferrer">
            moonlight-stream.org
          </a>
          ) and pick this server.{' '}
          {isAdmin ? (
            <>
              New device?{' '}
              <Link className={link} to="/settings#settings-streaming">
                Pair it
              </Link>
              .
            </>
          ) : (
            'New device? Ask whoever runs this server to pair it.'
          )}
        </li>
        {launcher ? (
          <>
            <li>
              Choose <b className="font-semibold text-white">{launcher}</b>.
            </li>
            <li>Pick {one ? <b className="font-semibold text-white">{one}</b> : `your profile${app.profiles.length ? ` (${app.profiles.join(', ')})` : ''}`}.</li>
            <li>
              Choose <b className="font-semibold text-white">{app.title}</b>, then the game.
            </li>
          </>
        ) : (
          <li>
            Choose <b className="font-semibold text-white">{app.title}</b>, then the game.
          </li>
        )}
      </ol>
      {app.play && <StartHere rom={rom} app={app} />}
    </div>
  )
}
