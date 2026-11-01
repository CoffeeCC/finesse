import { Link } from 'react-router-dom'
import { useViews } from '../api/queries'
import { imageUrl } from '../api/client'
import { ANIME_HREF, COLLECTIONS_HREF, useOptionalLibraries } from '../components/NavBar'
import { DiceIcon, useSurprise } from '../lib/surprise'
import { useTheme } from '../lib/theme'

// The phone's Library tab: every place to browse, one tap away (on desktop and
// TV these live in the navbar and its More menu).

interface Tile {
  key: string
  label: string
  to: string
  image?: string | null
  hue: number
  deck?: boolean
  kind?: 'movies' | 'tvshows'
}

export default function LibrariesPage() {
  const theme = useTheme()
  const { data: views } = useViews()
  const { surprise, busy } = useSurprise()
  const { hasAnime, hasGames } = useOptionalLibraries()
  const items = views?.Items ?? []
  const byType = (t: string) => items.filter((v) => v.CollectionType === t)
  const art = (id: string, tag?: string) => (tag ? imageUrl(id, 'Primary', { maxWidth: 640, tag }) : null)

  const tiles: Tile[] = [
    ...byType('movies').map((v) => ({ key: v.Id, label: v.Name, to: `/library/${v.Id}`, image: art(v.Id, v.ImageTags?.Primary), hue: 222, deck: true, kind: 'movies' as const })),
    ...byType('tvshows').map((v) => ({ key: v.Id, label: v.Name, to: `/library/${v.Id}`, image: art(v.Id, v.ImageTags?.Primary), hue: 190, deck: true, kind: 'tvshows' as const })),
    ...(hasAnime ? [{ key: 'anime', label: 'Anime', to: ANIME_HREF, hue: 320 }] : []),
    ...byType('music').map((v) => ({ key: v.Id, label: v.Name, to: '/music', image: art(v.Id, v.ImageTags?.Primary), hue: 28 })),
    ...(hasGames ? [{ key: 'games', label: 'Games', to: '/games', hue: 140 }] : []),
    ...(byType('boxsets').length ? [{ key: 'collections', label: 'Collections', to: COLLECTIONS_HREF, hue: 262 }] : []),
  ]

  const renderTile = (t: Tile) => {
    const deck = theme === 'card-table' && t.deck
    return (
      <Link
        key={t.key}
        data-deck-kind={t.kind}
        to={t.to}
        className={`${deck ? 'library-deck-tile ' : ''}group relative h-28 sm:h-36 rounded-2xl overflow-hidden flex items-end p-4 ring-1 ring-white/5 hover:ring-white/20 transition-all active:scale-[0.98]`}
        style={deck ? undefined : { background: `hsl(${t.hue}, 32%, 24%)` }}
      >
        {t.image ? (
          <img src={t.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70 group-hover:opacity-90 transition-opacity" />
        ) : (
          <span aria-hidden className="absolute -right-6 -top-6 h-24 w-24 rounded-full" style={{ background: `hsla(${(t.hue + 170) % 360}, 45%, 66%, 0.3)` }} />
        )}
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <span className={`${deck ? 'deck-tile-label ' : ''}relative text-lg font-semibold text-white`}>{t.label}</span>
      </Link>
    )
  }

  return (
    <div className="table-deck-hub pb-16 px-4 sm:px-6 lg:px-12 py-6">
      <h1 className="page-title mb-5">Library</h1>
      {theme === 'card-table' ? <>
        <section aria-label="Movie and show decks">
          <h2 className="text-sm text-ink-400 mb-4">Your movie &amp; show decks</h2>
          <div className="library-deck-grid grid gap-4">{tiles.filter((t) => t.deck).map(renderTile)}</div>
        </section>
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {tiles.filter((t) => !t.deck).map(renderTile)}
        </div>
      </> : <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">{tiles.map(renderTile)}</div>}

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
