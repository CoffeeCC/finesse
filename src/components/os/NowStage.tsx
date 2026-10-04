import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../../api/client'
import { useClipManifest, useItem } from '../../api/queries'
import { formatRuntime } from '../../api/types'
import { morphNavigate } from '../../lib/motion'
import { claimPreview, previewClipUrl, releasePreview, EMPTY_MANIFEST } from '../../lib/preview'
import { getPrefs } from '../../lib/settings'
import { setMood } from '../../lib/mood'
import { IS_TV } from '../../lib/device'
import WatchlistButton from '../WatchlistButton'
import CastMenu from '../CastMenu'
import { useLiveLines, useNowEntries, type NowEntry } from './now'

/** Resting this long on a title starts its preview clip behind the stage. */
const CLIP_DWELL_MS = 2200
/** Resting the mouse on a tile picks it; sweeping past tiles doesn't strobe the stage. */
const HOVER_DWELL_MS = 380

/** The tile you were on, kept while the app is open: Back to Home lands on it
 *  again rather than on the first tile. */
let rememberedFocus: string | null = null

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const canHover = () => typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches

const PlayIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.5-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8Z" />
  </svg>
)

/** Whether a title logo will read on a dark scene (some are dark lettering).
 *  null while it's being checked; remembered per logo. */
const logoVerdicts = new Map<string, boolean>()
function useLogoReadable(url: string | null): boolean | null {
  // TVs load art from another origin (the app runs from file://), so it can't
  // be read back from a canvas: trust the logo there.
  const [verdict, setVerdict] = useState<{ url: string | null; ok: boolean | null }>({ url, ok: url ? logoVerdicts.get(url) ?? null : false })
  useEffect(() => {
    if (!url) return setVerdict({ url, ok: false })
    if (IS_TV) return setVerdict({ url, ok: true })
    const known = logoVerdicts.get(url)
    if (known !== undefined) return setVerdict({ url, ok: known })
    setVerdict({ url, ok: null })
    let live = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const done = (ok: boolean) => {
      logoVerdicts.set(url, ok)
      if (live) setVerdict({ url, ok })
    }
    img.onload = () => {
      try {
        const w = 64
        const h = Math.max(1, Math.round((w * img.naturalHeight) / Math.max(1, img.naturalWidth)))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d')
        if (!g) return done(true)
        g.drawImage(img, 0, 0, w, h)
        const d = g.getImageData(0, 0, w, h).data
        let sum = 0
        let n = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
          n++
        }
        done(n > 20 && sum / n > 0.32)
      } catch {
        done(true)
      }
    }
    img.onerror = () => done(false)
    img.src = url
    return () => {
      live = false
    }
  }, [url])
  return verdict.url === url ? verdict.ok : null
}

/** The details the stage shows for what you rest on (loaded once you rest there). */
function useChips(entry: NowEntry) {
  const { data: full } = useItem(entry.item && entry.kind !== 'music' ? entry.item.Id : undefined)
  return useMemo(() => {
    const it = full ?? entry.item
    if (entry.kind === 'play') {
      return { chips: ['Moonlight', 'Steam and more', 'Your graphics card'], line: 'Your games run on the server and stream to any screen in the house. Pick up a controller.' }
    }
    if (entry.kind === 'music') {
      const t = entry.item
      return { chips: [t?.AlbumArtist ?? t?.Artists?.[0] ?? 'Music', t?.Name ?? ''].filter(Boolean), line: `${t?.Name ?? 'A song'} is playing right now. Open the album to pick it up here.` }
    }
    if (!it) return { chips: [], line: '' }
    const chips: string[] = []
    if (it.Type === 'Episode') {
      chips.push(`S${it.ParentIndexNumber ?? '?'} · E${it.IndexNumber ?? '?'}`)
      if (it.Name) chips.push(it.Name)
    } else {
      if (it.ProductionYear) chips.push(String(it.ProductionYear))
      for (const g of (it.Genres ?? []).slice(0, 2)) chips.push(g)
    }
    if (it.RunTimeTicks && it.Type !== 'Series') chips.push(formatRuntime(it.RunTimeTicks))
    if (it.OfficialRating) chips.push(it.OfficialRating)
    return { chips, line: it.Overview ?? '' }
  }, [full, entry])
}

