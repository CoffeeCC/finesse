import { Link } from 'react-router-dom'
import { useMyLimits } from '../api/parental'
import { useLatest, useViews } from '../api/queries'
import { backdropUrl, imageUrl } from '../api/client'
import { useFinesse } from '../lib/finesseServer'
import { ANIME_HREF, COLLECTIONS_HREF, useSecondaryDestinations } from '../components/NavBar'
import { DiceIcon, useSurprise } from '../lib/surprise'
import { prefetchRoute } from '../lib/prefetch'

// The phone's Library tab: every place to browse, one tap away (on desktop and
// TV these live in the navbar and its More menu).

interface TileMeta {
  subtitle: string
  /** Subtle radial accent tint (CSS rgb triplet). */
  tint: string
  /** Crisp icon path(s) in a 24x24 viewBox. */
  icon: string
}

interface Tile {
  key: string
  label: string
  to: string
  /** The library, whose newest title lends its artwork. */
  viewId?: string
  meta?: TileMeta
}

const SECONDARY_META: Record<string, TileMeta> = {
  [ANIME_HREF]: {
    subtitle: 'Series & films',
    tint: '244, 114, 182',
    icon: 'M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7L12 3zm6.5 11.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z',
  },
  '/music': {
    subtitle: 'Albums & tracks',
    tint: '167, 139, 250',
    icon: 'M9 18V6.5l11-2V16M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm11-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  },
  '/games': {
    subtitle: 'Retro & streamed',
    tint: '52, 211, 153',
    icon: 'M6 12h4m-2-2v4m7-3h.01M17 13h.01M6.5 7h11a4.5 4.5 0 0 1 4.4 5.4l-.8 3.6a2.8 2.8 0 0 1-4.8 1.3L14.8 16H9.2l-1.5 1.3a2.8 2.8 0 0 1-4.8-1.3l-.8-3.6A4.5 4.5 0 0 1 6.5 7Z',
  },
  '/friends': {
    subtitle: 'Shared servers',
    tint: '56, 189, 248',
    icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z',
  },
  [COLLECTIONS_HREF]: {
    subtitle: 'Box sets & sagas',
    tint: '251, 191, 36',
    icon: 'M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 0 0 4.5 9v.878m13.5-3A2.25 2.25 0 0 1 19.5 9v.878m0 0a2.246 2.246 0 0 0-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0 1 21 12v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6c0-.98.626-1.813 1.5-2.122',
  },
  '/together': {
    subtitle: 'Shared shortlists',
    tint: '251, 113, 133',
    icon: 'M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z',
  },
  '/moments': {
    subtitle: 'Picks & notes',
    tint: '251, 146, 60',
    icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z',
  },
  '/smart': {
    subtitle: 'Smart playlists',
    tint: '129, 140, 248',
    icon: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z',
  },
  '/request': {
    subtitle: 'Find & download',
    tint: '45, 212, 191',
    icon: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3',
  },
  '/activity': {
    subtitle: 'History & stats',
    tint: '96, 165, 250',
    icon: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  },
}

function extraLibraryMeta(collectionType?: string): TileMeta {
  switch (collectionType) {
    case 'homevideos':
      return {
        subtitle: 'Home videos',
        tint: '245, 158, 11',
        icon: 'M15.75 10.5 20.47 5.78a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z',
      }
    case 'musicvideos':
      return {
        subtitle: 'Music videos',
        tint: '232, 121, 249',
        icon: 'M9 18V6.5l11-2V16M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm11-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
      }
    case 'books':
      return {
        subtitle: 'Books',
        tint: '250, 204, 21',
        icon: 'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
      }
    case 'livetv':
      return {
        subtitle: 'Live TV',
        tint: '56, 189, 248',
        icon: 'M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125Z',
      }
    default:
      return {
        subtitle: 'Library',
        tint: '148, 163, 184',
        icon: 'M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z',
      }
  }
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
  const { data: views, isLoading, isError, refetch } = useViews()
  const { info } = useFinesse()
  const { surprise, busy } = useSurprise()
  const limits = useMyLimits()
  // The same places, under the same names, as the desktop and TV bar's More menu (and in the
  // same order), so nothing reachable there is missing here. Requests has its own button below.
  const secondary = useSecondaryDestinations().filter((d) => d.to !== '/request')
  const items = views?.Items ?? []
  const byType = (t: string) => items.filter((v) => v.CollectionType === t)
  const musicView = byType('music')[0]
  const canRequest = Boolean(info?.features?.requests) && (!limits || limits.requests)

  const tiles: Tile[] = [
    ...byType('movies').map((v) => ({ key: v.Id, label: v.Name, to: `/library/${v.Id}`, viewId: v.Id })),
    ...byType('tvshows').map((v) => ({ key: v.Id, label: v.Name, to: `/library/${v.Id}`, viewId: v.Id })),
    ...secondary.map((d) => ({
      key: d.to,
      label: d.label,
      to: d.to,
      viewId: d.to === '/music' ? musicView?.Id : d.viewId,
      meta: SECONDARY_META[d.to] ?? extraLibraryMeta(d.collectionType),
    })),
  ]

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-12 py-6">
      <h1 className="page-title mb-5">Library</h1>

      {isError && !views ? (
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-base font-semibold text-white">Couldn’t load your libraries</p>
          <p className="mt-1 text-sm text-ink-400">Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {isLoading && !views
            ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-28 sm:h-36 rounded-2xl shimmer" />)
            : tiles.map((t) => {
                const tint = t.meta?.tint
                return (
                  <Link
                    key={t.key}
                    to={t.to}
                    onMouseEnter={() => prefetchRoute(t.to)}
                    onFocus={() => prefetchRoute(t.to)}
                    onTouchStart={() => prefetchRoute(t.to)}
                    style={
                      tint
                        ? {
                            backgroundImage: `radial-gradient(85% 95% at 92% 10%, rgba(${tint}, 0.22), rgba(${tint}, 0.04) 55%, transparent 100%)`,
                          }
                        : undefined
                    }
                    className="group relative h-28 sm:h-36 rounded-2xl overflow-hidden flex items-end p-4 border border-white/[0.08] bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.07] transition-all active:scale-[0.98]"
                  >
                    <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/[0.09]" />
                    {!tint && (
                      <span aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-accent-400/10 transition-colors duration-300 group-hover:bg-accent-400/20" />
                    )}
                    {t.viewId && <TileArt viewId={t.viewId} music={t.to === '/music'} />}
                    <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/25 to-transparent" />
                    {t.meta && (
                      <span
                        aria-hidden
                        style={{ color: `rgb(${t.meta.tint})` }}
                        className="pointer-events-none absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-xl bg-black/35 ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-105"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={t.meta.icon} />
                        </svg>
                      </span>
                    )}
                    <span className="relative min-w-0">
                      <span className="block font-display italic text-2xl sm:text-[26px] leading-none text-white truncate">{t.label}</span>
                      {t.meta?.subtitle && (
                        <span className="mt-1 block text-xs font-medium text-white/60 truncate">{t.meta.subtitle}</span>
                      )}
                    </span>
                  </Link>
                )
              })}
        </div>
      )}

      <div className="mt-6 max-w-xl grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => surprise({ includeItemTypes: 'Movie,Series' })}
          disabled={busy}
          className="h-12 rounded-xl bg-white/[0.07] border border-white/15 flex items-center justify-center gap-2.5 text-[15px] font-semibold text-white hover:bg-white/10 transition-colors disabled:opacity-60"
        >
          <DiceIcon className="h-5 w-5" spinning={busy} />
          Surprise me
        </button>
        {canRequest && (
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
