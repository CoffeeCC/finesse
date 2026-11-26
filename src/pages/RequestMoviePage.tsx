// A movie that isn't in the library (yet): what it is, its trailer, and Request. Opened from a
// Discover poster or a search result on the Request page. Once it's downloaded, Play opens it in
// the library.

import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  arrAdd,
  arrCancelRequest,
  arrMovieDetails,
  arrSearchAgain,
  ArrError,
  toMovieDetails,
  type MovieDetails,
} from '../api/arr'
import { useMyLimits } from '../api/parental'
import { noteRequested, useLibraryMatch } from '../api/queries'
import { CONFIRM_AGAIN, RequestStatusView, useConfirmPress, useLater, useRequestStatus } from '../components/RequestStatus'
import { ACTION_BTN, ACTION_CIRCLE, PLAY_BTN, START_OVER_BTN } from '../components/ActionButton'
import QualityModal from '../components/QualityModal'
import WhyNothingModal from '../components/WhyNothingModal'
import TrailerHero from '../components/TrailerHero'
import { useToast } from '../components/Toast'
import { goBack } from '../lib/back'
import { IS_TV } from '../lib/device'

/** The Request page passes the movie it already has, so this page shows at once. */
export interface RequestMovieState {
  raw?: Record<string, unknown>
}

function titleHue(title: string): number {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360
  return h
}

