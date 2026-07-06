import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useArrQueue } from '../api/queries'
import { arrQueueRemove, arrQueueRetry, type ArrQueueItem } from '../api/arr'
import { sabItemPause, sabItemResume } from '../api/sab'
import { useToast } from './Toast'

function Row({ d }: { d: ArrQueueItem }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  // Cancel is two-tap: first tap arms, second within 4s confirms.
  const [armed, setArmed] = useState(false)

  const refresh = () => {
    // SAB/arr state takes a beat to settle; refetch shortly after acting.
    setTimeout(() => qc.invalidateQueries({ queryKey: ['arrQueue'] }), 1200)
  }

  const togglePause = async () => {
    setBusy(true)
    try {
      await Promise.all(d.nzoIds.map((id) => (d.paused ? sabItemResume(id) : sabItemPause(id))))
      toast(d.paused ? `Resumed “${d.title}”` : `Paused “${d.title}”`)
      refresh()
    } catch {
      toast(`Couldn’t ${d.paused ? 'resume' : 'pause'} “${d.title}”`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 4000)
      return
    }
    setArmed(false)
    setBusy(true)
    try {
      await arrQueueRemove(d)
      toast(`Cancelled “${d.title}”`)
      refresh()
    } catch {
      toast(`Couldn’t cancel “${d.title}”`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    setBusy(true)
    try {
      await arrQueueRetry(d)
      toast(`Dropped the stuck download for “${d.title}” — searching for another release`)
      refresh()
    } catch {
      toast(`Couldn’t retry “${d.title}”`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const attention = d.status === 'Needs attention'

  return (
    <div className={`rounded-xl border p-2.5 ${attention ? 'bg-amber-500/5 border-amber-500/30' : 'bg-ink-900/60 border-white/5'}`}>
      <div className="flex items-center gap-3">
        <div className="w-11 h-16 shrink-0 rounded-md overflow-hidden bg-ink-800">
          {d.poster && (
            <img src={d.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">
            {d.title}
            {d.detail && <span className="text-ink-400 font-normal"> · {d.detail}</span>}
          </p>
          <div className="mt-1.5 h-1.5 rounded-full bg-ink-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-700 ${d.done ? 'bg-emerald-400' : attention ? 'bg-amber-400' : d.paused ? 'bg-ink-500' : 'bg-accent-400'}`}
              style={{ width: `${Math.max(d.done ? 100 : 4, d.progress)}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className={d.done ? 'text-emerald-300' : attention ? 'text-amber-300' : d.paused ? 'text-ink-400' : 'text-accent-300'}>{d.status}</span>
            {!d.done && !attention && <span className="text-ink-400">{d.progress}%</span>}
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
            <button
              onClick={retry}
              disabled={busy}
              className="rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 px-3.5 py-2 text-sm font-semibold text-ink-950 transition-colors"
            >
              {busy ? 'Working…' : 'Retry — find another release'}
            </button>
          )}
          {d.nzoIds.length > 0 && (
            <button
              onClick={togglePause}
              disabled={busy}
              className="rounded-lg bg-ink-800 border border-white/10 hover:border-accent-500 disabled:opacity-50 px-3.5 py-2 text-sm font-medium text-ink-100 transition-colors"
            >
              {d.paused ? 'Resume' : 'Pause'}
            </button>
          )}
          {d.queueIds.length > 0 && (
            <button
              onClick={cancel}
              disabled={busy}
              className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                armed
                  ? 'bg-red-500 hover:bg-red-400 text-white font-semibold'
                  : 'bg-ink-800 border border-white/10 text-ink-100 hover:border-red-400 hover:text-red-300'
              }`}
            >
              {armed ? 'Tap again to confirm' : 'Cancel'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {items.map((d) => (
          <Row key={d.key} d={d} />
        ))}
      </div>
    </section>
  )
}
