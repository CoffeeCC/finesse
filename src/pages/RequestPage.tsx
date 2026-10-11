import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueries } from '@tanstack/react-query'
import {
  arrAdd,
  arrDiscover,
  arrLibraryQuality,
  arrLookup,
  ArrError,
  formatQualityInfo,
  type ArrKind,
  type ArrResult,
  type DiscoverMovie,
  type DiscoverSection,
} from '../api/arr'
import { useArrQueue } from '../api/queries'
import ArrThumb from '../components/ArrThumb'
import DownloadsSection from '../components/DownloadsSection'
import RequestedSection from '../components/RequestedSection'
import QualityModal from '../components/QualityModal'
import SabPanel from '../components/SabPanel'
import { useToast } from '../components/Toast'

type ItemState = 'idle' | 'adding' | 'requested'

const KINDS: { kind: ArrKind; label: string; placeholder: string }[] = [
  { kind: 'movie', label: 'Movies', placeholder: 'Search for a movie…' },
  { kind: 'series', label: 'Shows', placeholder: 'Search for a show…' },
  { kind: 'artist', label: 'Music', placeholder: 'Search for an artist…' },
]

export default function RequestPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const term = searchParams.get('q') ?? ''
  const kindParam = searchParams.get('kind') as ArrKind
  const kind = KINDS.some((k) => k.kind === kindParam) ? kindParam : 'movie'
  const [input, setInput] = useState(term)
  const toast = useToast()
  // Per-result override so a freshly-requested item flips state immediately.
  const [overrides, setOverrides] = useState<Record<string, ItemState>>({})
  /** Open quality/upgrade modal for an in-library title. */
  const [qualityItem, setQualityItem] = useState<ArrResult | null>(null)

  // URL is the source of truth, debounced from typing.
  useEffect(() => {
    const t = setTimeout(() => {
      if (input.trim() !== term) {
        const next = new URLSearchParams(searchParams)
        if (input.trim()) next.set('q', input.trim())
        else next.delete('q')
        setSearchParams(next, { replace: true })
      }
    }, 350)
    return () => clearTimeout(t)
  }, [input, term, searchParams, setSearchParams])

  const setKind = (k: ArrKind) => {
    const next = new URLSearchParams(searchParams)
    next.set('kind', k)
    setSearchParams(next, { replace: true })
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['arrLookup', kind, term],
    enabled: term.trim().length > 1,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => arrLookup(kind, term),
  })

  // Live download status, keyed by kind+arrId, to badge search results in progress.
  const { data: queue } = useArrQueue()
  const queueByRef = new Map((queue ?? []).map((q) => [`${q.kind}-${q.refId}`, q]))

  // Current on-disk quality for library hits (movies/shows only).
  const libraryHits = (data ?? []).filter((r) => r.id > 0 && r.hasFile && r.kind !== 'artist')
  const qualityQueries = useQueries({
    queries: libraryHits.map((r) => ({
      queryKey: ['arrQuality', r.kind, r.id] as const,
      queryFn: () => arrLibraryQuality(r.kind, r.id),
      staleTime: 5 * 60_000,
      retry: 1,
    })),
  })
  const qualityByKey = new Map(
    libraryHits.map((r, i) => [`${r.kind}-${r.id}`, qualityQueries[i]?.data] as const),
  )

  const keyOf = (r: ArrResult) => `${r.kind}:${r.tmdbId ?? r.tvdbId ?? r.title}`

  const request = async (r: ArrResult) => {
    const k = keyOf(r)
    setOverrides((o) => ({ ...o, [k]: 'adding' }))
    try {
      await arrAdd(r)
      setOverrides((o) => ({ ...o, [k]: 'requested' }))
      toast(`Added “${r.title}” — Radarr/Sonarr is searching for a release`)
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

  // Radarr's Discover: shown for movies while nothing is typed.
  const showDiscover = kind === 'movie' && term.trim().length <= 1
  const discover = useQuery({
    queryKey: ['arrDiscover'],
    enabled: showDiscover,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: arrDiscover,
  })

  return (
    <div className="pb-16">
      <div className="px-4 sm:px-6 lg:px-12 py-6">
        <h1 className="page-title mb-1">Request</h1>
        <p className="text-sm text-ink-400 mb-4">
          Can’t find something? Search and add it — or open an in-library title to upgrade /
          downgrade quality.
        </p>

        <div className="flex items-center gap-2 mb-4">
          <div className="inline-flex rounded-full bg-ink-800/80 border border-white/10 p-1">
            {KINDS.map((k) => (
              <button
                key={k.kind}
                onClick={() => setKind(k.kind)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  kind === k.kind ? 'bg-[#f5f3ee] text-ink-950' : 'text-ink-300 hover:text-white'
                }`}
              >
                {k.label}
              </button>
            ))}
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={KINDS.find((k) => k.kind === kind)!.placeholder}
            autoFocus={!term}
            className="w-full rounded-full bg-white/[0.06] border border-white/10 pl-11 pr-4 py-2.5 text-sm text-white outline-none focus:border-white/30 placeholder:text-ink-400"
          />
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-12">
        {/* Search results first: the lists below can be long. */}
        {authError && (
          <p className="mb-8 text-red-300">Your session expired — sign out and back in to request.</p>
        )}
        {isError && !authError && (
          <p className="mb-8 text-red-300">Couldn’t reach the request service. Try again in a moment.</p>
        )}
        {isLoading && <p className="mb-8 text-ink-400">Searching…</p>}
        {!isLoading && !isError && data && data.length === 0 && term.trim().length > 1 && (
          <p className="mb-8 text-ink-400">No matches for “{term}”.</p>
        )}

        <div className={`grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-4 ${data?.length ? 'mb-10' : ''}`}>
          {data?.map((r) => {
            const state: ItemState = overrides[keyOf(r)] ?? (r.id > 0 ? 'requested' : 'idle')
            const inLibrary = r.id > 0 && r.hasFile
            const dl = r.id > 0 ? queueByRef.get(`${r.kind}-${r.id}`) : undefined
            const qInfo = inLibrary ? qualityByKey.get(`${r.kind}-${r.id}`) : undefined
            const canQuality = inLibrary && (r.kind === 'movie' || r.kind === 'series')
            return (
              <div
                key={keyOf(r)}
                className="flex gap-4 rounded-2xl bg-ink-900/60 border border-white/5 p-3"
              >
                <ArrThumb kind={r.kind} id={r.id} remote={r.poster} title={r.title} size="md" />
                <div className="min-w-0 flex-1 flex flex-col">
                  <p className="text-sm font-semibold text-white leading-tight">
                    {r.title}
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
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                          In library
                        </span>
                        {canQuality && (
                          <button
                            onClick={() => setQualityItem(r)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                            Upgrade / quality
                          </button>
                        )}
                      </>
                    ) : dl ? (
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${dl.done ? 'text-emerald-300' : 'text-accent-300'}`}>
                        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13.5m0 0 4.5-4.5M12 16.5 7.5 12M3.75 18.75A2.25 2.25 0 0 0 6 21h12a2.25 2.25 0 0 0 2.25-2.25" />
                        </svg>
                        {dl.done ? dl.status : `${dl.status} ${dl.progress}%`}
                      </span>
                    ) : state === 'requested' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-300">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                        Added — searching
                      </span>
                    ) : (
                      <button
                        onClick={() => request(r)}
                        disabled={state === 'adding'}
                        className="inline-flex items-center gap-1.5 rounded-full bg-accent-fill hover:brightness-110 disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
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
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {showDiscover && (
          <DiscoverRows
            movies={discover.data}
            loading={discover.isLoading}
            failed={discover.isError}
            stateOf={(r) => overrides[keyOf(r)] ?? 'idle'}
            onRequest={request}
          />
        )}

        {/* Downloader (SABnzbd) status: speed / disk / pause-all / speed cap. */}
        <SabPanel />
        {/* What's currently downloading — live from the *arr queues, with controls. */}
        <DownloadsSection />
        {/* Recent requests still waiting for a release. */}
        <RequestedSection />
      </div>

      {qualityItem && (
        <QualityModal item={qualityItem} onClose={() => setQualityItem(null)} />
      )}
    </div>
  )
}

const ROWS: { id: DiscoverSection; title: string; hint: string }[] = [
  { id: 'trending', title: 'Trending this week', hint: 'What people are watching right now.' },
  { id: 'popular', title: 'Popular', hint: 'The most popular movies at the moment.' },
  { id: 'recommended', title: 'Recommended for you', hint: 'Based on the movies already in your library.' },
  { id: 'lists', title: 'From your lists', hint: 'From the lists set up in Radarr.' },
]

/** Radarr's Discover tab, as rows of posters you can request with one tap. */
function DiscoverRows({ movies, loading, failed, stateOf, onRequest }: { movies?: DiscoverMovie[]; loading: boolean; failed: boolean; stateOf: (r: ArrResult) => ItemState; onRequest: (r: ArrResult) => void }) {
  if (loading) return <p className="mb-10 text-sm text-ink-400">Finding movies to discover…</p>
  if (failed) return <p className="mb-10 text-sm text-ink-400">Discover isn’t available right now. You can still search above.</p>
  const rows = ROWS.map((row) => ({ ...row, items: (movies ?? []).filter((m) => m.sections.includes(row.id)).slice(0, 30) })).filter((r) => r.items.length > 0)
  if (rows.length === 0) return null
  return (
    <div className="mb-10 space-y-8">
      {rows.map((row) => (
        <section key={row.id} aria-label={row.title}>
          <h2 className="text-lg font-semibold text-white">{row.title}</h2>
          <p className="mb-3 text-xs text-ink-400">{row.hint}</p>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 no-scrollbar sm:-mx-6 sm:px-6 lg:-mx-12 lg:px-12">
            {row.items.map((m) => (
              <DiscoverCard key={m.tmdbId} m={m} state={stateOf(m)} onRequest={() => onRequest(m)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function DiscoverCard({ m, state, onRequest }: { m: DiscoverMovie; state: ItemState; onRequest: () => void }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className="w-32 shrink-0 sm:w-36">
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-ink-800" title={m.overview}>
        {m.poster && !broken ? (
          <img src={m.poster} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-end p-2.5 text-[13px] font-semibold leading-tight text-white/90"
            style={{ backgroundImage: `linear-gradient(150deg, hsl(${titleHue(m.title)}, 45%, 34%), hsl(${(titleHue(m.title) + 40) % 360}, 50%, 16%))` }}
          >
            {m.title}
          </div>
        )}
      </div>
      <p className="mt-1.5 truncate text-[13px] font-semibold text-white" title={m.title}>
        {m.title}
      </p>
      <p className="text-[11px] text-ink-400">{m.year ?? ''}</p>
      <div className="mt-1.5">
        {m.existing ? (
          <span className="text-xs font-medium text-emerald-300">Already in Finesse</span>
        ) : state === 'requested' ? (
          <span className="text-xs font-medium text-accent-300">Added — searching</span>
        ) : (
          <button
            onClick={onRequest}
            disabled={state === 'adding'}
            className="w-full rounded-full bg-accent-fill px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
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
