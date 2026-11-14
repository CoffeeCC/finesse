import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useArrQueue } from '../api/queries'
import { arrQueueRemove, arrQueueRetry, type ArrQueueItem, type DownloadVia } from '../api/arr'
import { setDownloadsAuto, useDownloadsAuto, type DownloadsAuto, type RescueEvent, type RescueWatch } from '../api/downloads'
import { sabItemPause, sabItemResume } from '../api/sab'
import { useAuth } from '../auth/AuthContext'
import { bytes, explainProblem, roughly, speed as fmtSpeed } from '../lib/downloadProblems'
import ArrThumb from './ArrThumb'
import { useToast } from './Toast'

// What's downloading, one line each: how far, how fast, how long, how it's coming and what
// quality. A row opens to show the rest (the release, where it was found, each episode). A stuck
// download says what happened in plain words and what Finesse will do about it, and when.

/** Says plainly how this is being fetched. */
const VIA: Record<Exclude<DownloadVia, null>, { label: string; hint: string; cls: string }> = {
  torrent: { label: 'Torrent · VPN', hint: 'Downloading by torrent. It only ever runs through your VPN.', cls: 'bg-violet-500/15 text-violet-200 border-violet-400/30' },
  usenet: { label: 'Usenet', hint: 'Downloading from Usenet, through SABnzbd.', cls: 'bg-sky-500/15 text-sky-200 border-sky-400/30' },
  mixed: { label: 'Torrent + Usenet', hint: 'Some of these are coming by torrent (through your VPN) and some from Usenet.', cls: 'bg-ink-700 text-ink-100 border-white/15' },
}

