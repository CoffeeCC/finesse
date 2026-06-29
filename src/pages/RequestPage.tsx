import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { arrAdd, arrLookup, ArrError, type ArrKind, type ArrResult } from '../api/arr'
import { useArrQueue } from '../api/queries'
import DownloadsSection from '../components/DownloadsSection'
import { useToast } from '../components/Toast'

type ItemState = 'idle' | 'adding' | 'requested'

export default function RequestPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const term = searchParams.get('q') ?? ''
  const kind = (searchParams.get('kind') as ArrKind) === 'series' ? 'series' : 'movie'
  const [input, setInput] = useState(term)
  const toast = useToast()
  // Per-result override so a freshly-requested item flips state immediately.
  const [overrides, setOverrides] = useState<Record<string, ItemState>>({})

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

  const keyOf = (r: ArrResult) => `${r.kind}:${r.tmdbId ?? r.tvdbId ?? r.title}`

  const request = async (r: ArrResult) => {
    const k = keyOf(r)
    setOverrides((o) => ({ ...o, [k]: 'adding' }))
    try {
      await arrAdd(r)
      setOverrides((o) => ({ ...o, [k]: 'requested' }))
      toast(`Requested “${r.title}” — searching now`)
    } catch (e) {
      setOverrides((o) => ({ ...o, [k]: 'idle' }))
      const msg =
        e instanceof ArrError && e.status === 401
          ? 'Sign in again to request'
          : `Couldn’t request “${r.title}”`
      toast(msg, 'error')
    }
  }

  const authError = isError && error instanceof ArrError && error.status === 401

  return (
    <div className="pb-16">
      <div className="px-4 sm:px-6 lg:px-12 py-6">
        <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Request</h1>
        <p className="text-sm text-ink-400 mb-4">
          Can’t find something? Search for it and add it to the library.
        </p>

        <div className="flex items-center gap-2 mb-4">
          <div className="inline-flex rounded-full bg-ink-800/80 border border-white/10 p-1">
            {(['movie', 'series'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  kind === k ? 'bg-accent-600 text-white' : 'text-ink-300 hover:text-white'
                }`}
              >
                {k === 'movie' ? 'Movies' : 'Shows'}
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
            placeholder={kind === 'movie' ? 'Search for a movie…' : 'Search for a show…'}
            autoFocus={!term}
            className="w-full rounded-full bg-ink-800/80 border border-white/10 pl-11 pr-4 py-2.5 text-sm outline-none focus:border-accent-500 placeholder:text-ink-400"
          />
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-12">
        {/* What's currently downloading — live from the Radarr/Sonarr queue. */}
        <DownloadsSection />

        {authError && (
          <p className="text-red-300">Your session expired — sign out and back in to request.</p>
        )}
        {isError && !authError && (
          <p className="text-red-300">Couldn’t reach the request service. Try again in a moment.</p>
        )}
        {isLoading && <p className="text-ink-400">Searching…</p>}
        {!isLoading && !isError && data && data.length === 0 && term.trim().length > 1 && (
          <p className="text-ink-400">No matches for “{term}”.</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data?.map((r) => {
            const state: ItemState = overrides[keyOf(r)] ?? (r.id > 0 ? 'requested' : 'idle')
            const inLibrary = r.id > 0 && r.hasFile
            const dl = r.id > 0 ? queueByRef.get(`${r.kind}-${r.id}`) : undefined
            return (
              <div
                key={keyOf(r)}
                className="flex gap-4 rounded-2xl bg-ink-900/60 border border-white/5 p-3"
              >
                <div className="w-20 h-30 shrink-0 rounded-lg overflow-hidden bg-ink-800 aspect-[2/3]">
                  {r.poster && (
                    <img src={r.poster} alt="" loading="lazy" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  )}
                </div>
                <div className="min-w-0 flex-1 flex flex-col">
                  <p className="text-sm font-semibold text-white leading-tight">
                    {r.title}
                    {r.year ? <span className="text-ink-400 font-normal"> ({r.year})</span> : null}
                  </p>
                  <p className="mt-1 text-xs text-ink-400 line-clamp-3">{r.overview}</p>
                  <div className="mt-auto pt-2">
                    {inLibrary ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        In library
                      </span>
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
                        Requested
                      </span>
                    ) : (
                      <button
                        onClick={() => request(r)}
                        disabled={state === 'adding'}
                        className="inline-flex items-center gap-1.5 rounded-full bg-accent-600 hover:bg-accent-500 disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
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
      </div>
    </div>
  )
}
