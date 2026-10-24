// A movie that isn't in the library (yet): what it is, its trailer, and Request. Opened from a
// Discover poster or a search result on the Request page. Once it's downloaded, Play opens it in
// the library.

import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { arrAdd, arrMovieDetails, ArrError, toMovieDetails, type MovieDetails } from '../api/arr'
import { getItems } from '../api/client'
import { useArrQueue } from '../api/queries'
import { ACTION_BTN, ActionButton, PLAY_BTN } from '../components/ActionButton'
import TrailerHero from '../components/TrailerHero'
import { useToast } from '../components/Toast'
import { goBack } from '../lib/back'
import { IS_TV } from '../lib/device'

/** The Request page passes the movie it already has, so this page shows at once. */
export interface RequestMovieState {
  raw?: Record<string, unknown>
}

export default function RequestMoviePage() {
  const { tmdbId: param } = useParams()
  const tmdbId = Number(param)
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const passed = (useLocation().state as RequestMovieState | null)?.raw
  const [requested, setRequested] = useState<'idle' | 'adding' | 'requested'>('idle')
  const [trailerOn, setTrailerOn] = useState(false)
  const [trailerLive, setTrailerLive] = useState(false)

  const details = useQuery({
    queryKey: ['arrMovieDetails', tmdbId],
    enabled: Number.isFinite(tmdbId) && tmdbId > 0,
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: () => arrMovieDetails(tmdbId),
    placeholderData: passed && Number(passed.tmdbId) === tmdbId ? toMovieDetails(passed) : undefined,
  })
  const m = details.data
  const inLibrary = Boolean(m && m.id > 0 && m.hasFile)
  const inRadarr = Boolean(m && m.id > 0) || requested === 'requested'

  // Downloading now? The queue says how far along.
  const { data: queue } = useArrQueue()
  const dl = m && m.id > 0 ? queue?.find((q) => q.kind === 'movie' && q.refId === m.id) : undefined

  // In the library: find it in Jellyfin (same TMDb id) so Play can open it.
  const libraryItem = useQuery({
    queryKey: ['jfByTmdb', tmdbId, m?.title],
    enabled: inLibrary && Boolean(m?.title),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await getItems({ searchTerm: m!.title, includeItemTypes: 'Movie', recursive: true, fields: 'ProviderIds', limit: 30 })
      return r.Items.find((i) => String((i as { ProviderIds?: Record<string, string> }).ProviderIds?.Tmdb ?? '') === String(tmdbId)) ?? null
    },
  })

  const request = async () => {
    if (!m) return
    setRequested('adding')
    try {
      await arrAdd(m)
      setRequested('requested')
      void qc.invalidateQueries({ queryKey: ['arrDiscover'] })
      void qc.invalidateQueries({ queryKey: ['arrMovieDetails', tmdbId] })
      toast(`Added “${m.title}”. Radarr is looking for it now.`)
    } catch (e) {
      setRequested('idle')
      toast(e instanceof ArrError && e.status === 401 ? 'Sign in again to request' : e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t request “${m.title}”`, 'error')
    }
  }

  if (!m) {
    return (
      <div className="px-4 sm:px-6 lg:px-12 py-10">
        <BackButton onClick={() => goBack(navigate)} />
        <p className="mt-16 text-sm text-ink-400">{details.isError ? 'Couldn’t load this movie. Radarr may be busy; try again in a moment.' : 'Loading…'}</p>
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

  return (
    <div className="pb-16">
      {m.backdrop && (
        <div className="ambilight fixed inset-0 -z-10 overflow-hidden" aria-hidden>
          <img src={m.backdrop} alt="" className="ambient-breathe h-full w-full object-cover blur-3xl brightness-[0.22] saturate-150" />
        </div>
      )}
      <div className="relative -mt-16">
        {!IS_TV && (
          <div className="absolute left-3 top-[4.75rem] sm:left-6 lg:left-12 sm:top-[5.25rem] z-20">
            <BackButton onClick={() => goBack(navigate)} />
          </div>
        )}
        <div className="hero-melt relative h-[calc(var(--vh)*48)] min-h-[360px] w-full overflow-hidden">
          {m.backdrop && (
            <img src={m.backdrop} alt="" className={`h-full w-full object-cover fade-in transition-opacity duration-700 ${trailerOn && trailerLive ? 'opacity-0' : 'opacity-100'}`} />
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
          {m.poster && <img src={m.poster} alt={m.title} className="hidden md:block w-52 rounded-xl ring-1 ring-white/10 shrink-0 shadow-2xl" />}
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
                libraryItem.data ? (
                  <button type="button" className={PLAY_BTN} onClick={() => navigate(`/item/${libraryItem.data!.Id}`)}>
                    <PlayIcon /> Open in Finesse
                  </button>
                ) : (
                  <span className="inline-flex h-11 items-center gap-2 text-[15px] font-semibold text-emerald-300">
                    <CheckIcon /> In your library
                  </span>
                )
              ) : dl ? (
                <span className="inline-flex h-11 items-center gap-2 text-[15px] font-semibold text-accent-300">
                  <DownloadIcon /> {dl.done ? dl.status : `${dl.status} ${dl.progress}%`}
                </span>
              ) : inRadarr ? (
                <span className="inline-flex h-11 items-center gap-2 text-[15px] font-semibold text-accent-300">
                  <ClockIcon /> Requested, waiting for a release
                </span>
              ) : (
                <button type="button" className={PLAY_BTN} onClick={request} disabled={requested === 'adding'} autoFocus={IS_TV}>
                  <PlusIcon /> {requested === 'adding' ? 'Adding…' : 'Request'}
                </button>
              )}
              <div className="flex items-start gap-1 sm:gap-2">
                {canTrailer && (
                  <ActionButton
                    label="Trailer"
                    onClick={() => setTrailerOn(true)}
                    active={trailerOn}
                    icon={
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
                        <path d="M10.5 9.5v5l4-2.5z" fill="currentColor" />
                      </svg>
                    }
                  />
                )}
                {m.imdbId && !IS_TV && (
                  <a href={`https://www.imdb.com/title/${m.imdbId}/`} target="_blank" rel="noopener noreferrer" className={ACTION_BTN}>
                    <span className="h-11 w-11 rounded-full flex items-center justify-center backdrop-blur-md border bg-white/10 border-white/15 text-white text-[11px] font-bold">IMDb</span>
                    <span className="leading-tight text-center">Details</span>
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
const ClockIcon = () => (
  <svg className={icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
)
const DownloadIcon = () => (
  <svg className={icon} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13.5m0 0 4.5-4.5M12 16.5 7.5 12M3.75 18.75A2.25 2.25 0 0 0 6 21h12a2.25 2.25 0 0 0 2.25-2.25" />
  </svg>
)
