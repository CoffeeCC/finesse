// Retro Store (/games/store/retro): browse connected ROM sources & free homebrew/showcase,
// filter by console, pick dump region, 1-click download into RomM, and search Prowlarr Console indexers.

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { getSession } from '../api/client'
import { formatSize } from '../api/gameStore'
import { useGameRequestActions, useGameRequests, useStoreMode } from '../api/gameStoreQueries'
import { useMyLimits } from '../api/parental'
import {
  retroApi,
  RetroApiError,
  useRetroCatalog,
  useRetroDownloads,
  useRetroLiveSearch,
  type RetroDownloadJob,
  type RetroGameEntry,
  type RetroLiveResult,
  type RetroVariant,
} from '../api/retro'
import { cleanName } from '../api/romm'
import { CardSkeleton } from '../components/Skeletons'
import { useToast } from '../components/Toast'
import { GameRequestStatusView } from '../components/gamestore/GameRequestStatus'
import { StoreHeader, StoreSearchBox } from '../components/gamestore/StoreHeader'
import { Spinner } from './setup/ui'

/** Console-themed gradient tiles so art-less ROM entries look crisp and distinct. */
const CONSOLE_GRADIENT: Record<string, [string, string]> = {
  nes: ['#c9243f', '#7a0d1c'],
  snes: ['#8b5cf6', '#4c1d95'],
  n64: ['#2f7d32', '#123f14'],
  gb: ['#8bac0f', '#38560a'],
  gbc: ['#a855f7', '#6b21a8'],
  gba: ['#4f46e5', '#312e81'],
  nds: ['#e11d48', '#881337'],
  '3ds': ['#f43f5e', '#881337'],
  psx: ['#334155', '#0f172a'],
  ps2: ['#1d4ed8', '#0b1e57'],
  ps3: ['#1f2937', '#030712'],
  psp: ['#0f172a', '#020617'],
  genesis: ['#1e6fd9', '#0b3a7a'],
  sms: ['#2563eb', '#0b3a7a'],
  gamegear: ['#0891b2', '#0e3a45'],
  gamecube: ['#6d5ae6', '#33257a'],
  wii: ['#38bdf8', '#0c4a6e'],
  wiiu: ['#0ea5e9', '#075985'],
  switch: ['#e60012', '#7a000a'],
  arcade: ['#f59e0b', '#7c4a02'],
  tg16: ['#ea580c', '#7c2d12'],
  atari2600: ['#b45309', '#451a03'],
  dc: ['#f97316', '#7c2d12'],
  saturn: ['#475569', '#0f172a'],
}

function consoleGradient(slug: string, seed: string): string {
  const hit = CONSOLE_GRADIENT[slug.toLowerCase()]
  if (hit) return `linear-gradient(150deg, ${hit[0]}, ${hit[1]})`
  let h = 17
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return `linear-gradient(150deg, hsl(${hue} 55% 40%), hsl(${hue} 58% 18%))`
}

/** Prefer (USA) → (World) → (Europe) → first available dump. */
function defaultVariantIndex(variants: RetroVariant[]): number {
  if (variants.length <= 1) return 0
  const score = (r: string) => {
    const s = r.toLowerCase()
    if (s.includes('usa')) return 4
    if (s.includes('world')) return 3
    if (s.includes('europe') || s === 'eu' || s === 'eur') return 2
    if (s.includes('en')) return 1
    return 0
  }
  let best = 0
  let bestScore = -1
  for (let i = 0; i < variants.length; i++) {
    const sc = score(variants[i]!.region)
    if (sc > bestScore) {
      bestScore = sc
      best = i
    }
  }
  return best
}

function jobKey(consoleSlug: string, fileName: string): string {
  return `${consoleSlug.toLowerCase()}::${fileName.toLowerCase()}`
}