function Hero({ entry, onGo }: { entry: NowEntry; onGo: (e: NowEntry, ev: React.MouseEvent, from: HTMLElement | null) => void }) {
  const { chips, line } = useChips(entry)
  const logoOk = useLogoReadable(entry.logo)
  const watchlistable = entry.item && (entry.item.Type === 'Movie' || entry.item.Type === 'Series')
  // Send it to the TV: your own titles that play as video (a friend's live on their server).
  const castable = !IS_TV && entry.item && /^(Movie|Episode|Video|MusicVideo)$/.test(entry.item.Type) && !entry.item.Id.startsWith('f-')
  return (
    // Re-keyed per title so each one rises in.
    <div key={entry.key} className="os-hero">
      <p className="os-kicker flex items-center gap-3 text-white/85 mb-4 sm:mb-5">
        <span className="os-dot" />
        <span>{entry.kicker}</span>
      </p>
      {/* Every part of the hero keeps its height from title to title, so Play
          stays where it was (a long story or a missing progress bar moved it). */}
      <div className="os-name">
        {logoOk ? (
          <img className="os-logo" src={entry.logo!} alt={entry.title} />
        ) : logoOk === false ? (
          <h1 className={`os-title ${entry.title.length > 14 ? 'long' : ''}`}>{entry.title}</h1>
        ) : null}
      </div>
      <div className="os-chips mt-5 sm:mt-6 flex flex-nowrap gap-2 overflow-hidden">
        {chips.map((c, i) => (
          <span key={`${c}-${i}`} className={`os-chip ${i === 0 ? 'hi' : ''}`}>{c}</span>
        ))}
      </div>
      <p className="os-line mt-4 sm:mt-5 max-w-[640px] text-[15px] sm:text-[19px] lg:text-[21px] leading-relaxed text-white/80 line-clamp-2 sm:line-clamp-3">{line}</p>
      <div className="os-actions mt-6 sm:mt-8 flex flex-wrap items-center gap-3">
        <Link
          to={entry.primary.to}
          className="os-btn primary"
          data-autofocus
          onClick={(e) => onGo(entry, e, (e.currentTarget.closest('.os-stage') as HTMLElement | null)?.querySelector<HTMLElement>('.os-bd.on') ?? null)}
        >
          <PlayIcon />
          <span>{entry.primary.label}</span>
        </Link>
        {entry.info && (
          <Link to={entry.info} className="os-btn os-glass">
            More info
          </Link>
        )}
        {castable && <CastMenu item={entry.item!} variant="os" />}
        {watchlistable && <WatchlistButton item={entry.item!} />}
      </div>
      <div className={`os-prog os-prog-at mt-6 sm:mt-7 ${entry.pct === undefined ? 'invisible' : ''}`} aria-hidden={entry.pct === undefined || undefined}>
        <i style={{ width: `${entry.pct ?? 0}%` }} />
      </div>
    </div>
  )
}

