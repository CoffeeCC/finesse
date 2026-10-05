import { useRef, useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { backdropUrl, episodeThumbUrl, getItem, imageUrl, posterUrl, trickplayTileUrl } from '../api/client'
import { useQueryClient } from '@tanstack/react-query'
import { useClipManifest } from '../api/queries'
import { blurhashAverageColor, blurhashToDataURL, primaryBlurhash } from '../lib/blurhash'
import { vividRgb } from '../lib/accent'
import { getPrefs } from '../lib/settings'
import {
  claimPreview,
  releasePreview,
  previewClipUrl,
  prefetchWhenVisible,
  EMPTY_MANIFEST,
} from '../lib/preview'
import { useTvLazy } from '../lib/tvLazy'
import { morphNavigate, posterMorphName } from '../lib/motion'
import { formatRuntime } from '../api/types'
import type { JfItem } from '../api/types'

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

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

export default function MediaCard({
  item,
  width,
  onDismiss,
  autoFocus,
  rank,
}: {
  item: JfItem
  width?: number
  /** Top 10 position, set in the artwork's lower-left corner. */
  rank?: number
  /** When set, a hover “×” appears (top-left) that calls this — e.g. to drop
   *  the card from Continue Watching. tabindex=-1: not a D-pad nav stop. */
  onDismiss?: (item: JfItem) => void
  /** Where TV/D-pad focus lands when the page opens (see lib/routeMemory). */
  autoFocus?: boolean
}) {
  const poster = posterUrl(item)
  const pct = progressPct(item)
  const played = item.UserData?.Played
  const unplayedCount = item.UserData?.UnplayedItemCount
  const linkId = item.Type === 'Episode' && item.SeriesId ? item.SeriesId : item.Id

  const tiltRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Hover-preview: mouse over a poster and a short muted clip of the real title
  // plays over it (Netflix-style). Clips are pre-generated per resolution under
  // /previews/ (see deploy/genclips.sh). The manifest is a shared query (one
  // fetch app-wide); reading it here reactively lets prefetch re-arm the moment
  // it loads. The URL is resolved at the user's chosen quality.
  const [preview, setPreview] = useState(false)
  const [playing, setPlaying] = useState(false) // revealed only once decoding
  const hoverTimer = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  // Web: mouse-hover previews. TV: hover would swamp the SoC (pointer remote
  // streams moves over many cards), but a *deliberate* D-pad focus dwell is one
  // card at a time — so the TV gets previews on dwell instead. Reduced-motion
  // opts out of both.
  const canHoverPreview = !__WEBOS__ && !REDUCED_MOTION
  const canFocusPreview = __WEBOS__ && !REDUCED_MOTION

  // No clip for this title? Its scrub (trickplay) thumbnails flip by instead — Jellyfin makes those on any server.
  const thumbsOk = canHoverPreview && getPrefs().thumbPreviews && /^(Movie|Episode|Video|MusicVideo)$/.test(item.Type) && !item.Id.startsWith('f-')
  const { data: manifest } = useClipManifest()
  const clipUrl =
    canHoverPreview || canFocusPreview
      ? previewClipUrl(item.Id, getPrefs().previewQuality, manifest ?? EMPTY_MANIFEST)
      : null

  // Stop this card's preview (also the single-play lock's stop fn).
  const stopPreview = useCallback(() => {
    setPreview(false)
    setPlaying(false)
  }, [])

  useEffect(() => () => {
    window.clearTimeout(hoverTimer.current)
    releasePreview(stopPreview)
  }, [stopPreview])

  // Warm this card's clip once it scrolls into view (web only), so the first
  // hover starts instantly instead of waiting on the network. Re-arms when the
  // manifest resolves (clipUrl flips from null to a real URL). The TV skips the
  // prefetch — dozens of speculative fetches hurt more than the dwell delay.
  useEffect(() => {
    if (!canHoverPreview || !clipUrl) return
    const el = tiltRef.current
    if (!el) return
    return prefetchWhenVisible(el, clipUrl)
  }, [canHoverPreview, clipUrl])

  const startPreview = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!canHoverPreview || e.pointerType !== 'mouse' || !(clipUrl || thumbsOk)) return
    // Short intent guard so a pointer just passing over doesn't fire.
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      claimPreview(stopPreview) // stops any other card/hero preview
      setPreview(true)
    }, 200)
  }, [canHoverPreview, clipUrl, thumbsOk, stopPreview])

  // TV: D-pad dwell → preview. Focus starts a longer intent timer (browsing
  // steps through cards quickly; only a pause means "show me"), blur cancels.
  const onTvFocus = useCallback(() => {
    if (!canFocusPreview || !clipUrl) return
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      claimPreview(stopPreview)
      setPreview(true)
    }, 700)
  }, [canFocusPreview, clipUrl, stopPreview])

  const onTvBlur = useCallback(() => {
    if (!canFocusPreview) return
    window.clearTimeout(hoverTimer.current)
    releasePreview(stopPreview)
    stopPreview()
  }, [canFocusPreview, stopPreview])

  const onPointerLeave = useCallback(() => {
    window.clearTimeout(hoverTimer.current)
    releasePreview(stopPreview)
    stopPreview()
  }, [stopPreview])

  // TV: skip blurhash (CPU decode per card) — the solid bg placeholder is fine.
  const hash = primaryBlurhash(item)
  const blurUrl = __WEBOS__ ? null : blurhashToDataURL(hash)

  // Light-spill: a focused/hovered card casts a soft glow in its own dominant
  // color onto the shelf beneath. The 4×4 average decode is cheap + cached, so
  // it's worth running on the TV too; the glow itself is a plain box-shadow.
  const spillAvg = blurhashAverageColor(hash)
  const mood = spillAvg ? vividRgb(spillAvg[0], spillAvg[1], spillAvg[2]).join(', ') : undefined
  const spillStyle = mood ? ({ '--spill': mood } as CSSProperties) : undefined

  // TV: real lazy loading — loading="lazy" is a no-op on the CX's Chromium 68.
  const [lazyRef, nearViewport] = useTvLazy<HTMLDivElement>()

  return (
    <Link
      to={`/item/${linkId}`}
      // The poster morphs into the detail page (lib/motion); Back reverses it.
      onClick={(e) =>
        morphNavigate(() => navigate(`/item/${linkId}`), { from: tiltRef.current, name: posterMorphName(), event: e })
      }
      className="group block shrink-0 snap-start outline-none"
      style={width ? { width } : undefined}
      data-backdrop={backdropUrl(item, 1280) ?? undefined}
      data-autofocus={autoFocus || undefined}
      onFocus={canFocusPreview ? onTvFocus : undefined}
      onBlur={canFocusPreview ? onTvBlur : undefined}
    >
      <div className="relative" style={spillStyle}>
        <span aria-hidden className="spill-glow" />
        <div
          ref={(el) => {
            tiltRef.current = el
            lazyRef.current = el
          }}
          onPointerEnter={canHoverPreview ? startPreview : undefined}
          onPointerLeave={__WEBOS__ ? undefined : onPointerLeave}
          data-vt-id={linkId}
          data-mood={mood}
          className="tilt sheen relative aspect-[2/3] rounded-xl overflow-hidden bg-ink-800 ring-1 ring-white/5 group-hover:ring-accent-400/70 group-focus-visible:ring-2 group-focus-visible:ring-accent-400"
        >
          {blurUrl && (
            <img src={blurUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          )}
          {poster && nearViewport ? (
            <img
              src={poster}
              alt={item.Name}
              loading="lazy"
              className="relative h-full w-full object-cover fade-in"
            />
          ) : poster ? null : (
            <div className="h-full w-full flex items-center justify-center p-3 text-center text-sm text-ink-400">
              {item.Name}
            </div>
          )}

          {preview && clipUrl && (
            <video
              ref={videoRef}
              src={clipUrl}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              onPlaying={(e) => {
                setPlaying(true)
                // Started muted so autoplay is allowed; unmute now if the user
                // wants preview audio (the single-play lock keeps it to one at a time).
                if (getPrefs().previewSound) e.currentTarget.muted = false
              }}
              onError={stopPreview}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                playing ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}

          {preview && !clipUrl && thumbsOk && <ThumbFlip itemId={item.Id} onReady={() => setPlaying(true)} />}

          {rank != null && (
            <>
              <div aria-hidden className={`rank-scrim ${playing ? 'opacity-0' : ''}`} />
              <span className={`rank-badge ${playing ? 'opacity-0' : ''}`} style={{ fontSize: (width ?? 176) * 0.34 }}>
                <span className="sr-only">Number </span>
                {rank}
              </span>
            </>
          )}

          {onDismiss && (
            <button
              tabIndex={-1}
              aria-label={`Remove ${item.Name} from this row`}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDismiss(item)
              }}
              className="absolute top-2 left-2 h-6 w-6 rounded-full bg-black/70 backdrop-blur flex items-center justify-center text-ink-300 hover:text-white hover:bg-black/90 opacity-0 group-hover:opacity-100 transition-opacity shadow-md shadow-black/40"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          {played && (
            <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-accent-fill flex items-center justify-center shadow-md shadow-black/40">
              <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
          )}
          {!played && unplayedCount != null && unplayedCount > 0 && (
            <div className="absolute top-2 right-2 min-w-6 h-6 px-1.5 rounded-full bg-accent-fill flex items-center justify-center text-xs font-semibold text-white shadow-md shadow-black/40">
              {unplayedCount}
            </div>
          )}

          {pct != null && (
            <div className="absolute bottom-0 inset-x-0 h-1 bg-black/60">
              <div
                className="h-full bg-accent-400 shadow-[0_0_8px_rgba(117,137,216,0.8)]"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 px-0.5">
        <p className="text-sm font-medium text-ink-200 truncate group-hover:text-white transition-colors">
          {item.Name}
        </p>
        {/* Quiet captions: posters already carry their title, so the year /
            episode line waits for hover or focus (always shown on touch). */}
        <p className="text-xs text-ink-400 truncate opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
          {subtitle(item)}
        </p>
      </div>
    </Link>
  )
}

/** Where "play" should start for an item: its resume point, unless finished. */
export function playHref(item: JfItem): string {
  const ud = item.UserData
  const t = !ud?.Played && ud?.PlaybackPositionTicks ? ud.PlaybackPositionTicks : 0
  return `/play/${item.Id}${t > 0 ? `?t=${t}` : ''}`
}

/** Landscape "keep watching" tile (Continue Watching / Next Up): the episode
 *  still or the film's backdrop instead of a cropped poster, and selecting it
 *  plays straight away — resuming where you left off. A small ⓘ opens details
 *  (pointer only; on a remote OK plays, like the big streaming apps). */
export function WideCard({
  item,
  onDismiss,
}: {
  item: JfItem
  onDismiss?: (item: JfItem) => void
}) {
  const navigate = useNavigate()
  const isEp = item.Type === 'Episode'
  const img = isEp
    ? episodeThumbUrl(item, 640)
    : item.ImageTags?.Thumb
      ? imageUrl(item.Id, 'Thumb', { maxWidth: 640, tag: item.ImageTags.Thumb })
      : backdropUrl(item, 640)
  const pct = progressPct(item)
  const pos = item.UserData?.PlaybackPositionTicks ?? 0
  const left =
    item.RunTimeTicks && pct != null ? formatRuntime(Math.max(item.RunTimeTicks - pos, 60 * 10_000_000)) : ''
  const title = isEp ? item.SeriesName ?? item.Name : item.Name
  const code =
    isEp && item.ParentIndexNumber != null && item.IndexNumber != null
      ? `S${item.ParentIndexNumber}:E${item.IndexNumber}`
      : ''
  const sub = isEp ? [code, item.Name].filter(Boolean).join(' · ') : item.ProductionYear ? String(item.ProductionYear) : ''
  const detailId = isEp && item.SeriesId ? item.SeriesId : item.Id
  const avg = blurhashAverageColor(primaryBlurhash(item))
  const mood = avg ? vividRgb(avg[0], avg[1], avg[2]).join(', ') : undefined
  const spill = mood ? ({ '--spill': mood } as CSSProperties) : undefined
  const [lazyRef, nearViewport] = useTvLazy<HTMLDivElement>()
  const href = playHref(item)
  const cornerBtn =
    'absolute top-2 h-7 w-7 rounded-full bg-black/70 backdrop-blur flex items-center justify-center text-ink-200 hover:text-white hover:bg-black/90 opacity-0 group-hover/wide:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity shadow-md shadow-black/40'

  return (
    <div className="group/wide relative shrink-0 snap-start w-[16.5rem] sm:w-[18.5rem] lg:w-[20rem]">
      <Link
        to={href}
        // The tile grows into the player (lib/motion); Back shrinks it back.
        onClick={(e) => morphNavigate(() => navigate(href), { from: lazyRef.current, name: 'vt-hero', event: e })}
        aria-label={`Play ${title}${sub ? ` — ${sub}` : ''}`}
        data-backdrop={backdropUrl(item, 1280) ?? undefined}
        className="group block outline-none"
      >
        <div className="relative" style={spill}>
          <span aria-hidden className="spill-glow" />
          <div
            ref={lazyRef}
            data-vt-id={item.Id}
            data-mood={mood}
            className="tilt sheen relative aspect-video rounded-xl overflow-hidden bg-ink-800 ring-1 ring-white/5 group-hover:ring-accent-400/70 group-focus-visible:ring-2 group-focus-visible:ring-accent-400"
          >
            {img && nearViewport && (
              <img src={img} alt="" loading="lazy" className="h-full w-full object-cover fade-in" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
              <span className="h-12 w-12 rounded-full bg-white/90 flex items-center justify-center shadow-xl shadow-black/40">
                <svg className="h-5 w-5 text-ink-950 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </div>
            {left && (
              <span className="absolute bottom-2.5 right-2.5 text-[11px] font-semibold text-white/90 drop-shadow">
                {left} left
              </span>
            )}
            {isEp && pct == null && (
              <span className="absolute bottom-2.5 left-2.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                Next episode
              </span>
            )}
            {pct != null && (
              <div className="absolute bottom-0 inset-x-0 h-1 bg-white/15">
                <div className="h-full bg-accent-400 shadow-[0_0_8px_rgba(117,137,216,0.8)]" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 px-0.5">
          <p className="text-sm font-medium text-ink-200 truncate group-hover:text-white transition-colors">{title}</p>
          <p className="text-xs text-ink-400 truncate">{sub}</p>
        </div>
      </Link>
      <button
        tabIndex={-1}
        onClick={() => navigate(`/item/${detailId}`)}
        aria-label={`Details for ${title}`}
        className={`${cornerBtn} right-2`}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
        </svg>
      </button>
      {onDismiss && (
        <button
          tabIndex={-1}
          onClick={() => onDismiss(item)}
          aria-label={`Remove ${title} from this row`}
          className={`${cornerBtn} left-2`}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** A flip-book of the title's scrub (trickplay) thumbnails, for cards with no preview clip.
 *  Steps evenly through the film (skipping the opening), cropped to fill the card. */
function ThumbFlip({ itemId, onReady }: { itemId: string; onReady: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<{ url: string; size: string; pos: string; aspect: number } | null>(null)
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  useEffect(() => {
    let alive = true
    let timer = 0
    qc.fetchQuery({ queryKey: ['item', itemId], queryFn: () => getItem(itemId), staleTime: 5 * 60_000 })
      .then((it) => {
        const first = it?.Trickplay ? Object.entries(it.Trickplay)[0] : undefined
        if (!alive || !first) return
        const [mediaSourceId, byWidth] = first
        const widths = Object.keys(byWidth).map(Number).sort((a, b) => a - b)
        const w = widths.find((x) => x >= 280) ?? widths[widths.length - 1]
        const info = byWidth[w]
        if (!info || !info.ThumbnailCount) return
        const per = info.TileWidth * info.TileHeight
        const start = Math.floor(info.ThumbnailCount * 0.05)
        const steps = Math.max(1, Math.min(32, info.ThumbnailCount - start))
        let k = 0
        const show = () => {
          const idx = Math.min(info.ThumbnailCount - 1, start + Math.floor(((info.ThumbnailCount - start) * (k % steps)) / steps))
          const tile = Math.floor(idx / per)
          const pos = idx % per
          const col = pos % info.TileWidth
          const row = Math.floor(pos / info.TileWidth)
          setF({
            url: trickplayTileUrl(itemId, w, tile, mediaSourceId),
            size: `${info.TileWidth * 100}% ${info.TileHeight * 100}%`,
            pos: `${info.TileWidth > 1 ? (col / (info.TileWidth - 1)) * 100 : 0}% ${info.TileHeight > 1 ? (row / (info.TileHeight - 1)) * 100 : 0}%`,
            aspect: info.Width / Math.max(1, info.Height),
          })
          k++
        }
        show()
        readyRef.current()
        timer = window.setInterval(show, 420)
      })
      .catch(() => {})
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [itemId, qc])
  if (!f) return null
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <div
        className="absolute left-1/2 top-0 h-full -translate-x-1/2"
        style={{ aspectRatio: String(f.aspect), backgroundImage: `url("${f.url}")`, backgroundSize: f.size, backgroundPosition: f.pos, backgroundRepeat: 'no-repeat' }}
      />
    </div>
  )
}
