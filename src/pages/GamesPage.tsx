import { memo, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getSession } from '../api/client'
import { useGamePlatforms, useGames } from '../api/queries'
import { fetchSgdbCover, rommCoverUrl, isPlayable, cleanName, tileGradient, type RommRom } from '../api/romm'
import { useGameRequests, useStoreMode } from '../api/gameStoreQueries'
import { CardSkeleton } from '../components/Skeletons'
import { useMoonlightApp } from '../components/MoonlightPlay'
import StreamingSection from '../components/StreamingSection'
import { AddRomsModal } from '../components/gamestore/AddRomsModal'
import { GameRequestStatusView, installerHref } from '../components/gamestore/GameRequestStatus'
import { StoreThumb, storeGameHref } from '../components/gamestore/StoreCards'
import { StoreHeader, StoreSearchBox } from '../components/gamestore/StoreHeader'
import YourGames from '../components/gamestore/YourGames'
import { IS_TV } from '../lib/device'
import { useFinesse } from '../lib/finesseServer'
import { readDrop, type Dropped } from '../lib/mediaSort'

const GameCard = memo(function GameCard({ rom }: { rom: RommRom }) {
  // RomM's cover, unless it didn't load: then SteamGridDB's, then the tile.
  const [romFailed, setRomFailed] = useState(false)
  const romCover = romFailed ? null : rommCoverUrl(rom)
  const [sgdbCover, setSgdbCover] = useState<string | null>(null)
  const [sgdbFailed, setSgdbFailed] = useState(false)
  const [inView, setInView] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const playable = isPlayable(rom)
  const moonlight = useMoonlightApp(playable ? undefined : rom.platform_slug).app
  const title = cleanName(rom.name)
  const cover = romCover ?? (sgdbFailed ? null : sgdbCover)

  // Only look up a SteamGridDB cover once the card is near the viewport, so
  // scrolling past 300 games doesn't fire hundreds of lookups up front.
  useEffect(() => {
    if (romCover || inView) return
    const el = cardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [romCover, inView])

  useEffect(() => {
    if (romCover || !inView) return
    let cancelled = false
    fetchSgdbCover(rom.fs_name_no_tags || title).then((url) => {
      if (!cancelled && url) setSgdbCover(url)
    })
    return () => {
      cancelled = true
    }
  }, [romCover, inView, rom.fs_name_no_tags, title])

  return (
    <Link to={`/games/game/${rom.id}`} viewTransition className="own-focus group block outline-none">
      <div
        ref={cardRef}
        // Every card is clickable (opens GameDetailPage), so every card gets the hover & focus ring.
        className="tilt sheen relative aspect-[3/4] overflow-hidden rounded-xl bg-ink-800 ring-1 ring-white/5 transition-all group-hover:shadow-2xl group-hover:shadow-black/60 group-hover:ring-accent-400/70 group-focus-visible:ring-2 group-focus-visible:ring-accent-400"
      >
        {cover ? (
          <img
            decoding="async"
            src={cover}
            alt={title}
            loading="lazy"
            className="fade-in h-full w-full object-cover"
            onError={() => (cover === romCover ? setRomFailed(true) : setSgdbFailed(true))}
          />
        ) : (
          <div className="flex h-full w-full flex-col justify-between p-3" style={{ backgroundImage: tileGradient(rom) }}>
            <span className="self-start rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
              {rom.platform_display_name}
            </span>
            <span className="line-clamp-4 text-[15px] font-bold leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
              {title}
            </span>
          </div>
        )}
        {playable ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90">
              <svg className="h-6 w-6 translate-x-0.5 text-ink-950" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        ) : (
          <div className={`absolute right-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium backdrop-blur ${moonlight ? 'text-accent-200' : 'text-ink-300'}`}>
            {moonlight ? 'Moonlight' : 'Details'}
          </div>
        )}
      </div>
      <p className="mt-2 truncate px-0.5 text-sm font-medium text-ink-200 transition-colors group-hover:text-white group-focus-visible:text-white">
        {title}
      </p>
    </Link>
  )
})

