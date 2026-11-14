// The game store's front: a featured game, what you've asked for, genres, and shelves. Every
// shelf carries the search behind it, so "See all" opens Browse with those filters set.

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { browseHref, type GameMode, type GameRequest, type StoreGame } from '../api/gameStore'
import { useGameRequests, useStoreFacets, useStoreHome, useStoreMode } from '../api/gameStoreQueries'
import { PLAY_BTN } from '../components/ActionButton'
import { GameRequestStatusView } from '../components/gamestore/GameRequestStatus'
import { ShelfSkeleton, StoreCover, StoreShelf, StoreThumb, storeGameHref, storeGradient } from '../components/gamestore/StoreCards'
import { StoreHeader, StoreSearchBox } from '../components/gamestore/StoreHeader'
import { IS_TV } from '../lib/device'

export default function GameStorePage() {
  const mode = useStoreMode()
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const home = useStoreHome()
  const facets = useStoreFacets({})
  const { data: requests } = useGameRequests()
  const byGame = useMemo(() => new Map((requests ?? []).map((r) => [r.gameId, r])), [requests])
  const current = (requests ?? []).filter((r) => r.state !== 'ready')

  if (!mode) return <NoStore />

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-12">
      <StoreHeader
        extra={
          <StoreSearchBox value={term} onChange={setTerm} onSubmit={() => term.trim() && navigate(browseHref({ q: term.trim() }))} />
        }
      />

      {home.isError ? (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-white">Couldn’t load the store</p>
          <p className="mt-1 text-sm text-ink-400">The game store didn’t answer. Try again in a moment.</p>
          <button type="button" onClick={() => home.refetch()} className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200">
            Try again
          </button>
        </div>
      ) : (
        <>
          {home.data ? <Featured games={home.data.featured} requests={byGame} /> : <div className="mb-9 h-[300px] rounded-2xl shimmer sm:h-[360px]" />}

          {current.length > 0 && <YourRequests requests={current} />}

          {facets.data && facets.data.genres.length > 0 && (
            <section className="mb-9">
              <h2 className="row-title mb-3 text-white">Genres</h2>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                {facets.data.genres.slice(0, 10).map((g) => (
                  <Link
                    key={g.value}
                    to={browseHref({ genres: [g.value] })}
                    className="group relative flex h-20 items-end overflow-hidden rounded-xl p-3 ring-1 ring-white/5 outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent-400"
                    style={{ backgroundImage: storeGradient(g.value, 120) }}
                  >
                    <span className="font-display text-xl leading-none text-white drop-shadow">{g.label}</span>
                    <span className="absolute right-3 top-2.5 text-xs font-semibold text-white/70">{g.count}</span>
                  </Link>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {facets.data.modes.map((m) => (
                  <Link key={m.value} to={browseHref({ mode: m.value as GameMode })} className="h-9 rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm font-medium leading-9 text-ink-200 hover:text-white">
                    {m.label} <span className="text-ink-400">{m.count}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {home.data
            ? home.data.shelves.map((s) => <StoreShelf key={s.id} title={s.title} href={browseHref(s.query)} games={s.items} requests={byGame} />)
            : Array.from({ length: 3 }).map((_, i) => <ShelfSkeleton key={i} />)}
        </>
      )}
    </div>
  )
}

/** One big featured game at a time, with dots to pick another; turns on its own every 9 s. */
function Featured({ games, requests }: { games: StoreGame[]; requests: Map<string, GameRequest> }) {
  const [i, setI] = useState(0)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (held || games.length < 2 || IS_TV) return
    const t = setTimeout(() => setI((n) => (n + 1) % games.length), 9000)
    return () => clearTimeout(t)
  }, [i, held, games.length])
  const g = games[i % Math.max(1, games.length)]
  if (!g) return null
  const r = requests.get(g.id)
  return (
    <section
      className="relative mb-9 overflow-hidden rounded-2xl ring-1 ring-white/10"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      aria-roledescription="carousel"
      aria-label="Featured games"
    >
      <div key={g.id} className="fade-in absolute inset-0" style={g.hero ? undefined : { backgroundImage: storeGradient(g.id, 110) }} aria-hidden>
        {g.hero && <img src={g.hero} alt="" className="h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/85 via-ink-950/40 to-transparent" />
      </div>
      <div className="relative flex min-h-[300px] items-end gap-8 p-5 sm:min-h-[360px] sm:p-8">
        <div className="hidden w-44 shrink-0 overflow-hidden rounded-xl shadow-2xl shadow-black/50 ring-1 ring-white/15 md:block aspect-[3/4]">
          <StoreCover game={g} big />
        </div>
        <div className="min-w-0 max-w-xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">Featured</p>
          <h2 className="font-display mb-3 text-4xl leading-[0.95] text-white drop-shadow-lg sm:text-5xl">{g.title}</h2>
          <p className="mb-2 text-sm text-ink-200">{[g.genres.slice(0, 2).join(', '), g.year, g.developer].filter(Boolean).join(' · ')}</p>
          <p className="mb-5 line-clamp-3 text-[15px] text-ink-100">{g.summary}</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to={storeGameHref(g.id)} className={PLAY_BTN}>
              {r ? 'See your request' : 'See the game'}
            </Link>
            {r && <GameRequestStatusView request={r} />}
          </div>
        </div>
      </div>
      {games.length > 1 && (
        <div className="absolute right-5 top-5 flex gap-1.5 sm:bottom-4 sm:top-auto">
          {games.map((x, n) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setI(n)}
              aria-label={`Show ${x.title}`}
              aria-current={n === i ? 'true' : undefined}
              className={`h-2 rounded-full transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent-400 ${n === i ? 'w-6 bg-white' : 'w-2 bg-white/40 hover:bg-white/70'}`}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** What's on its way (or needs a hand), newest first. */
function YourRequests({ requests }: { requests: GameRequest[] }) {
  return (
    <section className="mb-9">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="row-title text-white">Your requests</h2>
        <Link to="/games/store/requests" className="text-xs font-semibold text-accent-300 hover:text-accent-200">
          See all
        </Link>
      </div>
      <div className="-mx-2 flex gap-3 overflow-x-auto no-scrollbar px-2 pb-2">
        {requests.slice(0, 8).map((r) => (
          <Link
            key={r.id}
            to={r.state === 'needs-you' ? `/games/store/requests/${encodeURIComponent(r.id)}/installer` : storeGameHref(r.gameId)}
            className="flex w-72 shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 outline-none hover:bg-white/[0.07] focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            <StoreThumb id={r.gameId} title={r.title} cover={r.cover} />
            <div className="min-w-0 flex-1">
              <p className="mb-1 truncate text-sm font-semibold text-white">{r.title}</p>
              <GameRequestStatusView request={r} />
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function NoStore() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="page-title">Game store</h1>
      <p className="mt-3 text-sm text-ink-300">This server doesn’t have the game store yet. It arrives with a Finesse update.</p>
      <Link to="/games" className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200">
        Back to Games
      </Link>
    </div>
  )
}
