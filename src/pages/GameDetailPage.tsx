import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useGame } from '../api/queries'
import {
  cleanName,
  ejsCore,
  fetchSgdbCover,
  isPlayable,
  rommCoverUrl,
  tileGradient,
  type RommRom,
} from '../api/romm'

function useCover(rom: RommRom | undefined) {
  const rommCover = rom ? rommCoverUrl(rom) : null
  const [sgdb, setSgdb] = useState<string | null>(null)
  useEffect(() => {
    if (!rom || rommCover) return
    let cancelled = false
    fetchSgdbCover(rom.fs_name_no_tags || cleanName(rom.name)).then((url) => {
      if (!cancelled && url) setSgdb(url)
    })
    return () => {
      cancelled = true
    }
  }, [rom, rommCover])
  return rommCover ?? sgdb
}

export default function GameDetailPage() {
  const { romId } = useParams()
  const { data: rom, isLoading } = useGame(romId)
  const cover = useCover(rom)

  if (isLoading || !rom) return <div className="h-[60vh] shimmer -mt-16" />

  const title = cleanName(rom.name)
  const playable = isPlayable(rom)
  const core = ejsCore(rom.platform_slug)
  const siblings = (rom.siblings ?? []).filter((s) => s.id !== rom.id)

  return (
    <div className="min-h-[60vh] pb-16">
      {/* Ambient blurred cover behind everything */}
      {cover && (
        <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden>
          <img src={cover} alt="" className="h-full w-full object-cover blur-3xl brightness-[0.25] saturate-150 scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/60 to-ink-950/30" />
        </div>
      )}

      <div className="px-4 sm:px-6 lg:px-12 pt-8">
        <Link to="/games" className="inline-flex items-center gap-1.5 text-sm text-ink-300 hover:text-white transition-colors mb-6">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Games
        </Link>

        <div className="flex flex-col sm:flex-row gap-8 items-start">
          {/* Cover */}
          <div
            className="w-48 sm:w-56 shrink-0 aspect-[3/4] rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-black/50"
            style={{ viewTransitionName: 'vt-poster' }}
          >
            {cover ? (
              <img src={cover} alt={title} className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex flex-col justify-between p-3" style={{ backgroundImage: tileGradient(rom) }}>
                <span className="self-start rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
                  {rom.platform_display_name}
                </span>
                <span className="text-lg font-bold leading-tight text-white line-clamp-4">{title}</span>
              </div>
            )}
          </div>

          {/* Info + actions */}
          <div className="min-w-0 flex-1 pt-2">
            <h1 className="text-3xl font-bold text-white tracking-tight mb-2">{title}</h1>
            <div className="flex flex-wrap items-center gap-2 mb-6 text-sm text-ink-300">
              <span className="px-2 py-0.5 rounded-md bg-white/10 font-medium">{rom.platform_display_name}</span>
              {playable ? (
                <span className="text-emerald-400">Playable in browser</span>
              ) : (
                <span className="text-ink-400">Browse only — not emulatable in a browser</span>
              )}
            </div>

            {playable ? (
              <Link
                to={`/games/play/${rom.id}`}
                viewTransition
                className="inline-flex items-center gap-2 rounded-lg bg-white text-ink-950 px-7 py-3 text-sm font-semibold hover:bg-ink-200 active:scale-[0.98] transition-all"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Play
              </Link>
            ) : (
              <p className="text-sm text-ink-400 max-w-md">
                {rom.platform_display_name} games can’t run in a browser — this is here so you can browse the
                library. Retro consoles (NES, SNES, Game Boy, N64, Genesis, PS1…) play inline.
              </p>
            )}

            {rom.summary && <p className="text-sm leading-relaxed text-ink-200 mt-6 max-w-2xl">{rom.summary}</p>}

            {/* Alternate versions */}
            {siblings.length > 0 && (
              <div className="mt-8">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-3">
                  Other versions
                </h2>
                <div className="flex flex-wrap gap-2">
                  {siblings.map((s) => {
                    const label = cleanName(s.name)
                    return core ? (
                      <Link
                        key={s.id}
                        to={`/games/play/${s.id}`}
                        className="rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 text-xs font-medium text-ink-200 hover:text-white transition-colors"
                      >
                        {label || s.fs_name}
                      </Link>
                    ) : (
                      <span key={s.id} className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-ink-400">
                        {label || s.fs_name}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            <p className="mt-8 text-xs text-ink-500 font-mono break-all">{rom.fs_name}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
