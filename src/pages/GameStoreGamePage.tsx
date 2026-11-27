// A game in the store: hero + cover, sources, 1-click Request / Pause / Resume / Choose executable,
// clickable fullscreen screenshot lightbox (with TV Back support), facts, and similar games.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMyLimits } from '../api/parental'
import {
  browseHref,
  formatSize,
  genreSlug,
  INSTALLER_NOTE,
  MODE_LABEL,
  needsProgramPick,
  PLATFORM_LABEL,
  type GameRequest,
  type StoreMode,
  type StoreSource,
} from '../api/gameStore'
import { useGameRequest, useGameRequestActions, useGameRequests, useStoreGame, useStoreMode } from '../api/gameStoreQueries'
import { PLAY_BTN, START_OVER_BTN } from '../components/ActionButton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { ChooseProgramLink, GameRequestStatusView, installerHref, RequestStageBar } from '../components/gamestore/GameRequestStatus'
import GameTransferModal from '../components/gamestore/GameTransferModal'
import PlayChoice from '../components/gamestore/PlayChoice'
import { StoreCover, StoreShelf, storeGradient } from '../components/gamestore/StoreCards'
import { StoreUnavailable } from '../components/gamestore/StoreHeader'
import { goBack, pushBackHandler } from '../lib/back'
import { IS_TV } from '../lib/device'

