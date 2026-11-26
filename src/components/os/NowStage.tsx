import { continueHereHref, positionNow } from '../../lib/transfer'
import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import * as api from '../../api/client'
import { useClipManifest, useItem, useWatchlistIds } from '../../api/queries'
import { formatRuntime } from '../../api/types'
import { morphNavigate } from '../../lib/motion'
import { claimPreview, previewClipUrl, releasePreview, EMPTY_MANIFEST } from '../../lib/preview'
import { getPrefs } from '../../lib/settings'
import { setMood } from '../../lib/mood'
import { IS_TV } from '../../lib/device'
import { RestartIcon } from '../ActionButton'
import CastMenu from '../CastMenu'
import { useToast } from '../Toast'
import { useLiveLines, useNowEntries, type NowEntry } from './now'
import { useInView } from '../../lib/inView'
import { episodeChip } from '../../lib/episodes'

/** Resting this long on a title starts its preview clip behind the stage. */
const CLIP_DWELL_MS = 2200
/** Resting the mouse on a tile picks it; sweeping past tiles doesn't strobe the stage. */
const HOVER_DWELL_MS = 380
/** Fallback timeout so a slow logo check never stalls the hero title. */
const LOGO_TIMEOUT_MS = 500

/** The tile you were on, kept while the app is open: Back to Home lands on it
 *  again rather than on the first tile. */
let rememberedFocus: string | null = null

const reducedMotion = () =>
  (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce') ||
  (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
const canHover = () => typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches

const PlayIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.5-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8Z" />
  </svg>
)

/** Whether a title logo will read on a dark scene (some are dark lettering).
 *  null while it's being checked; remembered per logo (bounded). */
const logoVerdicts = new Map<string, boolean>()
function rememberLogoVerdict(url: string, ok: boolean) {
  if (logoVerdicts.size >= 200) {
    const oldest = logoVerdicts.keys().next().value
    if (oldest !== undefined) logoVerdicts.delete(oldest)
  }
  logoVerdicts.set(url, ok)
}
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
    let timer = 0
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const finish = (ok: boolean, cache: boolean) => {
      if (!live) return
      live = false
      window.clearTimeout(timer)
      if (cache) rememberLogoVerdict(url, ok)
      setVerdict({ url, ok })
    }
    timer = window.setTimeout(() => {
      img.onload = null
      img.onerror = null
      finish(false, false)
    }, LOGO_TIMEOUT_MS)
    img.onload = () => {
      try {
        const w = 64
        const h = Math.max(1, Math.round((w * img.naturalHeight) / Math.max(1, img.naturalWidth)))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d')
        if (!g) return finish(true, true)
        g.drawImage(img, 0, 0, w, h)
        const d = g.getImageData(0, 0, w, h).data
        let sum = 0
        let n = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255
          n++
        }
        finish(n > 20 && sum / n > 0.32, true)
      } catch {
        finish(true, true)
      }
    }
    img.onerror = () => finish(false, true)
    img.src = url
    return () => {
      live = false
      window.clearTimeout(timer)
      img.onload = null
      img.onerror = null
    }
  }, [url])
  return verdict.url === url ? verdict.ok : null
}

