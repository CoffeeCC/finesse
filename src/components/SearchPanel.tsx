import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  useArrQueue,
  useGenres,
  useRequestLookup,
  useSearch,
  useSearchPeople,
  useViews,
} from '../api/queries'
import { imageUrl, posterUrl, backdropUrl } from '../api/client'
import { arrAdd, ArrError, type ArrResult } from '../api/arr'
import { playHref } from './MediaCard'
import { useToast } from './Toast'
import { browseHref } from '../pages/BrowsePage'
import { DiceIcon, useSurprise } from '../lib/surprise'
import { IS_TV } from '../lib/device'
import type { JfItem } from '../api/types'

// Universal search: one box for everything. Your library first (a ranked top
// result, then everything else), the people in it, and — for titles you don't
// have — Radarr/Sonarr matches with a one-tap Request, so "not in the library"
// is a next step instead of a dead end (it used to be a separate Request page).

type Scope = 'all' | 'movies' | 'shows' | 'episodes' | 'people'
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'movies', label: 'Movies' },
  { key: 'shows', label: 'Shows' },
  { key: 'episodes', label: 'Episodes' },
  { key: 'people', label: 'People' },
]

const RECENT_KEY = 'finesse.recentSearches'
function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
function pushRecent(term: string) {
  const t = term.trim()
  if (t.length < 2) return
  try {
    const next = [t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, '').trim()

/** Exact title > starts with > a word starts with > contains; films and shows
 *  outrank episodes, so "signal" tops out on the show, not one of its episodes. */
function titleScore(title: string, q: string): number {
  const name = norm(title)
  return name === q ? 100 : name.startsWith(q) ? 60 : name.split(' ').some((w) => w.startsWith(q)) ? 40 : 20
}

function score(item: JfItem, q: string): number {
  return titleScore(item.Name ?? '', q) - (item.Type === 'Episode' ? 15 : 0)
}

function typeLabel(item: JfItem): string {
  if (item.Type === 'Series') return `Series${item.ProductionYear ? ` · ${item.ProductionYear}` : ''}`
  if (item.Type === 'Episode') {
    const code = item.ParentIndexNumber != null && item.IndexNumber != null ? `S${item.ParentIndexNumber}:E${item.IndexNumber}` : 'Episode'
    return `${item.SeriesName ?? 'Episode'} · ${code}`
  }
  return `Movie${item.ProductionYear ? ` · ${item.ProductionYear}` : ''}`
}

function watchState(item: JfItem): string {
  if (item.UserData?.Played) return 'Watched'
  if (item.UserData?.PlaybackPositionTicks) return 'In progress'
  return ''
}

const ROW =
  'flex items-center gap-3.5 rounded-xl px-2.5 py-2 hover:bg-white/5 focus-visible:bg-white/10 outline-none transition-colors'
const SECTION = 'px-2.5 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400'

export default function SearchPanel({
  mode,
  initialQuery = '',
  onClose,
  onQueryChange,
}: {
  mode: 'overlay' | 'page'
  initialQuery?: string
  onClose?: () => void
  /** Page mode: mirror the (debounced) term into the URL. */
  onQueryChange?: (term: string) => void
}) {
  const [input, setInput] = useState(initialQuery)
  const [term, setTerm] = useState(initialQuery)
  const [scope, setScope] = useState<Scope>('all')
  const [recent, setRecent] = useState<string[]>(readRecent)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { surprise, busy } = useSurprise()

  useEffect(() => {
    const t = setTimeout(() => setTerm(input.trim()), 250)
    return () => clearTimeout(t)
  }, [input])
  useEffect(() => {
    onQueryChange?.(term)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term])

  // TV: don't pop the on-screen keyboard over the page on arrival.
  useEffect(() => {
    if (!IS_TV && (mode === 'overlay' || !initialQuery)) inputRef.current?.focus()
  }, [mode, initialQuery])

  const active = term.length > 1
  const lib = useSearch(active ? term : '')
  const people = useSearchPeople(active && (scope === 'all' || scope === 'people') ? term : '')
  const request = useRequestLookup(active && scope !== 'people' && scope !== 'episodes' ? term : '')

  const ranked = useMemo(() => {
    const q = norm(term)
    const items = (lib.data?.Items ?? []).filter((i) =>
      scope === 'movies' ? i.Type === 'Movie' : scope === 'shows' ? i.Type === 'Series' : scope === 'episodes' ? i.Type === 'Episode' : scope !== 'people',
    )
    return items
      .map((item, i) => ({ item, s: score(item, q), i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.item)
  }, [lib.data, term, scope])

  // "Not in your library": drop anything the library search already found
  // (a title Radarr doesn't track still shows up in Jellyfin). Ranked like the
  // library, so the show someone typed exactly isn't below a loose movie match.
  const missing = useMemo(() => {
    const q = norm(term)
    const have = new Set((lib.data?.Items ?? []).map((i) => `${norm(i.Name ?? '')}|${i.ProductionYear ?? ''}`))
    return (request.data ?? [])
      .filter((r) => !(r.id > 0 && r.hasFile))
      .filter((r) => !have.has(`${norm(r.title)}|${r.year ?? ''}`))
      .filter((r) => (scope === 'movies' ? r.kind === 'movie' : scope === 'shows' ? r.kind === 'series' : true))
      .map((r, i) => ({ r, s: titleScore(r.title, q), i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.r)
      .slice(0, 6)
  }, [request.data, lib.data, scope, term])

  const top = scope !== 'people' ? ranked[0] : undefined
  const rest = scope !== 'people' ? ranked.slice(1, scope === 'all' ? 9 : 30) : []
  const peopleList = people.data?.Items.slice(0, scope === 'people' ? 24 : 6) ?? []

  const remember = () => {
    pushRecent(term)
    setRecent(readRecent())
  }
  const opened = () => {
    remember()
    onClose?.()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      const first = resultsRef.current?.querySelector<HTMLElement>('[data-result]')
      if (first) {
        e.preventDefault()
        first.focus()
      }
    } else if (e.key === 'Enter' && top) {
      e.preventDefault()
      opened()
      navigate(`/item/${top.Id}`)
    }
  }

  const nothing = active && !lib.isLoading && ranked.length === 0 && peopleList.length === 0 && missing.length === 0

  return (
    <div className={mode === 'overlay' ? 'flex flex-col max-h-[calc(var(--vh)*84)]' : ''}>
      <div className={`flex items-center gap-3 ${mode === 'overlay' ? 'h-16 px-5 border-b border-white/10 focus-within:border-accent-400/60' : 'h-12 px-4 rounded-xl bg-ink-900 border border-white/10 focus-within:border-accent-400 max-w-2xl'}`}>
        <svg className="h-5 w-5 shrink-0 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
        </svg>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          type="search"
          enterKeyHint="search"
          aria-label="Search your library"
          placeholder="Titles, people, genres"
          className={`search-field flex-1 min-w-0 bg-transparent outline-none placeholder:text-ink-400 text-white ${mode === 'overlay' ? 'text-xl' : 'text-base'}`}
        />
        {input && (
          <button
            type="button"
            onClick={() => {
              setInput('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="h-8 w-8 shrink-0 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-ink-200"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {mode === 'overlay' && (
          <kbd className="hidden sm:flex h-6 px-2 items-center rounded border border-white/15 text-[11px] font-sans text-ink-400">Esc</kbd>
        )}
      </div>

      {active && (
        <div role="tablist" aria-label="Filter results" className={`flex gap-1.5 overflow-x-auto no-scrollbar ${mode === 'overlay' ? 'px-5 py-3 border-b border-white/10' : 'pt-4'}`}>
          {SCOPES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={scope === s.key}
              onClick={() => setScope(s.key)}
              className={`shrink-0 h-8 px-3.5 rounded-full text-sm transition-colors ${
                scope === s.key ? 'bg-white text-ink-950 font-semibold' : 'border border-white/10 text-ink-200 hover:text-white font-medium'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div ref={resultsRef} className={mode === 'overlay' ? 'overflow-y-auto px-2.5 pb-4' : 'pt-2'}>
        {!active ? (
          <EmptyState
            recent={recent}
            onPick={(t) => setInput(t)}
            onClear={() => {
              try {
                localStorage.removeItem(RECENT_KEY)
              } catch {
                /* ignore */
              }
              setRecent([])
            }}
            onSurprise={() => {
              onClose?.()
              surprise({ includeItemTypes: 'Movie,Series' })
            }}
            surprising={busy}
            onNavigate={onClose}
          />
        ) : (
          <>
            {lib.isLoading && <p className="px-2.5 py-6 text-sm text-ink-400">Searching…</p>}
            {nothing && (
              <p className="px-2.5 py-6 text-sm text-ink-300">
                Nothing matches “{term}”. Check the spelling, or try a person or genre.
              </p>
            )}

            {top && <TopResult item={top} onOpen={opened} />}

            {rest.length > 0 && (
              <>
                <p className={SECTION}>{top ? 'More in your library' : 'In your library'}</p>
                {rest.map((item) => (
                  <Link key={item.Id} to={`/item/${item.Id}`} onClick={opened} data-result className={ROW}>
                    <Thumb item={item} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold text-white truncate">{item.Name}</span>
                      <span className="block text-[13px] text-ink-400 truncate">{typeLabel(item)}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-400">{watchState(item)}</span>
                  </Link>
                ))}
              </>
            )}

            {peopleList.length > 0 && (
              <>
                <p className={SECTION}>People</p>
                <div className="flex flex-wrap gap-2 px-2.5 pb-1">
                  {peopleList.map((p) => (
                    <Link
                      key={p.Id}
                      to={`/person/${p.Id}`}
                      onClick={opened}
                      data-result
                      className="inline-flex items-center gap-2.5 h-10 pl-1 pr-3.5 rounded-full bg-white/5 hover:bg-white/10 focus-visible:bg-white/15 outline-none transition-colors"
                    >
                      <span className="h-8 w-8 rounded-full overflow-hidden bg-ink-700 flex items-center justify-center text-xs font-semibold text-white">
                        {p.ImageTags?.Primary ? (
                          <img src={imageUrl(p.Id, 'Primary', { maxWidth: 80, tag: p.ImageTags.Primary })} alt="" className="h-full w-full object-cover" />
                        ) : (
                          p.Name?.split(' ').map((w) => w[0]).slice(0, 2).join('')
                        )}
                      </span>
                      <span className="text-sm text-white">{p.Name}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            {missing.length > 0 && (
              <>
                <p className={SECTION}>Not in your library</p>
                {missing.map((r) => (
                  <MissingRow key={`${r.kind}:${r.tmdbId ?? r.tvdbId ?? r.title}`} r={r} />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {mode === 'overlay' && (
        <div className="hidden sm:flex items-center gap-5 h-11 px-5 border-t border-white/10 bg-black/20 text-xs text-ink-400">
          <span><b className="font-semibold text-ink-200">↑ ↓</b> move</span>
          <span><b className="font-semibold text-ink-200">Enter</b> open top result</span>
          <span><b className="font-semibold text-ink-200">Esc</b> close</span>
        </div>
      )}
    </div>
  )
}

function Thumb({ item }: { item: JfItem }) {
  const src = item.Type === 'Episode' ? posterUrl(item, 100) : posterUrl(item, 100)
  return (
    <span className="h-14 w-10 shrink-0 rounded-md overflow-hidden bg-ink-800">
      {src && <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />}
    </span>
  )
}

function TopResult({ item, onOpen }: { item: JfItem; onOpen: () => void }) {
  const art = backdropUrl(item, 640) ?? posterUrl(item, 300)
  const playable = item.Type === 'Movie' || item.Type === 'Episode'
  const resuming = !!item.UserData?.PlaybackPositionTicks && !item.UserData.Played
  return (
    <>
      <p className={SECTION}>Top result</p>
      <div className="flex items-center gap-4 rounded-2xl bg-white/[0.06] ring-1 ring-white/10 p-3">
        <Link to={`/item/${item.Id}`} onClick={onOpen} data-result className="shrink-0 w-36 sm:w-48 aspect-video rounded-xl overflow-hidden bg-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
          {art && <img src={art} alt="" className="h-full w-full object-cover" />}
        </Link>
        <div className="flex-1 min-w-0">
          <p className="font-display text-2xl sm:text-3xl leading-tight text-white truncate">{item.Name}</p>
          <p className="text-sm text-ink-300 truncate">{typeLabel(item)}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {playable && (
              <Link
                to={playHref(item)}
                onClick={onOpen}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                {resuming ? 'Resume' : 'Play'}
              </Link>
            )}
            <Link
              to={`/item/${item.Id}`}
              onClick={onOpen}
              className="inline-flex h-9 items-center rounded-lg bg-white/10 border border-white/15 px-3.5 text-sm font-semibold text-white hover:bg-white/15 transition-colors"
            >
              {item.Type === 'Series' ? 'Open series' : 'Details'}
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}

function MissingRow({ r }: { r: ArrResult }) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data: queue } = useArrQueue()
  const [state, setState] = useState<'idle' | 'adding' | 'requested'>(r.id > 0 ? 'requested' : 'idle')
  const dl = r.id > 0 ? queue?.find((q) => q.kind === r.kind && q.refId === r.id) : undefined

  const request = async () => {
    setState('adding')
    try {
      await arrAdd(r)
      setState('requested')
      toast(`Requested “${r.title}”. It'll appear in My List while it downloads.`)
      qc.invalidateQueries({ queryKey: ['arrQueue'] })
    } catch (e) {
      setState('idle')
      toast(e instanceof ArrError && e.status === 401 ? 'Sign in again to request' : `Couldn't request “${r.title}”`, 'error')
    }
  }

  return (
    <div className="flex items-center gap-3.5 rounded-xl px-2.5 py-2">
      <span className="h-14 w-10 shrink-0 rounded-md overflow-hidden bg-ink-800 ring-1 ring-white/15">
        {r.poster && <img src={r.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-80" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-white truncate">{r.title}</span>
        <span className="block text-[13px] text-ink-400 truncate">
          {r.kind === 'movie' ? 'Movie' : 'Series'}
          {r.year ? ` · ${r.year}` : ''}
        </span>
      </span>
      {dl ? (
        <span className="shrink-0 rounded-md bg-amber-400/15 px-2 py-1 text-xs font-semibold text-amber-200">
          {dl.done ? dl.status : `Downloading ${dl.progress}%`}
        </span>
      ) : state === 'requested' ? (
        <span className="shrink-0 text-xs font-semibold text-accent-300">Requested</span>
      ) : (
        <button
          type="button"
          onClick={request}
          disabled={state === 'adding'}
          data-result
          className="shrink-0 h-9 rounded-lg bg-accent-fill hover:brightness-110 px-3.5 text-sm font-semibold text-white disabled:opacity-60 transition"
        >
          {state === 'adding' ? 'Requesting…' : 'Request'}
        </button>
      )}
    </div>
  )
}

function EmptyState({
  recent,
  onPick,
  onClear,
  onSurprise,
  surprising,
  onNavigate,
}: {
  recent: string[]
  onPick: (t: string) => void
  onClear: () => void
  onSurprise: () => void
  surprising: boolean
  onNavigate?: () => void
}) {
  const { data: views } = useViews()
  const movieLib = views?.Items.find((v) => v.CollectionType === 'movies')
  const { data: genres } = useGenres(movieLib?.Id)
  const names = (genres?.Items ?? []).map((g) => g.Name).slice(0, 12)
  const hue = (g: string) => [...g].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

  return (
    <div className="pt-2">
      {recent.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className={SECTION}>Recent</p>
            <button type="button" onClick={onClear} className="px-2.5 pt-3 text-xs font-semibold text-accent-300 hover:text-white">
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2 px-2.5">
            {recent.map((t) => (
              <button
                key={t}
                type="button"
                data-result
                onClick={() => onPick(t)}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm text-ink-200 hover:text-white hover:bg-white/10 transition-colors"
              >
                <svg className="h-3.5 w-3.5 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                {t}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="px-2.5 pt-4">
        <button
          type="button"
          onClick={onSurprise}
          disabled={surprising}
          data-result
          className="w-full sm:w-auto inline-flex h-11 items-center justify-center gap-2.5 rounded-xl bg-white/[0.07] border border-white/15 px-5 text-[15px] font-semibold text-white hover:bg-white/10 disabled:opacity-60 transition-colors"
        >
          <DiceIcon className="h-5 w-5" spinning={surprising} />
          Surprise me
        </button>
      </div>

      {names.length > 0 && (
        <>
          <p className={SECTION}>Browse by genre</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 px-2.5">
            {names.map((g) => (
              <Link
                key={g}
                to={browseHref(g, { includeItemTypes: 'Movie,Series', genres: g, sortBy: 'SortName' })}
                onClick={onNavigate}
                data-result
                className="relative h-16 sm:h-[4.5rem] rounded-xl overflow-hidden flex items-end px-3 pb-2 outline-none ring-1 ring-white/5 hover:ring-white/20 focus-visible:ring-2 focus-visible:ring-accent-400 transition-all"
                style={{ background: `hsl(${hue(g)}, 32%, 26%)` }}
              >
                <span aria-hidden className="absolute -right-5 -top-6 h-16 w-16 rounded-full" style={{ background: `hsla(${(hue(g) + 170) % 360}, 45%, 66%, 0.3)` }} />
                <span className="relative font-display text-xl leading-none text-white">{g}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      <p className="px-2.5 pt-5 text-[13px] text-ink-400">
        Can't find something? Search for it, and titles you don't have yet show up with a <span className="text-white font-semibold">Request</span> button.
      </p>
    </div>
  )
}