export default function RequestMoviePage() {
  const { tmdbId: param } = useParams()
  const tmdbId = Number(param)
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const later = useLater()
  const limits = useMyLimits()
  const canRequest = !limits || limits.requests
  const passed = (useLocation().state as RequestMovieState | null)?.raw
  const valid = Number.isFinite(tmdbId) && tmdbId > 0
  const [requested, setRequested] = useState<'idle' | 'adding' | 'requested'>('idle')
  const [cancelled, setCancelled] = useState(false)
  const [trailerOn, setTrailerOn] = useState(false)
  const [trailerLive, setTrailerLive] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [whyOpen, setWhyOpen] = useState(false)
  const [reqActionBusy, setReqActionBusy] = useState<'again' | 'cancel' | null>(null)
  const confirmCancel = useConfirmPress()

  // Another movie opened over this one (the route stays mounted): start it afresh, not as
  // "requested" or with the last one's trailer playing.
  const [shownId, setShownId] = useState(tmdbId)
  if (shownId !== tmdbId) {
    setShownId(tmdbId)
    setRequested('idle')
    setCancelled(false)
    setTrailerOn(false)
    setTrailerLive(false)
    setQualityOpen(false)
    setWhyOpen(false)
    setReqActionBusy(null)
  }

  const details = useQuery({
    queryKey: ['arrMovieDetails', tmdbId],
    enabled: valid,
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: () => arrMovieDetails(tmdbId),
    placeholderData: passed && Number(passed.tmdbId) === tmdbId ? toMovieDetails(passed) : undefined,
  })
  const m = details.data
  const inLibrary = Boolean(m && m.id > 0 && m.hasFile)
  const inRadarr = !cancelled && (Boolean(m && m.id > 0) || requested === 'requested')
  const isAvailable = m?.raw?.isAvailable !== false

  // Where the request stands: searching, downloading (how far), stuck, searching again…
  const status = useRequestStatus(cancelled ? undefined : m, {
    justRequested: requested === 'requested',
    available: isAvailable ? undefined : false,
  })

  // In the library: find it in Jellyfin (same TMDb id) so Play can open it. The same lookup the
  // Request page's Ready links use, so it's shared (and refreshed when a download lands).
  const libraryItem = useLibraryMatch(m, inLibrary)

  const refreshAll = () => {
    for (const key of [['arrRequested'], ['arrQueue'], ['arrLookup'], ['arrLookupAll'], ['arrDiscover'], ['arrMovieDetails', tmdbId], ['arrFailures']]) {
      void qc.invalidateQueries({ queryKey: key })
    }
  }

  const request = async () => {
    if (!m || requested !== 'idle' || !canRequest) return
    setRequested('adding')
    setCancelled(false)
    try {
      const id = await arrAdd(m)
      setRequested('requested')
      noteRequested(qc, m, id)
      toast(`Added “${m.title}”. Radarr is looking for a release now.`)
    } catch (e) {
      setRequested('idle')
      toast(e instanceof ArrError && e.status === 401 ? 'Sign in again to request' : e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t request “${m.title}”`, 'error')
    }
  }

  const searchAgain = async () => {
    if (!m || !m.id || reqActionBusy) return
    setReqActionBusy('again')
    try {
      await arrSearchAgain({ kind: 'movie', id: m.id })
      toast(`Looking for “${m.title}” again`)
      later(refreshAll, 1200)
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t search for “${m.title}” right now`, 'error')
    } finally {
      setReqActionBusy(null)
    }
  }

  const cancelRequest = async () => {
    if (!m || !m.id || reqActionBusy) return
    if (!confirmCancel.armed) return confirmCancel.arm()
    confirmCancel.disarm()
    setReqActionBusy('cancel')
    try {
      await arrCancelRequest({ kind: 'movie', id: m.id })
      setCancelled(true)
      setRequested('idle')
      toast(`Cancelled request for “${m.title}”`)
      refreshAll()
      later(refreshAll, 1200)
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t cancel “${m.title}”`, 'error')
    } finally {
      setReqActionBusy(null)
    }
  }

  if (!m) {
    const problem = !valid
      ? 'This link doesn’t point to a movie. Go back and pick one again.'
      : details.isError
        ? details.error instanceof ArrError && details.error.message
          ? details.error.message
          : 'Couldn’t load this movie. Radarr may be busy; try again in a moment.'
        : null
    return (
      <div className="px-4 sm:px-6 lg:px-12 py-10">
        {!IS_TV && <BackButton onClick={() => goBack(navigate)} />}
        {problem ? (
          <div className="mt-16 max-w-xl">
            <p className="text-sm text-ink-300" role="alert">
              {problem}
            </p>
            {valid && (
              <button
                type="button"
                onClick={() => void details.refetch()}
                disabled={details.isFetching}
                className="mt-4 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97] disabled:opacity-60"
              >
                {details.isFetching ? 'Trying again…' : 'Try again'}
              </button>
            )}
          </div>
        ) : (
          // The page's shape while Radarr answers: a hero, a title, a button.
          <div className="mt-10" aria-busy="true" aria-label="Loading the movie">
            <div className="h-[calc(var(--vh)*30)] min-h-[200px] w-full rounded-2xl shimmer" />
            <div className="mt-6 h-10 w-2/3 max-w-md rounded-lg shimmer" />
            <div className="mt-3 h-4 w-48 rounded shimmer" />
            <div className="mt-6 h-11 w-36 rounded-full shimmer" />
          </div>
        )}
      </div>
    )
  }

  const meta = [m.year ? String(m.year) : null, m.runtime ? runtime(m.runtime) : null].filter(Boolean) as string[]
  const facts = [
    ...m.released.map((r) => ({ label: r.label, value: date(r.date) })),
    m.studio ? { label: 'Studio', value: m.studio } : null,
    m.originalTitle ? { label: 'Original title', value: m.originalTitle } : null,
  ].filter((f): f is { label: string; value: string } => Boolean(f))
  const canTrailer = Boolean(m.trailer) && !__WEBOS__

  // Decide which CTA gets initial TV D-pad focus so the remote always lands on a real action.
  const focusOpen = Boolean(inLibrary && libraryItem.data)
  const focusRequest = !inLibrary && !inRadarr && canRequest
  const focusRequestedAction = !inLibrary && inRadarr && canRequest && m.id > 0 && isAvailable
  const focusTrailer = canTrailer && !focusOpen && !focusRequest && !focusRequestedAction

  const hue = titleHue(m.title)
  const fallbackGrad = `radial-gradient(120% 90% at 70% 25%, hsla(${hue}, 55%, 36%, 0.55) 0%, hsla(${(hue + 38) % 360}, 45%, 18%, 0.45) 48%, var(--color-ink-950) 85%)`

  return (
    <div className="pb-16">
      {m.backdrop && (
        <div className="ambilight fixed inset-0 -z-10 overflow-hidden" aria-hidden>
          <img decoding="async" src={m.backdrop} alt="" className="ambient-breathe h-full w-full object-cover blur-3xl brightness-[0.22] saturate-150" />
        </div>
      )}
      <div className="relative -mt-16">
        {!IS_TV && (
          <div className="absolute left-3 top-[4.75rem] sm:left-6 lg:left-12 sm:top-[5.25rem] z-20 supports-[top:max(0px,env(safe-area-inset-top))]:top-[calc(4.75rem+env(safe-area-inset-top))] supports-[top:max(0px,env(safe-area-inset-top))]:left-[max(0.75rem,env(safe-area-inset-left))] sm:supports-[top:max(0px,env(safe-area-inset-top))]:top-[calc(5.25rem+env(safe-area-inset-top))] sm:supports-[top:max(0px,env(safe-area-inset-top))]:left-[max(1.5rem,env(safe-area-inset-left))] lg:supports-[top:max(0px,env(safe-area-inset-top))]:left-[max(3rem,env(safe-area-inset-left))]">
            <BackButton onClick={() => goBack(navigate)} />
          </div>
        )}
        <div className="hero-melt relative h-[calc(var(--vh)*48)] min-h-[360px] w-full overflow-hidden">
          {m.backdrop ? (
            <img decoding="async" src={m.backdrop} alt="" className={`h-full w-full object-cover fade-in transition-opacity duration-700 ${trailerOn && trailerLive ? 'opacity-0' : 'opacity-100'}`} />
          ) : (
            <div className="h-full w-full relative overflow-hidden" style={{ backgroundImage: fallbackGrad }}>
              {m.poster && !IS_TV && (
                <img
                  decoding="async"
                  src={m.poster}
                  alt=""
                  aria-hidden
                  className={`h-full w-full object-cover scale-125 blur-3xl opacity-35 transition-opacity duration-700 ${trailerOn && trailerLive ? 'opacity-0' : 'opacity-35'}`}
                />
              )}
            </div>
          )}
          {trailerOn && m.trailer && (
            <TrailerHero
              youtubeId={m.trailer}
              onClose={() => {
                setTrailerOn(false)
                setTrailerLive(false)
              }}
              onPlaying={() => setTrailerLive(true)}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950/45 via-ink-950/10 to-ink-950/30 pointer-events-none" />
        </div>

        <div className="relative z-10 px-4 sm:px-6 lg:px-12 -mt-40 flex gap-8 items-end">
          {m.poster && <img decoding="async" src={m.poster} alt="" className="hidden md:block w-52 rounded-xl ring-1 ring-white/10 shrink-0 shadow-2xl" />}
          <div className="min-w-0 pb-2">
            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl leading-[0.95] text-white mb-3 drop-shadow-lg">{m.title}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-200 mb-4">
              {meta.map((x) => (
                <span key={x}>{x}</span>
              ))}
              {m.certification && <span className="px-1.5 py-0.5 rounded border border-white/20 text-xs">{m.certification}</span>}
              {m.genres.slice(0, 3).map((g) => (
                <span key={g} className="text-ink-400">
                  {g}
                </span>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
              {inLibrary ? (
                <div className="flex flex-wrap items-center gap-2.5">
                  {libraryItem.data ? (
                    <button
                      type="button"
                      className={PLAY_BTN}
                      autoFocus={IS_TV && focusOpen}
                      onClick={() => navigate(`/item/${libraryItem.data!.Id}`)}
                    >
                      <PlayIcon /> Open in Finesse
                    </button>
                  ) : (
                    <span className="inline-flex h-11 items-center gap-2 text-[15px] font-semibold text-emerald-300">
                      <CheckIcon /> In your library
                    </span>
                  )}
                  {canRequest && (
                    <button
                      type="button"
                      className={START_OVER_BTN}
                      onClick={() => setQualityOpen(true)}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Upgrade quality
                    </button>
                  )}
                </div>
              ) : inRadarr && status ? (
                <div className="space-y-3">
                  <RequestStatusView status={status} size="lg" className="sm:pt-1" />
                  {canRequest && m.id > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      {isAvailable && (
                        <button
                          type="button"
                          onClick={searchAgain}
                          disabled={reqActionBusy !== null}
                          autoFocus={IS_TV && focusRequestedAction}
                          className="inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-3.5 text-xs font-semibold text-white hover:bg-white/15 transition active:scale-[0.97] disabled:opacity-50"
                        >
                          {reqActionBusy === 'again' ? 'Searching…' : 'Search again'}
                        </button>
                      )}
                      {isAvailable && (
                        <button
                          type="button"
                          onClick={() => setWhyOpen(true)}
                          className="inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-3.5 text-xs font-semibold text-white hover:bg-white/15 transition active:scale-[0.97]"
                        >
                          Why nothing yet?
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={cancelRequest}
                        onBlur={confirmCancel.disarm}
                        disabled={reqActionBusy !== null}
                        className={`inline-flex h-9 items-center rounded-lg px-3.5 text-xs font-semibold transition active:scale-[0.97] disabled:opacity-50 ${
                          confirmCancel.armed
                            ? 'bg-red-500 text-white hover:bg-red-400'
                            : 'border border-white/15 bg-white/5 text-ink-200 hover:border-red-400/60 hover:text-red-300'
                        }`}
                      >
                        {reqActionBusy === 'cancel' ? 'Cancelling…' : confirmCancel.armed ? CONFIRM_AGAIN : 'Cancel request'}
                      </button>
                    </div>
                  )}
                </div>
              ) : canRequest ? (
                <button
                  type="button"
                  className={PLAY_BTN}
                  onClick={request}
                  disabled={requested === 'adding'}
                  autoFocus={IS_TV && focusRequest}
                >
                  <PlusIcon /> {requested === 'adding' ? 'Adding…' : 'Request'}
                </button>
              ) : (
                <p className="inline-flex h-11 items-center text-sm text-ink-400">Requests are off for this profile.</p>
              )}

              <div className="flex items-start gap-1 sm:gap-2">
                {canTrailer && (
                  <button
                    type="button"
                    autoFocus={IS_TV && focusTrailer}
                    aria-pressed={trailerOn}
                    aria-label={trailerOn ? 'Stop trailer' : 'Play trailer'}
                    onClick={() =>
                      setTrailerOn((v) => {
                        if (v) setTrailerLive(false)
                        return !v
                      })
                    }
                    className={ACTION_BTN}
                  >
                    <span
                      className={`${ACTION_CIRCLE} ${
                        trailerOn
                          ? 'bg-accent-500/25 border-accent-400/40 text-accent-300 group-hover/act:bg-accent-500/35'
                          : 'bg-white/10 border-white/15 text-white group-hover/act:bg-white/20'
                      }`}
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
                        <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" />
                      </svg>
                    </span>
                    <span className="leading-tight text-center">{trailerOn ? 'Stop' : 'Trailer'}</span>
                  </button>
                )}
                {m.imdbId && !IS_TV && (
                  <a
                    href={`https://www.imdb.com/title/${m.imdbId}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open on IMDb"
                    className={ACTION_BTN}
                  >
                    <span className="h-11 w-11 rounded-full flex items-center justify-center backdrop-blur-md border bg-white/10 border-white/15 text-white text-[11px] font-bold">IMDb</span>
                    <span className="leading-tight text-center">IMDb</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-12 mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          {m.overview ? <p className="max-w-3xl text-[15px] leading-relaxed text-ink-200">{m.overview}</p> : <p className="text-sm text-ink-400">No description yet.</p>}
          {m.ratings.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-3">
              {m.ratings.map((r) => (
                <div key={r.label} className="rounded-xl bg-white/5 border border-white/10 px-4 py-2.5">
                  <p className="text-lg font-semibold text-white tabular-nums">{r.value}</p>
                  <p className="text-[11px] text-ink-400">{r.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        {facts.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm self-start">
            {facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-ink-400">{f.label}</dt>
                <dd className="text-ink-100">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {qualityOpen && <QualityModal item={m} onClose={() => setQualityOpen(false)} />}
      {whyOpen && m.id > 0 && (
        <WhyNothingModal
          item={{ kind: 'movie', id: m.id, title: m.title, year: m.year }}
          onClose={() => setWhyOpen(false)}
        />
      )}
    </div>
  )
}

export function movieHref(tmdbId: number) {
  return `/request/movie/${tmdbId}`
}

export function movieState(m: MovieDetails | { raw: Record<string, unknown> }): RequestMovieState {
  return { raw: m.raw }
}

const runtime = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}m` : ''}`.trim() : `${min}m`)
const date = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      title="Back"
      className="h-10 w-10 rounded-full bg-black/45 backdrop-blur-md ring-1 ring-white/10 flex items-center justify-center text-white active:scale-95 transition-transform"
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
      </svg>
    </button>
  )
}

const icon = 'h-5 w-5'
const PlayIcon = () => (
  <svg className={icon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
)
const PlusIcon = () => (
  <svg className={icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
)
const CheckIcon = () => (
  <svg className={icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
  </svg>
)
