import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLatest, useNextUp, useResume, useViews } from '../api/queries'
import { backdropUrl, logoUrl } from '../api/client'
import { formatRuntime } from '../api/types'
import type { JfItem } from '../api/types'
import MediaRow from '../components/MediaRow'
import { HeroSkeleton } from '../components/Skeletons'

const HOME_COLLECTIONS = new Set(['movies', 'tvshows'])

function Hero({ item }: { item: JfItem }) {
  const backdrop = backdropUrl(item)
  const logo = logoUrl(item)

  return (
    <div className="relative h-[62vh] min-h-[420px] w-full -mt-16">
      {backdrop && (
        <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover fade-in" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-ink-950/20" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/80 via-transparent to-transparent" />

      <div className="absolute bottom-0 left-0 p-6 lg:p-12 max-w-2xl">
        {logo ? (
          <img src={logo} alt={item.Name} className="max-h-24 max-w-sm object-contain mb-4" />
        ) : (
          <h1 className="text-4xl lg:text-5xl font-bold text-white tracking-tight mb-3">
            {item.Name}
          </h1>
        )}
        <div className="flex items-center gap-3 text-sm text-ink-200 mb-4">
          {item.ProductionYear && <span>{item.ProductionYear}</span>}
          {item.RunTimeTicks && <span>{formatRuntime(item.RunTimeTicks)}</span>}
          {item.OfficialRating && (
            <span className="px-1.5 py-0.5 rounded border border-white/20 text-xs">
              {item.OfficialRating}
            </span>
          )}
          {item.CommunityRating && (
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
              </svg>
              {item.CommunityRating.toFixed(1)}
            </span>
          )}
        </div>
        {item.Overview && (
          <p className="text-sm text-ink-200/90 line-clamp-3 mb-6 max-w-xl">{item.Overview}</p>
        )}
        <div className="flex gap-3">
          <Link
            to={`/play/${item.Id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-white text-ink-950 px-6 py-2.5 text-sm font-semibold hover:bg-ink-200 transition-colors"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play
          </Link>
          <Link
            to={`/item/${item.Id}`}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 backdrop-blur px-6 py-2.5 text-sm font-semibold text-white hover:bg-white/20 transition-colors"
          >
            More info
          </Link>
        </div>
      </div>
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

  // Hero: most recently added item that has a backdrop, preferring movies
  const heroItem = useMemo(() => {
    const candidates = [...(latestMovies ?? []), ...(latestShows ?? [])]
    return candidates.find((i) => i.BackdropImageTags?.length) ?? candidates[0]
  }, [latestMovies, latestShows])

  const heroLoading = viewsLoading || (moviesLoading && showsLoading)

  return (
    <div className="pb-16">
      {heroLoading ? <HeroSkeleton /> : heroItem ? <Hero item={heroItem} /> : null}

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
