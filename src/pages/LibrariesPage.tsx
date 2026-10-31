import { Link } from 'react-router-dom'
import { useLatest, useViews } from '../api/queries'
import { backdropUrl, imageUrl } from '../api/client'
import { useSecondaryDestinations } from '../components/NavBar'
import { DiceIcon, useSurprise } from '../lib/surprise'

// The phone's Library tab: every place to browse, one tap away (on desktop and
// TV these live in the navbar and its More menu).

interface Tile {
  key: string
  label: string
  to: string
  /** The library, whose newest title lends its artwork. */
  viewId?: string
  hue: number
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
  return <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60 group-hover:opacity-80 transition-opacity" />
}

export default function LibrariesPage() {
  const { data: views } = useViews()
  const { surprise, busy } = useSurprise()
  // The same places, under the same names, as the desktop and TV bar's More menu (and in the
  // same order), so nothing reachable there is missing here. Requests has its own button below.
  const secondary = useSecondaryDestinations().filter((d) => d.to !== '/request')
  const items = views?.Items ?? []
  const byType = (t: string) => items.filter((v) => v.CollectionType === t)
  const musicView = byType('music')[0]
  const HUE: Record<string, number> = { Anime: 320, Music: 28, Games: 140, Friends: 170, Collections: 262, 'Smart collections': 290, 'Watch together': 12 }

  const tiles: Tile[] = [
    ...byType('movies').map((v) => ({ key: v.Id, label: v.Name, to: `/library/${v.Id}`, viewId: v.Id, hue: 222 })),
    ...byType('tvshows').map((v) => ({ key: v.Id, label: v.Name, to: `/library/${v.Id}`, viewId: v.Id, hue: 190 })),
    ...secondary.map((d) => ({ key: d.to, label: d.label, to: d.to, viewId: d.to === '/music' ? musicView?.Id : undefined, hue: HUE[d.label] ?? 230 })),
  ]

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-12 py-6">
      <h1 className="page-title mb-5">Library</h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {tiles.map((t) => (
          <Link
            key={t.key}
            to={t.to}
            className="group relative h-28 sm:h-36 rounded-2xl overflow-hidden flex items-end p-4 ring-1 ring-white/5 hover:ring-white/20 transition-all active:scale-[0.98]"
            style={{ background: `hsl(${t.hue}, 32%, 24%)` }}
          >
            <span aria-hidden className="absolute -right-6 -top-6 h-24 w-24 rounded-full" style={{ background: `hsla(${(t.hue + 170) % 360}, 45%, 66%, 0.3)` }} />
            {t.viewId && <TileArt viewId={t.viewId} music={t.to === '/music'} />}
            <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <span className="relative text-lg font-semibold text-white">{t.label}</span>
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
        <Link
          to="/request"
          className="h-12 rounded-xl bg-white/[0.07] border border-white/15 flex items-center justify-center gap-2.5 text-[15px] font-semibold text-white hover:bg-white/10 transition-colors"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Requests and downloads
        </Link>
      </div>
    </div>
  )
}
