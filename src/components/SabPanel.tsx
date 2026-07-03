import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSabStatus } from '../api/queries'
import { sabPauseAll, sabResumeAll, sabSetLimit } from '../api/sab'
import { useToast } from './Toast'

const LIMITS: { label: string; mbps: number }[] = [
  { label: 'Unlimited', mbps: 0 },
  { label: '50 MB/s', mbps: 50 },
  { label: '30 MB/s', mbps: 30 },
  { label: '20 MB/s', mbps: 20 },
  { label: '10 MB/s', mbps: 10 },
  { label: '5 MB/s', mbps: 5 },
]

function fmtSpeed(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
  if (bps >= 1024) return `${Math.round(bps / 1024)} kB/s`
  return `${bps} B/s`
}

/** Global downloader (SABnzbd) status + controls: pause everything, cap speed.
 *  Renders nothing when SAB is unreachable. */
export default function SabPanel() {
  const { data, isError } = useSabStatus()
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  if (isError || !data) return null

  const refresh = () => setTimeout(() => qc.invalidateQueries({ queryKey: ['sabStatus'] }), 800)

  const togglePause = async () => {
    setBusy(true)
    try {
      if (data.paused) {
        await sabResumeAll()
        toast('Downloads resumed')
      } else {
        await sabPauseAll()
        toast('All downloads paused')
      }
      refresh()
    } catch {
      toast('Downloader didn’t respond', 'error')
    } finally {
      setBusy(false)
    }
  }

  const changeLimit = async (mbps: number) => {
    setBusy(true)
    try {
      await sabSetLimit(mbps)
      toast(mbps > 0 ? `Speed capped at ${mbps} MB/s` : 'Speed limit removed')
      refresh()
    } catch {
      toast('Couldn’t set the speed limit', 'error')
    } finally {
      setBusy(false)
    }
  }

  // Match the active limit to a preset (SAB reports bytes/sec).
  const activeMbps = data.limitBps > 0 ? Math.round(data.limitBps / 1024 / 1024) : 0

  return (
    <section className="mb-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl bg-ink-900/60 border border-white/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${data.paused ? 'bg-amber-400' : data.speedBps > 0 ? 'bg-emerald-400' : 'bg-ink-500'}`} />
          <span className="font-medium text-ink-100">
            {data.paused ? 'Downloads paused' : data.jobs > 0 ? fmtSpeed(data.speedBps) : 'Downloader idle'}
          </span>
          {!data.paused && data.jobs > 0 && data.timeLeft && (
            <span className="text-ink-400 text-xs">{data.timeLeft} left</span>
          )}
        </div>

        <span className="text-xs text-ink-400">{Math.round(data.diskFreeGb)} GB free</span>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={activeMbps}
            onChange={(e) => changeLimit(Number(e.target.value))}
            disabled={busy}
            aria-label="Download speed limit"
            className="rounded-lg bg-ink-800 border border-white/10 px-2 py-1.5 text-xs outline-none focus:border-accent-500 text-ink-200 disabled:opacity-50"
          >
            {LIMITS.map((l) => (
              <option key={l.mbps} value={l.mbps}>
                {l.mbps === 0 ? 'No speed limit' : `Limit ${l.label}`}
              </option>
            ))}
            {activeMbps > 0 && !LIMITS.some((l) => l.mbps === activeMbps) && (
              <option value={activeMbps}>Limit {activeMbps} MB/s</option>
            )}
          </select>
          <button
            onClick={togglePause}
            disabled={busy}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              data.paused
                ? 'bg-accent-600 hover:bg-accent-500 text-white'
                : 'bg-ink-800 border border-white/10 text-ink-200 hover:border-accent-500'
            }`}
          >
            {data.paused ? 'Resume all' : 'Pause all'}
          </button>
        </div>
      </div>
    </section>
  )
}
