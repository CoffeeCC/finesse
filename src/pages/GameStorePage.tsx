// The game store's front: full-bleed cinematic hero with 1-click Request, live inline search
// (catalog + Prowlarr PC-game indexers), quick filter strip, active & ready requests, and shelves.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getSession } from '../api/client'
import {
  browseHref,
  MODE_LABEL,
  needsProgramPick,
  PLATFORM_LABEL,
  type GameMode,
  type GamePlatform,
  type GameRequest,
  type StoreGame,
  type StoreQuery,
} from '../api/gameStore'
import {
  useGameRequestActions,
  useGameRequests,
  useStoreFacets,
  useStoreGame,
  useStoreHome,
  useStoreMode,
  useStoreSearch,
} from '../api/gameStoreQueries'
import { useMyLimits } from '../api/parental'
import { PLAY_BTN, START_OVER_BTN } from '../components/ActionButton'
import { useToast } from '../components/Toast'
import { ChooseProgramLink, GameRequestStatusView, installerHref } from '../components/gamestore/GameRequestStatus'
import {
  LiveSearchSection,
  ShelfSkeleton,
  STORE_GRID,
  StoreCard,
  StoreCover,
  StoreGridSkeleton,
  StoreShelf,
  StoreThumb,
  storeGameHref,
  storeGradient,
} from '../components/gamestore/StoreCards'
import { StoreHeader, StoreSearchBox, StoreUnavailable } from '../components/gamestore/StoreHeader'
import { IS_TV } from '../lib/device'

type QuickFilter =
  | { kind: 'platform'; value: GamePlatform; label: string }
  | { kind: 'mode'; value: GameMode; label: string }
  | { kind: 'genre'; value: string; label: string }

