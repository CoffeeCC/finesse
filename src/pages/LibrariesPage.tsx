import { useMyLimits } from '../api/parental'
import { Link } from 'react-router-dom'
import { useLatest, useViews } from '../api/queries'
import { backdropUrl, imageUrl } from '../api/client'
import { useSecondaryDestinations } from '../components/NavBar'
import { DiceIcon, useSurprise } from '../lib/surprise'
import { prefetchRoute } from '../lib/prefetch'

// The phone's Library tab: every place to browse, one tap away (on desktop and
// TV these live in the navbar and its More menu).

interface Tile {
  key: string
  label: string
  to: string
  /** The library, whose newest title lends its artwork. */
  viewId?: string
}

/**
 * A tile's picture: artwork from the newest title in that library, never the library's own
 * image (Jellyfin draws the library's name into it, so the label showed twice). Music uses
 * the newest album's cover. Nothing yet: the tile's colour.
 */
function TileArt({ viewId, music }: { viewId: string; music: boolean }) {
  const { data } = useLatest(viewId)
  const items = data ?? []
  const src = music
    ? (() => {
        const a = items.find((i) => i.ImageTags?.Primary)
        return a ? imageUrl(a.Id, 'Primary', { maxWidth: 480, tag: a.ImageTags!.Primary }) : null
      })()
    : items.map((i) => backdropUrl(i, 640)).find(Boolean) ?? null
  if (!src) return null
  return <img src={src} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-60 group-hover:opacity-80 transition-opacity" />
}

export default function LibrariesPage() {
  const { data: views } = useViews()
  const { surprise, busy } = useSurprise()
  const limits = useMyLimits()
  // The same places, under the same names, as the desktop and TV bar's More menu (and in the
  // same order), so nothing reachable there is missing here. Requests has its own button below.
  const secondary = useSecondaryDestinations().filter((d) => d.to !== '/request')
  const items = views?.Items ?? []
  const byType = (t: string) => items.filter((v) => v.CollectionType === t)
  const musicView = byType('music')[0]

  const tiles: Tile[] = [
    ...byType('movies').map((v) => ({ key: v.Id, label: v.Name, to: `/library/${v.Id}`, viewId: v.Id })),
    ...byType('tvshows').map((v) => ({ key: v.Id, label: v.Name, to: `/library/${v.Id}`, viewId: v.Id })),
    ...secondary.map((d) => ({ key: d.to, label: d.label, to: d.to, viewId: d.to === '/music' ? musicView?.Id : undefined })),
  ]

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-12 py-6">
      <h1 className="page-title mb-5">Library</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {tiles.map((t) => (
          <Link
            key={t.key}
            to={t.to}
            onMouseEnter={() => prefetchRoute(t.to)}
            onFocus={() => prefetchRoute(t.to)}
            onTouchStart={() => prefetchRoute(t.to)}
            className="group relative h-28 sm:h-36 rounded-2xl overflow-hidden flex items-end p-4 border border-white/[0.08] bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.07] transition-all active:scale-[0.98]"
          >
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/[0.09]" />
            <span aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent-400/10 transition-colors duration-300 group-hover:bg-accent-400/20" />
            {t.viewId && <TileArt viewId={t.viewId} music={t.to === '/music'} />}
            <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/25 to-transparent" />
            <span className="relative font-display italic text-2xl sm:text-[26px] leading-none text-white">{t.label}</span>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => surprise({ includeItemTypes: 'Movie,Series' })}
          disabled={busy}
          className="h-12 rounded-xl bg-white/[0.07] border border-white/15 flex items-center justify-center gap-2.5 text-[15px] font-semibold text-white hover:bg-white/10 transition-colors disabled:opacity-60"
        >
          <DiceIcon className="h-5 w-5" spinning={busy} />
          Surprise me
        </button>
        {(!limits || limits.requests) && (
        <Link
          to="/request"
          onMouseEnter={() => prefetchRoute('/request')}
          onFocus={() => prefetchRoute('/request')}
          onTouchStart={() => prefetchRoute('/request')}
          className="h-12 rounded-xl bg-white/[0.07] border border-white/15 flex items-center justify-center gap-2.5 text-[15px] font-semibold text-white hover:bg-white/10 active:scale-[0.98] transition-all"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Requests and downloads
        </Link>
        )}
      </div>
    </div>
  )
}