function Tile({
  entry,
  on,
  onRest,
  onGo,
}: {
  entry: NowEntry
  on: boolean
  onRest: () => void
  onGo: (e: NowEntry, ev: React.MouseEvent, from: HTMLElement | null) => void
}) {
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const coverMode = Boolean(entry.cover) && !entry.tileArt
  return (
    <Link
      to={entry.primary.to}
      className={`os-tile ${on ? 'on' : ''}`}
      style={{ '--t': entry.tint } as CSSProperties}
      aria-label={`${entry.title}: ${entry.sub}`}
      data-tile
      onFocus={onRest}
      // A real move only: scrolling the page under a resting pointer also
      // "enters" tiles, and must not steal the stage from the remote or controller.
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse' || (e.movementX === 0 && e.movementY === 0) || on) return
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(onRest, HOVER_DWELL_MS)
      }}
      onPointerLeave={() => window.clearTimeout(timer.current)}
      onClick={(e) => onGo(entry, e, e.currentTarget.querySelector<HTMLElement>('.art'))}
    >
      {entry.gen ? (
        <span className="tgen">
          {entry.gen === 'neon' ? <span className="tsun" /> : <span className="tpix" />}
          <span className="tfloor" />
          <span className="word">Play</span>
        </span>
      ) : coverMode ? (
        <>
          <img className="art soft" src={entry.cover!} alt="" />
          <img className="cover" src={entry.cover!} alt="" />
        </>
      ) : entry.tileArt ? (
        <img className="art" src={entry.tileArt} alt="" loading="lazy" />
      ) : null}
      <span className="shade" />
      <span className={`cap ${coverMode ? 'right' : ''}`}>
        <b>{entry.title}</b>
        <small>
          {entry.playing && (
            <span className="os-eq" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          )}
          <span>{entry.sub}</span>
        </small>
      </span>
      {entry.badge && <span className="badge">{entry.badge}</span>}
      {entry.pct !== undefined && (
        <span className="tprog">
          <i style={{ width: `${entry.pct}%` }} />
        </span>
      )}
    </Link>
  )
}

/** Finesse 2.0's home: the art of what you rest on fills the screen, over a row
 *  of everything that's "now" in the house, with a live line underneath. */