const RetroGameCard = memo(function RetroGameCard({
  entry,
  romsWritable,
  jobsByKey,
  onDownload,
  startingKey,
}: {
  entry: RetroGameEntry
  romsWritable: boolean
  jobsByKey: Map<string, RetroDownloadJob>
  onDownload: (entry: RetroGameEntry, variant: RetroVariant) => void
  startingKey: string | null
}) {
  const [imgBroken, setImgBroken] = useState(false)
  const [variantIdx, setVariantIdx] = useState(() => defaultVariantIndex(entry.variants))

  // Reset selected variant index if entry changes
  useEffect(() => {
    setVariantIdx(defaultVariantIndex(entry.variants))
    setImgBroken(false)
  }, [entry.id, entry.variants])

  const variant = entry.variants[variantIdx] ?? entry.variants[0]
  const displayTitle = cleanName(entry.title) || entry.title
  const bytes = variant?.sizeBytes ?? entry.sizeBytes
  const currentKey = variant ? jobKey(entry.console, variant.fileName) : ''
  const activeJob = variant ? jobsByKey.get(currentKey) : undefined
  const isStarting = startingKey === currentKey

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] transition hover:border-white/20 hover:bg-white/[0.05]">
      {/* Artwork / Console Tile */}
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-ink-800">
        {entry.cover && !imgBroken ? (
          <img
            decoding="async"
            src={entry.cover}
            alt={displayTitle}
            loading="lazy"
            onError={() => setImgBroken(true)}
            className="fade-in h-full w-full object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full flex-col justify-between p-3"
            style={{ backgroundImage: consoleGradient(entry.console, entry.id) }}
          >
            <span className="self-start rounded-md bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/95">
              {entry.consoleLabel}
            </span>
            <span className="line-clamp-4 text-[15px] font-bold leading-tight text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
              {displayTitle}
            </span>
          </div>
        )}

        {/* Top-left console badge when cover art is present */}
        {entry.cover && !imgBroken && (
          <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
            {entry.consoleLabel}
          </span>
        )}

        {/* Homebrew / Freeware tag */}
        {entry.homebrew && (
          <span className="absolute right-2 top-2 rounded-md bg-emerald-500/80 px-1.5 py-0.5 text-[10px] font-semibold text-ink-950 backdrop-blur-sm">
            Free
          </span>
        )}

        {/* Download progress bar overlay */}
        {activeJob?.state === 'downloading' && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/60">
            <div className="h-full bg-accent-400 transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(4, activeJob.progress))}%` }} />
          </div>
        )}
      </div>

      {/* Metadata + Region + Get */}
      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div className="min-w-0">
          <h3 className="truncate text-[13.5px] font-semibold text-white" title={displayTitle}>
            {displayTitle}
          </h3>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-400">
            {[entry.consoleLabel, bytes ? formatSize(bytes) : '', entry.year ? String(entry.year) : ''].filter(Boolean).join(' · ')}
          </p>
        </div>

        {/* Region picker if multiple dumps exist */}
        {entry.variants.length > 1 && (
          <select
            value={variantIdx}
            onChange={(e) => setVariantIdx(Number(e.target.value))}
            aria-label={`Region for ${displayTitle}`}
            className="h-7 w-full rounded-lg border border-white/12 bg-ink-900 px-2 text-[11.5px] font-medium text-ink-100 outline-none focus:border-accent-400"
          >
            {entry.variants.map((v, idx) => (
              <option key={v.id} value={idx} className="bg-ink-900 text-white">
                {v.region || 'Standard'}
                {v.sizeBytes ? ` (${formatSize(v.sizeBytes)})` : ''}
              </option>
            ))}
          </select>
        )}

        <div className="mt-auto pt-1">
          {!variant ? null : activeJob?.state === 'ready' ? (
            <Link
              to="/games"
              className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25"
            >
              ✓ Added
            </Link>
          ) : activeJob?.state === 'downloading' ? (
            <div className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-500/15 px-2.5 text-xs font-semibold text-sky-200 tabular-nums">
              <Spinner className="h-3 w-3" />
              Downloading {Math.round(activeJob.progress)}%
            </div>
          ) : (
            <button
              type="button"
              disabled={!romsWritable || isStarting}
              title={!romsWritable ? 'Your server’s ROMs folder is read-only' : `Download ${variant.fileName}`}
              onClick={() => onDownload(entry, variant)}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-white px-3 text-xs font-semibold text-ink-950 outline-none transition hover:bg-ink-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent-400 disabled:opacity-45"
            >
              {isStarting ? (
                <>
                  <Spinner className="h-3 w-3" />
                  Starting…
                </>
              ) : !romsWritable ? (
                'ROMs read-only'
              ) : activeJob?.state === 'failed' ? (
                'Retry'
              ) : (
                'Get'
              )}
            </button>
          )}
        </div>
      </div>
    </article>
  )
})

