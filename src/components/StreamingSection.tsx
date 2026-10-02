import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { streamingApi, type StreamApp } from '../api/setup'
import { useAuth } from '../auth/AuthContext'

/** A steady colour per app, for apps without an icon. */
function tint(title: string): string {
  let h = 7
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `linear-gradient(150deg, hsl(${h} 45% 34%), hsl(${(h + 40) % 360} 50% 18%))`
}

function AppTile({ app }: { app: StreamApp }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className="w-28 shrink-0">
      <div className="relative h-28 w-28 overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/5" style={app.icon && !broken ? undefined : { background: tint(app.title) }}>
        {app.icon && !broken ? (
          <img src={streamingApi.iconUrl(app.id)} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-3xl font-semibold text-white/90" aria-hidden>
            {app.title.slice(0, 1)}
          </span>
        )}
        {app.hdr && <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">HDR</span>}
      </div>
      <p className="mt-2 truncate text-sm font-medium text-ink-200">{app.title}</p>
    </div>
  )
}

/** Games: what Wolf streams from this server to Moonlight, and how to start. */
export default function StreamingSection() {
  const { session } = useAuth()
  const isAdmin = Boolean(session?.isAdmin)
  const { data, isLoading, isError } = useQuery({ queryKey: ['streaming', 'apps'], queryFn: streamingApi.apps, staleTime: 60_000, retry: 1 })
  const link = 'text-accent-300 underline-offset-2 hover:underline'

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
          <Link
            to="/settings#settings-streaming"
            className="inline-flex h-9 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[13px] font-medium text-ink-200 hover:border-white/25 hover:text-white transition-colors"
          >
            Pair a device
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="flex gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 w-28 shrink-0 rounded-xl shimmer" />
          ))}
        </div>
      ) : isError || !data?.ok ? (
        <p className="rounded-xl border border-white/5 bg-ink-900/50 px-4 py-3 text-sm text-ink-300">{data?.error ?? 'Game streaming isn’t answering right now. Try again in a minute.'}</p>
      ) : data.apps.length === 0 ? (
        <p className="text-sm text-ink-400">Wolf has no apps to stream yet.</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
          {data.apps.map((a) => (
            <AppTile key={a.id} app={a} />
          ))}
        </div>
      )}

      <div className="mt-4 max-w-2xl rounded-xl border border-white/5 bg-ink-900/50 px-4 py-3 text-[13px] leading-relaxed text-ink-300">
        <p className="font-semibold text-white">How to play</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
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
          <li>Choose a game in Moonlight and play.</li>
        </ol>
      </div>
    </section>
  )
}
