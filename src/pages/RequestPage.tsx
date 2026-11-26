import { useMyLimits } from '../api/parental'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import {
  arrAdd,
  artistAlbums,
  arrDiscover,
  requestArtistAlbum,
  type ArtistAlbum,
  arrLibraryQuality,
  arrLookup,
  ArrError,
  ARR_APP_NAME,
  formatQualityInfo,
  qualityFromLookup,
  type ArrKind,
  type ArrResult,
  type DiscoverMovie,
  type DiscoverSection,
} from '../api/arr'
import { noteRequested, useArrQueue, useArrRequested } from '../api/queries'
import { useStoreMode } from '../api/gameStoreQueries'
import { IS_TV, TOUCH_UI } from '../lib/device'
import { discoverStatus, requestKey } from '../lib/requestState'
import { lookupTitles, matchesTerm } from '../lib/discovery'
import ArrThumb from '../components/ArrThumb'
import DownloadsSection from '../components/DownloadsSection'
import RequestedSection from '../components/RequestedSection'
import { ReadyLink, RequestStatusView, useRequestStatus } from '../components/RequestStatus'
import QualityModal from '../components/QualityModal'
import SabPanel from '../components/SabPanel'
import { useToast } from '../components/Toast'
import { movieHref, movieState } from './RequestMoviePage'

type ItemState = 'idle' | 'adding' | 'requested'

const KINDS: { kind: ArrKind; label: string; placeholder: string }[] = [
  { kind: 'movie', label: 'Movies', placeholder: 'Search for a movie…' },
  { kind: 'series', label: 'Shows', placeholder: 'Search for a show…' },
  { kind: 'artist', label: 'Music', placeholder: 'Search for an artist…' },
]

const SHOW_STARTERS = ['Severance', 'The Bear', 'Shōgun', 'Slow Horses', 'Andor', 'Silo', 'Fallout', 'Arcane']
const MUSIC_STARTERS = ['Radiohead', 'Daft Punk', 'Kendrick Lamar', 'Khruangbin', 'Tame Impala', 'Miles Davis', 'Fred again..', 'Billie Eilish']

const ARROW = 'h-8 w-8 rounded-full bg-ink-800 hover:bg-ink-700 flex items-center justify-center text-ink-200 transition-colors'

/** A limited profile without requests (parental limits) gets a plain explanation instead. */
export default function RequestPage() {
  const limits = useMyLimits()
  if (limits && !limits.requests)
    return (
      <div className="px-4 sm:px-6 lg:px-12 pb-16 pt-6">
        <h1 className="page-title">Requests</h1>
        <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-300">
          Requests are off for this profile. Ask whoever runs the server if you’d like something added.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 border border-white/15 px-5 text-sm font-semibold text-white hover:bg-white/15 transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    )
  return <RequestPageInner />
}

