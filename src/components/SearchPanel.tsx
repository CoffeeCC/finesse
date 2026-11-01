import { useEffect, useMemo, useRef, useState } from 'react'
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
import type { JfItem } from '../api/types'

// Universal search: one box for everything. A ranked top result, then one list
// of titles: your library's first, then titles only friends' servers have (Groups),
// then Radarr/Sonarr matches nobody has. Each title is listed once with where it is
// ("In your library", "On Sam's server", "Not in your library") and one action (Play,
// Play from Sam's, Request, or where the request stands); a title with more than one
// source lists the others under "More ways to watch". Friends' titles join ours only
// when their TMDb/TVDb ids match. Then albums, songs and people.

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
  const [where, setWhere] = useState<Where>('all')
  const [recent, setRecent] = useState<string[]>(readRecent)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { surprise, busy } = useSurprise()
  const { data: views } = useViews()
  const hasMusic = !!views?.Items.some((v) => v.CollectionType === 'music')
  const scopes = hasMusic ? SCOPES : SCOPES.filter((s) => s.key !== 'music')

  useEffect(() => {
    const t = setTimeout(() => setTerm(input.trim()), 250)
    return () => clearTimeout(t)
  }, [input])
  // A new search starts from every source again.
  useEffect(() => setWhere('all'), [term])
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
  // exactly isn't below a loose movie match. mergeTitles drops the ones the library has.
  const requestable = useMemo(() => {
    const q = norm(term)
    return (request.data ?? [])
      .filter((r) => (scope === 'movies' ? r.kind === 'movie' : scope === 'shows' ? r.kind === 'series' : true))
      .map((r, i) => ({ r, s: titleScore(r.title, q), i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.r)
  }, [request.data, scope, term])

  const top = scope !== 'people' ? ranked[0] : undefined
  const rest = scope !== 'people' ? ranked.slice(1, scope === 'all' ? 9 : 30) : []
  // One list of titles: the library's first, then friends' (Groups), then what can be requested,
  // each title once with all its sources (lib/discovery.ts mergeSources). The top result is above it.
  const merged = useMemo(() => (scope === 'people' || scope === 'music' ? [] : mergeSources(ranked, friendHits, requestable)), [ranked, friendHits, requestable, scope])
  const topTitle = top ? merged.find((t) => t.key === top.Id) : undefined
  const listed = useMemo(() => merged.filter((t) => (t.sources[0]!.source === 'library' ? rest.includes((t.sources[0] as { item: JfItem }).item) : true)), [merged, rest])
  const kinds = new Set(listed.flatMap((t) => t.sources.map((s) => s.source)))
  const titles = listed.filter((t) =>
    where === 'all' ? true : where === 'library' ? t.sources.some((s) => s.source === 'library') : where === 'friends' ? t.sources.some((s) => s.source === 'friend') : t.sources[0]!.source === 'request' || (t.sources.some((s) => s.source === 'request') && !t.sources.some((s) => s.source === 'library')),
  )
  const missing = listed.filter((t) => t.sources[0]!.source !== 'library')
  const peopleList = people.data?.Items.slice(0, scope === 'people' ? 24 : 6) ?? []

  // Albums named like the term first (best match on top), then albums by a
  // matching artist in the order the server gave (newest first). Songs by name.
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
    } else if (e.key === 'Enter' && (top || albums[0])) {
      e.preventDefault()
      opened()
      navigate(top ? `/item/${top.Id}` : `/album/${albums[0].Id}`)
    }
  }

  const nothing =
    active &&
    !lib.isLoading &&
    !music.isLoading &&
    ranked.length === 0 &&
    peopleList.length === 0 &&
    missing.length === 0 &&
    albums.length === 0 &&
    songs.length === 0

  return (
    <div className={mode === 'overlay' ? 'flex min-h-0 flex-col' : ''}>
      <div className={`flex items-center gap-3 ${mode === 'overlay' ? 'h-16 px-5 border-b border-white/10 focus-within:border-accent-400/60' : 'h-12 px-5 rounded-full bg-white/[0.06] border border-white/10 focus-within:border-white/30 max-w-2xl'}`}>
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
          placeholder={hasMusic ? 'Titles, people, music' : 'Titles, people, genres'}
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
          {scopes.map((s) => (
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

      <div ref={resultsRef} className={mode === 'overlay' ? 'os-scroll min-h-0 overflow-y-auto mx-1.5 mb-1.5 px-1 pb-4 pt-1' : 'pt-2'}>
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
            {(scope === 'music' ? music.isLoading : lib.isLoading) && <p className="px-2.5 py-6 text-sm text-ink-400">Searching…</p>}
            {nothing && (
              <p className="px-2.5 py-6 text-sm text-ink-300">
                Nothing matches “{term}”. Check the spelling, or try a person or genre.
              </p>
            )}

            {top && <TopResult item={top} also={topTitle?.sources.slice(1) ?? []} onOpen={opened} />}

            {friendSearch.failed.length > 0 && (
              <p className="px-2.5 pt-3 text-[12.5px] text-amber-200">
                Couldn’t reach {friendSearch.failed.join(', ')} just now, so {friendSearch.failed.length === 1 ? 'its' : 'their'} titles aren’t here.
              </p>
            )}

            {listed.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={SECTION}>{top ? 'More titles' : 'Titles'}</p>
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
                            className={`h-7 rounded-full px-3 text-[12.5px] transition-colors ${where === k ? 'bg-white font-semibold text-ink-950' : 'border border-white/10 text-ink-300 hover:text-white'}`}
                          >
                            {label}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                {titles.length === 0 && <p className="px-2.5 py-2 text-[13px] text-ink-400">None of these titles are there. Choose Everywhere to see them all.</p>}
                {titles.map((t) => (
                  <TitleRow key={t.key} t={t} onOpen={opened} />
                ))}
              </>
            )}

            {albums.length > 0 && (
              <>
                <p className={SECTION}>Albums</p>
                {albums.map((album) => (
                  <Link key={album.Id} to={`/album/${album.Id}`} onClick={opened} data-result className={ROW}>
                    <SquareThumb src={posterUrl(album, 100)} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold text-white truncate">{album.Name}</span>
                      <span className="block text-[13px] text-ink-400 truncate">{typeLabel(album)}</span>
                    </span>
                  </Link>
                ))}
              </>
            )}

            {songs.length > 0 && (
              <>
                <p className={SECTION}>Songs</p>
                {songs.map((song) => (
                  <SongRow key={song.Id} song={song} onPlay={opened} />
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

function SquareThumb({ src }: { src: string | null | undefined }) {
  return (
    <span className="h-12 w-12 shrink-0 rounded-md overflow-hidden bg-ink-800">
      {src && <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />}
    </span>
  )
}

/** A song: pressing it plays its album from this song on. */
function SongRow({ song, onPlay }: { song: JfItem; onPlay: () => void }) {
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
      <span className="shrink-0 text-xs text-ink-400">{isCurrent ? 'Playing' : 'Play'}</span>
    </button>
  )
}

function TopResult({ item, also, onOpen }: { item: JfItem; also: TitleSource<JfItem, ArrResult>[]; onOpen: () => void }) {
  const art = backdropUrl(item, 640) ?? posterUrl(item, 300)
  const playable = item.Type === 'Movie' || item.Type === 'Episode'
  const choice = playChoice(item)
  return (
    <>
      <p className={SECTION}>Top result</p>
      <div className="flex items-center gap-4 rounded-2xl bg-white/[0.06] ring-1 ring-white/10 p-3">
        <Link to={`/item/${item.Id}`} onClick={onOpen} data-result className="shrink-0 w-36 sm:w-48 aspect-video rounded-xl overflow-hidden bg-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
          {art && <img src={art} alt="" className="h-full w-full object-cover" />}
        </Link>
        <div className="flex-1 min-w-0">
          <p className="font-display text-2xl sm:text-3xl leading-tight text-white truncate">{item.Name}</p>
          <p className="text-sm text-ink-300 truncate">
            {typeLabel(item)}
            {also.some((x) => x.source === 'friend') && ` · Also on ${also.flatMap((x) => (x.source === 'friend' ? [x.friend.name] : [])).join(', ')}`}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {playable && (
              <Link
                to={choice.href}
                onClick={onOpen}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
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
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-white/10 border border-white/15 px-3.5 text-sm font-semibold text-white hover:bg-white/15 transition-colors"
              >
                <RestartIcon className="h-3.5 w-3.5" />
                Start over
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

/** Where a title comes from, said plainly on every row. */
function SourceTag({ s }: { s: TitleSource<JfItem, ArrResult> }) {
  if (s.source === 'library') return <span className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-px text-[10.5px] font-semibold text-emerald-200">In your library</span>
  if (s.source === 'friend') return <span className="shrink-0 truncate rounded bg-sky-400/15 px-1.5 py-px text-[10.5px] font-semibold text-sky-200 max-w-[11rem]">On {s.friend.name}</span>
  return <span className="shrink-0 rounded bg-white/10 px-1.5 py-px text-[10.5px] font-semibold text-ink-200">Not in your library</span>
}

/** One title: its main source's row, and the others under "More ways to watch". */
function TitleRow({ t, onOpen }: { t: Title; onOpen: () => void }) {
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
        <div className="pl-[3.75rem] pr-2.5">
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-[12.5px] font-semibold text-accent-300 hover:text-white">
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
}

/** A library title: opens its page; its one action plays it (or opens a show). */
function LibraryRow({ item, onOpen }: { item: JfItem; onOpen: () => void }) {
  const playable = item.Type === 'Movie' || item.Type === 'Episode' || item.Type === 'Video'
  const choice = playChoice(item)
  const state = watchState(item)
  return (
    <div className="flex items-center gap-2 rounded-xl pr-2.5 hover:bg-white/5 transition-colors">
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
        aria-label={`${playable ? (choice.resuming ? choice.label : 'Play') : 'Open'}: ${item.Name}`}
        title={playable && choice.resuming ? choice.label : undefined}
        className="shrink-0 inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3.5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
      >
        {playable && <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg>}
        {playable ? (choice.resuming ? 'Resume' : 'Play') : 'Open'}
      </Link>
    </div>
  )
}

/** A title on a friend's server: through our server's friend proxy (only what they share). */
function FriendRow({ item, friend, onOpen, compact }: { item: JfItem; friend: { id: string; name: string }; onOpen: () => void; compact?: boolean }) {
  const playable = item.Type === 'Movie'
  const choice = playChoice(item)
  const state = watchState(item)
  return (
    <div className="flex items-center gap-2 rounded-xl pr-2.5 hover:bg-white/5 transition-colors">
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
        className="shrink-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3.5 text-sm font-semibold text-white hover:bg-white/15 transition-colors"
      >
        {playable && <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg>}
        {playable ? (choice.resuming ? 'Resume' : 'Play') : 'Open'}
        <span className="hidden sm:inline font-normal text-ink-300">from {friend.name}</span>
      </Link>
    </div>
  )
}

/** A title the library doesn't have: Request, or where its request stands. */
function RequestRow({ r }: { r: ArrResult }) {
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
    <div className="flex items-center gap-3.5 rounded-xl px-2.5 py-2">
      <span className="h-14 w-10 shrink-0 rounded-md overflow-hidden bg-ink-800 ring-1 ring-white/15">
        {r.poster && <img src={r.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover opacity-80" />}
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
