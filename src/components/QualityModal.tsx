import { useEffect, useMemo, useState } from 'react'
import {
  ArrError,
  arrAutomaticSearch,
  arrGrabRelease,
  arrLibraryQuality,
  arrSearchReleases,
  formatQualityInfo,
  type ArrKind,
  type ArrQualityInfo,
  type ArrRelease,
  type ArrResult,
} from '../api/arr'
import { useToast } from './Toast'

type Filter = 'upgrades' | 'all'

function fmtSize(n: number): string {
  if (!n) return '—'
  const gb = n / 1_000_000_000
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`
  return `${Math.round(n / 1_000_000)} MB`
}

function fmtAge(hours?: number): string {
  if (hours == null || !Number.isFinite(hours)) return '—'
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

export default function QualityModal({
  item,
  onClose,
}: {
  item: ArrResult
  onClose: () => void
}) {
  const toast = useToast()
  const [quality, setQuality] = useState<ArrQualityInfo | null>(null)
  const [releases, setReleases] = useState<ArrRelease[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('upgrades')
  const [grabbing, setGrabbing] = useState<string | null>(null)
  const [autoBusy, setAutoBusy] = useState(false)

  const kind = item.kind as ArrKind

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [q, rel] = await Promise.all([
          arrLibraryQuality(kind, item.id),
          arrSearchReleases(kind, item.id),
        ])
        if (cancelled) return
        setQuality(q)
        setReleases(rel)
        // If nothing looks like an upgrade, default to "all" so the user still sees options.
        const hasUpgrade = rel.some((r) => !r.rejected && (r.isUpgrade || isLikelyUpgrade(r, q)))
        if (!hasUpgrade) setFilter('all')
      } catch (e) {
        if (cancelled) return
        let msg = 'Couldn’t load releases'
        if (e instanceof ArrError) {
          if (e.status === 401) msg = 'Sign in again'
          else if (e.message) msg = e.message.slice(0, 200)
        }
        setError(msg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [kind, item.id])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = useMemo(() => {
    if (!releases) return []
    if (filter === 'all') return releases
    return releases.filter((r) => !r.rejected && (r.isUpgrade || isLikelyUpgrade(r, quality)))
  }, [releases, filter, quality])

  const grab = async (r: ArrRelease) => {
    // Warn when Radarr has already flagged hard blockers — Force grab often still
    // works for "meets cutoff" / "not wanted", but size limits and dead NZBs fail.
    if (r.rejected && r.rejections.length) {
      const hard = r.rejections.filter((x) =>
        /larger than maximum|smaller than minimum|unable to match|not enabled/i.test(x),
      )
      if (hard.length) {
        const ok = window.confirm(
          `This release was rejected by Radarr:\n\n• ${r.rejections.slice(0, 4).join('\n• ')}\n\nForce grab anyway? Size-limit rejections often still fail.`,
        )
        if (!ok) return
      }
    }
    setGrabbing(r.guid)
    try {
      await arrGrabRelease(kind, r)
      toast(
        r.rejected || !isLikelyUpgrade(r, quality)
          ? `Grabbed “${r.qualityName}” — check Downloads / SABnzbd`
          : `Upgrade grabbed — ${r.qualityName}`,
      )
      onClose()
    } catch (e) {
      let msg = 'Grab failed'
      if (e instanceof ArrError && e.message) msg = e.message.slice(0, 220)
      toast(msg, 'error')
    } finally {
      setGrabbing(null)
    }
  }

  const autoSearch = async () => {
    setAutoBusy(true)
    try {
      await arrAutomaticSearch(kind, item.id)
      toast('Automatic upgrade search started — check Downloads shortly')
    } catch (e) {
      let msg = 'Search failed'
      if (e instanceof ArrError && e.message) msg = e.message.slice(0, 180)
      toast(msg, 'error')
    } finally {
      setAutoBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Quality for ${item.title}`}
    >
      <button
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-2xl max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-ink-900 border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 p-4 sm:p-5 border-b border-white/5">
          {item.poster && (
            <img
              src={item.poster}
              alt=""
              className="w-14 h-20 rounded-lg object-cover shrink-0 bg-ink-800"
              referrerPolicy="no-referrer"
            />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-white leading-tight">
              {item.title}
              {item.year ? <span className="text-ink-400 font-normal"> ({item.year})</span> : null}
            </h2>
            <p className="mt-1 text-xs text-ink-400">
              Current:{' '}
              <span className="text-ink-200">
                {loading && !quality ? '…' : quality ? formatQualityInfo(quality) : 'No file info'}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-ink-400 leading-snug">
              Pick a better release to upgrade, or any lower one to downgrade. Grabbing replaces the
              file via Radarr/Sonarr.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 h-8 w-8 rounded-full hover:bg-white/10 text-ink-300 hover:text-white"
            aria-label="Close"
          >
            <svg className="h-5 w-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 sm:px-5 py-3 border-b border-white/5 flex-wrap">
          <div className="inline-flex rounded-full bg-ink-800/80 border border-white/10 p-0.5">
            {(
              [
                ['upgrades', 'Upgrades'],
                ['all', 'All / downgrade'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filter === id ? 'bg-accent-600 text-white' : 'text-ink-300 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={autoSearch}
            disabled={autoBusy || loading}
            className="ml-auto text-xs font-semibold rounded-full border border-white/10 px-3 py-1.5 text-ink-200 hover:bg-white/5 disabled:opacity-50"
            title="Let Radarr/Sonarr search within your quality profile"
          >
            {autoBusy ? 'Searching…' : 'Auto search'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <p className="p-6 text-sm text-ink-400">Searching indexers… this can take a moment.</p>
          )}
          {error && <p className="p-6 text-sm text-red-300">{error}</p>}
          {!loading && !error && visible.length === 0 && (
            <p className="p-6 text-sm text-ink-400">
              {filter === 'upgrades'
                ? 'No clear upgrades found. Try “All / downgrade” to pick any release.'
                : 'No releases returned from the indexers.'}
            </p>
          )}
          <ul className="divide-y divide-white/5">
            {visible.map((r) => {
              const upgrade = !r.rejected && (r.isUpgrade || isLikelyUpgrade(r, quality))
              const lower =
                !r.rejected &&
                quality?.qualityResolution != null &&
                r.qualityResolution != null &&
                r.qualityResolution < quality.qualityResolution
              return (
                <li key={r.guid + r.indexerId} className="px-4 sm:px-5 py-3 flex gap-3 items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-semibold text-white">{r.qualityName}</span>
                      {upgrade && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          Upgrade
                        </span>
                      )}
                      {lower && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded">
                          Lower
                        </span>
                      )}
                      {r.rejected && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded">
                          Rejected
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ink-400 line-clamp-2 break-all">{r.title}</p>
                    <p className="mt-1 text-[11px] text-ink-400 tabular-nums">
                      {fmtSize(r.size)}
                      {r.seeders != null ? ` · ${r.seeders} seeders` : ''}
                      {r.ageHours != null ? ` · ${fmtAge(r.ageHours)}` : ''}
                      {r.customFormatScore ? ` · score ${r.customFormatScore}` : ''}
                    </p>
                    {r.rejected && r.rejections.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {r.rejections.slice(0, 3).map((rej) => (
                          <li
                            key={rej}
                            className={`text-[11px] line-clamp-2 ${
                              /larger than maximum|smaller than minimum/i.test(rej)
                                ? 'text-amber-300/90'
                                : 'text-red-300/80'
                            }`}
                          >
                            {rej}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    onClick={() => grab(r)}
                    disabled={grabbing === r.guid}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      r.rejected
                        ? 'bg-white/5 text-ink-200 hover:bg-white/10 border border-white/10'
                        : upgrade
                          ? 'bg-accent-600 hover:bg-accent-500 text-white'
                          : 'bg-ink-700 hover:bg-ink-600 text-white border border-white/10'
                    }`}
                    title={r.rejections.join(' · ') || undefined}
                  >
                    {grabbing === r.guid ? '…' : r.rejected ? 'Force grab' : lower ? 'Downgrade' : 'Grab'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

/** Heuristic when *arr doesn't set isUpgrade (common on some versions). */
function isLikelyUpgrade(r: ArrRelease, current: ArrQualityInfo | null): boolean {
  if (!current) return !r.rejected
  if (r.qualityResolution != null && current.qualityResolution != null) {
    if (r.qualityResolution > current.qualityResolution) return true
    if (r.qualityResolution < current.qualityResolution) return false
  }
  // Same quality bucket: prefer larger file (often remux / better encode) or higher score
  if (current.sizeBytes && r.size > current.sizeBytes * 1.15) return true
  if (r.customFormatScore > 0 && r.qualityName === current.qualityName) return r.customFormatScore >= 0
  return Boolean(r.isUpgrade)
}