function RequestPageInner() {
  const [searchParams, setSearchParams] = useSearchParams()
  const storeMode = useStoreMode()
  const term = searchParams.get('q') ?? ''
  const kindParam = searchParams.get('kind') as ArrKind
  const kind = KINDS.some((k) => k.kind === kindParam) ? kindParam : 'movie'
  const [input, setInput] = useState(term)
  const inputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const qc = useQueryClient()
  // Per-result override so a freshly-requested item flips state immediately.
  const [overrides, setOverrides] = useState<Record<string, ItemState>>({})
  /** Open quality/upgrade modal for an in-library title. */
  const [qualityItem, setQualityItem] = useState<ArrResult | null>(null)
  /** The artist whose albums and EPs are open (one at a time). */
  const [albumsFor, setAlbumsFor] = useState<string | null>(null)

  // Live activity determines whether Downloads & Pending Requests lead above Discover.
  const { data: queue } = useArrQueue()
  const { data: requestedList } = useArrRequested()
  const hasActivity = Boolean((queue?.length ?? 0) > 0 || (requestedList?.length ?? 0) > 0)

  // URL is the source of truth, debounced from typing.
  const commit = useCallback(
    (value: string) => {
      const v = value.trim()
      if (v === term) return
      const next = new URLSearchParams(searchParams)
      if (v) next.set('q', v)
      else next.delete('q')
      setSearchParams(next, { replace: true })
    },
    [term, searchParams, setSearchParams],
  )
  useEffect(() => {
    const t = setTimeout(() => commit(input), 350)
    return () => clearTimeout(t)
  }, [input, commit])

  // The address changed from outside (Back, or global search opening this page with a term):
  // the box shows that term rather than what was typed before.
  const lastTerm = useRef(term)
  useEffect(() => {
    if (term === lastTerm.current) return
    lastTerm.current = term
    setInput((cur) => (cur.trim() === term ? cur : term))
  }, [term])

  const setKind = (k: ArrKind) => {
    if (k === kind) return
    setAlbumsFor(null)
    const next = new URLSearchParams(searchParams)
    next.set('kind', k)
    // What's typed counts straight away in the new tab (not after the debounce).
    if (input.trim()) next.set('q', input.trim())
    else next.delete('q')
    setSearchParams(next, { replace: true })
  }

  const pickStarter = (suggestion: string) => {
    setInput(suggestion)
    commit(suggestion)
  }

  // The lookup is fuzzy: keep what answers the term, so a search for nothing says so.
  const select = useCallback((rows: ArrResult[]) => rows.filter((r) => matchesTerm(lookupTitles(r), term)), [term])
  const { data, isLoading, isError, error, isPlaceholderData } = useQuery({
    queryKey: ['arrLookup', kind, term],
    enabled: term.trim().length > 1,
    staleTime: 5 * 60_000,
    retry: false,
    // A newer term (or tab) cancels the lookup still on its way.
    queryFn: ({ signal }) => arrLookup(kind, term, signal),
    // While the next term loads, the last results (same tab) stay, filtered by the new term.
    // (Not once the box is cleared: a disabled query would keep showing them.)
    placeholderData: (prev, prevQuery) => (term.trim().length > 1 && prevQuery?.queryKey[1] === kind ? prev : undefined),
    select,
  })

  // Current on-disk quality for library hits (movies/shows only). Radarr's lookup already
  // carries a movie's file, so only shows (and movies without it) are asked again; a few at most.
  const libraryHits = (data ?? []).filter((r) => r.id > 0 && r.hasFile && r.kind !== 'artist')
  const needsQuality = libraryHits.filter((r) => !qualityFromLookup(r)).slice(0, 6)
  const qualityQueries = useQueries({
    queries: needsQuality.map((r) => ({
      queryKey: ['arrQuality', r.kind, r.id] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => arrLibraryQuality(r.kind, r.id, signal),
      staleTime: 5 * 60_000,
      retry: 1,
    })),
  })
  const qualityByKey = new Map(libraryHits.map((r) => [`${r.kind}-${r.id}`, qualityFromLookup(r) ?? undefined] as const))
  needsQuality.forEach((r, i) => qualityByKey.set(`${r.kind}-${r.id}`, qualityQueries[i]?.data ?? undefined))

  const keyOf = (r: ArrResult) => requestKey(r)

  const request = async (r: ArrResult) => {
    const k = keyOf(r)
    if (overrides[k] === 'adding' || overrides[k] === 'requested') return
    setOverrides((o) => ({ ...o, [k]: 'adding' }))
    try {
      const id = await arrAdd(r)
      setOverrides((o) => ({ ...o, [k]: 'requested' }))
      noteRequested(qc, r, id)
      toast(`Added “${r.title}”. ${ARR_APP_NAME[r.kind]} is looking for a release now.`)
    } catch (e) {
      setOverrides((o) => ({ ...o, [k]: 'idle' }))
      let msg = `Couldn’t request “${r.title}”`
      if (e instanceof ArrError) {
        if (e.status === 401) msg = 'Sign in again to request'
        else if (e.message) msg = e.message.slice(0, 180)
      }
      toast(msg, 'error')
    }
  }

  const authError = isError && error instanceof ArrError && error.status === 401
  // ArrError's words say what's wrong ("Sonarr isn't set up…", "isn't answering"); anything else is generic.
  const lookupProblem = error instanceof ArrError && error.message ? error.message : 'Couldn’t reach the request service. Try again in a moment.'
  const searching = term.trim().length > 1

  // Radarr's Discover: shown for movies while nothing is typed.
  const showDiscover = kind === 'movie' && !searching
  const discover = useQuery({
    queryKey: ['arrDiscover'],
    enabled: showDiscover,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: arrDiscover,
  })

  const activitySections = (
    <>
      {/* Downloader (SABnzbd) status: speed / disk / pause-all / speed cap. */}
      <SabPanel />
      {/* What's currently downloading — live from the *arr queues, with controls. */}
      <DownloadsSection />
      {/* Recent requests still waiting for a release. */}
      <RequestedSection />
    </>
  )

  return (
    <div className="pb-16">
      <div className="px-4 sm:px-6 lg:px-12 py-6">
        <h1 className="page-title mb-1">Request</h1>
        <p className="text-sm text-ink-400 mb-4">
          Can’t find something? Search and add it — or open an in-library title to upgrade /
          downgrade quality.
        </p>

        <div className="flex items-center gap-2 mb-4">
          <div className="inline-flex max-w-full overflow-x-auto no-scrollbar rounded-full bg-ink-800/80 border border-white/10 p-1" role="group" aria-label="What to request">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                aria-pressed={kind === k.kind}
                onClick={() => setKind(k.kind)}
                className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition active:scale-[0.97] ${
                  kind === k.kind ? 'bg-[#f5f3ee] text-ink-950' : 'text-ink-300 hover:text-white'
                }`}
              >
                {k.label}
              </button>
            ))}
            {storeMode && (
              <Link to="/games/store" className="shrink-0 px-4 py-1.5 rounded-full text-sm font-medium text-ink-300 hover:text-white transition-colors">
                Games
              </Link>
            )}
          </div>
        </div>

        <div className="relative max-w-xl">
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            aria-label={KINDS.find((k) => k.kind === kind)!.placeholder.replace('…', '')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            // Enter searches now (no waiting out the debounce); the TV keyboard's Done too.
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(input)
            }}
            placeholder={KINDS.find((k) => k.kind === kind)!.placeholder}
            autoFocus={!term && !IS_TV && !TOUCH_UI}
            className="search-field w-full rounded-full bg-white/[0.06] border border-white/10 pl-11 pr-10 py-2.5 text-sm text-white outline-none focus:border-white/30 placeholder:text-ink-400"
          />
          {input.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setInput('')
                commit('')
                inputRef.current?.focus()
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full text-ink-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-12">
        {/* Search results first: the lists below can be long. */}
        {authError && (
          <p className="mb-8 text-red-300">Your session expired — sign out and back in to request.</p>
        )}
        {isError && !authError && searching && <p className="mb-8 max-w-2xl text-red-300" role="alert">{lookupProblem}</p>}
        {isLoading && searching && <ResultSkeletons />}
        {!isLoading && !isError && !isPlaceholderData && data && data.length === 0 && searching && (
          <p className="mb-8 text-ink-400">
            No {kind === 'movie' ? 'movies' : kind === 'series' ? 'shows' : 'artists'} match “{term}”. Try another tab above, or check the spelling.
          </p>
        )}

        <div
          aria-busy={isPlaceholderData || undefined}
          className={`grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-4 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''} ${data?.length ? 'mb-10' : ''}`}
        >
          {data?.map((r) => {
            const k = keyOf(r)
            const state: ItemState = overrides[k] ?? (r.id > 0 ? 'requested' : 'idle')
            const inLibrary = r.id > 0 && r.hasFile
            const qInfo = inLibrary ? qualityByKey.get(`${r.kind}-${r.id}`) : undefined
            const canQuality = inLibrary && (r.kind === 'movie' || r.kind === 'series')
            const expanded = albumsFor === k
            return (
              <Fragment key={k}>
                <div className={`cv-card flex gap-4 rounded-2xl bg-ink-900/60 border p-3 transition-colors ${expanded ? 'border-accent-400/40' : 'border-white/5'}`}>
                  {r.kind === 'movie' && r.tmdbId ? (
                    <Link to={movieHref(r.tmdbId)} state={movieState(r)} aria-label={`${r.title}: details`} className="shrink-0 rounded-lg outline-none ring-accent-400 transition hover:brightness-110 focus-visible:ring-2">
                      <ArrThumb kind={r.kind} id={r.id} remote={r.poster} title={r.title} size="md" />
                    </Link>
                  ) : (
                    <ArrThumb kind={r.kind} id={r.id} remote={r.poster} title={r.title} size="md" />
                  )}
                  <div className="min-w-0 flex-1 flex flex-col">
                    <p className="text-sm font-semibold text-white leading-tight">
                      {r.kind === 'movie' && r.tmdbId ? (
                        <Link to={movieHref(r.tmdbId)} state={movieState(r)} tabIndex={-1} className="hover:underline">
                          {r.title}
                        </Link>
                      ) : (
                        r.title
                      )}
                      {r.year ? <span className="text-ink-400 font-normal"> ({r.year})</span> : null}
                    </p>
                    <p className="mt-1 text-xs text-ink-400 line-clamp-3">{r.overview}</p>
                    {canQuality && qInfo && (
                      <p className="mt-1.5 text-[11px] text-ink-300 tabular-nums">
                        <span className="text-ink-400">Current </span>
                        {formatQualityInfo(qInfo)}
                      </p>
                    )}
                    <div className="mt-auto pt-2 flex flex-wrap items-center gap-2">
                      {inLibrary ? (
                        <>
                          <ReadyLink r={r} />
                          {canQuality && (
                            <button
                              type="button"
                              onClick={() => setQualityItem(r)}
                              className="inline-flex items-center gap-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-semibold text-white transition active:scale-[0.97]"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                              </svg>
                              Upgrade / quality
                            </button>
                          )}
                        </>
                      ) : r.id > 0 || state === 'requested' ? (
                        <CardStatus r={r} justRequested={state === 'requested'} />
                      ) : (
                        <button
                          type="button"
                          onClick={() => request(r)}
                          disabled={state === 'adding'}
                          className="inline-flex items-center gap-1.5 rounded-full bg-accent-fill hover:brightness-110 disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-white transition active:scale-[0.97] disabled:active:scale-100"
                        >
                          {state === 'adding' ? (
                            'Adding…'
                          ) : (
                            <>
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                              </svg>
                              Request
                            </>
                          )}
                        </button>
                      )}
                      {r.kind === 'artist' && Boolean(r.raw.foreignArtistId) && (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setAlbumsFor(expanded ? null : k)}
                          className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-[0.97] ${
                            expanded
                              ? 'bg-white text-ink-950 border-white'
                              : 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                          }`}
                        >
                          {expanded ? 'Hide albums & EPs' : 'Albums & EPs'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {expanded && (
                  <div className="col-span-full rounded-2xl border border-white/10 bg-ink-900/80 p-4">
                    <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/5">
                      <div>
                        <p className="text-sm font-semibold text-white">{r.title} — Albums &amp; EPs</p>
                        <p className="text-xs text-ink-400">Request an individual album or EP directly through Lidarr.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAlbumsFor(null)}
                        aria-label="Close albums and EPs"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-300 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <ArtistAlbums artist={r} />
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>

        {/* Active downloads and pending requests lead above Discover when anything is in flight. */}
        {hasActivity && activitySections}

        {showDiscover && (
          <DiscoverRows
            movies={discover.data}
            loading={discover.isLoading}
            failed={discover.isError}
            stateOf={(r) => overrides[keyOf(r)] ?? 'idle'}
            onRequest={request}
          />
        )}

        {!searching && (kind === 'series' || kind === 'artist') && (
          <IdleStarters kind={kind} onPick={pickStarter} />
        )}

        {!hasActivity && activitySections}
      </div>

      {qualityItem && (
        <QualityModal item={qualityItem} onClose={() => setQualityItem(null)} />
      )}
    </div>
  )
}

