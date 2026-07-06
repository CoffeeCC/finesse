import { useRef, useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { backdropUrl, posterUrl } from '../api/client'
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
import type { JfItem } from '../api/types'

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const MAX_TILT_DEG = 9

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

  const tiltRef = useRef<HTMLDivElement>(null)
  const frame = useRef(0)

  // Hover-preview: mouse over a poster and a short muted clip of the real title
  // plays over it (Netflix-style). Clips are pre-generated per resolution under
  // /previews/ (see deploy/genclips.sh). The manifest is a shared query (one
  // fetch app-wide); reading it here reactively lets prefetch re-arm the moment
  // it loads. The URL is resolved at the user's chosen quality.
  const [preview, setPreview] = useState(false)
  const [playing, setPlaying] = useState(false) // revealed only once decoding
  const hoverTimer = useRef(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  // TV skips it (pointer-remote hover + many cards would swamp the SoC), and
  // reduced-motion users opt out of the autoplaying video.
  const canPreview = !__WEBOS__ && !REDUCED_MOTION

  const { data: manifest } = useClipManifest()
  const clipUrl = canPreview ? previewClipUrl(item.Id, getPrefs().previewQuality, manifest ?? EMPTY_MANIFEST) : null

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
  // manifest resolves (clipUrl flips from null to a real URL).
  useEffect(() => {
    if (!canPreview || !clipUrl) return
    const el = tiltRef.current
    if (!el) return
    return prefetchWhenVisible(el, clipUrl)
  }, [canPreview, clipUrl])

  const startPreview = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!canPreview || e.pointerType !== 'mouse' || !clipUrl) return
    // Short intent guard so a pointer just passing over doesn't fire.
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      claimPreview(stopPreview) // stops any other card/hero preview
      setPreview(true)
    }, 200)
  }, [canPreview, clipUrl, stopPreview])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (REDUCED_MOTION || e.pointerType === 'touch') return
    const el = tiltRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      el.classList.add('tilting')
      el.style.transform =
        `perspective(900px) rotateX(${((0.5 - y) * MAX_TILT_DEG).toFixed(2)}deg)` +
        ` rotateY(${((x - 0.5) * MAX_TILT_DEG).toFixed(2)}deg) scale3d(1.05, 1.05, 1)`
      el.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`)
      el.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`)
    })
  }, [])

  const onPointerLeave = useCallback(() => {
    window.clearTimeout(hoverTimer.current)
    releasePreview(stopPreview)
    stopPreview()
    const el = tiltRef.current
    if (!el) return
    cancelAnimationFrame(frame.current)
    el.classList.remove('tilting')
    el.style.transform = ''
  }, [stopPreview])

  // TV: skip blurhash (CPU decode per card) — the solid bg placeholder is fine.
  const hash = primaryBlurhash(item)
  const blurUrl = __WEBOS__ ? null : blurhashToDataURL(hash)

  // Light-spill: a focused/hovered card casts a soft glow in its own dominant
  // color onto the shelf beneath. The 4×4 average decode is cheap + cached, so
  // it's worth running on the TV too; the glow itself is a plain box-shadow.
  const spillAvg = blurhashAverageColor(hash)
  const spillStyle = spillAvg
    ? ({ '--spill': vividRgb(spillAvg[0], spillAvg[1], spillAvg[2]).join(', ') } as CSSProperties)
    : undefined

  // TV: real lazy loading — loading="lazy" is a no-op on the CX's Chromium 68.
  const [lazyRef, nearViewport] = useTvLazy<HTMLDivElement>()

  return (
    <Link
      to={`/item/${linkId}`}
      viewTransition
      onClick={() => {
        // The clicked poster morphs into the detail-page poster (Chrome VT API)
        if (tiltRef.current) tiltRef.current.style.viewTransitionName = 'vt-poster'
      }}
      className="group block shrink-0 outline-none"
      style={width ? { width } : undefined}
      data-backdrop={backdropUrl(item, 1280) ?? undefined}
    >
      <div
        ref={(el) => {
          tiltRef.current = el
          lazyRef.current = el
        }}
        // TV: the pointer remote streams pointermove events — tilt math + style
        // writes per move would repaint cards constantly. Outline hover is enough.
        onPointerMove={__WEBOS__ ? undefined : onPointerMove}
        onPointerEnter={canPreview ? startPreview : undefined}
        onPointerLeave={__WEBOS__ ? undefined : onPointerLeave}
        style={spillStyle}
        className="tilt spill-card relative aspect-[2/3] rounded-xl overflow-hidden bg-ink-800 ring-1 ring-white/5 group-hover:ring-accent-400/70 group-focus-visible:ring-2 group-focus-visible:ring-accent-400"
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
            onPlaying={() => setPlaying(true)}
            onError={stopPreview}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              playing ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        <div className="tilt-glare" />

        {played && (
          <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-accent-500 flex items-center justify-center shadow-md shadow-black/40">
            <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
        )}
        {!played && unplayedCount != null && unplayedCount > 0 && (
          <div className="absolute top-2 right-2 min-w-6 h-6 px-1.5 rounded-full bg-accent-500 flex items-center justify-center text-xs font-semibold text-white shadow-md shadow-black/40">
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

      <div className="mt-2 px-0.5">
        <p className="text-sm font-medium text-ink-200 truncate group-hover:text-white transition-colors">
          {item.Name}
        </p>
        <p className="text-xs text-ink-400 truncate">{subtitle(item)}</p>
      </div>
    </Link>
  )
}
