import { useArrQueue } from '../api/queries'
import type { ArrQueueItem } from '../api/arr'

function Row({ d }: { d: ArrQueueItem }) {
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
            className={`h-full rounded-full transition-[width] duration-700 ${d.done ? 'bg-emerald-400' : 'bg-accent-400'}`}
            style={{ width: `${Math.max(d.done ? 100 : 4, d.progress)}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className={d.done ? 'text-emerald-300' : 'text-accent-300'}>{d.status}</span>
          {!d.done && <span className="text-ink-400">{d.progress}%</span>}
        </div>
      </div>
    </div>
  )
}

/** Live "what's downloading" list from the Radarr/Sonarr queue. Renders nothing
 *  when the queue is empty or unreachable. */
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