function IdleStarters({ kind, onPick }: { kind: 'series' | 'artist'; onPick: (q: string) => void }) {
  const isShows = kind === 'series'
  const starters = isShows ? SHOW_STARTERS : MUSIC_STARTERS
  return (
    <section className="mb-10 rounded-2xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
      <div className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-300">
          {isShows ? 'TVDB · Sonarr' : 'MusicBrainz · Lidarr'}
        </p>
        <h2 className="mt-1.5 text-lg font-semibold text-white">
          {isShows ? 'Search TVDB to request any show' : 'Search MusicBrainz to request any artist or album'}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-400">
          {isShows
            ? 'Type a series title above and Finesse will monitor new episodes and download available seasons automatically.'
            : 'Type an artist name above to add their discography, or expand Albums & EPs to request a specific release.'}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-400 mr-1">Try searching:</span>
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPick(s)}
              className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-ink-200 hover:bg-white/15 hover:text-white transition active:scale-[0.97]"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

const ROWS: { id: DiscoverSection; title: string; hint: string }[] = [
  { id: 'trending', title: 'Trending this week', hint: 'What people are watching right now.' },
  { id: 'popular', title: 'Popular', hint: 'The most popular movies at the moment.' },
  { id: 'recommended', title: 'Recommended for you', hint: 'Based on the movies already in your library.' },
  { id: 'lists', title: 'From your lists', hint: 'From the lists set up in Radarr.' },
]

/** Cards the size of results while a search is on its way. */
function ResultSkeletons() {
  return (
    <div className="mb-10 grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-4" aria-busy="true" aria-label="Searching">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex gap-4 rounded-2xl bg-ink-900/60 border border-white/5 p-3" aria-hidden>
          <div className="h-30 w-20 shrink-0 rounded-lg shimmer" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <div className="h-3.5 w-2/3 rounded shimmer" />
            <div className="h-2.5 w-full rounded shimmer" />
            <div className="h-2.5 w-5/6 rounded shimmer" />
            <div className="mt-4 h-7 w-24 rounded-full shimmer" />
          </div>
        </div>
      ))}
    </div>
  )
}