function liveRetroGameId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'game'
  return `live-${slug}`
}

function RetroLiveSearchSection({ q, consoleSlug }: { q: string; consoleSlug?: string }) {
  const trimmed = q.trim()
  const live = useRetroLiveSearch(trimmed, consoleSlug)
  const storeMode = useStoreMode()
  const { data: requests } = useGameRequests()
  const actions = useGameRequestActions()
  const limits = useMyLimits()
  const toast = useToast()
  const qc = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)

  const reqByGameId = useMemo(() => new Map((requests ?? []).map((r) => [r.gameId, r])), [requests])

  if (trimmed.length < 2) return null
  if (!live.isLoading && (!live.data || !live.data.available)) return null

  const items = live.data?.items ?? []
  const requestsBlocked = Boolean(limits && !limits.requests)

  const handleRequest = async (item: RetroLiveResult) => {
    setBusyId(item.id)
    if (storeMode === 'server') {
      actions.liveRequest.mutate(
        {
          title: item.title,
          downloadUrl: item.downloadUrl,
          sizeBytes: item.sizeBytes,
          platform: 'windows',
          installer: 'archive',
          summary: `${item.consoleLabel} · ${item.releaseTitle}`,
        },
        {
          onSuccess: () => toast(`Requested “${item.title}”. Track progress in Requests.`),
          onError: (e) => toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t request “${item.title}”`, 'error'),
          onSettled: () => setBusyId((cur) => (cur === item.id ? null : cur)),
        },
      )
      return
    }
    try {
      const safeName = `${item.title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'rom'}.zip`
      await retroApi.download({
        title: item.title,
        console: item.console,
        fileName: safeName,
        url: item.downloadUrl,
      })
      toast(`Started downloading “${item.title}”`)
      void qc.invalidateQueries({ queryKey: ['retro', 'downloads'] })
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : `Couldn’t request “${item.title}”`, 'error')
    } finally {
      setBusyId((cur) => (cur === item.id ? null : cur))
    }
  }

  return (
    <section className="mt-10 border-t border-white/10 pt-8" aria-label="Live console indexer search">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <h2 className="row-title text-white">Live console search</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-400/30 bg-accent-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent-200">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-400" aria-hidden />
          Prowlarr
        </span>
        {!live.isLoading && (
          <span className="text-xs text-ink-400">
            {items.length === 0 ? 'No console releases found' : `${items.length} ${items.length === 1 ? 'release' : 'releases'}`}
          </span>
        )}
      </div>

      {live.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl shimmer" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-6 text-center text-sm text-ink-400">
          No console indexer releases matched “{trimmed}”. Try a shorter title or another console.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((item) => {
            const existing = reqByGameId.get(liveRetroGameId(item.title))
            const isBusy = busyId === item.id
            const seedTone = item.seeders >= 10 ? 'text-emerald-300' : item.seeders > 0 ? 'text-amber-200' : 'text-ink-400'
            return (
              <li
                key={item.id}
                className="flex flex-col justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-3.5 transition-colors hover:border-white/20 hover:bg-white/[0.055] sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-white">
                      {item.consoleLabel}
                    </span>
                    <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                  </div>
                  <p className="mt-1 truncate font-mono text-[11px] text-ink-400" title={item.releaseTitle}>
                    {item.releaseTitle}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                    <span className="font-mono text-ink-300">{formatSize(item.sizeBytes)}</span>
                    <span className="text-ink-500">·</span>
                    <span className={`font-mono font-medium ${seedTone}`}>{item.seeders} seeders</span>
                    <span className="text-ink-500">·</span>
                    <span className="truncate text-ink-400">{item.indexer}</span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end">
                  {existing ? (
                    <Link
                      to="/games/store/requests"
                      className="inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-3.5 text-xs font-semibold text-white transition hover:bg-white/20"
                    >
                      <GameRequestStatusView request={existing} />
                    </Link>
                  ) : requestsBlocked ? (
                    <span className="text-xs text-ink-400">Requests off</span>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleRequest(item)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97] disabled:opacity-60"
                    >
                      {isBusy ? 'Requesting…' : 'Request'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default function RetroStorePage() {
  const [params, setParams] = useSearchParams()
  const urlQ = params.get('q') ?? ''
  const consoleSlug = params.get('console') || undefined
  const isAdmin = Boolean(getSession()?.isAdmin)
  const toast = useToast()
  const qc = useQueryClient()

  const [searchInput, setSearchInput] = useState(urlQ)
  const [debouncedQ, setDebouncedQ] = useState(urlQ)
  const [startingKey, setStartingKey] = useState<string | null>(null)
  const [enablingHomebrew, setEnablingHomebrew] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<string[]>([])

  const paramsRef = useRef({ urlQ, consoleSlug })
  paramsRef.current = { urlQ, consoleSlug }

  useEffect(() => {
    setSearchInput(urlQ)
    setDebouncedQ(urlQ)
  }, [urlQ])

  useEffect(() => {
    const t = setTimeout(() => {
      const nextQ = searchInput.trim()
      setDebouncedQ(nextQ)
      if (nextQ !== paramsRef.current.urlQ) {
        const next = new URLSearchParams()
        if (paramsRef.current.consoleSlug) next.set('console', paramsRef.current.consoleSlug)
        if (nextQ) next.set('q', nextQ)
        setParams(next, { replace: true })
      }
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, setParams])

  const setConsole = (slug: string | undefined) => {
    const next = new URLSearchParams()
    if (slug) next.set('console', slug)
    const q = searchInput.trim()
    if (q) next.set('q', q)
    setParams(next, { replace: true })
  }

  const catalog = useRetroCatalog(debouncedQ || undefined, consoleSlug)
  const unsupported = catalog.error instanceof RetroApiError && catalog.error.status === 404
  const downloads = useRetroDownloads(!unsupported)

  const jobsByKey = useMemo(() => {
    const map = new Map<string, RetroDownloadJob>()
    for (const d of downloads.data ?? []) {
      const key = jobKey(d.console, d.fileName)
      const prev = map.get(key)
      // Prefer active downloading or ready over an older failed attempt
      if (!prev || d.state === 'downloading' || (d.state === 'ready' && prev.state !== 'downloading')) {
        map.set(key, d)
      }
    }
    return map
  }, [downloads.data])

  const visibleDownloads = useMemo(() => {
    const dismissed = new Set(dismissedIds)
    return (downloads.data ?? []).filter((d) => d.state === 'downloading' || !dismissed.has(d.id))
  }, [downloads.data, dismissedIds])

  const handleDownload = async (entry: RetroGameEntry, variant: RetroVariant) => {
    const key = jobKey(entry.console, variant.fileName)
    setStartingKey(key)
    try {
      await retroApi.download({
        title: entry.title,
        console: entry.console,
        fileName: variant.fileName,
        url: variant.url,
      })
      toast(`Downloading “${cleanName(entry.title) || entry.title}”…`)
      void qc.invalidateQueries({ queryKey: ['retro', 'downloads'] })
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : 'Download couldn’t start', 'error')
    } finally {
      setStartingKey((cur) => (cur === key ? null : cur))
    }
  }

  const handleEnableHomebrew = async () => {
    setEnablingHomebrew(true)
    try {
      await retroApi.setSettings({ homebrew: true })
      toast('Free homebrew shelf turned on!')
      void qc.invalidateQueries({ queryKey: ['retro'] })
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : 'Couldn’t enable homebrew shelf', 'error')
    } finally {
      setEnablingHomebrew(false)
    }
  }

  const data = catalog.data
  const showEmptySourcesShowcase = Boolean(data && data.sourcesCount === 0 && !data.homebrewEnabled && !debouncedQ)

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-12">
      <StoreHeader
        title="Retro games"
        extra={
          <StoreSearchBox
            value={searchInput}
            onChange={setSearchInput}
            onSubmit={() => {
              const nextQ = searchInput.trim()
              setDebouncedQ(nextQ)
              const next = new URLSearchParams()
              if (consoleSlug) next.set('console', consoleSlug)
              if (nextQ) next.set('q', nextQ)
              setParams(next, { replace: true })
            }}
            placeholder="Search retro games & console indexers…"
            ariaLabel="Search retro games"
            className="w-full sm:w-80"
          />
        }
      />

      {/* Active / Recent Retro Downloads Banner */}
      {visibleDownloads.length > 0 && (
        <section className="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4" aria-label="Retro downloads">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">
              {visibleDownloads.some((d) => d.state === 'downloading') ? 'Downloading to your library' : 'Recent retro downloads'}
            </h2>
            {visibleDownloads.some((d) => d.state === 'ready') && (
              <Link to="/games" className="text-xs font-semibold text-accent-300 hover:text-accent-200">
                Play in Your games →
              </Link>
            )}
          </div>
          <ul className="space-y-2.5">
            {visibleDownloads.slice(0, 5).map((d) => (
              <li key={d.id} className="rounded-xl border border-white/[0.06] bg-ink-950/50 px-3.5 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-ink-200">
                      {d.console}
                    </span>
                    <span className="truncate text-[13.5px] font-medium text-white">{cleanName(d.title) || d.title}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5 text-xs">
                    {d.state === 'downloading' ? (
                      <span className="font-mono text-sky-300 tabular-nums">
                        {Math.round(d.progress)}%
                        {d.totalBytes > 0 ? ` · ${formatSize(d.receivedBytes)} / ${formatSize(d.totalBytes)}` : ''}
                      </span>
                    ) : d.state === 'ready' ? (
                      <Link to="/games" className="font-semibold text-emerald-300 hover:text-emerald-200">
                        Play in Your games →
                      </Link>
                    ) : (
                      <span className="text-red-300">{d.error || 'Download failed'}</span>
                    )}
                    {d.state !== 'downloading' && (
                      <button
                        type="button"
                        onClick={() => setDismissedIds((prev) => [...prev, d.id])}
                        aria-label={`Dismiss ${d.title}`}
                        className="grid h-6 w-6 place-items-center rounded-full text-ink-400 hover:bg-white/10 hover:text-white"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
                {d.state === 'downloading' && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-accent-400 transition-[width] duration-300"
                      style={{ width: `${Math.min(100, Math.max(3, d.progress))}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Horizontal Console Filter Strip */}
      {data && data.consoles.length > 0 && (
        <div className="-mx-2 -my-1 mb-6 flex items-center gap-2 overflow-x-auto no-scrollbar px-2 py-1.5" role="region" aria-label="Filter by console">
          <button
            type="button"
            onClick={() => setConsole(undefined)}
            aria-pressed={!consoleSlug}
            className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
              !consoleSlug ? 'bg-[#f5f3ee] text-ink-950' : 'border border-white/10 bg-white/[0.06] text-ink-200 hover:text-white'
            }`}
          >
            All
          </button>
          {data.consoles.map((c) => {
            const active = consoleSlug === c.slug
            return (
              <button
                key={c.slug}
                type="button"
                onClick={() => setConsole(c.slug)}
                aria-pressed={active}
                className={`h-9 shrink-0 rounded-full px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
                  active ? 'bg-[#f5f3ee] text-ink-950' : 'border border-white/10 bg-white/[0.06] text-ink-200 hover:text-white'
                }`}
              >
                {c.label} <span className={active ? 'text-ink-700' : 'text-ink-400'}>{c.count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Main Content */}
      {unsupported ? (
        <div className="mx-auto max-w-lg py-16 text-center">
          <p className="text-lg font-semibold text-white">Retro store isn’t available on this server yet</p>
          <p className="mt-2 text-sm text-ink-400">Update your Finesse server to browse retro sources and download ROMs directly.</p>
          <Link
            to="/games"
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200"
          >
            Back to Games
          </Link>
        </div>
      ) : catalog.isError ? (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-white">Couldn’t load the retro catalog</p>
          <p className="mt-1 text-sm text-ink-400">{catalog.error instanceof Error ? catalog.error.message : 'Try again in a moment.'}</p>
          <button
            type="button"
            onClick={() => void catalog.refetch()}
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200"
          >
            Try again
          </button>
        </div>
      ) : catalog.isLoading ? (
        <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : showEmptySourcesShowcase && data ? (
        <div className="space-y-8">
          {/* 2-game Showcase strip */}
          {data.showcase.length > 0 && (
            <section>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <div>
                  <h2 className="row-title text-white">Try a free retro game right now</h2>
                  <p className="mt-0.5 text-sm text-ink-400">
                    One click drops it straight into your library and starts a RomM scan.
                  </p>
                </div>
              </div>
              <div className="grid max-w-xl grid-cols-2 gap-4">
                {data.showcase.slice(0, 2).map((entry) => (
                  <RetroGameCard
                    key={entry.id}
                    entry={entry}
                    romsWritable={data.romsWritable}
                    jobsByKey={jobsByKey}
                    onDownload={(e, v) => void handleDownload(e, v)}
                    startingKey={startingKey}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Connect ROM sources / Homebrew opt-in card */}
          <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-accent-500/15 via-white/[0.04] to-transparent p-6 sm:p-8">
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-300">Retro ROM Sources</p>
              <h2 className="font-display mt-2 text-2xl leading-tight text-white sm:text-3xl">
                Connect your own ROM directory or Archive collection
              </h2>
              <p className="mt-2.5 text-sm leading-relaxed text-ink-200">
                Add any HTTP ROM directory, Internet Archive collection URL, or JSON catalog in Settings to browse and download your collection with one click — or turn on the curated freeware &amp; homebrew shelf.
              </p>
              {isAdmin ? (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link
                    to="/settings?s=games"
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.98]"
                  >
                    Add a ROM source →
                  </Link>
                  <button
                    type="button"
                    disabled={enablingHomebrew}
                    onClick={() => void handleEnableHomebrew()}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.98] disabled:opacity-50"
                  >
                    {enablingHomebrew && <Spinner className="h-3.5 w-3.5" />}
                    Turn on free homebrew shelf
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs text-ink-400">
                  Ask an administrator to add ROM sources or enable the homebrew shelf in Settings → Games.
                </p>
              )}
            </div>
          </section>
        </div>
      ) : data && data.items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-4">
          {data.items.map((entry) => (
            <div key={entry.id} className="cv-card">
              <RetroGameCard
                entry={entry}
                romsWritable={data.romsWritable}
                jobsByKey={jobsByKey}
                onDownload={(e, v) => void handleDownload(e, v)}
                startingKey={startingKey}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-12 text-center">
          <p className="text-base font-semibold text-white">
            {debouncedQ ? `No retro catalog games match “${debouncedQ}”` : 'No retro games in this console filter'}
          </p>
          <p className="mt-1 text-sm text-ink-400">
            {debouncedQ
              ? 'Check live Prowlarr console results below or try another search term.'
              : 'Try picking another console or adding a ROM source in Settings.'}
          </p>
          {(debouncedQ || consoleSlug) && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('')
                setDebouncedQ('')
                setParams(new URLSearchParams(), { replace: true })
              }}
              className="mt-4 inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Live Prowlarr Console Search */}
      {debouncedQ.length >= 2 && <RetroLiveSearchSection q={debouncedQ} consoleSlug={consoleSlug} />}
    </div>
  )
}
