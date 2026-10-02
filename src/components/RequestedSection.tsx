import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useArrQueue, useArrRequested } from '../api/queries'
import { arrCancelRequest, arrSearchAgain, type ArrRequested } from '../api/arr'
import ArrThumb from './ArrThumb'
import { useToast } from './Toast'

const KIND_LABEL = { movie: 'Movie', series: 'Show', artist: 'Artist' } as const

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function Row({ r }: { r: ArrRequested }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  // Take back is two-tap: first tap arms, second within 4s confirms.
  const [armed, setArmed] = useState(false)

  const refresh = () => setTimeout(() => {
    qc.invalidateQueries({ queryKey: ['arrRequested'] })
    qc.invalidateQueries({ queryKey: ['arrQueue'] })
    qc.invalidateQueries({ queryKey: ['arrLookup'] })
  }, 1200)

  const again = async () => {
    setBusy(true)
    try {
      await arrSearchAgain(r)
      toast(`Looking for “${r.title}” again`)
      refresh()
    } catch {
      toast(`Couldn’t search for “${r.title}” right now`, 'error')
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
      await arrCancelRequest(r)
      toast(`Took back the request for “${r.title}”`)
      refresh()
    } catch {
      toast(`Couldn’t take back “${r.title}”`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-3 rounded-xl border bg-ink-900/60 border-white/5 p-2.5">
      <ArrThumb kind={r.kind} id={r.id} remote={r.poster} title={r.title} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white truncate">
          {r.title}
          {r.year ? <span className="text-ink-400 font-normal"> ({r.year})</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-ink-400">
          {KIND_LABEL[r.kind]} · requested {ago(r.added)}
        </p>
        <p className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${r.available ? 'text-accent-300' : 'text-ink-300'}`}>
          {r.available && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400 animate-pulse" aria-hidden />}
          {r.available ? 'Looking for a release' : 'Not out yet — it’ll download when it is'}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {r.available && (
            <button
              onClick={again}
              disabled={busy}
              className="rounded-lg bg-ink-800 border border-white/10 hover:border-accent-500 disabled:opacity-50 px-3.5 py-2 text-sm font-medium text-ink-100 transition-colors"
            >
              Search again
            </button>
          )}
          <button
            onClick={cancel}
            disabled={busy}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              armed ? 'bg-red-500 hover:bg-red-400 text-white font-semibold' : 'bg-ink-800 border border-white/10 text-ink-100 hover:border-red-400 hover:text-red-300'
            }`}
          >
            {armed ? 'Tap again to confirm' : 'Take back'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Columns the grid has right now (it fits as many cards as the screen allows). */
function useColumns() {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [cols, setCols] = useState(1)
  useEffect(() => {
    if (!el) return
    const read = () => setCols(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length))
    read()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, cols] as const
}

/** Requests from the last 30 days that aren't downloading and have nothing on
 *  disk yet. Renders nothing when there are none. */
export default function RequestedSection() {
  const { data } = useArrRequested()
  const { data: queue } = useArrQueue()
  const busy = new Set((queue ?? []).map((q) => `${q.kind}-${q.refId}`))
  const [all, setAll] = useState(false)
  const [grid, cols] = useColumns()
  const items = (data ?? []).filter((r) => !busy.has(r.key))
  if (items.length === 0) return null
  // Two full rows (at least four), so a long list doesn't push everything else
  // off the screen; no "Show all" to reveal just one more.
  const folded = Math.max(4, cols * 2)
  const foldable = items.length > folded + 1
  const shown = all || !foldable ? items : items.slice(0, folded)
  return (
    <section className="mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <h2 className="text-lg font-semibold text-white tracking-tight">
          Requested <span className="text-ink-400 font-normal text-base tabular-nums">{items.length}</span>
        </h2>
        <span className="text-xs text-ink-400">Downloads start as soon as a release turns up</span>
      </div>
      <div ref={grid} className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-2.5">
        {shown.map((r) => (
          <Row key={r.key} r={r} />
        ))}
      </div>
      {foldable && (
        <button
          onClick={() => setAll((v) => !v)}
          className="mt-3 rounded-lg bg-ink-800 border border-white/10 hover:border-accent-500 px-3.5 py-2 text-sm font-medium text-ink-100 transition-colors"
        >
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  )
}