function DiscoverRow({
  title,
  hint,
  items,
  stateOf,
  onRequest,
}: {
  title: string
  hint: string
  items: DiscoverMovie[]
  stateOf: (r: ArrResult) => ItemState
  onRequest: (r: ArrResult) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollBy = (dir: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }
  return (
    <section className="group/row" aria-label={title}>
      <div className="flex items-end justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="text-xs text-ink-400">{hint}</p>
        </div>
        {!IS_TV && (
          <div className="hidden md:flex shrink-0 gap-1 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
            <button type="button" onClick={() => scrollBy(-1)} tabIndex={-1} className={ARROW} aria-label={`Scroll ${title} left`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button type="button" onClick={() => scrollBy(1)} tabIndex={-1} className={ARROW} aria-label={`Scroll ${title} right`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div
        ref={scrollRef}
        className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 no-scrollbar scroll-smooth sm:-mx-6 sm:px-6 lg:-mx-12 lg:px-12"
      >
        {items.map((m) => (
          <DiscoverCard key={m.tmdbId} m={m} state={stateOf(m)} onRequest={() => onRequest(m)} />
        ))}
      </div>
    </section>
  )
}

/** Radarr's Discover tab, as rows of posters you can request with one tap. */
function DiscoverRows({ movies, loading, failed, stateOf, onRequest }: { movies?: DiscoverMovie[]; loading: boolean; failed: boolean; stateOf: (r: ArrResult) => ItemState; onRequest: (r: ArrResult) => void }) {
  if (loading)
    return (
      <div className="mb-10 space-y-8" aria-busy="true" aria-label="Finding movies to discover">
        {[0, 1].map((row) => (
          <div key={row} aria-hidden>
            <div className="h-4 w-40 rounded shimmer" />
            <div className="mt-2 mb-3 h-2.5 w-56 rounded shimmer" />
            <div className="-mx-4 flex gap-3 overflow-hidden px-4 sm:-mx-6 sm:px-6 lg:-mx-12 lg:px-12">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="w-32 shrink-0 sm:w-36">
                  <div className="aspect-[2/3] rounded-xl shimmer" />
                  <div className="mt-2 h-3 w-4/5 rounded shimmer" />
                  <div className="mt-3 h-7 w-full rounded-full shimmer" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  if (failed) return <p className="mb-10 text-sm text-ink-400">Discover isn’t available right now. You can still search above.</p>
  const rows = ROWS.map((row) => ({ ...row, items: (movies ?? []).filter((m) => m.sections.includes(row.id)).slice(0, 30) })).filter((r) => r.items.length > 0)
  if (rows.length === 0) return null
  return (
    <div className="mb-10 space-y-8">
      {rows.map((row) => (
        <DiscoverRow
          key={row.id}
          title={row.title}
          hint={row.hint}
          items={row.items}
          stateOf={stateOf}
          onRequest={onRequest}
        />
      ))}
    </div>
  )
}

function DiscoverCard({ m, state, onRequest }: { m: DiscoverMovie; state: ItemState; onRequest: () => void }) {
  const [broken, setBroken] = useState(false)
  const dStatus = discoverStatus(m)
  return (
    <div className="w-32 shrink-0 sm:w-36">
      <Link
        to={movieHref(m.tmdbId!)}
        state={movieState(m)}
        aria-label={`${m.title}${m.year ? ` (${m.year})` : ''}: details`}
        className="relative block aspect-[2/3] overflow-hidden rounded-xl bg-ink-800 outline-none ring-accent-400 transition hover:brightness-110 focus-visible:ring-2"
        title={m.overview}
      >
        {m.poster && !broken ? (
          <img decoding="async" src={m.poster} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-end p-2.5 text-[13px] font-semibold leading-tight text-white/90"
            style={{ backgroundImage: `linear-gradient(150deg, hsl(${titleHue(m.title)}, 45%, 34%), hsl(${(titleHue(m.title) + 40) % 360}, 50%, 16%))` }}
          >
            {m.title}
          </div>
        )}
      </Link>
      <Link to={movieHref(m.tmdbId!)} state={movieState(m)} tabIndex={-1} className="mt-1.5 block truncate text-[13px] font-semibold text-white hover:underline" title={m.title}>
        {m.title}
      </Link>
      <p className="text-[11px] text-ink-400">{m.year ?? ''}</p>
      <div className="mt-1.5">
        {dStatus === 'in-library' ? (
          <ReadyLink r={{ ...m, hasFile: true }} className="w-full justify-center" />
        ) : dStatus === 'requested' ? (
          <Link to={movieHref(m.tmdbId!)} state={movieState(m)} className="text-xs font-medium text-accent-300 hover:underline">
            Requested
          </Link>
        ) : m.existing ? (
          <ReadyLink r={{ ...m, hasFile: true }} className="w-full justify-center" />
        ) : state === 'requested' ? (
          <Link to={movieHref(m.tmdbId!)} state={movieState(m)} className="text-xs font-medium text-accent-300 hover:underline">
            Added — searching
          </Link>
        ) : (
          <button
            type="button"
            onClick={onRequest}
            disabled={state === 'adding'}
            aria-label={`Request ${m.title}`}
            className="w-full rounded-full bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
          >
            {state === 'adding' ? 'Adding…' : 'Request'}
          </button>
        )}
      </div>
    </div>
  )
}

/** A steady colour per title, for posters that didn't load. */
function titleHue(title: string): number {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360
  return h
}

/**
 * An artist's albums and EPs, each requestable on its own. Requesting a whole artist only
 * gets what Lidarr's metadata profile follows (often albums only), so an EP-only artist
 * came up empty; asking for the EP itself gets it.
 */
function ArtistAlbums({ artist }: { artist: ArrResult }) {
  const toast = useToast()
  const qc = useQueryClient()
  const key = ['artistAlbums', String(artist.raw.foreignArtistId)]
  const q = useQuery({ queryKey: key, queryFn: () => artistAlbums(artist), staleTime: 5 * 60_000, retry: false })
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, string>>({})
  const ask = async (a: ArtistAlbum) => {
    if (busy) return
    setBusy(a.foreignAlbumId)
    try {
      const r = await requestArtistAlbum(artist, a)
      setDone((d) => ({ ...d, [a.foreignAlbumId]: r.state === 'have' ? 'In your music' : 'Requested' }))
      toast(r.profileChanged ? `${r.message} ${artist.title} now follows EPs too.` : r.message)
      void qc.invalidateQueries({ queryKey: key })
      void qc.invalidateQueries({ queryKey: ['arrQueue'] })
      void qc.invalidateQueries({ queryKey: ['arrRequested'] })
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t request “${a.title}”`, 'error')
    } finally {
      setBusy(null)
    }
  }
  if (q.isLoading) return <p className="mt-3 text-xs text-ink-400">Asking Lidarr for {artist.title}’s albums and EPs…</p>
  if (q.isError) return <p className="mt-3 text-xs text-red-300">{(q.error as Error).message}</p>
  const list = q.data ?? []
  if (!list.length) return <p className="mt-3 text-xs text-ink-400">Lidarr doesn’t list any albums or EPs for {artist.title} yet.</p>
  return (
    <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
      {list.slice(0, 40).map((a) => {
        const status = done[a.foreignAlbumId] ?? (a.downloaded ? 'In your music' : a.monitored ? 'Requested' : null)
        return (
          <li key={a.foreignAlbumId} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-white">{a.title}</span>
              <span className="block text-[11px] text-ink-400">{[a.type, a.year].filter(Boolean).join(' · ')}</span>
            </span>
            {status ? (
              <span className={`shrink-0 text-xs font-medium ${status === 'In your music' ? 'text-emerald-300' : 'text-accent-300'}`}>{status}</span>
            ) : (
              <button
                type="button"
                onClick={() => void ask(a)}
                disabled={busy !== null}
                aria-label={`Request ${a.title}`}
                className="shrink-0 rounded-full bg-accent-fill px-3 py-1 text-xs font-semibold text-white transition hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
              >
                {busy === a.foreignAlbumId ? 'Requesting…' : 'Request'}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A requested title's card: where it stands now (searching, downloading 42%, stuck…). */
function CardStatus({ r, justRequested }: { r: ArrResult; justRequested: boolean }) {
  const status = useRequestStatus(r, { justRequested })
  return status ? <RequestStatusView status={status} /> : null
}
