import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useGamePlatforms, useGames } from '../api/queries'
import { fetchSgdbCover, rommCoverUrl, isPlayable, type RommRom } from '../api/romm'
import { CardSkeleton } from '../components/Skeletons'

// Brand-ish colors per console so the (mostly art-less) grid reads as designed,
// not empty. Two-stop gradient keyed off the platform; unknown → hashed hue.
const PLATFORM_COLORS: Record<string, [string, string]> = {
  nes: ['#c9243f', '#7a0d1c'], famicom: ['#c9243f', '#7a0d1c'],
  snes: ['#8b5cf6', '#4c1d95'], sfc: ['#8b5cf6', '#4c1d95'],
  n64: ['#2f7d32', '#123f14'],
  gb: ['#8bac0f', '#38560a'], gbc: ['#a855f7', '#6b21a8'], gba: ['#4f46e5', '#312e81'],
  nds: ['#e11d48', '#881337'],
  psx: ['#334155', '#0f172a'], ps1: ['#334155', '#0f172a'], ps2: ['#1d4ed8', '#0b1e57'],
  ps3: ['#111827', '#000000'],
  genesis: ['#1e6fd9', '#0b3a7a'], megadrive: ['#1e6fd9', '#0b3a7a'], 'genesis-slash-megadrive': ['#1e6fd9', '#0b3a7a'],
  mastersystem: ['#2563eb', '#0b3a7a'], gamegear: ['#0891b2', '#0e3a45'],
  switch: ['#e60012', '#7a000a'], wiiu: ['#0ea5e9', '#075985'], wii: ['#38bdf8', '#0c4a6e'],
  gamecube: ['#6d5ae6', '#33257a'], gc: ['#6d5ae6', '#33257a'],
  psp: ['#0f172a', '#020617'], ps4: ['#1d4ed8', '#0b1e57'],
  arcade: ['#f59e0b', '#7c4a02'], mame: ['#f59e0b', '#7c4a02'], neogeo: ['#dc2626', '#7f1d1d'],
  pce: ['#ea580c', '#7c2d12'], c64: ['#4b5563', '#1f2937'],
}

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

function tileGradient(rom: RommRom): string {
  const c = PLATFORM_COLORS[rom.platform_slug?.toLowerCase()]
  if (c) return `linear-gradient(150deg, ${c[0]}, ${c[1]})`
  const hue = hashHue(rom.platform_slug || rom.name)
  return `linear-gradient(150deg, hsl(${hue} 55% 42%), hsl(${hue} 60% 20%))`
}

function GameCard({ rom }: { rom: RommRom }) {
  const romCover = rommCoverUrl(rom)
  const [sgdbCover, setSgdbCover] = useState<string | null>(null)
  const [inView, setInView] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const playable = isPlayable(rom)
  const title = cleanName(rom.name)
  const cover = romCover ?? sgdbCover

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
  const inner = (
    <div
      ref={cardRef}
      className={`relative aspect-[3/4] rounded-xl overflow-hidden bg-ink-800 ring-1 ring-white/5 transition-all ${
        playable ? 'group-hover:ring-accent-400/70 group-hover:shadow-2xl group-hover:shadow-black/60' : ''
      }`}
    >
      {cover ? (
        <img src={cover} alt={title} loading="lazy" className="h-full w-full object-cover fade-in" />
      ) : (
        <div className="h-full w-full flex flex-col justify-between p-3" style={{ backgroundImage: tileGradient(rom) }}>
          <span className="self-start rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
            {rom.platform_display_name}
          </span>
          <span className="text-[15px] font-bold leading-tight text-white line-clamp-4 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
            {title}
          </span>
        </div>
      )}
      {playable ? (
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="h-12 w-12 rounded-full bg-white/90 flex items-center justify-center">
            <svg className="h-6 w-6 text-ink-950 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      ) : (
        <div className="absolute top-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-ink-300 backdrop-blur">
          Browse only
        </div>
      )}
    </div>
  )

  return playable ? (
    <Link to={`/games/play/${rom.id}`} viewTransition className="group block outline-none">
      {inner}
      <p className="mt-2 px-0.5 text-sm font-medium text-ink-200 truncate group-hover:text-white transition-colors">
        {title}
      </p>
    </Link>
  ) : (
    <div className="group block" title="Not playable in a browser — retro consoles only">
      {inner}
      <p className="mt-2 px-0.5 text-sm font-medium text-ink-400 truncate">{title}</p>
    </div>
  )
}

/** Trim the file extension + redump/region noise for a clean display title. */
function cleanName(name: string): string {
  return name
    .replace(/\.(7z|zip|rar|z64|n64|nes|smc|sfc|gb[ac]?|gba|iso|nsp|nsz|xci|nds|md|bin|cue|chd|pce)$/i, '')
    .replace(/\[[^\]]*\]/g, '') // [NSP], [!], [FitGirl Repack]
    .replace(/\([^)]*\)/g, (m) => (/disc/i.test(m) ? m : '')) // drop (USA)/(Rev 1)/(En,Fr) — keep (Disc N)
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export default function GamesPage() {
  const { data: platforms } = useGamePlatforms()
  const [platformId, setPlatformId] = useState<number | undefined>()
  const [search, setSearch] = useState('')
  const { data, isLoading } = useGames(platformId, search.trim() || undefined)

  const games = useMemo(() => data?.items ?? [], [data])

  return (
    <div className="px-4 sm:px-6 lg:px-12 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <h1 className="text-2xl font-bold text-white tracking-tight">Games</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search games…"
          className="w-full sm:w-72 rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 text-ink-200"
        />
      </div>

      {/* Platform filter */}
      <div className="flex items-center gap-2 mb-6 overflow-x-auto no-scrollbar pb-1">
        <Chip active={platformId === undefined} onClick={() => setPlatformId(undefined)}>
          All
        </Chip>
        {platforms?.map((p) => (
          <Chip key={p.id} active={platformId === p.id} onClick={() => setPlatformId(p.id)}>
            {p.name} <span className="text-ink-400">{p.rom_count}</span>
          </Chip>
        ))}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {isLoading
          ? Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)
          : games.map((rom) => <GameCard key={rom.id} rom={rom} />)}
      </div>

      {!isLoading && games.length === 0 && (
        <p className="text-ink-400 text-sm py-12 text-center">No games found.</p>
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active ? 'bg-accent-500 text-white' : 'bg-ink-800 text-ink-300 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}
