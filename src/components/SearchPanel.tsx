import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  noteRequested,
  useGenres,
  useRequestLookup,
  useFriendSearch,
  useMusicSearch,
  useSearch,
  useSearchPeople,
  useViews,
} from '../api/queries'
import { imageUrl, posterUrl, backdropUrl } from '../api/client'
import { arrAdd, ArrError, type ArrResult } from '../api/arr'
import { playChoice } from '../lib/playChoice'
import { useMyLimits } from '../api/parental'
import { mergeSources, type MergedTitle, type TitleSource } from '../lib/discovery'
import { RestartIcon } from './ActionButton'
import { RequestStatusView, useRequestStatus } from './RequestStatus'
import { useToast } from './Toast'
import { browseHref } from '../pages/BrowsePage'
import { DiceIcon, useSurprise } from '../lib/surprise'
import { IS_TV } from '../lib/device'
import { artistOf, trackArt } from '../lib/music'
import { usePlayTrack } from '../lib/playAlbum'
import { useAudio } from '../audio/AudioPlayerContext'
import { formatRuntime, type JfItem } from '../api/types'
import { prefetchItem, prefetchPlayer, prefetchRoute } from '../lib/prefetch'
import { useOptionalLibraries } from './NavBar'

// Universal search: one command palette for everything. A spotlight Top Result,
// then one merged list of titles (your library first, friends' servers, then
// requestable titles via Radarr/Sonarr), followed by albums, songs, and people.