export default function NowStage() {
  const artWidth = !IS_TV && typeof window !== 'undefined' && window.innerWidth > 1280 ? 1920 : 1280
  const { entries } = useNowEntries(artWidth)
  // Follows the title, not its place: the row fills in as data arrives, and
  // the house changes (someone starts playing) while you rest on something.
  const [focusKey, setFocusKey] = useState<string | null>(() => rememberedFocus)
  useEffect(() => {
    if (focusKey) rememberedFocus = focusKey
  }, [focusKey])
  const f = Math.max(0, entries.findIndex((e) => e.key === focusKey))
  const entry = entries[f]
  const setFocus = useCallback((i: number) => setFocusKey(entries[i]?.key ?? null), [entries])
  const navigate = useNavigate()
  const railRef = useRef<HTMLDivElement>(null)
  const lines = useLiveLines(entries)

  // Only the art you've been near is loaded (and kept, so going back crossfades).
  const [seen, setSeen] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    const near = entries.slice(Math.max(0, f - 1), f + 2).map((e) => e.key)
    setSeen((s) => (near.every((k) => s.has(k)) ? s : new Set([...s, ...near])))
  }, [entries, f])

  // The whole app takes on the title's colour (nav, washes, loading states).
  useEffect(() => {
    if (entry) setMood(entry.tint)
  }, [entry])

  // Rest on a title for a moment and its preview clip plays behind the stage.
  const { data: manifest } = useClipManifest()
  const [clip, setClip] = useState<{ key: string; url: string; on: boolean } | null>(null)
  const stopClip = useCallback(() => setClip(null), [])
  useEffect(() => {
    setClip(null)
    // TVs: one video decoder is for the film itself, not a background loop.
    if (!entry?.item || reducedMotion() || IS_TV) return
    const ids = [entry.item.Id, entry.item.SeriesId].filter(Boolean) as string[]
    const url = ids.map((id) => previewClipUrl(id, getPrefs().previewQuality, manifest ?? EMPTY_MANIFEST)).find(Boolean)
    if (!url) return
    const t = window.setTimeout(() => setClip({ key: entry.key, url, on: false }), CLIP_DWELL_MS)
    return () => window.clearTimeout(t)
  }, [entry, manifest])
  useEffect(() => {
    if (!clip) return
    claimPreview(stopClip)
    return () => releasePreview(stopClip)
  }, [clip, stopClip])

  // The row is scroll-snapped, and a browser stays snapped to the same tile when
  // titles arrive in front of it. Until you've touched the row, keep it at the start.
  const touched = useRef(false)
  // Back to Home: bring the remembered tile into view once it's in the row.
  const restored = useRef(!rememberedFocus)
  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return
    if (!restored.current && focusKey) {
      const i = entries.findIndex((e) => e.key === focusKey)
      const tile = i >= 0 ? rail.querySelectorAll<HTMLElement>('[data-tile]')[i] : undefined
      if (tile) {
        restored.current = true
        touched.current = true
        const pad = parseFloat(getComputedStyle(rail).paddingLeft || '0')
        rail.scrollLeft = Math.max(0, tile.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft - pad)
      }
      return
    }
    if (!focusKey && !touched.current) rail.scrollLeft = 0
  }, [entries, focusKey])

  // Phones: the stage follows whichever tile the row is resting on.
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const touch = () => {
      touched.current = true
    }
    rail.addEventListener('pointerdown', touch, { passive: true })
    rail.addEventListener('wheel', touch, { passive: true })
    if (canHover()) {
      return () => {
        rail.removeEventListener('pointerdown', touch)
        rail.removeEventListener('wheel', touch)
      }
    }
    let raf = 0
    const onScroll = () => {
      if (!touched.current) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const tiles = [...rail.querySelectorAll<HTMLElement>('[data-tile]')]
        const edge = rail.getBoundingClientRect().left + parseFloat(getComputedStyle(rail).paddingLeft || '0')
        let best = 0
        let bestD = Infinity
        tiles.forEach((t, i) => {
          const d = Math.abs(t.getBoundingClientRect().left - edge)
          if (d < bestD) {
            bestD = d
            best = i
          }
        })
        setFocus(best)
      })
    }
    rail.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      rail.removeEventListener('pointerdown', touch)
      rail.removeEventListener('wheel', touch)
      rail.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [setFocus])

  const go = useCallback(
    (e: NowEntry, ev: React.MouseEvent, from: HTMLElement | null) => {
      if (e.primary.stopSession) api.sendStopToSession(e.primary.stopSession)
      morphNavigate(() => navigate(e.primary.to), { from, name: 'vt-hero', event: ev })
    },
    [navigate],
  )

  if (!entry) return null

  const doubled = lines.length > 1 ? [...lines, ...lines] : []
  return (
    <section className="os-stage" aria-label="Now" style={{ '--tint-rgb': entry.tint } as CSSProperties}>
      <div className="os-scene" aria-hidden>
        {entries.map((e, i) => {
          if (!seen.has(e.key)) return null
          const cls = i === f ? ' on' : ''
          if (e.gen) {
            return (
              <div key={e.key} className="os-gen" style={{ opacity: i === f ? 1 : 0, transition: 'opacity 1.1s ease' }}>
                <div className="sun" />
                <div className="floor" />
              </div>
            )
          }
          if (e.art) return <img key={e.key} className={`os-bd${cls}`} src={e.art} alt="" />
          if (e.cover) return <img key={e.key} className={`os-bd soft${cls}`} src={e.cover} alt="" />
          return null
        })}
        {clip && clip.key === entry.key && (
          <video
            key={clip.url}
            className={`os-clip ${clip.on ? 'on' : ''}`}
            src={clip.url}
            muted
            playsInline
            autoPlay
            loop
            onPlaying={() => setClip((c) => (c && c.url === clip.url ? { ...c, on: true } : c))}
            onError={() => setClip(null)}
          />
        )}
        <div className="os-orb a" />
        <div className="os-orb b" />
        <div className="os-scrim" />
        <div className="os-vignette" />
      </div>

      <div className="os-top relative pt-24 sm:pt-28">
        <Hero entry={entry} onGo={go} />
      </div>

      <div ref={railRef} className="os-rail os-rail-at mt-8 sm:mt-10">
        {entries.map((e, i) => (
          <Tile key={e.key} entry={e} on={i === f} onRest={() => setFocus(i)} onGo={go} />
        ))}
      </div>

      {doubled.length > 0 && (
        <div className="os-live" aria-label="What's happening">
          <span className="tag">LIVE</span>
          <div className="lane">
            <div className="run" style={{ '--dur': `${Math.max(24, lines.length * 9)}s` } as CSSProperties}>
              {doubled.map((l, i) => (
                <span key={i} className="ev" aria-hidden={i >= lines.length || undefined}>
                  <span style={{ color: `rgb(${l.rgb})` }}>●</span>
                  <span>{l.text}</span>
                  <em>{l.when}</em>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