const SHELF_CAP = 20
const SHELF_ARROW = 'grid h-8 w-8 place-items-center rounded-full bg-ink-800/90 text-ink-200 ring-1 ring-white/10 transition-colors hover:bg-ink-700 hover:text-white'

/** Games: streaming from the server (Wolf), retro library (RomM), and Game Store showcase. */
export default function GamesPage() {
  const { info } = useFinesse()
  const storeMode = useStoreMode()
  const streaming = Boolean(info?.features.streaming)
  // Older servers without discovery: the games library, as before.
  const library = info ? Boolean(info.features.games) : true

  if (library) return <GamesLibrary top={streaming ? <StreamingSection /> : null} />

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-12">
      <StoreHeader title="Games" />
      <YourGames />
      {streaming && <StreamingSection />}
      {storeMode ? (
        <StoreOnlyShowcase />
      ) : !streaming ? (
        <NoGamesConfigured />
      ) : null}
    </div>
  )
}

/** Shown when Game Store is enabled without a RomM library, so /games is never blank. */
function StoreOnlyShowcase() {
  const { data: requests } = useGameRequests()
  const ready = (requests ?? []).filter((r) => r.state === 'ready')
  const active = (requests ?? []).filter((r) => r.state !== 'ready')

  return (
    <div className="space-y-8">
      {ready.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="row-title text-white">Installed from Store</h2>
            <Link to="/games/store/requests" className="text-xs font-semibold text-accent-300 hover:text-accent-200">
              Manage
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ready.map((r) => (
              <Link
                key={r.id}
                to={storeGameHref(r.gameId)}
                className="flex items-center gap-3.5 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.05] p-3.5 outline-none transition hover:border-emerald-400/40 hover:bg-emerald-500/[0.09] focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                <StoreThumb id={r.gameId} title={r.title} cover={r.cover} className="h-16 w-12" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{r.title}</p>
                  <GameRequestStatusView request={r} className="mt-0.5" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {active.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="row-title text-white">In progress</h2>
            <Link to="/games/store/requests" className="text-xs font-semibold text-accent-300 hover:text-accent-200">
              See all
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.slice(0, 6).map((r) => (
              <Link
                key={r.id}
                to={r.state === 'needs-you' ? installerHref(r) : storeGameHref(r.gameId)}
                className="flex items-center gap-3.5 rounded-xl border border-white/10 bg-white/[0.035] p-3.5 outline-none transition hover:border-white/20 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                <StoreThumb id={r.gameId} title={r.title} cover={r.cover} className="h-16 w-12" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{r.title}</p>
                  <GameRequestStatusView request={r} className="mt-0.5" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-accent-500/15 via-white/[0.04] to-transparent p-6 sm:p-10">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-300">Game Store</p>
          <h2 className="font-display mt-2 text-3xl leading-tight text-white sm:text-4xl">
            Discover & install PC games right from Finesse
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-200">
            Browse curated feeds or search live PC game indexers. Requested games download, verify, and install straight onto your server.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/games/store"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.98]"
            >
              Open Game Store
            </Link>
            <Link
              to="/games/store/browse"
              className="inline-flex h-11 items-center rounded-lg border border-white/15 bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.98]"
            >
              Browse all games
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

function NoGamesConfigured() {
  const isAdmin = Boolean(getSession()?.isAdmin)
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-lg font-semibold text-white">No game sources set up yet</p>
      <p className="mt-2 text-sm text-ink-400">
        {isAdmin
          ? 'Connect RomM, Wolf game streaming, or enable the Game Store in Settings → Games to start playing.'
          : 'Ask an administrator to enable Games or the Game Store in Settings.'}
      </p>
      {isAdmin && (
        <Link
          to="/settings"
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
        >
          Open Settings
        </Link>
      )}
    </div>
  )
}

function ConsoleShelf({
  platform,
  games,
  onSelectPlatform,
}: {
  platform: { id: number; name: string; rom_count: number }
  games: RommRom[]
  onSelectPlatform: (id: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollBy = (dir: number) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <section className="group/row mb-9">
      <div className="mb-3 flex items-center gap-3">
        <button onClick={() => onSelectPlatform(platform.id)} className="group/h flex min-w-0 items-center gap-2 text-left">
          <h2 className="row-title truncate text-white transition-colors group-hover/h:text-accent-300">{platform.name}</h2>
          <span className="text-sm text-ink-400">{platform.rom_count}</span>
          <svg
            className="h-4 w-4 -translate-x-1 text-ink-400 opacity-0 transition-all group-hover/h:translate-x-0 group-hover/h:opacity-100"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </button>
        <div className="flex-1" />
        {!IS_TV && games.length > 4 && (
          <div className="hidden gap-1 opacity-0 transition-opacity group-hover/row:opacity-100 md:flex">
            <button type="button" onClick={() => scrollBy(-1)} tabIndex={-1} className={SHELF_ARROW} aria-label={`Scroll ${platform.name} left`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button type="button" onClick={() => scrollBy(1)} tabIndex={-1} className={SHELF_ARROW} aria-label={`Scroll ${platform.name} right`}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {/* Room around the cards: a scroller clips what pokes out, and the focus ring and hover lift do. */}
      <div ref={scrollRef} className="-mx-2 -mt-2 flex gap-4 overflow-x-auto no-scrollbar scroll-smooth px-2 pb-2 pt-2">
        {games.slice(0, SHELF_CAP).map((rom) => (
          <div key={rom.id} className="w-36 shrink-0">
            <GameCard rom={rom} />
          </div>
        ))}
        {games.length > SHELF_CAP && (
          <button
            type="button"
            onClick={() => onSelectPlatform(platform.id)}
            className="flex aspect-[3/4] w-36 shrink-0 items-center justify-center self-start rounded-xl border border-white/5 bg-ink-800/60 text-sm font-medium text-ink-300 transition-colors hover:bg-ink-800 hover:text-white"
          >
            See all {platform.rom_count} →
          </button>
        )}
      </div>
    </section>
  )
}

function GamesLibrary({ top }: { top: React.ReactNode }) {
  const { info } = useFinesse()
  const isAdmin = Boolean(getSession()?.isAdmin)
  const canAddRoms = !__WEBOS__ && isAdmin && Boolean(info?.features?.addMedia || info?.features?.games)

  const [params, setParams] = useSearchParams()
  const urlPlatformRaw = params.get('platform')
  const platformId = urlPlatformRaw && /^\d+$/.test(urlPlatformRaw) ? Number(urlPlatformRaw) : undefined
  const urlQ = params.get('q') ?? ''

  const [searchInput, setSearchInput] = useState(urlQ)
  const [debouncedSearch, setDebouncedSearch] = useState(urlQ)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addModalTab, setAddModalTab] = useState<'upload' | 'import'>('upload')
  const [droppedFiles, setDroppedFiles] = useState<Dropped[] | undefined>(undefined)
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)

  const paramsRef = useRef({ platformId, urlQ })
  paramsRef.current = { platformId, urlQ }

  // Sync local input when navigating Back/Forward
  useEffect(() => {
    setSearchInput(urlQ)
    setDebouncedSearch(urlQ)
  }, [urlQ])

  // Debounce search and keep URL search params in sync without clobbering platform
  useEffect(() => {
    const t = setTimeout(() => {
      const nextQ = searchInput.trim()
      setDebouncedSearch(nextQ)
      if (nextQ !== paramsRef.current.urlQ) {
        const next = new URLSearchParams()
        if (paramsRef.current.platformId !== undefined) next.set('platform', String(paramsRef.current.platformId))
        if (nextQ) next.set('q', nextQ)
        setParams(next, { replace: true })
      }
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, setParams])

  const setPlatformId = (id: number | undefined) => {
    const next = new URLSearchParams()
    if (id !== undefined) next.set('platform', String(id))
    const q = searchInput.trim()
    if (q) next.set('q', q)
    setParams(next, { replace: true })
  }

  const { data: platforms } = useGamePlatforms()
  const { data, isLoading, isError, refetch } = useGames(platformId, debouncedSearch || undefined)

  const selectedPlatform = useMemo(
    () => (platformId !== undefined ? platforms?.find((p) => p.id === platformId) : undefined),
    [platformId, platforms],
  )
  const defaultConsole = selectedPlatform?.fs_slug || selectedPlatform?.slug

  const games = useMemo(() => data?.items ?? [], [data])
  const shelfMode = platformId === undefined && !debouncedSearch

  // For the "All" view, group games into a horizontal shelf per console.
  const shelves = useMemo(() => {
    if (!shelfMode || !platforms) return []
    const byPlat = new Map<number, RommRom[]>()
    for (const g of games) {
      const arr = byPlat.get(g.platform_id) ?? []
      arr.push(g)
      byPlat.set(g.platform_id, arr)
    }
    return platforms
      .map((p) => ({ platform: p, games: byPlat.get(p.id) ?? [] }))
      .filter((x) => x.games.length > 0)
  }, [shelfMode, games, platforms])

  const openAddModal = (tab: 'upload' | 'import' = 'upload') => {
    setDroppedFiles(undefined)
    setAddModalTab(tab)
    setAddModalOpen(true)
  }

  const hasDraggedFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')

  const handleDragEnter = (e: DragEvent) => {
    if (!canAddRoms || addModalOpen || !hasDraggedFiles(e)) return
    e.stopPropagation()
    dragDepth.current += 1
    setDragOver(true)
  }

  const handleDragOver = (e: DragEvent) => {
    if (!canAddRoms || addModalOpen || !hasDraggedFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (e: DragEvent) => {
    if (!canAddRoms || addModalOpen || !hasDraggedFiles(e)) return
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }

  const handleDrop = (e: DragEvent) => {
    if (!canAddRoms || addModalOpen || !hasDraggedFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragOver(false)
    const dt = e.dataTransfer
    void readDrop(dt).then((items) => {
      if (!items.length) return
      setDroppedFiles(items)
      setAddModalTab('upload')
      setAddModalOpen(true)
    })
  }

  const addRomsBtn = canAddRoms ? (
    <button
      type="button"
      onClick={() => openAddModal('upload')}
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent-fill px-4 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(79,99,180,.35)] outline-none transition hover:brightness-110 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent-400"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      Add ROMs
    </button>
  ) : null

  const searchBox = (
    <StoreSearchBox
      value={searchInput}
      onChange={setSearchInput}
      onSubmit={() => {
        const nextQ = searchInput.trim()
        setDebouncedSearch(nextQ)
        const next = new URLSearchParams()
        if (platformId !== undefined) next.set('platform', String(platformId))
        if (nextQ) next.set('q', nextQ)
        setParams(next, { replace: true })
      }}
      placeholder="Search your games…"
      ariaLabel="Search the games library"
      className="w-full sm:w-72"
    />
  )

  return (
    <div
      className="relative min-h-[calc(100vh-8rem)] px-4 py-6 sm:px-6 lg:px-12"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div
          className="pointer-events-none fixed inset-0 z-[85] grid place-items-center bg-ink-950/75 p-6 backdrop-blur-md"
          aria-hidden
        >
          <div className="flex flex-col items-center gap-3.5 rounded-[2rem] border-2 border-dashed border-accent-300/80 bg-accent-500/15 px-12 py-10 text-center shadow-[0_0_80px_rgba(117,137,216,.35)]">
            <svg viewBox="0 0 24 24" className="h-11 w-11 text-accent-300" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5" />
              <path d="M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" />
            </svg>
            <p className="font-display text-[30px] leading-tight text-white">
              Drop ROMs to add{selectedPlatform ? ` to ${selectedPlatform.name}` : ''}
            </p>
            <p className="text-[13.5px] text-ink-200">
              Single files, .zip archives, or whole console folders
            </p>
          </div>
        </div>
      )}

      {top ? (
        <>
          <StoreHeader title="Games" extra={addRomsBtn} />
          <YourGames />
          {top}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <h2 className="row-title text-white">Games library</h2>
            {searchBox}
          </div>
        </>
      ) : (
        <>
          <StoreHeader
            title="Games"
            extra={
              <div className="flex w-full flex-wrap items-center justify-end gap-2.5 sm:w-auto">
                {searchBox}
                {addRomsBtn}
              </div>
            }
          />
          <YourGames />
        </>
      )}

      {/* Platform filter */}
      <div className="-mx-2 -my-1 mb-6 flex items-center gap-2 overflow-x-auto no-scrollbar px-2 py-1.5">
        <Chip active={platformId === undefined} onClick={() => setPlatformId(undefined)}>
          All
        </Chip>
        {platforms?.map((p) => (
          <Chip key={p.id} active={platformId === p.id} onClick={() => setPlatformId(p.id)}>
            {p.name} <span className={platformId === p.id ? 'text-ink-700' : 'text-ink-400'}>{p.rom_count}</span>
          </Chip>
        ))}
      </div>

      {isError ? (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-white">Couldn’t load your games</p>
          <p className="mt-1 text-sm text-ink-400">The games library didn’t respond. Check that RomM is online and try again.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
          >
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-2.5 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : shelfMode ? (
        shelves.map(({ platform, games: pg }) => (
          <ConsoleShelf key={platform.id} platform={platform} games={pg} onSelectPlatform={setPlatformId} />
        ))
      ) : (
        <div className="grid grid-cols-2 gap-2.5 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-4">
          {games.map((rom) => (
            <div key={rom.id} className="cv-card">
              <GameCard rom={rom} />
            </div>
          ))}
        </div>
      )}

      {!isLoading && !isError && games.length === 0 && (
        debouncedSearch || platformId !== undefined ? (
          <div className="py-14 text-center">
            <p className="text-base font-semibold text-white">No games found</p>
            <p className="mt-1 text-sm text-ink-400">Try clearing your search or platform filter.</p>
            <button
              type="button"
              onClick={() => {
                setSearchInput('')
                setDebouncedSearch('')
                setParams(new URLSearchParams(), { replace: true })
              }}
              className="mt-4 inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Show all games
            </button>
          </div>
        ) : (
          <section className="mx-auto my-8 max-w-2xl rounded-2xl border border-white/10 bg-gradient-to-br from-accent-500/15 via-white/[0.03] to-transparent p-7 text-center sm:p-10">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-accent-300" aria-hidden>
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5h10.5a4.5 4.5 0 0 1 4.44 5.24l-.56 3.38a3.25 3.25 0 0 1-5.5 1.77l-1.4-1.39h-4.46l-1.4 1.39a3.25 3.25 0 0 1-5.5-1.77l-.56-3.38A4.5 4.5 0 0 1 6.75 7.5Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 11.25v3m-1.5-1.5h3m5.25-.75h.01M17.25 13.5h.01" />
              </svg>
            </div>
            <h2 className="font-display text-2xl text-white sm:text-3xl">Build your retro game library</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-300">
              Drop ROMs right onto this page, browse free retro titles &amp; connected ROM sources, or import an existing folder from your server or SD card.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {canAddRoms && (
                <button
                  type="button"
                  onClick={() => openAddModal('upload')}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent-fill px-4 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add ROMs
                </button>
              )}
              <Link
                to="/games/store/retro"
                className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.98]"
              >
                Browse Retro Store
              </Link>
              {canAddRoms && (
                <button
                  type="button"
                  onClick={() => openAddModal('import')}
                  className="inline-flex h-10 items-center rounded-lg border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.98]"
                >
                  Import server folder
                </button>
              )}
            </div>
          </section>
        )
      )}

      {canAddRoms && (
        <AddRomsModal
          open={addModalOpen}
          onClose={() => {
            setAddModalOpen(false)
            setDroppedFiles(undefined)
          }}
          defaultConsole={defaultConsole}
          initialTab={addModalTab}
          initialFiles={droppedFiles}
        />
      )}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
        active ? 'bg-[#f5f3ee] text-ink-950' : 'border border-white/10 bg-white/[0.06] text-ink-200 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}