function ViaChip({ via }: { via: DownloadVia }) {
  if (!via) return null
  const v = VIA[via]
  return (
    <span title={v.hint} className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold leading-none ${v.cls}`}>
      {v.label}
    </span>
  )
}

/** Bytes a second per row, worked out from how much less is left each time the list refreshes
 *  (the download apps don't say). Smoothed, so one slow refresh doesn't make it jump. */
function useSpeeds(items: ArrQueueItem[] | undefined): Map<string, number> {
  const last = useRef(new Map<string, { left: number; at: number; bps: number }>())
  const [speeds, setSpeeds] = useState(() => new Map<string, number>())
  useEffect(() => {
    if (!items) return
    const now = Date.now()
    const next = new Map<string, number>()
    const keep = new Map<string, { left: number; at: number; bps: number }>()
    for (const d of items) {
      const prev = last.current.get(d.key)
      let bps = prev?.bps ?? 0
      if (prev && now - prev.at >= 4000) {
        const moved = prev.left - d.leftBytes
        const inst = moved > 0 ? (moved / (now - prev.at)) * 1000 : 0
        bps = prev.bps > 0 ? prev.bps * 0.5 + inst * 0.5 : inst
        keep.set(d.key, { left: d.leftBytes, at: now, bps })
      } else {
        keep.set(d.key, prev ?? { left: d.leftBytes, at: now, bps: 0 })
      }
      if (bps > 0 && d.status === 'Downloading') next.set(d.key, bps)
    }
    last.current = keep
    setSpeeds(next)
  }, [items])
  return speeds
}

/** How long is left: the app's own estimate, or what's left at the speed it's going. */
function etaMs(d: ArrQueueItem, bps: number | undefined): number | null {
  if (d.etaAt) {
    const ms = Date.parse(d.etaAt) - Date.now()
    if (ms > 0) return ms
  }
  if (bps && bps > 0 && d.leftBytes > 0) return (d.leftBytes / bps) * 1000
  return null
}

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h ago` : h < 48 ? 'yesterday' : `${Math.round(h / 24)} days ago`
}

const BTN = 'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50'
const BTN_QUIET = `${BTN} bg-ink-800 border border-white/10 text-ink-100 hover:border-accent-500`

function Row({ d, bps, watch, events, auto }: { d: ArrQueueItem; bps?: number; watch?: RescueWatch; events: RescueEvent[]; auto: DownloadsAuto | undefined }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  // Cancel is two-tap: first tap arms, second within 4s confirms.
  const [armed, setArmed] = useState(false)

  const refresh = () => {
    // The apps take a beat to settle; look again shortly after acting.
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: ['arrQueue'] })
      qc.invalidateQueries({ queryKey: ['downloadsAuto'] })
    }, 1200)
  }
  const run = async (work: () => Promise<unknown>, ok: string, bad: string) => {
    setBusy(true)
    try {
      await work()
      toast(ok)
      refresh()
    } catch {
      toast(bad, 'error')
    } finally {
      setBusy(false)
    }
  }
  const togglePause = () =>
    run(() => Promise.all(d.nzoIds.map((id) => (d.paused ? sabItemResume(id) : sabItemPause(id)))), d.paused ? `Resumed “${d.title}”` : `Paused “${d.title}”`, `Couldn’t ${d.paused ? 'resume' : 'pause'} “${d.title}”`)
  const retry = () => run(() => arrQueueRetry(d), `Dropped the stuck download for “${d.title}”. Looking for another release.`, `Couldn’t retry “${d.title}”`)
  const cancel = () => {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 4000)
      return
    }
    setArmed(false)
    void run(() => arrQueueRemove(d), `Cancelled “${d.title}”`, `Couldn’t cancel “${d.title}”`)
  }

  const attention = d.status === 'Needs attention'
  const problem = attention ? explainProblem(d.reason ?? watch?.reason, d.progress >= 100) : null
  const left = etaMs(d, bps)
  const partsDone = d.parts.filter((p) => p.done).length

  // The right-hand words: what a glance needs.
  const glance = attention
    ? 'Stuck'
    : d.done
      ? 'Adding to your library'
      : d.paused
        ? 'Paused'
        : d.status === 'Downloading'
          ? [bps ? fmtSpeed(bps) : '', left != null ? `${roughly(left)} left` : ''].filter(Boolean).join(' · ') || 'Downloading'
          : 'Waiting its turn'

  // What Finesse is going to do about a stuck one, and when.
  const plan = !attention
    ? null
    : problem!.fix === 'person'
      ? null
      : watch?.exhausted
        ? `Finesse tried ${watch.swaps} other releases today and they got stuck too, so it has stopped trying for now.`
        : auto && !auto.enabled
          ? 'Automatic fixing is switched off.'
          : watch?.dueAt
            ? problem!.fix === 'clear'
              ? `Finesse clears it away in ${roughly(Date.parse(watch.dueAt) - Date.now())}.`
              : `If it’s still stuck in ${roughly(Date.parse(watch.dueAt) - Date.now())}, Finesse swaps it for another release${auto?.both ? (d.via === 'torrent' ? ', from Usenet if there is one' : d.via === 'usenet' ? ', by torrent if need be' : '') : ''}.`
            : auto
              ? 'Finesse is keeping an eye on it.'
              : null

  const meta = [d.detail && d.parts.length > 1 && partsDone > 0 ? `${partsDone} of ${d.parts.length} done` : d.detail, d.quality, d.sizeBytes > 0 ? (d.leftBytes > 0 && !d.done ? `${bytes(d.sizeBytes - d.leftBytes)} of ${bytes(d.sizeBytes)}` : bytes(d.sizeBytes)) : ''].filter(Boolean)
  const hasMore = Boolean(d.release || d.indexer || d.client || d.parts.length > 1 || events.length)

  return (
    <li className={`rounded-xl border ${attention ? 'bg-amber-500/[0.06] border-amber-500/30' : 'bg-ink-900/60 border-white/5'}`}>
      <div className="flex items-center gap-3 p-2.5">
        <ArrThumb kind={d.kind} id={d.refId} remote={d.poster} title={d.title} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-semibold text-white">{d.title}</p>
            <span className={`shrink-0 text-xs tabular-nums ${attention ? 'text-amber-300 font-semibold' : d.done ? 'text-emerald-300' : d.paused ? 'text-ink-400' : 'text-accent-300'}`}>{glance}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={d.progress} aria-label={`${d.title}: ${d.progress}%`}>
              <div
                className={`h-full rounded-full transition-[width] duration-700 ${d.done ? 'bg-emerald-400' : attention ? 'bg-amber-400' : d.paused ? 'bg-ink-500' : 'bg-accent-400'}`}
                style={{ width: `${Math.max(d.done ? 100 : 3, d.progress)}%` }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-300">{d.done ? '100' : d.progress}%</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-400">
            <ViaChip via={d.via} />
            <span className="min-w-0 truncate">{meta.join(' · ')}</span>
          </div>
        </div>
      </div>

      {attention && (
        <div className="border-t border-amber-500/20 px-3 py-2.5">
          <p className="text-[13px] leading-snug text-amber-100">{problem!.what}</p>
          {problem!.todo && <p className="mt-1 text-[13px] leading-snug text-amber-200/85">{problem!.todo}</p>}
          {plan && <p className="mt-1 text-xs leading-snug text-amber-200/70">{plan}</p>}
        </div>
      )}

      {!d.done && (d.queueIds.length > 0 || d.nzoIds.length > 0 || hasMore) && (
        <div className="flex flex-wrap items-center gap-2 px-2.5 pb-2.5">
          {attention && d.queueIds.length > 0 && problem!.fix !== 'person' && (
            <button onClick={retry} disabled={busy} className={`${BTN} bg-amber-500 hover:bg-amber-400 font-semibold text-ink-950`}>
              {busy ? 'Working…' : problem!.fix === 'clear' ? 'Clear it now' : 'Try another release now'}
            </button>
          )}
          {d.nzoIds.length > 0 && !attention && (
            <button onClick={togglePause} disabled={busy} className={BTN_QUIET}>
              {d.paused ? 'Resume' : 'Pause'}
            </button>
          )}
          {d.queueIds.length > 0 && (
            <button onClick={cancel} disabled={busy} className={armed ? `${BTN} bg-red-500 hover:bg-red-400 font-semibold text-white` : `${BTN_QUIET} hover:!border-red-400 hover:text-red-300`}>
              {armed ? 'Tap again to confirm' : 'Cancel'}
            </button>
          )}
          {hasMore && (
            <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`${BTN} ml-auto text-ink-300 hover:text-white`}>
              {open ? 'Less' : 'Details'}
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="border-t border-white/5 px-3 py-2.5 text-xs text-ink-300">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {d.release && (
              <>
                <dt className="text-ink-400">Release</dt>
                <dd className="min-w-0 break-words font-mono text-[11px] text-ink-200">{d.release}</dd>
              </>
            )}
            {d.indexer && (
              <>
                <dt className="text-ink-400">Found on</dt>
                <dd>{d.indexer}</dd>
              </>
            )}
            {d.client && (
              <>
                <dt className="text-ink-400">Downloading with</dt>
                <dd>{d.client}</dd>
              </>
            )}
            {attention && d.reason && (
              <>
                <dt className="text-ink-400">The app says</dt>
                <dd className="min-w-0 break-words">{d.reason}</dd>
              </>
            )}
          </dl>
          {d.parts.length > 1 && (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
              {d.parts.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-ink-200">{p.label}</span>
                  <span className={`shrink-0 tabular-nums ${p.status === 'Needs attention' ? 'text-amber-300' : p.done ? 'text-emerald-300' : 'text-ink-400'}`}>
                    {p.status === 'Needs attention' ? 'Stuck' : p.done ? 'Done' : p.status === 'Downloading' ? `${p.progress}%` : p.status === 'Paused' ? 'Paused' : 'Waiting'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {events.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-white/5 pt-2">
              {events.slice(0, 4).map((e) => (
                <li key={e.at} className="text-ink-400">
                  {ago(e.at)}: {e.what === 'swapped' ? 'Finesse swapped a stuck download for another release' : e.what === 'dropped' ? 'Finesse cleared a download the library didn’t need' : 'Finesse stopped trying other releases for today'} ({explainProblem(e.reason).what.replace(/\.$/, '').toLowerCase()})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/** One line on what Finesse does by itself, and (for admins) the two choices behind it. */
function AutoLine({ auto }: { auto: DownloadsAuto }) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const change = async (c: { enabled?: boolean; prefer?: 'usenet' | 'torrent'; stalledMinutes?: number }) => {
    setBusy(true)
    try {
      qc.setQueryData(['downloadsAuto'], await setDownloadsAuto(c))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const order = !auto.both || !auto.prefer ? '' : auto.prefer === 'usenet' ? ' Usenet first, torrents as the backup.' : ' Torrents first, Usenet as the backup.'
  const swapped = auto.log.filter((e) => e.what === 'swapped' && Date.now() - Date.parse(e.at) < 7 * 86_400_000).length
  return (
    <div className="mb-3 rounded-xl border border-white/5 bg-ink-900/40 px-3 py-2 text-xs text-ink-300">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${auto.enabled ? 'bg-emerald-400' : 'bg-ink-500'}`} aria-hidden />
        <span className="min-w-0 flex-1">
          {auto.enabled ? 'Finesse swaps a stuck download for another release by itself.' : 'Stuck downloads wait for someone to press Try another release.'}
          {order}
          {swapped > 0 && ` ${swapped} swapped this week.`}
        </span>
        {session?.isAdmin && (
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="font-semibold text-accent-300 hover:text-white">
            {open ? 'Done' : 'Change'}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/5 pt-2.5">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={auto.enabled} disabled={busy} onChange={(e) => void change({ enabled: e.target.checked })} className="h-4 w-4 accent-[var(--color-accent-400)]" />
            <span className="text-ink-100">Fix stuck downloads automatically</span>
          </label>
          {auto.both && (
            <label className="flex items-center gap-2">
              <span className="text-ink-100">Try first</span>
              <select value={auto.prefer ?? 'usenet'} disabled={busy} onChange={(e) => void change({ prefer: e.target.value as 'usenet' | 'torrent' })} className="rounded-lg border border-white/10 bg-ink-800 px-2 py-1 text-ink-100">
                <option value="usenet">Usenet (torrents as the backup)</option>
                <option value="torrent">Torrents (Usenet as the backup)</option>
              </select>
            </label>
          )}
          <label className="flex items-center gap-2">
            <span className="text-ink-100">Give a stalled download</span>
            <select value={auto.stalledMinutes} disabled={busy || !auto.enabled} onChange={(e) => void change({ stalledMinutes: Number(e.target.value) })} className="rounded-lg border border-white/10 bg-ink-800 px-2 py-1 text-ink-100">
              {[...new Set([30, 60, 120, 240, 480, auto.stalledMinutes])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : `${m / 60} hours`}
                </option>
              ))}
            </select>
          </label>
          <span className="basis-full text-ink-400">A download that fails outright is replaced straight away. One that stalls, or can’t be added to the library, gets its wait and then Finesse tries another release: up to {auto.maxSwaps} a day for each title. A full disk or a folder problem is never “fixed” this way; it’s shown here with what to do.</span>
        </div>
      )}
    </div>
  )
}

/** Live "what's downloading" list from the Radarr/Sonarr/Lidarr queues, with
 *  pause/resume/cancel controls. Renders nothing when the queue is empty. */
export default function DownloadsSection({ limit, title = 'Downloading now' }: { limit?: number; title?: string }) {
  const { data, isError } = useArrQueue()
  const full = !limit
  const { data: auto } = useDownloadsAuto(Boolean(data?.length))
  const speeds = useSpeeds(data)
  const totals = useMemo(() => {
    const list = data ?? []
    const active = list.filter((d) => !d.done && d.status !== 'Needs attention')
    return {
      stuck: list.filter((d) => d.status === 'Needs attention').length,
      left: active.reduce((n, d) => n + d.leftBytes, 0),
      bps: [...speeds.values()].reduce((a, b) => a + b, 0),
    }
  }, [data, speeds])
  if (isError || !data || data.length === 0) return null

  const items = limit ? data.slice(0, limit) : data
  const summary = [
    `${data.length} in progress`,
    totals.left > 0 ? `${bytes(totals.left)} to go` : '',
    totals.bps > 0 ? fmtSpeed(totals.bps) : '',
    totals.bps > 0 && totals.left > 0 ? `${roughly((totals.left / totals.bps) * 1000)} left` : '',
  ].filter(Boolean)

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-white">{title}</h2>
        <span className="text-xs tabular-nums text-ink-400">
          {totals.stuck > 0 && <span className="mr-2 font-semibold text-amber-300">{totals.stuck} stuck</span>}
          {summary.join(' · ')}
        </span>
      </div>
      {full && auto && <AutoLine auto={auto} />}
      <ul className="grid grid-cols-1 items-start gap-2 lg:grid-cols-2 2xl:grid-cols-3">
        {items.map((d) => (
          <Row key={d.key} d={d} bps={speeds.get(d.key)} watch={auto?.watching.find((w) => w.key === d.key)} events={(auto?.log ?? []).filter((e) => e.key === d.key)} auto={auto} />
        ))}
      </ul>
    </section>
  )
}