type Scope = 'all' | 'movies' | 'shows' | 'episodes' | 'music' | 'people'
type Where = 'all' | 'library' | 'friends' | 'request'
type Title = MergedTitle<JfItem, ArrResult>
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'movies', label: 'Movies' },
  { key: 'shows', label: 'Shows' },
  { key: 'episodes', label: 'Episodes' },
  { key: 'music', label: 'Music' },
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
function saveRecent(list: string[]) {
  try {
    if (list.length) localStorage.setItem(RECENT_KEY, JSON.stringify(list))
    else localStorage.removeItem(RECENT_KEY)
  } catch {
    /* private mode */
  }
}
function pushRecent(term: string) {
  const t = term.trim()
  if (t.length < 2) return
  saveRecent([t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6))
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
  if (item.Type === 'MusicAlbum') return ['Album', item.AlbumArtist, item.ProductionYear].filter(Boolean).join(' · ')
  if (item.Type === 'Audio') return ['Song', artistOf(item), item.Album].filter(Boolean).join(' · ')
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
  'flex items-center gap-3.5 rounded-xl px-2.5 py-2 hover:bg-white/[0.06] focus-visible:bg-white/[0.1] focus-visible:ring-1 focus-visible:ring-accent-400/70 outline-none transition-colors'
const SECTION = 'px-2.5 pt-4 pb-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-400'

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
  const [term, setTerm] = useState(initialQuery.trim())
  const [scope, setScope] = useState<Scope>('all')
  const [where, setWhere] = useState<Where>('all')
  const [recent, setRecent] = useState<string[]>(readRecent)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const lastEmittedRef = useRef(initialQuery.trim())
  const navigate = useNavigate()
  const { surprise, busy } = useSurprise()
  const { data: views } = useViews()
  const hasMusic = !!views?.Items.some((v) => v.CollectionType === 'music')
  const scopes = hasMusic ? SCOPES : SCOPES.filter((s) => s.key !== 'music')

  // Sync external initialQuery changes (e.g. URL navigation or reopening overlay with a query),
  // without clobbering mid-keystroke input when onQueryChange echoes back our own term.
  useEffect(() => {
    const trimmed = initialQuery.trim()
    if (trimmed !== lastEmittedRef.current) {
      lastEmittedRef.current = trimmed
      setInput(initialQuery)
      setTerm(trimmed)
    }
  }, [initialQuery])

  useEffect(() => {
    const t = setTimeout(() => setTerm(input.trim()), 200)
    return () => clearTimeout(t)
  }, [input])
  // A new search starts from every source again.
  useEffect(() => setWhere('all'), [term])
  useEffect(() => {
    lastEmittedRef.current = term
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
  const friendSearch = useFriendSearch(active && (scope === 'all' || scope === 'movies' || scope === 'shows') ? term : '')
  const friendHits = useMemo(
    () => friendSearch.hits.filter(({ item }) => (scope === 'movies' ? item.Type === 'Movie' : scope === 'shows' ? item.Type === 'Series' : true)),
    [friendSearch.hits, scope],
  )
  // A limited profile without requests (parental limits) isn't offered titles to request.
  const limits = useMyLimits()
  const canRequest = !limits || limits.requests
  const request = useRequestLookup(canRequest && active && scope !== 'people' && scope !== 'episodes' && scope !== 'music' ? term : '')
  const music = useMusicSearch(active && hasMusic && (scope === 'all' || scope === 'music') ? term : '')

  const ranked = useMemo(() => {
    const q = norm(term)
    const items = (lib.data?.Items ?? []).filter((i) =>
      scope === 'movies'
        ? i.Type === 'Movie'
        : scope === 'shows'
          ? i.Type === 'Series'
          : scope === 'episodes'
            ? i.Type === 'Episode'
            : scope !== 'people' && scope !== 'music',
    )
    return items
      .map((item, i) => ({ item, s: score(item, q), i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.item)
  }, [lib.data, term, scope])

  // Requestable titles (Radarr/Sonarr), ranked like the library so the show someone typed
  // exactly isn't below a loose movie match. mergeSources drops the ones the library has.
  const requestable = useMemo(() => {
    const q = norm(term)
    return (request.data ?? [])
      .filter((r) => (scope === 'movies' ? r.kind === 'movie' : scope === 'shows' ? r.kind === 'series' : true))
      .map((r, i) => ({ r, s: titleScore(r.title, q), i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.r)
  }, [request.data, scope, term])

  const top = scope !== 'people' ? ranked[0] : undefined
  const showTop = Boolean(top) && (where === 'all' || where === 'library')
  const rest = useMemo(() => new Set(scope !== 'people' ? ranked.slice(1, scope === 'all' ? 9 : 30) : []), [ranked, scope])
  const merged = useMemo(() => (scope === 'people' || scope === 'music' ? [] : mergeSources(ranked, friendHits, requestable)), [ranked, friendHits, requestable, scope])
  const topAlso = useMemo(() => (top ? merged.find((t) => t.key === top.Id)?.sources.slice(1) ?? [] : []), [merged, top])
  const listed = useMemo(() => merged.filter((t) => (t.sources[0]!.source === 'library' ? rest.has((t.sources[0] as { item: JfItem }).item) : true)), [merged, rest])
  const kinds = useMemo(() => {
    const s = new Set(listed.flatMap((t) => t.sources.map((x) => x.source)))
    if (top) s.add('library')
    return s
  }, [listed, top])
  const titles = useMemo(
    () =>
      listed.filter((t) =>
        where === 'all'
          ? true
          : where === 'library'
            ? t.sources.some((s) => s.source === 'library')
            : where === 'friends'
              ? t.sources.some((s) => s.source === 'friend')
              : t.sources[0]!.source === 'request' || (t.sources.some((s) => s.source === 'request') && !t.sources.some((s) => s.source === 'library')),
      ),
    [listed, where],
  )
  const missing = useMemo(() => listed.filter((t) => t.sources[0]!.source !== 'library'), [listed])
  const peopleList = people.data?.Items.slice(0, scope === 'people' ? 24 : 6) ?? []

  const { albums, songs } = useMemo(() => {
    const q = norm(term)
    const rank = (list: JfItem[]) =>
      list
        .map((item, i) => ({ item, s: titleScore(item.Name ?? '', q), i }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((x) => x.item)
    const all = music.data?.albums ?? []
    const named = all.filter((a) => norm(a.Name ?? '').includes(q))
    const byArtist = all.filter((a) => !norm(a.Name ?? '').includes(q))
    const wide = scope === 'music'
    return {
      albums: [...rank(named), ...byArtist].slice(0, wide ? 24 : 6),
      songs: rank(music.data?.songs ?? []).slice(0, wide ? 30 : 6),
    }
  }, [music.data, term, scope])

  const termRef = useRef(term)
  termRef.current = term
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const opened = useCallback(() => {
    pushRecent(termRef.current)
    setRecent(readRecent())
    onCloseRef.current?.()
  }, [])

  const stepFocus = useCallback((dir: 1 | -1) => {
    const nodes = Array.from(resultsRef.current?.querySelectorAll<HTMLElement>('[data-result]:not([disabled])') ?? [])
    if (!nodes.length) return false
    const idx = nodes.indexOf(document.activeElement as HTMLElement)
    if (idx === -1) {
      if (dir === 1) {
        nodes[0]!.focus()
        nodes[0]!.scrollIntoView({ block: 'nearest' })
        return true
      }
      return false
    }
    const next = idx + dir
    if (next < 0) {
      inputRef.current?.focus()
      return true
    }
    if (next < nodes.length) {
      nodes[next]!.focus()
      nodes[next]!.scrollIntoView({ block: 'nearest' })
      return true
    }
    return false
  }, [])

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (stepFocus(1)) e.preventDefault()
    } else if (e.key === 'Enter') {
      const trimmed = input.trim()
      if (trimmed !== term) {
        e.preventDefault()
        setTerm(trimmed)
        return
      }
      if (showTop && top) {
        e.preventDefault()
        opened()
        navigate(`/item/${top.Id}`)
      } else if (titles[0]?.sources[0]?.source === 'library' || titles[0]?.sources[0]?.source === 'friend') {
        e.preventDefault()
        opened()
        navigate(`/item/${titles[0].sources[0].item.Id}`)
      } else if (albums[0]) {
        e.preventDefault()
        opened()
        navigate(`/album/${albums[0].Id}`)
      } else if (peopleList[0]) {
        e.preventDefault()
        opened()
        navigate(`/person/${peopleList[0].Id}`)
      } else if (stepFocus(1)) {
        e.preventDefault()
      }
    }
  }

  const onResultsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      if (stepFocus(1)) e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      if (stepFocus(-1)) e.preventDefault()
    } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      inputRef.current?.focus()
    }
  }

  const removeRecent = (item: string) => {
    const next = recent.filter((x) => x !== item)
    saveRecent(next)
    setRecent(next)
  }

  const searching =
    active &&
    (scope === 'music'
      ? music.isLoading
      : scope === 'people'
        ? people.isLoading
        : scope === 'episodes'
          ? lib.isLoading
          : scope === 'movies' || scope === 'shows'
            ? lib.isLoading || request.isLoading
            : lib.isLoading || people.isLoading || request.isLoading || (hasMusic && music.isLoading))
  const fetching = active && (lib.isFetching || music.isFetching || request.isFetching || people.isFetching)
  const hasAny =
    ranked.length > 0 ||
    peopleList.length > 0 ||
    missing.length > 0 ||
    albums.length > 0 ||
    songs.length > 0
  const nothing = active && !searching && !hasAny

  return (
    <div className={mode === 'overlay' ? 'flex min-h-0 flex-col' : ''}>
      {/* Search bar */}
      <div
        className={`group/bar flex items-center gap-3 transition-colors ${
          mode === 'overlay'
            ? 'h-16 px-4 sm:px-5 border-b border-white/[0.08] bg-white/[0.02] focus-within:border-accent-400/50'
            : 'h-12 px-5 rounded-full bg-white/[0.06] border border-white/10 focus-within:border-accent-400/60 max-w-2xl'
        }`}
      >
        <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          {fetching ? (
            <span className="h-4 w-4 rounded-full border-2 border-white/15 border-t-accent-400 animate-spin" aria-label="Searching" />
          ) : (
            <svg className="h-5 w-5 text-ink-400 transition-colors group-focus-within/bar:text-accent-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
            </svg>
          )}
        </div>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKeyDown}
          type="search"
          enterKeyHint="search"
          aria-label="Search your library"
          placeholder={hasMusic ? 'Search movies, shows, people, music…' : 'Search movies, shows, people, genres…'}
          className={`search-field flex-1 min-w-0 bg-transparent outline-none placeholder:text-ink-400/80 text-white ${mode === 'overlay' ? 'text-lg sm:text-xl font-medium tracking-[-0.01em]' : 'text-base'}`}
        />
        {input && (
          <button
            type="button"
            onClick={() => {
              setInput('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="h-8 w-8 shrink-0 rounded-full bg-white/[0.07] hover:bg-white/15 active:scale-90 flex items-center justify-center text-ink-200 hover:text-white transition"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {mode === 'overlay' && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            title="Close (Esc)"
            className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-2.5 text-[11.5px] font-medium text-ink-300 hover:border-white/25 hover:bg-white/10 hover:text-white active:scale-95 transition"
          >
            <span className="hidden sm:inline font-mono">Esc</span>
            <svg className="h-3.5 w-3.5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Scope pills */}
      {active && (
        <div role="tablist" aria-label="Filter results" className={`flex items-center gap-1.5 overflow-x-auto no-scrollbar ${mode === 'overlay' ? 'px-4 sm:px-5 py-2.5 border-b border-white/[0.07] bg-white/[0.015]' : 'pt-4'}`}>
          {scopes.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={scope === s.key}
              onClick={() => setScope(s.key)}
              className={`shrink-0 h-8 px-3.5 rounded-full text-[13px] transition active:scale-[0.97] ${
                scope === s.key
                  ? 'bg-white text-ink-950 font-semibold shadow-sm'
                  : 'border border-white/10 bg-white/[0.03] text-ink-200 hover:bg-white/[0.08] hover:text-white font-medium'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Results body */}
      <div
        ref={resultsRef}
        onKeyDown={onResultsKeyDown}
        className={mode === 'overlay' ? 'os-scroll min-h-0 flex-1 overflow-y-auto px-2.5 sm:px-3.5 pb-4 pt-1' : 'pt-2'}
      >
        {!active ? (
          <EmptyState
            recent={recent}
            onPick={(t) => setInput(t)}
            onRemoveRecent={removeRecent}
            onClear={() => {
              saveRecent([])
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
            {searching && !hasAny && <SearchSkeleton />}
            {nothing && (
              <div className="px-3 py-10 text-center">
                <p className="font-display text-2xl text-white">Nothing matches “{term}”</p>
                <p className="mt-1.5 text-sm text-ink-400">
                  Check the spelling, try a shorter word, or switch tabs above.
                </p>
              </div>
            )}

            {showTop && top && <TopResult item={top} also={topAlso} onOpen={opened} />}

            {friendSearch.failed.length > 0 && (
              <p className="mx-2.5 mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12.5px] text-amber-200">
                Couldn’t reach {friendSearch.failed.join(', ')} just now, so {friendSearch.failed.length === 1 ? 'its' : 'their'} titles aren’t here.
              </p>
            )}

            {(listed.length > 0 || (top && kinds.size > 1)) && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={SECTION}>{showTop ? 'More titles' : 'Titles'}</p>
                  {kinds.size > 1 && (
                    <div role="radiogroup" aria-label="Where" className="flex flex-wrap gap-1.5 px-2.5 pt-3">
                      {(
                        [
                          ['all', 'Everywhere'],
                          ['library', 'Yours'],
                          ['friends', 'Friends’'],
                          ['request', 'To request'],
                        ] as [Where, string][]
                      )
                        .filter(([k]) => k === 'all' || kinds.has(k === 'library' ? 'library' : k === 'friends' ? 'friend' : 'request'))
                        .map(([k, label]) => (
                          <button
                            key={k}
                            type="button"
                            role="radio"
                            aria-checked={where === k}
                            onClick={() => setWhere(k)}
                            className={`h-7 rounded-full px-3 text-[12px] transition active:scale-[0.97] ${
                              where === k ? 'bg-white font-semibold text-ink-950' : 'border border-white/10 text-ink-300 hover:bg-white/[0.06] hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                {titles.length === 0 && (
                  <p className="px-2.5 py-2 text-[13px] text-ink-400">
                    {showTop ? 'No other titles match this filter.' : 'None of these titles are there. Choose Everywhere to see them all.'}
                  </p>
                )}
                <div className="space-y-0.5">
                  {titles.map((t) => (
                    <TitleRow key={t.key} t={t} onOpen={opened} />
                  ))}
                </div>
              </>
            )}

            {albums.length > 0 && (
              <>
                <p className={SECTION}>Albums</p>
                <div className="space-y-0.5">
                  {albums.map((album) => (
                    <Link
                      key={album.Id}
                      to={`/album/${album.Id}`}
                      onClick={opened}
                      onMouseEnter={() => prefetchRoute(`/album/${album.Id}`)}
                      data-result
                      className={ROW}
                    >
                      <SquareThumb src={posterUrl(album, 100)} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-semibold text-white truncate">{album.Name}</span>
                        <span className="block text-[13px] text-ink-400 truncate">{typeLabel(album)}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            {songs.length > 0 && (
              <>
                <p className={SECTION}>Songs</p>
                <div className="space-y-0.5">
                  {songs.map((song) => (
                    <SongRow key={song.Id} song={song} onPlay={opened} />
                  ))}
                </div>
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
                      onMouseEnter={() => prefetchRoute(`/person/${p.Id}`)}
                      data-result
                      className="inline-flex items-center gap-2.5 h-10 pl-1 pr-3.5 rounded-full border border-white/[0.08] bg-white/[0.04] hover:bg-white/10 focus-visible:bg-white/15 focus-visible:ring-1 focus-visible:ring-accent-400/70 outline-none transition"
                    >
                      <span className="h-8 w-8 rounded-full overflow-hidden bg-ink-700 flex items-center justify-center text-xs font-semibold text-white">
                        {p.ImageTags?.Primary ? (
                          <img decoding="async" src={imageUrl(p.Id, 'Primary', { maxWidth: 80, tag: p.ImageTags.Primary })} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          p.Name?.split(' ').map((w) => w[0]).slice(0, 2).join('')
                        )}
                      </span>
                      <span className="text-sm font-medium text-white">{p.Name}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Command-palette keyboard legend */}
      {mode === 'overlay' && (
        <div className="hidden sm:flex items-center justify-between gap-4 h-11 px-5 border-t border-white/[0.08] bg-black/25 text-xs text-ink-400">
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-white/15 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] text-ink-200">↑↓</kbd>
              Navigate
            </span>
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded border border-white/15 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] text-ink-200">↵</kbd>
              Open
            </span>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 text-ink-400 hover:text-white transition-colors"
            >
              <kbd className="rounded border border-white/15 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] text-ink-200">Esc</kbd>
              Close
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function SearchSkeleton() {
  return (
    <div className="space-y-2 px-2.5 py-3" aria-busy="true" aria-label="Searching">
      <div className="h-28 rounded-2xl shimmer" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3.5 py-1.5">
          <div className="h-14 w-10 shrink-0 rounded-md shimmer" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-48 rounded shimmer" />
            <div className="h-3 w-32 rounded shimmer" />
          </div>
        </div>
      ))}
    </div>
  )
}

function Thumb({ item }: { item: JfItem }) {
  const src = posterUrl(item, 100)
  return (
    <span className="h-14 w-10 shrink-0 rounded-md overflow-hidden bg-ink-800 ring-1 ring-white/10">
      {src && <img decoding="async" src={src} alt="" loading="lazy" className="h-full w-full object-cover" />}
    </span>
  )
}

function SquareThumb({ src }: { src: string | null | undefined }) {
  return (
    <span className="h-12 w-12 shrink-0 rounded-md overflow-hidden bg-ink-800 ring-1 ring-white/10">
      {src && <img decoding="async" src={src} alt="" loading="lazy" className="h-full w-full object-cover" />}
    </span>
  )
}

/** A song: pressing it plays its album from this song on. */
const SongRow = memo(function SongRow({ song, onPlay }: { song: JfItem; onPlay: () => void }) {
  const playTrack = usePlayTrack()
  const { current } = useAudio()
  const isCurrent = current?.Id === song.Id
  return (
    <button
      type="button"
      data-result
      onClick={() => {
        void playTrack(song)
        onPlay()
      }}
      aria-label={`Play ${song.Name}`}
      className={`${ROW} w-full text-left`}
    >
      <SquareThumb src={trackArt(song, 100)} />
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-white truncate">{song.Name}</span>
        <span className="block text-[13px] text-ink-400 truncate">{typeLabel(song)}</span>
      </span>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${isCurrent ? 'bg-accent-400/20 text-accent-300' : 'text-ink-400'}`}>
        {isCurrent ? 'Playing' : 'Play'}
      </span>
    </button>
  )
})

const TopResult = memo(function TopResult({ item, also, onOpen }: { item: JfItem; also: TitleSource<JfItem, ArrResult>[]; onOpen: () => void }) {
  const qc = useQueryClient()
  const art = backdropUrl(item, 640) ?? posterUrl(item, 300)
  const playable = item.Type === 'Movie' || item.Type === 'Episode'
  const choice = playChoice(item)
  const runtime = item.RunTimeTicks && item.Type !== 'Series' ? formatRuntime(item.RunTimeTicks) : ''
  const friendsAlso = also.flatMap((x) => (x.source === 'friend' ? [x.friend.name] : []))

  return (
    <>
      <p className={SECTION}>Top result</p>
      <div
        onMouseEnter={() => {
          prefetchItem(qc, item.Id)
          if (playable) prefetchPlayer()
        }}
        className="relative mx-1 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 sm:p-4"
      >
        {art && (
          <img
            src={art}
            alt=""
            aria-hidden
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.16] scale-110"
          />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink-950/90 via-ink-950/75 to-ink-950/55"
        />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <Link
            to={`/item/${item.Id}`}
            onClick={onOpen}
            data-result
            className="shrink-0 w-full sm:w-48 aspect-video rounded-xl overflow-hidden bg-ink-800 ring-1 ring-white/15 shadow-lg shadow-black/40 outline-none focus-visible:ring-2 focus-visible:ring-accent-400 transition-transform hover:scale-[1.02]"
          >
            {art && <img decoding="async" src={art} alt="" className="h-full w-full object-cover" />}
          </Link>
          <div className="flex-1 min-w-0">
            <p className="font-display text-2xl sm:text-[2rem] leading-[1.02] text-white truncate">{item.Name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-300">
              <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 font-semibold text-emerald-200">In your library</span>
              <span>{typeLabel(item)}</span>
              {runtime && <span>· {runtime}</span>}
              {item.OfficialRating && <span className="rounded border border-white/15 px-1.5 py-px text-[11px] text-ink-200">{item.OfficialRating}</span>}
              {friendsAlso.length > 0 && <span className="text-sky-200">· Also on {friendsAlso.join(', ')}</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {playable && (
                <Link
                  to={choice.href}
                  onClick={onOpen}
                  onMouseEnter={prefetchPlayer}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 active:scale-[0.97] transition"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                  {choice.label}
                </Link>
              )}
              {playable && choice.startOver && (
                <Link
                  to={choice.startOver}
                  onClick={onOpen}
                  aria-label={`Start ${item.Name} over from the beginning`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3.5 text-sm font-semibold text-white hover:bg-white/15 active:scale-[0.97] transition"
                >
                  <RestartIcon className="h-3.5 w-3.5" />
                  Start over
                </Link>
              )}
              <Link
                to={`/item/${item.Id}`}
                onClick={onOpen}
                className="inline-flex h-9 items-center rounded-full bg-white/10 border border-white/15 px-4 text-sm font-semibold text-white hover:bg-white/15 active:scale-[0.97] transition"
              >
                {item.Type === 'Series' ? 'Open series' : 'Details'}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  )
})

/** Where a title comes from, said plainly on every row. */
function SourceTag({ s }: { s: TitleSource<JfItem, ArrResult> }) {
  if (s.source === 'library') return <span className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-px text-[10.5px] font-semibold text-emerald-200">In your library</span>
  if (s.source === 'friend') return <span className="shrink-0 truncate rounded bg-sky-400/15 px-1.5 py-px text-[10.5px] font-semibold text-sky-200 max-w-[11rem]">On {s.friend.name}</span>
  return <span className="shrink-0 rounded bg-white/10 px-1.5 py-px text-[10.5px] font-semibold text-ink-200">Not in your library</span>
}

/** One title: its main source's row, and the others under "More ways to watch". */
const TitleRow = memo(function TitleRow({ t, onOpen }: { t: Title; onOpen: () => void }) {
  const [open, setOpen] = useState(false)
  const [main, ...others] = t.sources
  return (
    <div>
      {main!.source === 'library' ? (
        <LibraryRow item={main!.item} onOpen={onOpen} />
      ) : main!.source === 'friend' ? (
        <FriendRow item={main!.item} friend={main!.friend} onOpen={onOpen} />
      ) : (
        <RequestRow r={main!.r} />
      )}
      {others.length > 0 && (
        <div className="pl-[3.75rem] pr-2.5 pb-1">
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-[12.5px] font-semibold text-accent-300 hover:text-white transition-colors">
            {open ? 'Hide other ways' : `More ways to watch (${others.length}): ${others.map((o) => (o.source === 'friend' ? o.friend.name : o.source === 'request' ? 'request it' : 'your library')).join(', ')}`}
          </button>
          {open && (
            <div className="mt-1 rounded-xl border border-white/10 bg-white/[0.03]">
              {others.map((o) =>
                o.source === 'friend' ? (
                  <FriendRow key={o.item.Id} item={o.item} friend={o.friend} onOpen={onOpen} compact />
                ) : o.source === 'request' ? (
                  <RequestRow key="request" r={o.r} />
                ) : (
                  <LibraryRow key={o.item.Id} item={o.item} onOpen={onOpen} />
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

/** A library title: opens its page; its one action plays it (or opens a show). */
const LibraryRow = memo(function LibraryRow({ item, onOpen }: { item: JfItem; onOpen: () => void }) {
  const qc = useQueryClient()
  const playable = item.Type === 'Movie' || item.Type === 'Episode' || item.Type === 'Video'
  const choice = playChoice(item)
  const state = watchState(item)
  return (
    <div
      onMouseEnter={() => prefetchItem(qc, item.Id)}
      className="flex items-center gap-2 rounded-xl pr-2.5 hover:bg-white/[0.05] transition-colors"
    >
      <Link to={`/item/${item.Id}`} onClick={onOpen} data-result className={`${ROW} flex-1 min-w-0 hover:bg-transparent`}>
        <Thumb item={item} />
        <span className="flex-1 min-w-0">
          <span className="block text-[15px] font-semibold text-white truncate">{item.Name}</span>
          <span className="flex items-center gap-2 text-[13px] text-ink-400 min-w-0">
            <SourceTag s={{ source: 'library', item }} />
            <span className="truncate">
              {typeLabel(item)}
              {state ? ` · ${state}` : ''}
            </span>
          </span>
        </span>
      </Link>
      <Link
        to={playable ? choice.href : `/item/${item.Id}`}
        onClick={onOpen}
        onMouseEnter={playable ? prefetchPlayer : undefined}
        aria-label={`${playable ? (choice.resuming ? choice.label : 'Play') : 'Open'}: ${item.Name}`}
        title={playable && choice.resuming ? choice.label : undefined}
        className="shrink-0 inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition active:scale-[0.97]"
      >
        {playable && <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg>}
        {playable ? (choice.resuming ? 'Resume' : 'Play') : 'Open'}
      </Link>
    </div>
  )
})

/** A title on a friend's server: through our server's friend proxy (only what they share). */
const FriendRow = memo(function FriendRow({ item, friend, onOpen, compact }: { item: JfItem; friend: { id: string; name: string }; onOpen: () => void; compact?: boolean }) {
  const playable = item.Type === 'Movie'
  const choice = playChoice(item)
  const state = watchState(item)
  return (
    <div className="flex items-center gap-2 rounded-xl pr-2.5 hover:bg-white/[0.05] transition-colors">
      <Link to={`/item/${item.Id}`} onClick={onOpen} data-result className={`${ROW} flex-1 min-w-0 hover:bg-transparent`}>
        {!compact && <Thumb item={item} />}
        <span className="flex-1 min-w-0">
          {!compact && <span className="block text-[15px] font-semibold text-white truncate">{item.Name}</span>}
          <span className="flex items-center gap-2 text-[13px] text-ink-400 min-w-0">
            <SourceTag s={{ source: 'friend', item, friend }} />
            <span className="truncate">
              {typeLabel(item)}
              {state ? ` · ${state}` : ''}
            </span>
          </span>
        </span>
      </Link>
      <Link
        to={playable ? choice.href : `/item/${item.Id}`}
        onClick={onOpen}
        aria-label={`${playable ? 'Play' : 'Open'} ${item.Name} from ${friend.name}`}
        className="shrink-0 inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3.5 text-sm font-semibold text-white hover:bg-white/15 active:scale-[0.97] transition"
      >
        {playable && <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg>}
        {playable ? (choice.resuming ? 'Resume' : 'Play') : 'Open'}
        <span className="hidden sm:inline font-normal text-ink-300">from {friend.name}</span>
      </Link>
    </div>
  )
})

/** A title the library doesn't have: Request, or where its request stands. */
const RequestRow = memo(function RequestRow({ r }: { r: ArrResult }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [state, setState] = useState<'idle' | 'adding' | 'requested'>(r.id > 0 ? 'requested' : 'idle')
  const status = useRequestStatus(r, { justRequested: state === 'requested' })

  const request = async () => {
    if (state !== 'idle') return
    setState('adding')
    try {
      const id = await arrAdd(r)
      setState('requested')
      toast(`Requested “${r.title}”. It'll appear in My List while it downloads.`)
      noteRequested(qc, r, id)
    } catch (e) {
      setState('idle')
      toast(e instanceof ArrError && e.status === 401 ? 'Sign in again to request' : e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn't request “${r.title}”`, 'error')
    }
  }

  return (
    <div className="flex items-center gap-3.5 rounded-xl px-2.5 py-2 hover:bg-white/[0.04] transition-colors">
      <span className="h-14 w-10 shrink-0 rounded-md overflow-hidden bg-ink-800 ring-1 ring-white/15">
        {r.poster && <img decoding="async" src={r.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-85" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-white truncate">{r.title}</span>
        <span className="flex items-center gap-2 text-[13px] text-ink-400 min-w-0">
          <SourceTag s={{ source: 'request', r }} />
          <span className="truncate">
            {r.kind === 'movie' ? 'Movie' : 'Series'}
            {r.year ? ` · ${r.year}` : ''}
          </span>
        </span>
      </span>
      {state === 'requested' && status ? (
        <RequestStatusView status={status} className="shrink-0 max-w-[45%]" />
      ) : (
        <button
          type="button"
          onClick={request}
          disabled={state === 'adding'}
          data-result
          className="shrink-0 h-9 rounded-full bg-accent-fill hover:brightness-110 px-4 text-sm font-semibold text-white disabled:opacity-60 active:scale-[0.97] transition"
        >
          {state === 'adding' ? 'Requesting…' : 'Request'}
        </button>
      )}
    </div>
  )
})

function EmptyState({
  recent,
  onPick,
  onRemoveRecent,
  onClear,
  onSurprise,
  surprising,
  onNavigate,
}: {
  recent: string[]
  onPick: (t: string) => void
  onRemoveRecent: (t: string) => void
  onClear: () => void
  onSurprise: () => void
  surprising: boolean
  onNavigate?: () => void
}) {
  const { data: views } = useViews()
  const { hasGames } = useOptionalLibraries()
  const limits = useMyLimits()
  const movieLib = views?.Items.find((v) => v.CollectionType === 'movies')
  const showLib = views?.Items.find((v) => v.CollectionType === 'tvshows')
  const hasMusic = views?.Items.some((v) => v.CollectionType === 'music') ?? false
  const { data: genres } = useGenres((movieLib ?? showLib)?.Id)
  const names = (genres?.Items ?? []).map((g) => g.Name).slice(0, 12)

  const jumps = [
    ...(movieLib ? [{ label: movieLib.Name, to: `/library/${movieLib.Id}` }] : []),
    ...(showLib ? [{ label: showLib.Name, to: `/library/${showLib.Id}` }] : []),
    ...(hasMusic ? [{ label: 'Music', to: '/music' }] : []),
    ...(hasGames ? [{ label: 'Games', to: '/games' }] : []),
    ...(!limits || limits.requests ? [{ label: 'Requests', to: '/request' }] : []),
    { label: 'My List', to: '/mylist' },
  ]

  return (
    <div className="pt-1">
      {/* Quick jump command bar */}
      <p className={SECTION}>Quick jump</p>
      <div className="flex flex-wrap gap-2 px-2.5">
        <button
          type="button"
          onClick={onSurprise}
          disabled={surprising}
          data-result
          className="inline-flex h-9 items-center gap-2 rounded-full bg-white text-ink-950 px-3.5 text-[13px] font-semibold hover:bg-ink-200 active:scale-[0.97] disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-accent-400 transition"
        >
          <DiceIcon className="h-4 w-4" spinning={surprising} />
          Surprise me
        </button>
        {jumps.map((j) => (
          <Link
            key={j.to}
            to={j.to}
            onClick={onNavigate}
            onMouseEnter={() => prefetchRoute(j.to)}
            data-result
            className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-[13px] font-medium text-ink-200 hover:border-white/20 hover:bg-white/10 hover:text-white active:scale-[0.97] outline-none focus-visible:ring-2 focus-visible:ring-accent-400 transition"
          >
            {j.label}
          </Link>
        ))}
      </div>

      {recent.length > 0 && (
        <>
          <div className="flex items-center justify-between pr-2.5">
            <p className={SECTION}>Recent</p>
            <button type="button" onClick={onClear} className="pt-3 text-xs font-semibold text-ink-400 hover:text-white transition-colors">
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2 px-2.5">
            {recent.map((t) => (
              <span
                key={t}
                className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.04] pl-3 pr-1.5 text-sm text-ink-200 hover:border-white/20 hover:bg-white/[0.08] transition-colors"
              >
                <button
                  type="button"
                  data-result
                  onClick={() => onPick(t)}
                  className="inline-flex items-center gap-2 pr-1.5 text-left text-ink-200 hover:text-white outline-none focus-visible:text-accent-300"
                >
                  <svg className="h-3.5 w-3.5 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  {t}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveRecent(t)}
                  aria-label={`Remove ${t} from recent searches`}
                  className="grid h-6 w-6 place-items-center rounded-full text-ink-400 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        </>
      )}

      {names.length > 0 && (
        <>
          <p className={SECTION}>Browse by genre</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 px-2.5">
            {names.map((g) => (
              <Link
                key={g}
                to={browseHref(g, { includeItemTypes: 'Movie,Series', genres: g, sortBy: 'SortName' })}
                onClick={onNavigate}
                data-result
                className="group/g relative flex h-12 items-center justify-between gap-2 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] px-3.5 outline-none transition hover:border-white/20 hover:bg-white/[0.07] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/[0.09]" />
                <span className="truncate font-display italic text-[20px] leading-none text-white/90 transition-colors group-hover/g:text-white">
                  {g}
                </span>
                <svg
                  className="h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform duration-200 group-hover/g:translate-x-0.5 group-hover/g:text-accent-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  aria-hidden
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            ))}
          </div>
        </>
      )}

      {(!limits || limits.requests) && (
        <p className="px-2.5 pt-4 text-[12.5px] text-ink-400">
          Looking for something not in your library? Type its name to <span className="text-ink-200 font-semibold">Request</span> it right from here.
        </p>
      )}
    </div>
  )
}
