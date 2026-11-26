// The store's covers, cards, shelves, grid, and live PC-game indexer results.
// A game without art gets a steady deterministic gradient tile so art-less entries still look designed.

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatSize, MODE_LABEL, PLATFORM_LABEL, type GameRequest, type LiveGameResult, type StoreGame } from '../../api/gameStore'
import { useGameRequestActions, useGameRequests, useStoreLiveSearch } from '../../api/gameStoreQueries'
import { useMyLimits } from '../../api/parental'
import { IS_TV } from '../../lib/device'
import { CardSkeleton } from '../Skeletons'
import { useToast } from '../Toast'
import { GameRequestBadge, GameRequestStatusView } from './GameRequestStatus'

function hue(s: string): number {
  let h = 11
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/** Two colours from the game's id: the same game always gets the same tile. */
export function storeGradient(id: string, angle = 150): string {
  const h = hue(id)
  return `linear-gradient(${angle}deg, hsl(${h} 52% 38%), hsl(${(h + 48) % 360} 58% 16%))`
}

export function storeGameHref(id: string): string {
  return `/games/store/game/${encodeURIComponent(id)}`
}

/** The cover, or the tile when there's none (or it doesn't load). */
export function StoreCover({ game, className = '', big = false }: { game: StoreGame; className?: string; big?: boolean }) {
  const [broken, setBroken] = useState(false)
  if (game.cover && !broken)
    return <img decoding="async" src={game.cover} alt={game.title} loading="lazy" onError={() => setBroken(true)} className={`h-full w-full object-cover fade-in ${className}`} />
  return (
    <div className={`flex h-full w-full flex-col justify-between p-3 ${className}`} style={{ backgroundImage: storeGradient(game.id) }}>
      <span className="self-start rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/85">{game.genres[0] ?? 'Game'}</span>
      <span className={`font-display leading-[1.02] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)] line-clamp-4 ${big ? 'text-3xl' : 'text-[19px]'}`}>{game.title}</span>
    </div>
  )
}

/** A small portrait thumbnail for lists (requests, live results): cover or deterministic initial tile. */
export function StoreThumb({ id, title, cover, className = 'h-16 w-12' }: { id: string; title: string; cover?: string; className?: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-md ring-1 ring-white/10 ${className}`} style={cover && !broken ? undefined : { backgroundImage: storeGradient(id) }}>
      {cover && !broken ? (
        <img decoding="async" src={cover} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center font-display text-xl text-white/90" aria-hidden>
          {title.slice(0, 1)}
        </span>
      )}
    </div>
  )
}

export const StoreCard = memo(function StoreCard({ game, request }: { game: StoreGame; request?: GameRequest }) {
  const shots = game.screenshots
  const canHoverPreview = !__WEBOS__ && !IS_TV && Boolean(shots && shots.length > 0)
  const [hovered, setHovered] = useState(false)
  const [shotIdx, setShotIdx] = useState(-1)

  useEffect(() => {
    if (!hovered || !canHoverPreview || !shots?.length) {
      setShotIdx(-1)
      return
    }
    let interval: ReturnType<typeof setInterval> | undefined
    const delay = setTimeout(() => {
      setShotIdx(0)
      if (shots.length > 1) {
        interval = setInterval(() => {
          setShotIdx((n) => (n + 1) % shots.length)
        }, 2200)
      }
    }, 450)
    return () => {
      clearTimeout(delay)
      if (interval) clearInterval(interval)
    }
  }, [hovered, canHoverPreview, shots])

  const previewUrl = shotIdx >= 0 && shots ? shots[shotIdx] : undefined
  const modePill = game.modes.includes('online') ? 'Online' : game.modes.includes('local') ? 'Co-op' : undefined
  const platPill = game.platforms.length === 2 ? 'Win · Linux' : game.platforms[0] ? PLATFORM_LABEL[game.platforms[0]] : undefined

  return (
    <Link
      to={storeGameHref(game.id)}
      viewTransition
      className="own-focus group block outline-none"
      onMouseEnter={canHoverPreview ? () => setHovered(true) : undefined}
      onMouseLeave={canHoverPreview ? () => setHovered(false) : undefined}
    >
      <div className="tilt sheen relative aspect-[3/4] overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/5 transition-all group-hover:shadow-2xl group-hover:shadow-black/60 group-hover:ring-accent-400/70 group-focus-visible:ring-2 group-focus-visible:ring-accent-400">
        <StoreCover game={game} />
        {previewUrl && (
          <img
            decoding="async"
            src={previewUrl}
            alt=""
            className="fade-in absolute inset-0 h-full w-full object-cover"
          />
        )}
        {previewUrl && shots && shots.length > 1 && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex gap-1" aria-hidden>
            {shots.slice(0, 6).map((_, idx) => (
              <span
                key={idx}
                className={`h-0.5 flex-1 rounded-full transition-colors ${idx === shotIdx % Math.min(shots.length, 6) ? 'bg-white' : 'bg-white/35'}`}
              />
            ))}
          </div>
        )}
        {request && (
          <div className="absolute right-2 top-2 z-10">
            <GameRequestBadge request={request} />
          </div>
        )}
        {(platPill || modePill) && !previewUrl && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-2.5 pb-2 pt-8 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
            {platPill && <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-ink-100 backdrop-blur-sm">{platPill}</span>}
            {modePill && <span className="rounded bg-accent-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-accent-200 backdrop-blur-sm">{modePill}</span>}
          </div>
        )}
      </div>
      <p className="mt-2 truncate px-0.5 text-sm font-medium text-ink-200 transition-colors group-hover:text-white group-focus-visible:text-white">{game.title}</p>
      <p className="truncate px-0.5 text-xs text-ink-400">{[game.genres[0], game.year].filter(Boolean).join(' · ')}</p>
    </Link>
  )
})

const SHELF_ARROW = 'grid h-8 w-8 place-items-center rounded-full bg-ink-800/90 text-ink-200 ring-1 ring-white/10 transition-colors hover:bg-ink-700 hover:text-white'

/** A titled row of cards with "See all" and desktop left/right scroll arrows. */
export function StoreShelf({ title, href, games, requests }: { title: ReactNode; href?: string; games: StoreGame[]; requests?: Map<string, GameRequest> }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  if (!games.length) return null

  const scrollBy = (dir: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <section className="group/row mb-9">
      <div className="mb-3 flex items-center gap-3">
        {href ? (
          <h2 className="min-w-0">
            <Link to={href} className="group/title row-title flex min-w-0 items-baseline gap-2 text-white transition-colors hover:text-accent-300">
              <span className="truncate">{title}</span>
              <span className="shrink-0 font-sans text-xs font-semibold not-italic text-accent-300 transition-opacity sm:opacity-80 sm:group-hover/row:opacity-100">
                See all →
              </span>
            </Link>
          </h2>
        ) : (
          <h2 className="row-title min-w-0 truncate text-white">{title}</h2>
        )}
        <div className="flex-1" />
        {!IS_TV && games.length > 4 && (
          <div className="hidden gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 md:flex">
            <button type="button" onClick={() => scrollBy(-1)} tabIndex={-1} className={SHELF_ARROW} aria-label="Scroll left">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button type="button" onClick={() => scrollBy(1)} tabIndex={-1} className={SHELF_ARROW} aria-label="Scroll right">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {/* Room around the cards: a scroller clips what pokes out, and the focus ring and the hover lift do. */}
      <div ref={scrollRef} className="-mx-2 -mt-2 flex gap-4 overflow-x-auto no-scrollbar scroll-smooth px-2 pb-2 pt-2">
        {games.map((g) => (
          <div key={g.id} className="w-36 shrink-0 sm:w-40">
            <StoreCard game={g} request={requests?.get(g.id)} />
          </div>
        ))}
      </div>
    </section>
  )
}

export const STORE_GRID = 'grid gap-3 sm:gap-4 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(156px,1fr))]'

export function StoreGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={STORE_GRID}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}

export function ShelfSkeleton() {
  return (
    <section className="mb-9">
      <div className="mb-3 h-7 w-48 rounded shimmer" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="w-36 shrink-0 sm:w-40">
            <div className="aspect-[3/4] rounded-xl shimmer" />
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------- Live Prowlarr PC-game search results ----------

function liveGameIdFor(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'game'
  return `live-${slug}`
}

const GROUP_PILL: Record<string, string> = {
  FitGirl: 'border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-200',
  DODI: 'border-sky-400/30 bg-sky-500/15 text-sky-200',
  GOG: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200',
  ElAmigos: 'border-amber-400/30 bg-amber-500/15 text-amber-200',
  Portable: 'border-teal-400/30 bg-teal-500/15 text-teal-200',
  LinuxRuleZ: 'border-orange-400/30 bg-orange-500/15 text-orange-200',
}

export function LiveSearchSection({ q, className = '' }: { q: string; className?: string }) {
  const trimmed = q.trim()
  const live = useStoreLiveSearch(trimmed)
  const { data: requests } = useGameRequests()
  const actions = useGameRequestActions()
  const limits = useMyLimits()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const reqByGameId = useMemo(() => new Map((requests ?? []).map((r) => [r.gameId, r])), [requests])

  if (trimmed.length < 2) return null
  if (!live.isLoading && (!live.data || !live.data.available)) return null

  const items = live.data?.items ?? []
  const requestsBlocked = Boolean(limits && !limits.requests)

  const handleRequest = (item: LiveGameResult) => {
    setBusyId(item.id)
    actions.liveRequest.mutate(
      {
        title: item.title,
        downloadUrl: item.downloadUrl,
        sizeBytes: item.sizeBytes,
        platform: item.platform,
        installer: item.installer,
        cover: item.cover,
        summary: item.summary,
        year: item.year,
        genres: item.genres,
      },
      {
        onSuccess: () => toast(`Requested “${item.title}”. Track progress in Requests.`),
        onError: (e) => toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t request “${item.title}”`, 'error'),
        onSettled: () => setBusyId((cur) => (cur === item.id ? null : cur)),
      },
    )
  }

  return (
    <section className={`mt-8 ${className}`} aria-label="Live PC game search">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <h2 className="row-title text-white">Live PC game search</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-400/30 bg-accent-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent-200">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-400" aria-hidden />
          Indexers
        </span>
        {!live.isLoading && (
          <span className="text-xs text-ink-400">
            {items.length === 0 ? 'No indexer releases found' : `${items.length} ${items.length === 1 ? 'release' : 'releases'}`}
          </span>
        )}
      </div>

      {live.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl shimmer" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-6 text-center text-sm text-ink-400">
          No live PC game releases matched “{trimmed}”. Try a shorter title or different spelling.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((item) => {
            const existing = reqByGameId.get(liveGameIdFor(item.title))
            const isBusy = busyId === item.id
            const groupStyle = (item.group && GROUP_PILL[item.group]) || 'border-white/15 bg-white/[0.08] text-ink-100'
            const seedTone = item.seeders >= 10 ? 'text-emerald-300' : item.seeders > 0 ? 'text-amber-200' : 'text-ink-400'
            return (
              <li
                key={item.id}
                className="flex flex-col justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-3.5 transition-colors hover:border-white/20 hover:bg-white/[0.055] sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  <StoreThumb id={item.id} title={item.title} cover={item.cover} className="h-16 w-24 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                      {item.year && <span className="text-xs text-ink-400">{item.year}</span>}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-ink-400" title={item.releaseTitle}>
                      {item.releaseTitle}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {item.group && (
                        <span className={`rounded-full border px-2 py-0.5 font-semibold ${groupStyle}`}>
                          {item.group}
                        </span>
                      )}
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 font-medium text-ink-200">
                        {PLATFORM_LABEL[item.platform]}
                      </span>
                      <span className="font-mono text-ink-300">{formatSize(item.sizeBytes)}</span>
                      <span className="text-ink-500">·</span>
                      <span className={`font-mono font-medium ${seedTone}`}>{item.seeders} seeders</span>
                      <span className="text-ink-500">·</span>
                      <span className="truncate text-ink-400">{item.indexer}</span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-2 sm:flex-col sm:items-end">
                  {existing ? (
                    <Link
                      to={existing.state === 'needs-you' ? `/games/store/requests/${encodeURIComponent(existing.id)}/installer` : '/games/store/requests'}
                      className="inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-3.5 text-xs font-semibold text-white transition hover:bg-white/20"
                    >
                      <GameRequestStatusView request={existing} />
                    </Link>
                  ) : requestsBlocked ? (
                    <span className="text-xs text-ink-400">Requests off</span>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleRequest(item)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97] disabled:opacity-60"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13.5m0 0 4.5-4.5M12 16.5 7.5 12M3.75 18.75A2.25 2.25 0 0 0 6 21h12a2.25 2.25 0 0 0 2.25-2.25" />
                      </svg>
                      {isBusy ? 'Requesting…' : 'Request'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export { MODE_LABEL, PLATFORM_LABEL }