/** The details the stage shows for what you rest on (debounced so sweeping past tiles doesn't fire a fetch per tile). */
function useChips(entry: NowEntry) {
  const rawId = entry.item && entry.kind !== 'music' ? entry.item.Id : undefined
  const [settledId, setSettledId] = useState<string | undefined>(rawId)
  useEffect(() => {
    if (!rawId) {
      setSettledId(undefined)
      return
    }
    const t = window.setTimeout(() => setSettledId(rawId), 220)
    return () => window.clearTimeout(t)
  }, [rawId])
  const { data: full } = useItem(settledId)
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
      const code = episodeChip(it)
      if (code) chips.push(code)
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

/** Hero-sized glass My List toggle matching `.os-btn.os-glass` height and presence. */
function HeroWatchlistButton({ itemId }: { itemId: string }) {
  const { data: ids } = useWatchlistIds()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const inList = ids?.includes(itemId) ?? false

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    const add = !inList
    try {
      const next = await api.setInWatchlist(itemId, add)
      qc.setQueryData(['watchlistIds'], next)
      void qc.invalidateQueries({ queryKey: ['watchlistItems'] })
      toast(add ? 'Added to My List' : 'Removed from My List')
    } catch {
      toast('Couldn’t update My List', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={inList}
      aria-label={inList ? 'Remove from My List' : 'Add to My List'}
      title={inList ? 'In My List' : 'Add to My List'}
      className={`os-btn os-glass max-sm:w-12 max-sm:px-0 disabled:opacity-50 ${inList ? '!text-accent-300' : ''}`}
    >
      <svg className="h-5 w-5 shrink-0" fill={inList ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
      </svg>
      <span className="hidden sm:inline">{inList ? 'In My List' : 'My List'}</span>
    </button>
  )
}

function Hero({
  entry,
  onGo,
  onDismissed,
}: {
  entry: NowEntry
  onGo: (e: NowEntry, ev: React.MouseEvent, from: HTMLElement | null, to?: string) => void
  onDismissed: (key: string) => void
}) {
  const { chips, line } = useChips(entry)
  const logoOk = useLogoReadable(entry.logo)
  const qc = useQueryClient()
  const toast = useToast()
  const [dismissing, setDismissing] = useState(false)

  // Episodes toggle their parent Series on My List so the whole show stays saved.
  const watchlistId = entry.item
    ? entry.item.Type === 'Episode'
      ? entry.item.SeriesId ?? entry.item.Id
      : entry.item.Type === 'Movie' || entry.item.Type === 'Series'
        ? entry.item.Id
        : null
    : null
  // Send it to the TV: your own titles that play as video (a friend's live on their server).
  const castable = !IS_TV && entry.item && /^(Movie|Episode|Video|MusicVideo)$/.test(entry.item.Type) && !entry.item.Id.startsWith('f-')
  const dismissable = entry.kind === 'resume' && Boolean(entry.item) && !entry.item!.Id.startsWith('f-')

  const dismissResume = async () => {
    if (!entry.item || dismissing) return
    setDismissing(true)
    try {
      await api.clearResumePosition(entry.item.Id)
      void qc.invalidateQueries({ queryKey: ['resume'] })
      void qc.invalidateQueries({ queryKey: ['nextUp'] })
      toast(`Removed “${entry.title}” from Continue Watching`)
      onDismissed(entry.key)
    } catch {
      toast('Couldn’t remove from Continue Watching', 'error')
    } finally {
      setDismissing(false)
    }
  }

  return (
    // Re-keyed per title so each one rises in.
    <div key={entry.key} className="os-hero">
      <p className="os-kicker flex items-center gap-3 text-white/85 mb-4 sm:mb-5">
        <span className="os-dot" />
        <span>{entry.kicker}</span>
      </p>
      {/* Every part of the hero keeps its height from title to title, so Play
          stays where it was (a long story or a missing progress bar moved it).
          Render the title text immediately until the logo is confirmed ready. */}
      <div className="os-name">
        {logoOk === true && entry.logo ? (
          <img className="os-logo" src={entry.logo} alt={entry.title} crossOrigin={IS_TV ? undefined : 'anonymous'} />
        ) : (
          <h1 className={`os-title ${entry.title.length > 14 ? 'long' : ''}`}>{entry.title}</h1>
        )}
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
        {entry.restart && (
          <Link
            to={entry.restart}
            className="os-btn os-glass os-restart"
            aria-label={`Start ${entry.title} over from the beginning`}
            title="Start over"
            onClick={(e) => onGo(entry, e, (e.currentTarget.closest('.os-stage') as HTMLElement | null)?.querySelector<HTMLElement>('.os-bd.on') ?? null, entry.restart)}
          >
            <RestartIcon />
            <span>Start over</span>
          </Link>
        )}
        {entry.info && (
          <Link to={entry.info} className="os-btn os-glass">
            More info
          </Link>
        )}
        {castable && <CastMenu item={entry.item!} variant="os" />}
        {watchlistId && <HeroWatchlistButton itemId={watchlistId} />}
        {dismissable && (
          <button
            type="button"
            onClick={dismissResume}
            disabled={dismissing}
            aria-label={`Remove ${entry.title} from Continue Watching`}
            title="Remove from Continue Watching"
            className="os-btn os-glass max-sm:w-12 max-sm:px-0 text-white/80 hover:text-white disabled:opacity-50"
          >
            <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
            <span className="hidden sm:inline">{dismissing ? 'Removing…' : 'Dismiss'}</span>
          </button>
        )}
      </div>
      <div className={`os-prog os-prog-at mt-6 sm:mt-7 ${entry.pct === undefined ? 'invisible' : ''}`} aria-hidden={entry.pct === undefined || undefined}>
        <i style={{ width: `${entry.pct ?? 0}%` }} />
      </div>
    </div>
  )
}

/** Full-height shimmer placeholder while Now entries load so the page never jumps 100vh. */
function StageSkeleton() {
  return (
    <section className="os-stage" aria-busy="true" aria-label="Loading Home">
      <div className="os-scene" aria-hidden>
        <div className="os-orb a" />
        <div className="os-orb b" />
        <div className="os-scrim" />
        <div className="os-vignette" />
      </div>
      <div className="os-top relative pt-24 sm:pt-28" aria-hidden>
        <div className="os-hero">
          <div className="h-3.5 w-36 rounded-full shimmer mb-5" />
          <div className="os-name">
            <div className="h-14 sm:h-20 w-72 sm:w-96 max-w-full rounded-2xl shimmer" />
          </div>
          <div className="mt-5 sm:mt-6 flex gap-2">
            <div className="h-7 w-20 rounded-full shimmer" />
            <div className="h-7 w-24 rounded-full shimmer" />
            <div className="h-7 w-16 rounded-full shimmer" />
          </div>
          <div className="os-line mt-4 sm:mt-5 space-y-2.5 max-w-[540px]">
            <div className="h-4 w-full rounded shimmer" />
            <div className="h-4 w-4/5 rounded shimmer" />
          </div>
          <div className="os-actions mt-6 sm:mt-8 flex items-center gap-3">
            <div className="h-12 sm:h-14 w-36 rounded-full shimmer" />
            <div className="h-12 sm:h-14 w-32 rounded-full shimmer" />
          </div>
          <div className="os-prog os-prog-at mt-6 sm:mt-7 invisible" />
        </div>
      </div>
      <div className="os-rail os-rail-at mt-8 sm:mt-10" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="os-tile shimmer !opacity-60" />
        ))}
      </div>
    </section>
  )
}