export default function GameStoreGamePage() {
  const { gameId } = useParams()
  const mode = useStoreMode()
  const navigate = useNavigate()
  const { data, isError, refetch } = useStoreGame(gameId)
  const request = useGameRequest(gameId)
  const { data: allRequests } = useGameRequests()
  const byGame = useMemo(() => new Map((allRequests ?? []).map((r) => [r.gameId, r])), [allRequests])
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  if (!mode) return <StoreUnavailable />
  if (!data) {
    return (
      <div className="px-4 py-10 sm:px-6 lg:px-12">
        <div className="flex items-center gap-3">
          <BackButton onClick={() => goBack(navigate)} />
          <Link to="/games/store" className="text-sm font-medium text-ink-300 hover:text-white">
            Game store
          </Link>
        </div>
        {isError ? (
          <div className="mt-16">
            <p className="text-lg font-semibold text-white">Couldn’t load this game</p>
            <p className="mt-1 text-sm text-ink-400">It may have left the store, or the store is busy.</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
            >
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
  }

  const { game: g, sources, similar } = data
  const meta = [g.year ? String(g.year) : null, g.developer].filter(Boolean) as string[]
  const paragraphs = (g.description ?? g.summary).split(/\n{2,}/).filter(Boolean)
  const screenshots = g.screenshots ?? []
  const hasFacts = Boolean(g.developer || g.year || g.license || g.modes.length > 0 || g.website)

  return (
    <div className="pb-16">
      <div className="relative -mt-16">
        {!IS_TV && (
          <div className="absolute left-3 top-[4.75rem] z-20 flex items-center gap-2.5 sm:left-6 sm:top-[5.25rem] lg:left-12 supports-[top:max(0px,env(safe-area-inset-top))]:top-[calc(4.75rem+env(safe-area-inset-top))] supports-[top:max(0px,env(safe-area-inset-top))]:left-[max(0.75rem,env(safe-area-inset-left))] sm:supports-[top:max(0px,env(safe-area-inset-top))]:top-[calc(5.25rem+env(safe-area-inset-top))] sm:supports-[top:max(0px,env(safe-area-inset-top))]:left-[max(1.5rem,env(safe-area-inset-left))] lg:supports-[top:max(0px,env(safe-area-inset-top))]:left-[max(3rem,env(safe-area-inset-left))]">
            <BackButton onClick={() => goBack(navigate)} />
            <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 rounded-full bg-black/45 px-3.5 py-1.5 text-xs font-medium text-ink-200 ring-1 ring-white/10 backdrop-blur-md sm:inline-flex">
              <Link to="/games/store" className="transition-colors hover:text-white">
                Game store
              </Link>
              {g.genres[0] && (
                <>
                  <span className="text-ink-500" aria-hidden>/</span>
                  <Link to={browseHref({ genres: [genreSlug(g.genres[0])] })} className="transition-colors hover:text-white">
                    {g.genres[0]}
                  </Link>
                </>
              )}
            </nav>
          </div>
        )}
        <div
          className="hero-melt relative h-[calc(var(--vh)*40)] min-h-[300px] w-full overflow-hidden"
          style={g.hero ? undefined : { backgroundImage: storeGradient(g.id, 160) }}
        >
          {g.hero && <img decoding="async" src={g.hero} alt="" className="fade-in h-full w-full object-cover" />}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/35 to-ink-950/25" />
        </div>

        <div className="relative z-10 -mt-36 flex items-end gap-5 px-4 sm:gap-8 sm:px-6 lg:px-12">
          {/* Show poster cover on mobile too when there is no hero art */}
          <div
            className={`${g.hero ? 'hidden md:block' : 'block w-28 sm:w-36'} aspect-[3/4] shrink-0 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/15 md:w-52`}
            style={{ viewTransitionName: 'vt-poster' }}
          >
            <StoreCover game={g} big />
          </div>
          <div className="min-w-0 pb-2">
            {IS_TV && (
              <Link to="/games/store" className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-ink-300 hover:text-white">
                ← Game store
              </Link>
            )}
            <h1 className="font-display mb-3 text-4xl leading-[0.95] text-white drop-shadow-lg sm:text-5xl lg:text-6xl">{g.title}</h1>
            <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-200">
              {meta.map((x) => (
                <span key={x}>{x}</span>
              ))}
              {g.genres.map((x) => (
                <Link key={x} to={browseHref({ genres: [genreSlug(x)] })} className="text-ink-300 underline-offset-4 hover:text-white hover:underline">
                  {x}
                </Link>
              ))}
            </div>
            <p className="text-sm text-ink-400">
              {[...g.modes.map((m) => MODE_LABEL[m]), ...g.platforms.map((p) => PLATFORM_LABEL[p])].join(' · ')}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-12">
        <div className={`mt-6 grid gap-10 ${hasFacts ? 'lg:grid-cols-[1fr_22rem]' : ''}`}>
          <div className="min-w-0">
            <RequestArea gameId={g.id} title={g.title} sources={sources} request={request} mode={mode} />

            {paragraphs.length > 0 && (
              <div className="mt-8 max-w-2xl space-y-3 text-[15px] leading-relaxed text-ink-200">
                {paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            )}

            {screenshots.length > 0 && (
              <div className="mt-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">Screenshots</h2>
                <div className="-mx-2 flex gap-3 overflow-x-auto no-scrollbar px-2 pb-2">
                  {screenshots.map((s, idx) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setLightboxIdx(idx)}
                      aria-label={`View screenshot ${idx + 1} of ${screenshots.length}`}
                      className="group relative aspect-video w-72 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 outline-none transition hover:ring-accent-400/70 focus-visible:ring-2 focus-visible:ring-accent-400 sm:w-80"
                    >
                      <img decoding="async" src={s} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                      <span
                        aria-hidden
                        className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25"
                      >
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                          </svg>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {hasFacts && (
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
          )}
        </div>

        {similar.length > 0 && (
          <div className="mt-12">
            <StoreShelf title="More like this" href={browseHref({ genres: g.genres.map(genreSlug) })} games={similar} requests={byGame} />
          </div>
        )}
      </div>

      {lightboxIdx !== null && screenshots.length > 0 && (
        <ScreenshotLightbox
          images={screenshots}
          index={lightboxIdx}
          title={g.title}
          onChange={setLightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  )
}

/** Fullscreen screenshot lightbox with arrow-key navigation, click-outside close, and TV Back support. */
function ScreenshotLightbox({
  images,
  index,
  title,
  onChange,
  onClose,
}: {
  images: string[]
  index: number
  title: string
  onChange: (i: number) => void
  onClose: () => void
}) {
  useEffect(
    () =>
      pushBackHandler(() => {
        onClose()
        return true
      }),
    [onClose],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onChange((index - 1 + images.length) % images.length)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onChange((index + 1) % images.length)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, images.length, onChange, onClose])

  const src = images[index % images.length]

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} screenshots`}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div className="relative flex max-h-full max-w-6xl flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <img
          src={src}
          alt={`${title} screenshot ${index + 1} of ${images.length}`}
          className="max-h-[82vh] max-w-full rounded-xl object-contain shadow-2xl ring-1 ring-white/15"
        />
        <div className="mt-4 flex items-center gap-4">
          {images.length > 1 && (
            <button
              type="button"
              onClick={() => onChange((index - 1 + images.length) % images.length)}
              aria-label="Previous screenshot"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
          )}
          <span className="font-mono text-xs font-medium text-ink-300">
            {index + 1} / {images.length}
          </span>
          {images.length > 1 && (
            <button
              type="button"
              onClick={() => onChange((index + 1) % images.length)}
              aria-label="Next screenshot"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close screenshots"
        className="fixed right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/15 transition hover:bg-white/20 sm:right-6 sm:top-6"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>,
    document.body,
  )
}

/** Pick a download, Request; then the request's status and full actions (including Choose executable + Pause/Resume). */
function RequestArea({
  gameId,
  title,
  sources,
  request,
  mode,
}: {
  gameId: string
  title: string
  sources: StoreSource[]
  request: GameRequest | undefined
  mode: StoreMode
}) {
  const limits = useMyLimits()
  const actions = useGameRequestActions()
  const toast = useToast()
  const [sourceId, setSourceId] = useState(sources[0]?.id)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [transfer, setTransfer] = useState(false)
  const [play, setPlay] = useState(false)
  const source = sources.find((s) => s.id === sourceId) ?? sources[0]

  if (limits && !limits.requests) {
    return <p className="text-sm text-ink-300">Requests are off for this profile. Ask whoever runs the server if you’d like this game.</p>
  }

  if (request) {
    const r = request
    const picking = needsProgramPick(r)
    const canTransfer = r.state === 'ready' || r.state === 'needs-you' || (r.state === 'failed' && (r.progress ?? 0) >= 100)
    const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'That didn’t work', 'error')

    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
          <div className="flex flex-wrap items-center gap-2.5">
            {picking ? (
              <ChooseProgramLink request={r} className={PLAY_BTN} />
            ) : r.state === 'needs-you' ? (
              <Link to={installerHref(r)} className={PLAY_BTN}>
                Finish installing
              </Link>
            ) : r.state === 'ready' ? (
              <button type="button" className={PLAY_BTN} onClick={() => setPlay(true)}>
                <PlayIcon /> Play
              </button>
            ) : r.state === 'failed' ? (
              <button
                type="button"
                className={PLAY_BTN}
                disabled={actions.retry.isPending}
                onClick={() => actions.retry.mutate(r.id, { onError: fail })}
              >
                {actions.retry.isPending ? 'Trying again…' : 'Try again'}
              </button>
            ) : actions.canPause && r.state === 'paused' ? (
              <button
                type="button"
                className={PLAY_BTN}
                disabled={actions.resume.isPending}
                onClick={() => actions.resume.mutate(r.id, { onError: fail })}
              >
                {actions.resume.isPending ? 'Resuming…' : 'Carry on'}
              </button>
            ) : null}

            {r.state === 'failed' && picking && (
              <button
                type="button"
                className={START_OVER_BTN}
                disabled={actions.retry.isPending}
                onClick={() => actions.retry.mutate(r.id, { onError: fail })}
              >
                {actions.retry.isPending ? 'Trying again…' : 'Try again'}
              </button>
            )}
          </div>

          <GameRequestStatusView request={r} size="lg" className="flex-1 sm:pt-0.5" />

          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {actions.canPause && r.state === 'downloading' && (
              <button
                type="button"
                className={START_OVER_BTN}
                disabled={actions.pause.isPending}
                onClick={() => actions.pause.mutate(r.id, { onError: fail })}
              >
                {actions.pause.isPending ? 'Pausing…' : 'Pause'}
              </button>
            )}
            {canTransfer && (
              <button type="button" className={START_OVER_BTN} onClick={() => setTransfer(true)}>
                Transfer to PC / Deck
              </button>
            )}
            <button type="button" className={START_OVER_BTN} onClick={() => setConfirmCancel(true)}>
              {r.state === 'ready' ? 'Uninstall' : r.state === 'failed' ? 'Remove' : 'Cancel'}
            </button>
          </div>
        </div>

        <RequestStageBar request={r} className="mt-4 border-t border-white/[0.08] pt-3.5" />

        {play && <PlayChoice request={r} onClose={() => setPlay(false)} />}
        {transfer && <GameTransferModal requestId={r.id} title={title} onClose={() => setTransfer(false)} />}
        {confirmCancel && (
          <ConfirmDialog
            title={r.state === 'ready' ? `Uninstall “${title}”?` : r.state === 'failed' ? `Remove “${title}”?` : `Cancel “${title}”?`}
            confirmLabel={r.state === 'ready' ? 'Uninstall' : r.state === 'failed' ? 'Remove' : 'Cancel the request'}
            cancelLabel="Keep it"
            busy={actions.cancel.isPending}
            onCancel={() => setConfirmCancel(false)}
            onConfirm={() =>
              actions.cancel.mutate(r.id, {
                onSuccess: () => toast(r.state === 'ready' ? `Uninstalled “${title}”` : `Cancelled “${title}”`),
                onError: (e) => toast(e instanceof Error ? e.message : 'Couldn’t remove it', 'error'),
                onSettled: () => setConfirmCancel(false),
              })
            }
          >
            {r.state === 'ready'
              ? 'The installed game files and its download are deleted from the server to free space. You can request it again later.'
              : 'The download stops and what was downloaded is deleted. You can request it again later.'}
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
                onSuccess: () =>
                  toast(
                    mode === 'demo'
                      ? `Requested “${title}” (demo mode — simulated download).`
                      : `Requested “${title}”. It will download and install automatically.`,
                  ),
                onError: (e) => toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t request “${title}”`, 'error'),
              },
            )
          }
        >
          <DownloadIcon /> {actions.request.isPending ? 'Requesting…' : 'Request'}
        </button>
        <p className="text-sm text-ink-400">
          {sources.length > 1
            ? formatSize(source.sizeBytes)
            : [PLATFORM_LABEL[source.platform], formatSize(source.sizeBytes), INSTALLER_NOTE[source.installer]].filter(Boolean).join(' · ')}
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
