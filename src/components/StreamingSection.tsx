import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { streamingApi, type StreamApp, type StreamProfile } from '../api/setup'
import { useAuth } from '../auth/AuthContext'
import LaunchDialog from './LaunchDialog'
import { useToast } from './Toast'
import SteamGamesDialog from './SteamGamesDialog'

/** A steady colour per app, for apps without an icon. */
function tint(title: string): string {
  let h = 7
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `linear-gradient(150deg, hsl(${h} 45% 34%), hsl(${(h + 40) % 360} 50% 18%))`
}

function AppTile({ app, onOpen, cover, onHide }: { app: StreamApp; onOpen?: (app: StreamApp) => void; cover?: boolean; onHide?: (app: StreamApp) => void }) {
  const [broken, setBroken] = useState(false)
  // A Steam game shows its own cover; other apps their Wolf icon.
  const src = app.steam ? streamingApi.steamArtUrl(app.steam) : app.icon ? streamingApi.iconUrl(app.id) : null
  // Wolf UI is Moonlight's own menu: nothing to start from here.
  const Tag = onOpen && !app.launcher ? 'button' : 'div'
  // Steam games: tall covers (Steam's library art is 2:3). Apps and emulators: smaller squares.
  const size = cover ? 'h-48 w-32' : 'h-24 w-24'
  return (
    <div className={`group/tile relative shrink-0 ${cover ? 'w-32' : 'w-24'} ${app.hidden ? 'opacity-50' : ''}`}>
      <Tag
        {...(Tag === 'button' ? { type: 'button' as const, onClick: () => onOpen!(app), 'aria-label': `Play ${app.title}` } : {})}
        className={`block w-full text-left ${Tag === 'button' ? 'group rounded-xl focus-visible:outline-2 focus-visible:outline-accent-400' : ''}`}
      >
        <div className={`relative ${size} overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/5 transition group-hover:ring-white/30`} style={src && !broken ? undefined : { background: tint(app.title) }}>
          {src && !broken ? (
            <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center p-2 text-center text-2xl font-semibold text-white/90" aria-hidden>
              {cover ? app.title : app.title.slice(0, 1)}
            </span>
          )}
          {app.hdr && <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">HDR</span>}
        </div>
        <p className="mt-2 truncate text-sm font-medium text-ink-200 group-hover:text-white">{app.title}</p>
      </Tag>
      {onHide && (
        <button
          type="button"
          onClick={() => onHide(app)}
          className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white opacity-0 ring-1 ring-white/15 transition-opacity hover:bg-black/90 focus-visible:opacity-100 group-hover/tile:opacity-100"
          aria-label={app.hidden ? `Show ${app.title} again` : `Hide ${app.title}`}
        >
          {app.hidden ? 'Show' : 'Hide'}
        </button>
      )}
    </div>
  )
}

function Row({ apps, onOpen, cover, onHide }: { apps: StreamApp[]; onOpen: (app: StreamApp) => void; cover?: boolean; onHide?: (app: StreamApp) => void }) {
  return (
    <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
      {apps.map((a) => (
        <AppTile key={a.id} app={a} onOpen={onOpen} cover={cover} onHide={onHide} />
      ))}
    </div>
  )
}

/** Recently played first (Steam's record), then by name. */
const byPlayed = (a: StreamApp, b: StreamApp) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.title.localeCompare(b.title)

/** One set of apps (a profile's, or Moonlight's own list), in rows: Steam games, emulators, other apps. */
function Library({ apps, onOpen, onHide, showHidden }: { apps: StreamApp[]; onOpen: (app: StreamApp) => void; onHide?: (app: StreamApp) => void; showHidden: boolean }) {
  const [q, setQ] = useState('')
  const shown = apps.filter((a) => showHidden || !a.hidden)
  const kind = (a: StreamApp) => a.kind ?? (a.steam ? 'steam' : 'app')
  const steam = shown.filter((a) => kind(a) === 'steam').sort(byPlayed)
  const found = q.trim() ? steam.filter((a) => a.title.toLowerCase().includes(q.trim().toLowerCase())) : steam
  const emulators = shown.filter((a) => kind(a) === 'emulator')
  const other = shown.filter((a) => kind(a) === 'app')
  const label = 'mb-2 text-[13px] font-semibold text-ink-300'
  return (
    <div className="space-y-5">
      {steam.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink-300">Steam games</p>
            {steam.length > 8 && (
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Find one of ${steam.length} games`}
                aria-label="Find a Steam game"
                className="h-8 w-56 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[13px] text-white placeholder:text-ink-500 focus:border-accent-400 focus:outline-none"
              />
            )}
          </div>
          {found.length ? <Row apps={found} onOpen={onOpen} onHide={onHide} cover /> : <p className="text-[13px] text-ink-400">No game called that.</p>}
        </div>
      )}
      {emulators.length > 0 && (
        <div>
          <p className={label}>Emulators</p>
          <Row apps={emulators} onOpen={onOpen} onHide={onHide} />
        </div>
      )}
      {other.length > 0 && (
        <div>
          <p className={label}>Apps</p>
          <Row apps={other} onOpen={onOpen} onHide={onHide} />
        </div>
      )}
    </div>
  )
}

/** Games: what Wolf streams from this server to Moonlight, and how to start. */
export default function StreamingSection() {
  const { session } = useAuth()
  const isAdmin = Boolean(session?.isAdmin)
  const { data, isLoading, isError } = useQuery({ queryKey: ['streaming', 'apps'], queryFn: streamingApi.apps, staleTime: 60_000, retry: 1 })
  const link = 'text-accent-300 underline-offset-2 hover:underline'
  // With Wolf UI, Moonlight lists just the launcher; the games are in its profiles.
  const launcher = data?.apps.find((a) => a.launcher)
  const profiles: StreamProfile[] = launcher ? (data?.profiles ?? []) : []
  const direct = (data?.apps ?? []).filter((a) => !(a.launcher && profiles.length))
  const one = profiles.length === 1 ? profiles[0]! : null
  const [steamOpen, setSteamOpen] = useState(false)
  const [launch, setLaunch] = useState<StreamApp | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const qc = useQueryClient()
  const toast = useToast()
  const allApps = [...profiles.flatMap((p) => p.apps), ...direct]
  const hiddenCount = new Set(allApps.filter((a) => a.hidden).map((a) => a.title.toLowerCase())).size
  // Administrators tidy the page: hidden here, still in Moonlight.
  const onHide = isAdmin
    ? (app: StreamApp) =>
        void streamingApi
          .setHidden(app.title, !app.hidden)
          .then(() => qc.invalidateQueries({ queryKey: ['streaming', 'apps'] }))
          .then(() => toast(app.hidden ? `${app.title} is back` : `${app.title} hidden. It’s still in Moonlight.`))
          .catch((e: Error) => toast(e.message, 'error'))
    : undefined
  const pill = 'inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.06] px-4 text-[13px] font-medium text-ink-100 hover:border-white/25 hover:text-white transition-colors'

  return (
    <section className="mb-9" aria-labelledby="streaming-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="streaming-title" className="row-title text-white">
            Stream from your server
          </h2>
          <p className="text-[13px] text-ink-400">Steam and more run here on the server, and you play on your TV, phone or computer with Moonlight.</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            {data?.ok && data.steam && (
              <button type="button" onClick={() => setSteamOpen(true)} className={pill}>
                Steam games
              </button>
            )}
            <Link to="/settings#settings-streaming" className={pill}>
              Pair a device
            </Link>
          </div>
        )}
        {steamOpen && <SteamGamesDialog onClose={() => setSteamOpen(false)} />}
        {launch && <LaunchDialog app={launch} onClose={() => setLaunch(null)} />}
      </div>

      {isLoading ? (
        <div className="flex gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 w-28 shrink-0 rounded-xl shimmer" />
          ))}
        </div>
      ) : isError || !data?.ok ? (
        <p className="rounded-xl border border-white/5 bg-ink-900/50 px-4 py-3 text-sm text-ink-300">{data?.error ?? 'Game streaming isn’t answering right now. Try again in a minute.'}</p>
      ) : direct.length === 0 && profiles.length === 0 ? (
        <p className="text-sm text-ink-400">Wolf has no apps to stream yet.</p>
      ) : (
        <div className="space-y-5">
          {profiles.map((p) => (
            <div key={p.id}>
              {profiles.length > 1 && <p className="mb-3 text-[15px] font-semibold text-white">{p.name}</p>}
              <Library apps={p.apps} onOpen={setLaunch} onHide={onHide} showHidden={showHidden} />
            </div>
          ))}
          {direct.length > 0 && (
            <div>
              {profiles.length > 0 && <p className="mb-3 text-[15px] font-semibold text-white">Straight from Moonlight</p>}
              <Library apps={direct} onOpen={setLaunch} onHide={onHide} showHidden={showHidden} />
            </div>
          )}
          {isAdmin && hiddenCount > 0 && (
            <button type="button" onClick={() => setShowHidden((v) => !v)} className="text-[13px] text-ink-400 underline-offset-2 hover:text-white hover:underline">
              {showHidden ? 'Done' : `Show ${hiddenCount} hidden`}
            </button>
          )}
        </div>
      )}

      <details className="group mt-4 max-w-2xl rounded-2xl border border-white/10 bg-ink-900/60 px-5 py-3 text-[14px] leading-relaxed text-ink-300">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-white [&::-webkit-details-marker]:hidden">
          How to play with Moonlight
          <svg className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Get Moonlight for your device from{' '}
            <a className={link} href="https://moonlight-stream.org" target="_blank" rel="noreferrer">
              moonlight-stream.org
            </a>{' '}
            (phones, tablets, computers, Apple TV and more). On an LG TV, use the community{' '}
            <a className={link} href="https://github.com/mariotaku/moonlight-tv" target="_blank" rel="noreferrer">
              Moonlight TV
            </a>{' '}
            app.
          </li>
          <li>Open Moonlight and pick this server. At home it usually finds it by itself.</li>
          <li>Moonlight shows a PIN. {isAdmin ? 'Enter it under Settings → Server → Game streaming.' : 'Ask whoever runs this server to enter it in Finesse.'}</li>
          {profiles.length > 0 ? (
            <li>
              In Moonlight choose <b className="font-semibold text-white">{launcher!.title}</b>, then {one ? <b className="font-semibold text-white">{one.name}</b> : 'your profile'}, then the app you want.
            </li>
          ) : (
            <li>Choose a game in Moonlight and play.</li>
          )}
        </ol>
      </details>
    </section>
  )
}
