import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { playApi, streamingApi, type StreamEmulator } from '../api/setup'
import { useAuth } from '../auth/AuthContext'
import { useFinesse } from '../lib/finesseServer'
import { PLAY_BTN } from './ActionButton'

/** The emulator app (in Wolf) that plays a RomM console, if this server has one. Shares the Games page's list. */
export function useMoonlightApp(slug: string | undefined): { app: StreamEmulator | null; launcher: string | null; profiles: { id: string; name: string }[] } {
  const { info } = useFinesse()
  const on = Boolean(info?.features.streaming)
  const { data } = useQuery({ queryKey: ['streaming', 'apps'], queryFn: streamingApi.apps, staleTime: 60_000, retry: 1, enabled: on })
  const s = slug?.toLowerCase() ?? ''
  const app = (on && s && data?.emulators?.find((e) => e.consoles.includes(s))) || null
  const profiles = (data?.profiles ?? []).filter((p) => !app || app.profiles.includes(p.name)).map((p) => ({ id: p.id, name: p.name }))
  return { app, launcher: data?.apps.find((a) => a.launcher)?.title ?? null, profiles }
}

const link = 'text-accent-300 underline-offset-2 hover:underline'
const smallBtn =
  'inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-4 text-[13px] font-medium text-ink-100 hover:border-white/25 hover:text-white disabled:opacity-50 transition-colors'

/** Whose saves, when Wolf has more than one profile. */
export function ProfilePick({ profiles, value, onChange }: { profiles: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  if (profiles.length < 2) return null
  return (
    <select className="h-11 rounded-lg border border-white/10 bg-ink-900/80 px-3 text-[14px] text-white" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Whose saves">
      <option value="">Whose saves?</option>
      {profiles.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

export function PlayIcon() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

/** The page's main action for these consoles: play right here, streamed from the server. */
export function BrowserPlayButton({ rom, profile, needProfile, onError }: { rom: number; profile: string | undefined; needProfile: boolean; onError: (m: string) => void }) {
  const navigate = useNavigate()
  const { info } = useFinesse()
  const [busy, setBusy] = useState(false)
  // The player decodes video with WebCodecs, which browsers only allow on https pages.
  if (!window.isSecureContext) {
    const port = info?.httpsPort
    if (!port) return null
    return (
      <a href={`https://${window.location.hostname}:${port}${window.location.pathname}${window.location.search}`} className={PLAY_BTN} title="Browsers only play these games on a secure (https) page">
        <PlayIcon />
        Play (opens the https address)
      </a>
    )
  }
  return (
    <button
      type="button"
      className={PLAY_BTN}
      disabled={busy || (needProfile && !profile)}
      onClick={() => {
        setBusy(true)
        playApi
          .start(rom, profile)
          .then((s) => navigate(`/games/stream/${s.id}`))
          .catch((e: Error) => onError(e.message))
          .finally(() => setBusy(false))
      }}
    >
      <PlayIcon />
      {busy ? 'Starting…' : 'Play'}
    </button>
  )
}

/** How to reach the game in Moonlight: Moonlight → Wolf UI → profile → the app. */
export function MoonlightSteps({ app, launcher, consoleName }: { app: StreamEmulator; launcher: string | null; consoleName: string }) {
  const { session } = useAuth()
  const isAdmin = Boolean(session?.isAdmin)
  const one = app.profiles.length === 1 ? app.profiles[0]! : null
  return (
    <div className="space-y-2 text-[14px] leading-relaxed text-ink-300">
      <p>
        {consoleName} games run on the server in <b className="font-semibold text-white">{app.title}</b>. Moonlight plays them on your TV with the least delay.
      </p>
      <ol className="list-decimal space-y-1 pl-5">
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
        {launcher && (
          <li>
            Choose <b className="font-semibold text-white">{launcher}</b>, then {one ? <b className="font-semibold text-white">{one}</b> : `your profile${app.profiles.length ? ` (${app.profiles.join(', ')})` : ''}`}.
          </li>
        )}
        <li>
          Choose <b className="font-semibold text-white">{app.title}</b>, then the game.
        </li>
      </ol>
    </div>
  )
}

/** Start the game in a Moonlight session that's already open (Wolf starts the emulator with it). */
export function StartOnDevice({ rom, profile }: { rom: number; profile: string | undefined }) {
  const [state, setState] = useState<{ busy?: string; done?: string; err?: string }>({})
  const { data, isLoading, refetch } = useQuery({ queryKey: ['streaming', 'sessions'], queryFn: streamingApi.sessions, refetchInterval: 5000 })
  const sessions = data?.sessions ?? []
  return (
    <div className="space-y-3">
      <p className="text-[14px] leading-relaxed text-ink-300">Open Moonlight on the TV first (Wolf UI is fine), then pick it here. The game starts on that screen.</p>
      {isLoading ? (
        <p className="text-[13px] text-ink-400">Looking for open Moonlight sessions…</p>
      ) : !data?.ok ? (
        <p className="text-[13px] text-amber-200">{data?.error ?? 'Game streaming isn’t answering right now.'}</p>
      ) : sessions.length === 0 ? (
        <p className="text-[13px] text-ink-400">
          No Moonlight session is open.{' '}
          <button type="button" className={link} onClick={() => void refetch()}>
            Look again
          </button>
        </p>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[14px] text-white">
                {s.ip || 'A device'}
                {s.app && <span className="text-ink-400"> · in {s.app}</span>}
              </span>
              <button
                type="button"
                className={smallBtn}
                disabled={Boolean(state.busy)}
                onClick={() => {
                  setState({ busy: s.id })
                  streamingApi
                    .play(rom, s.id, profile)
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
      {state.done && <p className="text-[13px] text-emerald-300">{state.done}</p>}
      {state.err && <p className="text-[13px] text-red-300">{state.err}</p>}
    </div>
  )
}