export default function GameStorePage() {
  const mode = useStoreMode()
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [debouncedTerm, setDebouncedTerm] = useState('')
  const [quickFilter, setQuickFilter] = useState<QuickFilter | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(term.trim()), 300)
    return () => clearTimeout(t)
  }, [term])

  const home = useStoreHome()
  const facets = useStoreFacets({})
  const { data: requests } = useGameRequests()
  const byGame = useMemo(() => new Map((requests ?? []).map((r) => [r.gameId, r])), [requests])
  const current = useMemo(() => (requests ?? []).filter((r) => r.state !== 'ready'), [requests])
  const ready = useMemo(() => (requests ?? []).filter((r) => r.state === 'ready'), [requests])

  const quickQuery: StoreQuery | null = useMemo(() => {
    if (!quickFilter) return null
    if (quickFilter.kind === 'platform') return { platform: quickFilter.value, sort: 'popular' }
    if (quickFilter.kind === 'mode') return { mode: quickFilter.value, sort: 'popular' }
    return { genres: [quickFilter.value], sort: 'popular' }
  }, [quickFilter])

  const quickResults = useStoreSearch(quickQuery ?? { limit: 1 })
  const inlineCatalog = useStoreSearch({ q: debouncedTerm || undefined, sort: 'popular' })

  if (!mode) return <StoreUnavailable />

  const searching = debouncedTerm.length > 0
  const catalogHits = inlineCatalog.data?.pages.flatMap((p) => p.items) ?? []
  const quickGames = quickFilter ? (quickResults.data?.pages.flatMap((p) => p.items) ?? []) : []
  const isCatalogEmpty = Boolean(home.data && home.data.featured.length === 0 && home.data.shelves.length === 0)

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-12">
      <StoreHeader
        extra={
          <StoreSearchBox
            value={term}
            onChange={setTerm}
            onSubmit={() => term.trim() && navigate(browseHref({ q: term.trim() }))}
          />
        }
      />

      {searching ? (
        <section className="mb-10" aria-label="Search results">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <h2 className="row-title text-white">Results for “{debouncedTerm}”</h2>
              {inlineCatalog.data?.pages[0] && (
                <span className="text-xs font-medium text-ink-400">
                  {inlineCatalog.data.pages[0].total} in catalog
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={browseHref({ q: debouncedTerm })}
                className="inline-flex h-8 items-center rounded-full border border-white/15 bg-white/[0.06] px-3.5 text-xs font-semibold text-ink-100 transition hover:bg-white/15 hover:text-white"
              >
                Open in Browse →
              </Link>
              <button
                type="button"
                onClick={() => {
                  setTerm('')
                  setDebouncedTerm('')
                }}
                className="inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold text-ink-400 hover:text-white"
              >
                Clear
              </button>
            </div>
          </div>

          {inlineCatalog.isLoading ? (
            <StoreGridSkeleton count={6} />
          ) : catalogHits.length > 0 ? (
            <div className={STORE_GRID}>
              {catalogHits.slice(0, 12).map((g) => (
                <div key={g.id} className="cv-card">
                  <StoreCard game={g} request={byGame.get(g.id)} />
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-5 text-sm text-ink-400">
              No catalog games match “{debouncedTerm}”.
            </p>
          )}

          <LiveSearchSection q={debouncedTerm} />
        </section>
      ) : home.isError ? (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-white">Couldn’t load the store</p>
          <p className="mt-1 text-sm text-ink-400">The game store didn’t answer. Try again in a moment.</p>
          <button
            type="button"
            onClick={() => home.refetch()}
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
          >
            Try again
          </button>
        </div>
      ) : isCatalogEmpty ? (
        <>
          {(current.length > 0 || ready.length > 0) && <YourRequests active={current} ready={ready} />}
          <EmptyCatalog mode={mode} />
        </>
      ) : (
        <>
          {home.data ? (
            <Featured games={home.data.featured} requests={byGame} mode={mode} />
          ) : (
            <div className="-mx-4 mb-8 h-[340px] shimmer sm:-mx-6 sm:h-[420px] lg:-mx-12" />
          )}

          {/* Quick horizontal genre / platform / mode filter strip */}
          {facets.data && (facets.data.platforms.length > 0 || facets.data.modes.length > 0 || facets.data.genres.length > 0) && (
            <div className="mb-8 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1" role="group" aria-label="Quick filters">
              <QuickChip active={quickFilter === null} onClick={() => setQuickFilter(null)}>
                All shelves
              </QuickChip>
              {facets.data.platforms.map((p) => {
                const active = quickFilter?.kind === 'platform' && quickFilter.value === p.value
                return (
                  <QuickChip
                    key={`p-${p.value}`}
                    active={active}
                    onClick={() => setQuickFilter(active ? null : { kind: 'platform', value: p.value as GamePlatform, label: p.label })}
                  >
                    {p.label}
                  </QuickChip>
                )
              })}
              {facets.data.modes.map((m) => {
                const active = quickFilter?.kind === 'mode' && quickFilter.value === m.value
                return (
                  <QuickChip
                    key={`m-${m.value}`}
                    active={active}
                    onClick={() => setQuickFilter(active ? null : { kind: 'mode', value: m.value as GameMode, label: m.label })}
                  >
                    {m.label}
                  </QuickChip>
                )
              })}
              {facets.data.genres.slice(0, 8).map((g) => {
                const active = quickFilter?.kind === 'genre' && quickFilter.value === g.value
                return (
                  <QuickChip
                    key={`g-${g.value}`}
                    active={active}
                    onClick={() => setQuickFilter(active ? null : { kind: 'genre', value: g.value, label: g.label })}
                  >
                    {g.label}
                  </QuickChip>
                )
              })}
            </div>
          )}

          {quickFilter && quickQuery ? (
            <section className="mb-10">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="row-title text-white">{quickFilter.label}</h2>
                <div className="flex items-center gap-2">
                  <Link
                    to={browseHref(quickQuery)}
                    className="inline-flex h-8 items-center rounded-full border border-white/15 bg-white/[0.06] px-3.5 text-xs font-semibold text-ink-100 transition hover:bg-white/15 hover:text-white"
                  >
                    See all in Browse →
                  </Link>
                  <button
                    type="button"
                    onClick={() => setQuickFilter(null)}
                    className="inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold text-ink-400 hover:text-white"
                  >
                    Reset
                  </button>
                </div>
              </div>
              {quickResults.isLoading ? (
                <StoreGridSkeleton count={12} />
              ) : quickGames.length === 0 ? (
                <p className="py-10 text-center text-sm text-ink-400">No games in this category yet.</p>
              ) : (
                <div className={STORE_GRID}>
                  {quickGames.slice(0, 18).map((g) => (
                    <div key={g.id} className="cv-card">
                      <StoreCard game={g} request={byGame.get(g.id)} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <>
              {(current.length > 0 || ready.length > 0) && <YourRequests active={current} ready={ready} />}

              {home.data
                ? home.data.shelves.map((s) => (
                    <StoreShelf key={s.id} title={s.title} href={browseHref(s.query)} games={s.items} requests={byGame} />
                  ))
                : Array.from({ length: 3 }).map((_, i) => <ShelfSkeleton key={i} />)}

              {facets.data && facets.data.genres.length > 0 && (
                <section className="mb-9">
                  <h2 className="row-title mb-3 text-white">Explore genres</h2>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {facets.data.genres.slice(0, 10).map((g) => (
                      <Link
                        key={g.value}
                        to={browseHref({ genres: [g.value] })}
                        className="group relative flex h-16 items-end justify-between gap-2 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3 outline-none transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.07] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent-400"
                      >
                        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/[0.09]" />
                        <span
                          aria-hidden
                          className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent-400/0 transition-colors duration-300 group-hover:bg-accent-400/15"
                        />
                        <span className="relative truncate font-display text-[22px] italic leading-none text-white/90 transition-colors group-hover:text-white">
                          {g.label}
                        </span>
                        <span className="relative shrink-0 self-start font-mono text-[11px] font-medium tabular-nums text-ink-400 transition-colors group-hover:text-accent-300">
                          {g.count}
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function QuickChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 shrink-0 rounded-full border px-3.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
        active
          ? 'border-accent-400/60 bg-accent-500/20 text-accent-100'
          : 'border-white/10 bg-white/[0.04] text-ink-200 hover:border-white/20 hover:bg-white/[0.08] hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

/** Full-bleed cinematic featured carousel with 1-click Request, badges, and proper thumbnail controls. */
function Featured({ games, requests, mode }: { games: StoreGame[]; requests: Map<string, GameRequest>; mode: 'server' | 'demo' }) {
  const [i, setI] = useState(0)
  const [held, setHeld] = useState(false)
  const limits = useMyLimits()
  const actions = useGameRequestActions()
  const toast = useToast()

  useEffect(() => {
    if (held || games.length < 2 || IS_TV) return
    const t = setTimeout(() => setI((n) => (n + 1) % games.length), 9000)
    return () => clearTimeout(t)
  }, [i, held, games.length])

  const activeIdx = i % Math.max(1, games.length)
  const g = games[activeIdx]
  const detail = useStoreGame(g?.id)
  if (!g) return null

  const r = requests.get(g.id)
  const firstSource = detail.data?.sources[0]
  const canRequest = Boolean(firstSource && !r && !(limits && !limits.requests))
  const picking = r ? needsProgramPick(r) : false

  const step = (delta: number) => setI((n) => (n + delta + games.length) % games.length)

  const handleOneClickRequest = () => {
    if (!firstSource) return
    actions.request.mutate(
      { gameId: g.id, sourceId: firstSource.id },
      {
        onSuccess: () =>
          toast(
            mode === 'demo'
              ? `Requested “${g.title}” (demo mode — simulated download).`
              : `Requested “${g.title}”. Track progress in Requests.`,
          ),
        onError: (e) => toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t request “${g.title}”`, 'error'),
      },
    )
  }

  return (
    <section
      className="relative -mx-4 mb-7 overflow-hidden border-y border-white/10 bg-ink-900 sm:-mx-6 lg:-mx-12"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      aria-roledescription="carousel"
      aria-label="Featured games"
    >
      {/* Background artwork with dual gradient scrims for crisp contrast on mobile & desktop */}
      <div
        key={g.id}
        className="fade-in absolute inset-0"
        style={g.hero ? undefined : { backgroundImage: storeGradient(g.id, 115) }}
        aria-hidden
      >
        {g.hero && <img decoding="async" src={g.hero} alt="" className="h-full w-full object-cover object-center" />}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/95 via-ink-950/65 to-ink-950/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/40 to-ink-950/20" />
      </div>

      {/* Content */}
      <div className="relative px-4 pb-6 pt-8 sm:px-6 sm:pb-8 sm:pt-12 lg:px-12">
        <div className="flex min-h-[260px] items-end gap-7 sm:min-h-[320px]">
          <div className="hidden aspect-[3/4] w-44 shrink-0 overflow-hidden rounded-xl shadow-2xl shadow-black/70 ring-1 ring-white/20 md:block lg:w-48">
            <StoreCover game={g} big />
          </div>
          <div className="min-w-0 max-w-2xl flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur-sm">
                Featured
              </span>
              {g.platforms.map((p) => (
                <span key={p} className="rounded-full border border-white/15 bg-black/35 px-2.5 py-0.5 text-[11px] font-medium text-ink-100 backdrop-blur-sm">
                  {PLATFORM_LABEL[p]}
                </span>
              ))}
              {g.modes.slice(0, 2).map((m) => (
                <span key={m} className="rounded-full border border-accent-400/30 bg-accent-500/15 px-2.5 py-0.5 text-[11px] font-medium text-accent-200 backdrop-blur-sm">
                  {MODE_LABEL[m]}
                </span>
              ))}
            </div>

            <h2 className="font-display mb-2.5 text-4xl leading-[0.95] text-white drop-shadow-lg sm:text-5xl lg:text-6xl">
              {g.title}
            </h2>

            <p className="mb-2 text-sm text-ink-200">
              {[g.genres.slice(0, 2).join(', '), g.year, g.developer].filter(Boolean).join(' · ')}
            </p>
            <p className="mb-5 line-clamp-3 max-w-xl text-[15px] leading-relaxed text-ink-100/95">
              {g.summary}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              {r ? (
                <>
                  {picking ? (
                    <ChooseProgramLink request={r} className={PLAY_BTN} />
                  ) : r.state === 'needs-you' ? (
                    <Link to={installerHref(r)} className={PLAY_BTN}>
                      Finish installing
                    </Link>
                  ) : (
                    <Link to="/games/store/requests" className={PLAY_BTN}>
                      See status
                    </Link>
                  )}
                  <Link to={storeGameHref(g.id)} className={START_OVER_BTN}>
                    Details
                  </Link>
                  <GameRequestStatusView request={r} className="w-full sm:w-auto" />
                </>
              ) : (
                <>
                  {canRequest && (
                    <button
                      type="button"
                      disabled={actions.request.isPending}
                      onClick={handleOneClickRequest}
                      className={PLAY_BTN}
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13.5m0 0 4.5-4.5M12 16.5 7.5 12M3.75 18.75A2.25 2.25 0 0 0 6 21h12a2.25 2.25 0 0 0 2.25-2.25" />
                      </svg>
                      {actions.request.isPending ? 'Requesting…' : 'Request'}
                    </button>
                  )}
                  <Link to={storeGameHref(g.id)} className={canRequest ? START_OVER_BTN : PLAY_BTN}>
                    Details
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Clickable thumbnail pills + prev/next arrows (proper touch targets) */}
        {games.length > 1 && (
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
              {games.map((x, n) => {
                const active = n === activeIdx
                return (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setI(n)}
                    aria-label={`Show ${x.title}`}
                    aria-current={active ? 'true' : undefined}
                    className={`flex h-11 shrink-0 items-center gap-2.5 rounded-xl border pr-3 pl-1.5 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent-400 ${
                      active
                        ? 'border-white/40 bg-white/15 text-white shadow-sm'
                        : 'border-white/10 bg-black/35 text-ink-300 hover:border-white/25 hover:bg-black/50 hover:text-white'
                    }`}
                  >
                    <StoreThumb id={x.id} title={x.title} cover={x.cover} className="h-8 w-6 rounded" />
                    <span className="max-w-[9rem] truncate text-xs font-semibold">{x.title}</span>
                  </button>
                )
              })}
            </div>

            <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous featured game"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-sm transition hover:bg-white/20"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next featured game"
                className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-sm transition hover:bg-white/20"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/** Active requests + a dedicated "Ready to play" strip so finished games never vanish quietly. */
function YourRequests({ active, ready }: { active: GameRequest[]; ready: GameRequest[] }) {
  return (
    <section className="mb-9 space-y-5">
      {active.length > 0 && (
        <div>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="row-title text-white">Your requests</h2>
            <Link to="/games/store/requests" className="text-xs font-semibold text-accent-300 hover:text-accent-200">
              See all ({active.length + ready.length})
            </Link>
          </div>
          <div className="-mx-2 flex gap-3 overflow-x-auto no-scrollbar px-2 pb-2">
            {active.slice(0, 8).map((r) => (
              <Link
                key={r.id}
                to={needsProgramPick(r) || r.state === 'needs-you' ? installerHref(r) : storeGameHref(r.gameId)}
                className="flex w-72 shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 outline-none transition hover:border-white/20 hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                <StoreThumb id={r.gameId} title={r.title} cover={r.cover} />
                <div className="min-w-0 flex-1">
                  <p className="mb-1 truncate text-sm font-semibold text-white">{r.title}</p>
                  <GameRequestStatusView request={r} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {ready.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2.5">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
            <h2 className="row-title text-white">Ready to play</h2>
            <Link to="/games/store/requests" className="text-xs font-semibold text-accent-300 hover:text-accent-200">
              Manage
            </Link>
          </div>
          <div className="-mx-2 flex gap-3 overflow-x-auto no-scrollbar px-2 pb-2">
            {ready.slice(0, 8).map((r) => (
              <Link
                key={r.id}
                to={storeGameHref(r.gameId)}
                className="flex w-64 shrink-0 items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.05] p-3 outline-none transition hover:border-emerald-400/40 hover:bg-emerald-500/[0.09] focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                <StoreThumb id={r.gameId} title={r.title} cover={r.cover} className="h-14 w-11" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{r.title}</p>
                  <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-300">
                    Installed · Ready
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function EmptyCatalog({ mode }: { mode: 'server' | 'demo' }) {
  const isAdmin = Boolean(getSession()?.isAdmin)
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-14 text-center">
      <h2 className="font-display text-3xl text-white">No catalog games yet</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-300">
        {mode === 'server'
          ? 'No game store feeds are synced yet. You can still search for any PC game in the search box above if Prowlarr is connected, or add a catalog feed in Settings.'
          : 'The store catalog is currently empty.'}
      </p>
      {isAdmin && (
        <Link
          to="/settings"
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
        >
          Configure in Settings → Games
        </Link>
      )}
    </div>
  )
}
