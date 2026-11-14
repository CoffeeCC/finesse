// A game in the store: what it is, which download to get, Request, and where the request stands
// (downloading, installing, needs you, ready, or what went wrong and what to do).

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMyLimits } from '../api/parental'
import { browseHref, formatSize, genreSlug, INSTALLER_NOTE, MODE_LABEL, PLATFORM_LABEL, type GameRequest, type StoreSource } from '../api/gameStore'
import { useGameRequest, useGameRequestActions, useStoreGame, useStoreMode } from '../api/gameStoreQueries'
import { PLAY_BTN, START_OVER_BTN } from '../components/ActionButton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { GameRequestStatusView } from '../components/gamestore/GameRequestStatus'
import { StoreCover, StoreShelf, storeGradient } from '../components/gamestore/StoreCards'
import { goBack } from '../lib/back'
import { IS_TV } from '../lib/device'

export default function GameStoreGamePage() {
  const { gameId } = useParams()
  const mode = useStoreMode()
  const navigate = useNavigate()
  const { data, isError, refetch } = useStoreGame(gameId)
  const request = useGameRequest(gameId)

  if (!mode) return null
  if (!data)
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-12">
        <BackButton onClick={() => goBack(navigate)} />
        {isError ? (
          <div className="mt-16">
            <p className="text-lg font-semibold text-white">Couldn’t load this game</p>
            <p className="mt-1 text-sm text-ink-400">It may have left the store, or the store is busy.</p>
            <button type="button" onClick={() => refetch()} className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200">
              Try again
            </button>
          </div>
        ) : (
          <div className="mt-10 flex gap-8">
            <div className="hidden aspect-[3/4] w-52 rounded-xl shimmer md:block" />
            <div className="flex-1 space-y-3 pt-24">
              <div className="h-12 w-2/3 rounded shimmer" />
              <div className="h-4 w-1/3 rounded shimmer" />
            </div>
          </div>
        )}
      </div>
    )

  const { game: g, sources, similar } = data
  const meta = [g.year ? String(g.year) : null, g.developer].filter(Boolean) as string[]
  const paragraphs = (g.description ?? g.summary).split(/\n{2,}/)

  return (
    <div className="pb-16">
      <div className="relative -mt-16">
        {!IS_TV && (
          <div className="absolute left-3 top-[4.75rem] z-20 sm:left-6 sm:top-[5.25rem] lg:left-12">
            <BackButton onClick={() => goBack(navigate)} />
          </div>
        )}
        <div className="hero-melt relative h-[calc(var(--vh)*40)] min-h-[300px] w-full overflow-hidden" style={g.hero ? undefined : { backgroundImage: storeGradient(g.id, 160) }}>
          {g.hero && <img src={g.hero} alt="" className="fade-in h-full w-full object-cover" />}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-ink-950/20" />
        </div>

        <div className="relative z-10 -mt-36 flex items-end gap-8 px-4 sm:px-6 lg:px-12">
          <div className="hidden aspect-[3/4] w-52 shrink-0 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 md:block" style={{ viewTransitionName: 'vt-poster' }}>
            <StoreCover game={g} big />
          </div>
          <div className="min-w-0 pb-2">
            <h1 className="font-display mb-3 text-5xl leading-[0.95] text-white drop-shadow-lg sm:text-6xl">{g.title}</h1>
            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-200">
              {meta.map((x) => (
                <span key={x}>{x}</span>
              ))}
              {g.genres.map((x) => (
                <Link key={x} to={browseHref({ genres: [genreSlug(x)] })} className="text-ink-300 underline-offset-4 hover:text-white hover:underline">
                  {x}
                </Link>
              ))}
            </div>
            <p className="text-sm text-ink-400">{[...g.modes.map((m) => MODE_LABEL[m]), ...g.platforms.map((p) => PLATFORM_LABEL[p])].join(' · ')}</p>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-12">
        <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0">
            <RequestArea gameId={g.id} title={g.title} sources={sources} request={request} />
            <div className="mt-8 max-w-2xl space-y-3 text-[15px] leading-relaxed text-ink-200">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {g.screenshots && g.screenshots.length > 0 && (
              <div className="-mx-2 mt-8 flex gap-3 overflow-x-auto no-scrollbar px-2 pb-2">
                {g.screenshots.map((s) => (
                  <img key={s} src={s} alt="" loading="lazy" className="aspect-video w-80 shrink-0 rounded-xl object-cover ring-1 ring-white/10" />
                ))}
              </div>
            )}
          </div>

          <dl className="h-fit space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm">
            <Fact label="Developer" value={g.developer} />
            <Fact label="Released" value={g.year ? String(g.year) : undefined} />
            <Fact label="License" value={g.license} />
            <Fact label="Players" value={g.modes.map((m) => MODE_LABEL[m]).join(', ')} />
            {g.website && (
              <div>
                <dt className="text-xs text-ink-400">Website</dt>
                <dd>
                  <a href={g.website} target="_blank" rel="noreferrer" className="break-all text-accent-300 hover:text-accent-200">
                    {g.website.replace(/^https?:\/\//, '')}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </div>

        {similar.length > 0 && (
          <div className="mt-12">
            <StoreShelf title="More like this" href={browseHref({ genres: g.genres.map(genreSlug) })} games={similar} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Pick a download, Request; then the request's status and what you can do about it. */
function RequestArea({ gameId, title, sources, request }: { gameId: string; title: string; sources: StoreSource[]; request: GameRequest | undefined }) {
  const limits = useMyLimits()
  const actions = useGameRequestActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [sourceId, setSourceId] = useState(sources[0]?.id)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const source = sources.find((s) => s.id === sourceId) ?? sources[0]

  if (limits && !limits.requests) return <p className="text-sm text-ink-300">Requests are off for this profile. Ask whoever runs the server if you’d like this game.</p>

  if (request) {
    const r = request
    return (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        {r.state === 'needs-you' ? (
          <Link to={`/games/store/requests/${encodeURIComponent(r.id)}/installer`} className={PLAY_BTN}>
            Finish installing
          </Link>
        ) : r.state === 'ready' ? (
          <button type="button" className={PLAY_BTN} onClick={() => navigate('/games')}>
            <PlayIcon /> Play
          </button>
        ) : r.state === 'failed' ? (
          <button
            type="button"
            className={PLAY_BTN}
            disabled={actions.retry.isPending}
            onClick={() => actions.retry.mutate(r.id, { onError: (e) => toast(e instanceof Error ? e.message : 'Couldn’t try again', 'error') })}
          >
            {actions.retry.isPending ? 'Trying again…' : 'Try again'}
          </button>
        ) : null}
        <GameRequestStatusView request={r} size="lg" className="sm:pt-1" />
        {r.state !== 'ready' && (
          <button type="button" className={`${START_OVER_BTN} sm:ml-auto`} onClick={() => setConfirmCancel(true)}>
            {r.state === 'failed' ? 'Remove' : 'Cancel'}
          </button>
        )}
        {confirmCancel && (
          <ConfirmDialog
            title={r.state === 'failed' ? `Remove “${title}”?` : `Cancel “${title}”?`}
            confirmLabel={r.state === 'failed' ? 'Remove' : 'Cancel the request'}
            cancelLabel="Keep it"
            busy={actions.cancel.isPending}
            onCancel={() => setConfirmCancel(false)}
            onConfirm={() =>
              actions.cancel.mutate(r.id, {
                onSuccess: () => toast(`Cancelled “${title}”`),
                onError: (e) => toast(e instanceof Error ? e.message : 'Couldn’t cancel it', 'error'),
                onSettled: () => setConfirmCancel(false),
              })
            }
          >
            The download stops and what was downloaded is deleted. You can request it again later.
          </ConfirmDialog>
        )}
      </div>
    )
  }

  if (!source) return <p className="text-sm text-ink-300">There’s no download for this game right now.</p>

  return (
    <div>
      {sources.length > 1 && (
        <div className="mb-4 grid max-w-2xl gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Which download">
          {sources.map((s) => {
            const on = s.id === source.id
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSourceId(s.id)}
                className={`rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
                  on ? 'border-accent-400/60 bg-accent-500/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                }`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold text-white">
                  {PLATFORM_LABEL[s.platform]}
                  <span className="text-xs font-medium text-ink-400">{[s.version, formatSize(s.sizeBytes)].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="mt-1 block text-xs leading-snug text-ink-300">{INSTALLER_NOTE[s.installer]}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <button
          type="button"
          className={PLAY_BTN}
          disabled={actions.request.isPending}
          onClick={() =>
            actions.request.mutate(
              { gameId, sourceId: source.id },
              {
                onSuccess: () => toast(`Requested “${title}”. It downloads over the VPN, then installs.`),
                onError: (e) => toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t request “${title}”`, 'error'),
              },
            )
          }
        >
          <DownloadIcon /> {actions.request.isPending ? 'Requesting…' : 'Request'}
        </button>
        <p className="text-sm text-ink-400">
          {sources.length > 1 ? formatSize(source.sizeBytes) : [PLATFORM_LABEL[source.platform], formatSize(source.sizeBytes), INSTALLER_NOTE[source.installer]].filter(Boolean).join(' · ')}
          {source.verified ? ' · Checked against the store’s checksum' : ''}
        </p>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="text-ink-100">{value}</dd>
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      title="Back"
      className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/10 backdrop-blur-md transition-transform active:scale-95"
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
      </svg>
    </button>
  )
}

function PlayIcon() {
  return (
    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13.5m0 0 4.5-4.5M12 16.5 7.5 12M3.75 18.75A2.25 2.25 0 0 0 6 21h12a2.25 2.25 0 0 0 2.25-2.25" />
    </svg>
  )
}
