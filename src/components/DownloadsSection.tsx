import { memo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useArrQueue } from '../api/queries'
import { arrQueueRemove, arrQueueRetry, type ArrQueueItem, type DownloadVia } from '../api/arr'
import { sabItemPause, sabItemResume } from '../api/sab'
import ArrThumb from './ArrThumb'
import { CONFIRM_AGAIN, useConfirmPress, useLater } from './RequestStatus'
import { useToast } from './Toast'

/** Says plainly how this is being fetched, right by the status. */
const VIA: Record<Exclude<DownloadVia, null>, { label: string; hint: string; cls: string }> = {
  torrent: { label: 'Torrent · through your VPN', hint: 'Downloading by torrent. It only ever runs through your VPN.', cls: 'bg-violet-500/15 text-violet-200 border-violet-400/30' },
  usenet: { label: 'Usenet', hint: 'Downloading from Usenet, through SABnzbd.', cls: 'bg-sky-500/15 text-sky-200 border-sky-400/30' },
  mixed: { label: 'Torrent + Usenet', hint: 'Some of these are coming by torrent (through your VPN) and some from Usenet.', cls: 'bg-ink-700 text-ink-100 border-white/15' },
}

function ViaChip({ via }: { via: DownloadVia }) {
  if (!via) return null
  const v = VIA[via]
  return (
    <span title={v.hint} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none ${v.cls}`}>
      {v.label}
    </span>
  )
}

type Action = 'pause' | 'cancel' | 'retry'

const BTN = 'rounded-lg px-3.5 py-2 text-sm font-medium transition active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100'
const QUIET = 'bg-ink-800 border border-white/10 text-ink-100 hover:border-accent-500'

const Row = memo(function Row({ d }: { d: ArrQueueItem }) {
  const toast = useToast()
  const qc = useQueryClient()
  const later = useLater()
  const [busy, setBusy] = useState<Action | null>(null)
  // Cancel is two-press: the first arms it, a second within 4 s confirms.
  const confirm = useConfirmPress()

  // Change this row in the cached queue now; SAB and the app take a beat to agree, so the
  // queue is fetched again shortly after (cleared if the row goes first).
  const patch = (fn: (list: ArrQueueItem[]) => ArrQueueItem[]) => qc.setQueryData<ArrQueueItem[]>(['arrQueue'], (list) => (list ? fn(list) : list))
  const refresh = () => later(() => void qc.invalidateQueries({ queryKey: ['arrQueue'] }), 1200)

  const togglePause = async () => {
    if (busy) return
    const pausing = !d.paused
    setBusy('pause')
    try {
      await Promise.all(d.nzoIds.map((id) => (pausing ? sabItemPause(id) : sabItemResume(id))))
      patch((list) => list.map((x) => (x.key === d.key ? { ...x, paused: pausing, status: pausing ? 'Paused' : 'Downloading' } : x)))
      toast(pausing ? `Paused “${d.title}”` : `Resumed “${d.title}”`)
      refresh()
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : `Couldn’t ${pausing ? 'pause' : 'resume'} “${d.title}”`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const cancel = async () => {
    if (busy) return
    if (!confirm.armed) return confirm.arm()
    confirm.disarm()
    setBusy('cancel')
    try {
      await arrQueueRemove(d)
      patch((list) => list.filter((x) => x.key !== d.key))
      toast(`Cancelled “${d.title}”`)
      refresh()
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t cancel “${d.title}”`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const retry = async () => {
    if (busy) return
    setBusy('retry')
    try {
      await arrQueueRetry(d)
      patch((list) => list.filter((x) => x.key !== d.key))
      toast(`Dropped the stuck download for “${d.title}” — searching for another release`)
      refresh()
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t retry “${d.title}”`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const attention = d.status === 'Needs attention'

  return (
    <div className={`rounded-xl border p-2.5 transition-opacity ${busy === 'cancel' || busy === 'retry' ? 'opacity-60' : ''} ${attention ? 'bg-amber-500/5 border-amber-500/30' : 'bg-ink-900/60 border-white/5'}`}>
      <div className="flex items-center gap-3">
        <ArrThumb kind={d.kind} id={d.refId} remote={d.poster} title={d.title} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">
            {d.title}
            {d.detail && <span className="text-ink-400 font-normal"> · {d.detail}</span>}
          </p>
          <div
            className="mt-1.5 h-1.5 rounded-full bg-ink-700 overflow-hidden"
            role="progressbar"
            aria-label={`${d.title}: ${d.status}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={d.done ? 100 : d.progress}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-700 ${d.done ? 'bg-emerald-400' : attention ? 'bg-amber-400' : d.paused ? 'bg-ink-500' : 'bg-accent-400'}`}
              style={{ width: `${Math.max(d.done ? 100 : 4, d.progress)}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              <span className={d.done ? 'text-emerald-300' : attention ? 'text-amber-300' : d.paused ? 'text-ink-400' : 'text-accent-300'}>{d.status}</span>
              <ViaChip via={d.via} />
            </span>
            {!d.done && !attention && <span className="shrink-0 tabular-nums text-ink-400">{d.progress}%</span>}
          </div>
        </div>
      </div>

      {/* Why it's stuck — plain-language reason from Radarr/Sonarr/Lidarr. */}
      {attention && (
        <p className="mt-2 text-xs text-amber-200/80 leading-snug">
          {d.reason
            ? `${d.reason}`
            : 'This download couldn’t be imported. Retry to drop it and search for a different release.'}
        </p>
      )}

      {/* Big labeled controls — easy D-pad targets. Hidden once importing. */}
      {!d.done && (d.queueIds.length > 0 || d.nzoIds.length > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {attention && d.queueIds.length > 0 && (
            <button type="button" onClick={retry} disabled={busy !== null} className={`${BTN} bg-amber-500 hover:bg-amber-400 font-semibold text-ink-950`}>
              {busy === 'retry' ? 'Retrying…' : 'Retry — find another release'}
            </button>
          )}
          {d.nzoIds.length > 0 && (
            <button type="button" onClick={togglePause} disabled={busy !== null} className={`${BTN} ${QUIET}`}>
              {busy === 'pause' ? (d.paused ? 'Resuming…' : 'Pausing…') : d.paused ? 'Resume' : 'Pause'}
            </button>
          )}
          {d.queueIds.length > 0 && (
            <button
              type="button"
              onClick={cancel}
              onBlur={confirm.disarm}
              disabled={busy !== null}
              className={`${BTN} ${
                confirm.armed ? 'bg-red-500 hover:bg-red-400 text-white font-semibold' : 'bg-ink-800 border border-white/10 text-ink-100 hover:border-red-400 hover:text-red-300'
              }`}
            >
              {busy === 'cancel' ? 'Cancelling…' : confirm.armed ? CONFIRM_AGAIN : 'Cancel'}
            </button>
          )}
        </div>
      )}
    </div>
  )
})

/** Live "what's downloading" list from the Radarr/Sonarr/Lidarr queues, with
 *  pause/resume/cancel controls. Renders nothing when the queue is empty. */
export default function DownloadsSection({ limit, title = 'Downloading now' }: { limit?: number; title?: string }) {
  const { data, isError } = useArrQueue()
  if (isError || !data || data.length === 0) return null

  const items = limit ? data.slice(0, limit) : data

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold text-white tracking-tight">{title}</h2>
        <span className="text-xs text-ink-400">{data.length} in progress</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-2.5">
        {items.map((d) => (
          <Row key={d.key} d={d} />
        ))}
      </div>
    </section>
  )
}
