import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useEpisodes, useItem, useSeasons } from '../api/queries'
import { backdropUrl, episodeThumbUrl, imageUrl, logoUrl, posterUrl } from '../api/client'
import { formatRuntime, ticksToSeconds } from '../api/types'
import type { JfItem } from '../api/types'

function PlayLink({ item, className }: { item: JfItem; className?: string }) {
  const resumeTicks = item.UserData?.PlaybackPositionTicks ?? 0
  const canResume = resumeTicks > 0
  return (
    <Link
      to={`/play/${item.Id}${canResume ? `?t=${resumeTicks}` : ''}`}
      className={
        className ??
        'inline-flex items-center gap-2 rounded-lg bg-white text-ink-950 px-6 py-2.5 text-sm font-semibold hover:bg-ink-200 transition-colors'
      }
    >
      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z" />
      </svg>
      {canResume ? `Resume · ${formatRemaining(item)}` : 'Play'}
    </Link>
  )
}

function formatRemaining(item: JfItem): string {
  const pos = ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  const total = ticksToSeconds(item.RunTimeTicks)
  if (!total) return ''
  const remainMin = Math.max(1, Math.round((total - pos) / 60))
  return `${remainMin}m left`
}

function EpisodeRow({ ep }: { ep: JfItem }) {
  const thumb = episodeThumbUrl(ep)
  const pct =
    ep.UserData?.PlaybackPositionTicks && ep.RunTimeTicks
      ? (ep.UserData.PlaybackPositionTicks / ep.RunTimeTicks) * 100
      : 0

  return (
    <Link
      to={`/play/${ep.Id}${ep.UserData?.PlaybackPositionTicks ? `?t=${ep.UserData.PlaybackPositionTicks}` : ''}`}
      className="group flex gap-4 rounded-xl p-3 hover:bg-white/5 transition-colors"
    >
      <div className="relative w-44 shrink-0 aspect-video rounded-lg overflow-hidden bg-ink-800 ring-1 ring-white/5">
        {thumb && (
          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover fade-in" />
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
          <div className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center">
            <svg className="h-5 w-5 text-ink-950 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        {ep.UserData?.Played && (
          <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-accent-500 flex items-center justify-center">
            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
        )}
        {pct > 1 && pct < 99 && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-black/60">
            <div className="h-full bg-accent-400" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="min-w-0 py-1">
        <p className="text-sm font-semibold text-white">
          {ep.IndexNumber != null && <span className="text-ink-400 mr-2">{ep.IndexNumber}.</span>}
          {ep.Name}
        </p>
        <p className="text-xs text-ink-400 mt-0.5">{formatRuntime(ep.RunTimeTicks)}</p>
        {ep.Overview && (
          <p className="text-xs text-ink-400 mt-1.5 line-clamp-2 max-w-2xl">{ep.Overview}</p>
        )}
      </div>
    </Link>
  )
}

function Seasons({ series }: { series: JfItem }) {
  const { data: seasons } = useSeasons(series.Id)
  const [seasonId, setSeasonId] = useState<string>()

  useEffect(() => {
    if (!seasonId && seasons?.Items.length) {
      // Prefer the first real season over Specials (IndexNumber 0)
      const regular = seasons.Items.find((s) => (s.IndexNumber ?? 0) >= 1)
      setSeasonId((regular ?? seasons.Items[0]).Id)
    }
  }, [seasons, seasonId])

  const { data: episodes, isLoading } = useEpisodes(series.Id, seasonId)

  if (!seasons?.Items.length) return null

  return (
    <section className="mt-10">
      <div className="flex items-center gap-3 mb-4 overflow-x-auto no-scrollbar">
        {seasons.Items.map((s) => (
          <button
            key={s.Id}
            onClick={() => setSeasonId(s.Id)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              s.Id === seasonId
                ? 'bg-accent-500 text-white'
                : 'bg-ink-800 text-ink-400 hover:text-white'
            }`}
          >
            {s.Name}
          </button>
        ))}
      </div>
      <div className="space-y-1">
        {isLoading && <p className="text-ink-400 text-sm px-3 py-6">Loading episodes…</p>}
        {episodes?.Items.map((ep) => <EpisodeRow key={ep.Id} ep={ep} />)}
      </div>
    </section>
  )
}

export default function ItemPage() {
  const { itemId } = useParams()
  const { data: item, isLoading } = useItem(itemId)

  if (isLoading || !item) {
    return <div className="h-[50vh] shimmer -mt-16" />
  }

  const backdrop = backdropUrl(item)
  const logo = logoUrl(item)
  const poster = posterUrl(item, 600)
  const cast = item.People?.filter((p) => p.Type === 'Actor').slice(0, 12) ?? []
  const isSeries = item.Type === 'Series'

  return (
    <div className="pb-16">
      <div className="relative -mt-16">
        <div className="h-[48vh] min-h-[360px] w-full overflow-hidden">
          {backdrop && (
            <img src={backdrop} alt="" className="h-full w-full object-cover fade-in" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/40 to-ink-950/30" />
        </div>

        <div className="relative px-6 lg:px-12 -mt-40 flex gap-8 items-end">
          {poster && (
            <img
              src={poster}
              alt={item.Name}
              className="hidden md:block w-52 rounded-xl shadow-2xl ring-1 ring-white/10 shrink-0"
            />
          )}
          <div className="min-w-0 pb-2">
            {logo ? (
              <img src={logo} alt={item.Name} className="max-h-20 max-w-md object-contain mb-3" />
            ) : (
              <h1 className="text-4xl font-bold text-white tracking-tight mb-2">{item.Name}</h1>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-200 mb-4">
              {item.ProductionYear && (
                <span>
                  {item.ProductionYear}
                  {isSeries && item.EndDate
                    ? `–${new Date(item.EndDate).getFullYear()}`
                    : isSeries && item.Status === 'Continuing'
                      ? '–'
                      : ''}
                </span>
              )}
              {item.RunTimeTicks && !isSeries && <span>{formatRuntime(item.RunTimeTicks)}</span>}
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
              {item.Genres?.slice(0, 3).map((g) => (
                <span key={g} className="text-ink-400">
                  {g}
                </span>
              ))}
            </div>
            {!isSeries && (
              <div className="flex gap-3">
                <PlayLink item={item} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 lg:px-12 mt-8 max-w-4xl">
        {item.Taglines?.[0] && (
          <p className="text-ink-400 italic mb-2">{item.Taglines[0]}</p>
        )}
        {item.Overview && <p className="text-sm leading-relaxed text-ink-200">{item.Overview}</p>}
      </div>

      {cast.length > 0 && (
        <section className="mt-10 px-6 lg:px-12">
          <h2 className="text-lg font-semibold text-white tracking-tight mb-4">Cast</h2>
          <div className="flex gap-5 overflow-x-auto no-scrollbar pb-2">
            {cast.map((p) => (
              <div key={p.Id} className="w-24 shrink-0 text-center">
                <div className="h-24 w-24 rounded-full overflow-hidden bg-ink-800 ring-1 ring-white/5 mx-auto">
                  {p.PrimaryImageTag && (
                    <img
                      src={imageUrl(p.Id, 'Primary', { maxWidth: 200, tag: p.PrimaryImageTag })}
                      alt={p.Name}
                      loading="lazy"
                      className="h-full w-full object-cover fade-in"
                    />
                  )}
                </div>
                <p className="mt-2 text-xs font-medium text-ink-200 truncate">{p.Name}</p>
                {p.Role && <p className="text-[11px] text-ink-400 truncate">{p.Role}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {isSeries && (
        <div className="px-6 lg:px-12">
          <Seasons series={item} />
        </div>
      )}
    </div>
  )
}