const Tile = memo(function Tile({
  entry,
  on,
  onRest,
  onGo,
}: {
  entry: NowEntry
  on: boolean
  onRest: (key: string) => void
  onGo: (e: NowEntry, ev: React.MouseEvent, from: HTMLElement | null) => void
}) {
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const coverMode = Boolean(entry.cover) && !entry.tileArt
  const rest = useCallback(() => onRest(entry.key), [onRest, entry.key])
  return (
    <Link
      to={entry.primary.to}
      className={`os-tile ${on ? 'on' : ''}`}
      style={{ '--t': entry.tint } as CSSProperties}
      aria-label={`${entry.title}: ${entry.sub}`}
      data-tile
      onFocus={rest}
      // A real move only: scrolling the page under a resting pointer also
      // "enters" tiles, and must not steal the stage from the remote or controller.
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse' || (e.movementX === 0 && e.movementY === 0) || on) return
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(rest, HOVER_DWELL_MS)
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
})

/** Finesse 2.0's home: the art of what you rest on fills the screen, over a row
 *  of everything that's "now" in the house, with a live line underneath. */
export default function NowStage() {
  const artWidth = useMemo(() => (!IS_TV && typeof window !== 'undefined' && window.innerWidth > 1280 ? 1920 : 1280), [])
  const { entries, loading } = useNowEntries(artWidth)
  // Follows the title, not its place: the row fills in as data arrives, and
  // the house changes (someone starts playing) while you rest on something.
  const [focusKey, setFocusKey] = useState<string | null>(() => rememberedFocus)
  useEffect(() => {
    if (focusKey) rememberedFocus = focusKey
  }, [focusKey])
  const f = Math.max(0, entries.findIndex((e) => e.key === focusKey))
  const entry = entries[f]
  const entryKey = entry?.key ?? null
  const entryTint = entry?.tint ?? null
  const entryItemId = entry?.item?.Id
  const entrySeriesId = entry?.item?.SeriesId
  const setFocusByKey = useCallback((key: string) => {
    startTransition(() => setFocusKey(key))
  }, [])
  const setFocus = useCallback((i: number) => {
    const k = entries[i]?.key ?? null
    startTransition(() => setFocusKey(k))
  }, [entries])
  const navigate = useNavigate()
  const railRef = useRef<HTMLDivElement>(null)
  const lines = useLiveLines(entries)

  // Desktop rail scroll arrows visibility
  const [railScroll, setRailScroll] = useState({ left: false, right: false })
  const syncRailScroll = useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const left = rail.scrollLeft > 12
    const right = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 12
    setRailScroll((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  // Keep only the current backdrop, its immediate neighbors, and a small LRU tail
  // so crossfades stay smooth without pinning 10+ 1920px bitmaps in GPU memory.
  const [seen, setSeen] = useState<string[]>([])
  useEffect(() => {
    const near = entries.slice(Math.max(0, f - 1), f + 2).map((e) => e.key)
    if (!near.length) return
    setSeen((prev) => {
      const merged = [...prev.filter((k) => !near.includes(k)), ...near]
      const trimmed = merged.slice(-5)
      if (trimmed.length === prev.length && trimmed.every((k, i) => k === prev[i])) return prev
      return trimmed
    })
  }, [entries, f])
  const seenSet = useMemo(() => new Set(seen), [seen])

  // The whole app takes on the title's colour (nav, washes, loading states).
  useEffect(() => {
    if (entryTint) setMood(entryTint)
  }, [entryTint])

  // Rest on a title for a moment and its preview clip plays behind the stage —
  // only while the stage is on screen: scrolled down the page, it pauses and starts nothing new.
  const [stageRef, stageInView] = useInView<HTMLElement>()
  const { data: manifest } = useClipManifest()
  const entryClipUrl = useMemo(() => {
    if (!entryItemId && !entrySeriesId) return null
    const ids = [entryItemId, entrySeriesId].filter(Boolean) as string[]
    return ids.map((id) => previewClipUrl(id, getPrefs().previewQuality, manifest ?? EMPTY_MANIFEST)).find(Boolean) ?? null
  }, [entryItemId, entrySeriesId, manifest])
  const [clip, setClip] = useState<{ key: string; url: string; on: boolean } | null>(null)
  const stopClip = useCallback(() => setClip(null), [])
  useEffect(() => {
    setClip(null)
    // TVs: one video decoder is for the film itself, not a background loop.
    if (!entryKey || !entryClipUrl || reducedMotion() || IS_TV || !stageInView) return
    const t = window.setTimeout(() => setClip({ key: entryKey, url: entryClipUrl, on: false }), CLIP_DWELL_MS)
    return () => window.clearTimeout(t)
  }, [entryKey, entryClipUrl, stageInView])
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
      syncRailScroll()
      return
    }
    if (!focusKey && !touched.current) rail.scrollLeft = 0
    syncRailScroll()
  }, [entries, focusKey, syncRailScroll])

  // Phones: the stage follows whichever tile the row is resting on. Desktop: keep arrow states fresh.
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const touch = () => {
      touched.current = true
    }
    rail.addEventListener('pointerdown', touch, { passive: true })
    rail.addEventListener('wheel', touch, { passive: true })
    if (!IS_TV) {
      syncRailScroll()
      window.addEventListener('resize', syncRailScroll, { passive: true })
    }
    if (canHover()) {
      const onDesktopScroll = () => syncRailScroll()
      rail.addEventListener('scroll', onDesktopScroll, { passive: true })
      return () => {
        rail.removeEventListener('pointerdown', touch)
        rail.removeEventListener('wheel', touch)
        rail.removeEventListener('scroll', onDesktopScroll)
        if (!IS_TV) window.removeEventListener('resize', syncRailScroll)
      }
    }
    let raf = 0
    const onScroll = () => {
      if (!IS_TV) syncRailScroll()
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
      if (!IS_TV) window.removeEventListener('resize', syncRailScroll)
      cancelAnimationFrame(raf)
    }
  }, [setFocus, syncRailScroll, entries.length])

  const scrollRail = useCallback((dir: number) => {
    const rail = railRef.current
    if (!rail) return
    touched.current = true
    rail.scrollBy({ left: dir * rail.clientWidth * 0.72, behavior: 'smooth' })
  }, [])

  const onDismissed = useCallback((key: string) => {
    setFocusKey((cur) => (cur === key ? null : cur))
    if (rememberedFocus === key) rememberedFocus = null
  }, [])

  const go = useCallback(
    (e: NowEntry, ev: React.MouseEvent, from: HTMLElement | null, to = e.primary.to) => {
      const h = e.primary.handoff
      if (h && e.item && to === e.primary.to) {
        if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return
        ev.preventDefault()
        // Continue here: where the other device is right now (the list can be 15 s old); it's
        // stopped by the player once this one is playing, not before.
        const item = e.item
        void api
          .getSessions()
          .then((list) => list.find((x) => x.Id === h.sessionId))
          .catch(() => undefined)
          .then((s) => navigate(s?.NowPlayingItem?.Id === item.Id ? continueHereHref(item.Id, positionNow(s), h) : to))
        return
      }
      morphNavigate(() => navigate(to), { from, name: 'vt-hero', event: ev })
    },
    [navigate],
  )

  if (loading && !entry) return <StageSkeleton />
  if (!entry) return null

  const staticTicker = IS_TV || reducedMotion() || lines.length === 1
  const doubled = !staticTicker && lines.length > 1 ? [...lines, ...lines] : []
  return (
    <section ref={stageRef} className="os-stage" aria-label="Now" style={{ '--tint-rgb': entry.tint } as CSSProperties}>
      <div className="os-scene" aria-hidden>
        {entries.map((e, i) => {
          if (!seenSet.has(e.key)) return null
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
        <Hero entry={entry} onGo={go} onDismissed={onDismissed} />
      </div>

      <div className="group/rail relative">
        {!IS_TV && railScroll.left && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => scrollRail(-1)}
            aria-label="Scroll Now rail left"
            className="hidden md:flex absolute left-4 lg:left-6 top-1/2 -translate-y-1/2 z-10 h-11 w-11 items-center justify-center rounded-full os-glass text-white opacity-0 group-hover/rail:opacity-100 focus-visible:opacity-100 transition-opacity hover:scale-105 active:scale-95"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
        )}
        <div ref={railRef} className="os-rail os-rail-at mt-8 sm:mt-10">
          {entries.map((e, i) => (
            <Tile key={e.key} entry={e} on={i === f} onRest={setFocusByKey} onGo={go} />
          ))}
        </div>
        {!IS_TV && railScroll.right && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => scrollRail(1)}
            aria-label="Scroll Now rail right"
            className="hidden md:flex absolute right-4 lg:right-6 top-1/2 -translate-y-1/2 z-10 h-11 w-11 items-center justify-center rounded-full os-glass text-white opacity-0 group-hover/rail:opacity-100 focus-visible:opacity-100 transition-opacity hover:scale-105 active:scale-95"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        )}
      </div>

      {lines.length > 0 && (
        <div className="os-live" aria-label="What's happening">
          <span className="tag">LIVE</span>
          {staticTicker ? (
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center gap-6 overflow-hidden whitespace-nowrap">
                {lines.slice(0, 3).map((l, i) => (
                  <span key={i} className="ev min-w-0 truncate">
                    <span className="shrink-0" style={{ color: `rgb(${l.rgb})` }}>●</span>
                    <span className="truncate">{l.text}</span>
                    <em className="shrink-0">{l.when}</em>
                  </span>
                ))}
              </div>
            </div>
          ) : (
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
          )}
        </div>
      )}
    </section>
  )
}
