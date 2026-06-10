import { Link } from 'react-router-dom'
import { posterUrl } from '../api/client'
import type { JfItem } from '../api/types'

function progressPct(item: JfItem): number | null {
  const ud = item.UserData
  if (!ud?.PlaybackPositionTicks || !item.RunTimeTicks) return null
  const pct = (ud.PlaybackPositionTicks / item.RunTimeTicks) * 100
  return pct > 1 && pct < 99 ? pct : null
}

function subtitle(item: JfItem): string {
  if (item.Type === 'Episode') {
    const s = item.ParentIndexNumber
    const e = item.IndexNumber
    return s != null && e != null ? `S${s}:E${e} · ${item.SeriesName ?? ''}` : item.SeriesName ?? ''
  }
  return item.ProductionYear ? String(item.ProductionYear) : ''
}

export default function MediaCard({ item, width }: { item: JfItem; width?: number }) {
  const poster = posterUrl(item)
  const pct = progressPct(item)
  const played = item.UserData?.Played
  const unplayedCount = item.UserData?.UnplayedItemCount
  const linkId = item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id

  return (
    <Link
      to={`/item/${linkId}`}
      className="group block shrink-0 outline-none"
      style={width ? { width } : undefined}
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-ink-800 ring-1 ring-white/5 transition-all duration-200 group-hover:ring-2 group-hover:ring-accent-400 group-hover:scale-[1.03] group-hover:shadow-xl group-hover:shadow-black/50 group-focus-visible:ring-2 group-focus-visible:ring-accent-400">
        {poster ? (
          <img
            src={poster}
            alt={item.Name}
            loading="lazy"
            className="h-full w-full object-cover fade-in"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center p-3 text-center text-sm text-ink-400">
            {item.Name}
          </div>
        )}

        {played && (
          <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-accent-500 flex items-center justify-center shadow-md">
            <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
        )}
        {!played && unplayedCount != null && unplayedCount > 0 && (
          <div className="absolute top-2 right-2 min-w-6 h-6 px-1.5 rounded-full bg-accent-500 flex items-center justify-center text-xs font-semibold text-white shadow-md">
            {unplayedCount}
          </div>
        )}

        {pct != null && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-black/60">
            <div className="h-full bg-accent-400" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="mt-2 px-0.5">
        <p className="text-sm font-medium text-ink-200 truncate group-hover:text-white transition-colors">
          {item.Name}
        </p>
        <p className="text-xs text-ink-400 truncate">{subtitle(item)}</p>
      </div>
    </Link>
  )
}
