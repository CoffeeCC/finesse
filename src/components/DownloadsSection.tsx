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

  return (
    <div className="flex items-center gap-3 rounded-xl bg-ink-900/60 border border-white/5 p-2.5">
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
            className={`h-full rounded-full transition-[width] duration-700 ${d.done ? 'bg-emerald-400' : d.paused ? 'bg-ink-500' : 'bg-accent-400'}`}
            style={{ width: `${Math.max(d.done ? 100 : 4, d.progress)}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className={d.done ? 'text-emerald-300' : d.paused ? 'text-ink-400' : 'text-accent-300'}>{d.status}</span>
          {!d.done && <span className="text-ink-400">{d.progress}%</span>}
        </div>
      </div>

      {/* Controls: retry (stuck rows), pause/resume (usenet only), cancel. Hidden once importing. */}
      {!d.done && (
        <div className="flex items-center gap-1 shrink-0">
          {d.status === 'Needs attention' && d.queueIds.length > 0 && (
            <button
              onClick={retry}
              disabled={busy}
              title="Drop this download and search for a different release"
              aria-label="Retry with a different release"
              className="h-8 w-8 rounded-full flex items-center justify-center text-amber-300 hover:text-amber-200 hover:bg-white/10 disabled:opacity-40 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
          )}
          {d.nzoIds.length > 0 && (
            <button
              onClick={togglePause}
              disabled={busy}
              title={d.paused ? 'Resume' : 'Pause'}
              aria-label={d.paused ? 'Resume download' : 'Pause download'}
              className="h-8 w-8 rounded-full flex items-center justify-center text-ink-300 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors"
            >
              {d.paused ? (
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5.14v13.72c0 .84.93 1.35 1.64.9l10.18-6.86a1.08 1.08 0 0 0 0-1.8L9.64 4.24A1.08 1.08 0 0 0 8 5.14Z" /></svg>
              ) : (
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
              )}
            </button>
          )}
          {d.queueIds.length > 0 && (
            <button
              onClick={cancel}
              disabled={busy}
              title={armed ? 'Tap again to confirm' : 'Cancel download'}
              aria-label="Cancel download"
              className={`h-8 rounded-full flex items-center justify-center transition-all ${
                armed
                  ? 'px-2.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-400'
                  : 'w-8 text-ink-300 hover:text-red-300 hover:bg-white/10'
              } disabled:opacity-40`}
            >
              {armed ? (
                'Sure?'
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              )}
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
