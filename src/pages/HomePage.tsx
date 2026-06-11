import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLatest, useNextUp, useResume, useViews } from '../api/queries'
import { backdropUrl, logoUrl } from '../api/client'
import { formatRuntime } from '../api/types'
import type { JfItem } from '../api/types'
import MediaRow from '../components/MediaRow'
import { HeroSkeleton } from '../components/Skeletons'

const HOME_COLLECTIONS = new Set(['movies', 'tvshows'])
const HERO_ROTATE_MS = 9000
const HERO_COUNT = 5

function HeroCarousel({ items }: { items: JfItem[] }) {
  const [index, setIndex] = useState(0)
  const active = items[index]

  useEffect(() => {
    if (items.length < 2) return
    const t = setInterval(() => setIndex((i) => (i + 1) % items.length), HERO_ROTATE_MS)
    return () => clearInterval(t)
  }, [items.length])

  const logo = logoUrl(active)

  return (
    <div className="relative h-[68vh] min-h-[460px] w-full -mt-16 overflow-hidden">
      {/* Stacked backdrops crossfade; the active one slow-zooms (Ken Burns) */}
      {items.map((item, i) => {
        const backdrop = backdropUrl(item)
        return (
          <div
            key={item.Id}
            className="absolute inset-0 transition-opacity duration-1000 ease-out"
            style={{ opacity: i === index ? 1 : 0 }}
          >
            {backdrop && (
              /* key swap restarts the Ken Burns zoom each time this slide becomes active */
              <img
                key={i === index ? `active-${index}` : `idle-${i}`}
                src={backdrop}
                alt=""
                className={`h-full w-full object-cover ${i === index ? 'kenburns' : ''}`}
              />
            )}
          </div>
        )
      })}

      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/25 to-ink-950/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/85 via-ink-950/20 to-transparent" />

      {/* Content swaps with a rise-in on every rotation */}
      <div key={active.Id} className="absolute bottom-0 left-0 p-6 lg:p-12 max-w-2xl hero-content-in">
        {logo ? (
          <img src={logo} alt={active.Name} className="max-h-28 max-w-md object-contain mb-4 drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)]" />
        ) : (
          <h1 className="text-4xl lg:text-6xl font-bold text-white tracking-tight mb-3 drop-shadow-lg">
            {active.Name}
          </h1>
        )}
        <div className="flex items-center gap-3 text-sm text-ink-200 mb-4">
          {active.ProductionYear && <span>{active.ProductionYear}</span>}
          {active.RunTimeTicks && <span>{formatRuntime(active.RunTimeTicks)}</span>}
          {active.OfficialRating && (
            <span className="px-1.5 py-0.5 rounded border border-white/20 text-xs">
              {active.OfficialRating}
            </span>
          )}
          {active.CommunityRating && (
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
              </svg>
              {active.CommunityRating.toFixed(1)}
            </span>
          )}
        </div>
        {active.Overview && (
          <p className="text-sm text-ink-200/90 line-clamp-3 mb-6 max-w-xl drop-shadow">
            {active.Overview}
          </p>
        )}
        <div className="flex gap-3">
          <Link
            to={`/play/${active.Id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-white text-ink-950 px-6 py-2.5 text-sm font-semibold hover:bg-ink-200 hover:shadow-[0_0_28px_rgba(255,255,255,0.25)] active:scale-[0.97] transition-all"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play
          </Link>
          <Link
            to={`/item/${active.Id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 backdrop-blur-md px-6 py-2.5 text-sm font-semibold text-white hover:bg-white/20 active:scale-[0.97] transition-all"
          >
            More info
          </Link>
        </div>
      </div>

      {/* Rotation dots */}
      {items.length > 1 && (
        <div className="absolute bottom-6 right-6 lg:right-12 flex gap-2">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Show featured item ${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 active:scale-90 ${
                i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function HomePage() {
  const { data: views, isLoading: viewsLoading } = useViews()
  const { data: resume, isLoading: resumeLoading } = useResume()
  const { data: nextUp, isLoading: nextUpLoading } = useNextUp()

  const libraries = useMemo(
    () => views?.Items.filter((v) => HOME_COLLECTIONS.has(v.CollectionType ?? '')) ?? [],
    [views],
  )

  const movieLib = libraries.find((l) => l.CollectionType === 'movies')
  const showLib = libraries.find((l) => l.CollectionType === 'tvshows')
  const { data: latestMovies, isLoading: moviesLoading } = useLatest(movieLib?.Id)
  const { data: latestShows, isLoading: showsLoading } = useLatest(showLib?.Id)

  const heroItems = useMemo(() => {
    const candidates = [...(latestMovies ?? []), ...(latestShows ?? [])]
    return candidates.filter((i) => i.BackdropImageTags?.length).slice(0, HERO_COUNT)
  }, [latestMovies, latestShows])

  const heroLoading = viewsLoading || (moviesLoading && showsLoading)

  return (
    <div className="pb-16">
      {/* Ambient drifting aurora behind everything */}
      <div className="aurora" aria-hidden>
        <div />
        <div />
        <div />
      </div>

      {heroLoading ? (
        <HeroSkeleton />
      ) : heroItems.length > 0 ? (
        <HeroCarousel items={heroItems} />
      ) : null}

      <div className="space-y-10 mt-10">
        <MediaRow title="Continue Watching" items={resume?.Items} loading={resumeLoading} />
        <MediaRow title="Next Up" items={nextUp?.Items} loading={nextUpLoading} />
        {movieLib && (
          <MediaRow title={`Recently Added · ${movieLib.Name}`} items={latestMovies} loading={moviesLoading} />
        )}
        {showLib && (
          <MediaRow title={`Recently Added · ${showLib.Name}`} items={latestShows} loading={showsLoading} />
        )}
      </div>
    </div>
  )
}
