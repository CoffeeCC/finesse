import { memo, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useArrFailures, useArrQueue, useArrRequested } from '../api/queries'
import { requestStatus } from '../lib/requestStatus'
import { CONFIRM_AGAIN, RequestStatusView, useConfirmPress, useLater } from './RequestStatus'
import { arrCancelRequest, arrSearchAgain, type ArrFailure, type ArrRequested } from '../api/arr'
import ArrThumb from './ArrThumb'
import WhyNothingModal from './WhyNothingModal'
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

const BTN = 'rounded-lg px-3.5 py-2 text-sm font-medium transition active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100'

const Row = memo(function Row({ r, failure }: { r: ArrRequested; failure?: ArrFailure }) {
  const toast = useToast()
  const qc = useQueryClient()
  const later = useLater()
  const [busy, setBusy] = useState<'again' | 'cancel' | null>(null)
  // Take back is two-press: the first arms it, a second within 4 s confirms.
  const confirm = useConfirmPress()
  const [why, setWhy] = useState(false)

  // Everything that says whether this title is requested, once the app has caught up.
  const refresh = () =>
    later(() => {
      for (const key of [['arrRequested'], ['arrQueue'], ['arrLookup'], ['arrLookupAll'], ['arrDiscover'], ['arrMovieDetails'], ['arrFailures']]) void qc.invalidateQueries({ queryKey: key })
    }, 1200)

  const again = async () => {
    if (busy) return
    setBusy('again')
    try {
      await arrSearchAgain(r)
      toast(`Looking for “${r.title}” again`)
      refresh()
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t search for “${r.title}” right now`, 'error')
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
      await arrCancelRequest(r)
      // Gone from the list at once; the lists that offered Request again catch up just after.
      qc.setQueryData<ArrRequested[]>(['arrRequested'], (list) => list?.filter((x) => x.key !== r.key))
      toast(`Took back the request for “${r.title}”`)
      refresh()
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message.slice(0, 180) : `Couldn’t take back “${r.title}”`, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={`flex gap-3 rounded-xl border bg-ink-900/60 border-white/5 p-2.5 transition-opacity ${busy === 'cancel' ? 'opacity-60' : ''}`}>
      <ArrThumb kind={r.kind} id={r.id} remote={r.poster} title={r.title} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white truncate">
          {r.title}
          {r.year ? <span className="text-ink-400 font-normal"> ({r.year})</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-ink-400">
          {KIND_LABEL[r.kind]} · requested {ago(r.added)}
        </p>
        <RequestStatusView status={requestStatus({ requested: true, hasFile: false, available: r.available, failure })} className="mt-1" />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {r.available && r.kind !== 'artist' && (
            <button
              type="button"
              onClick={() => setWhy(true)}
              className={`${BTN} bg-ink-800 border border-white/10 hover:border-accent-500 text-ink-100`}
            >
              Why nothing yet?
            </button>
          )}
          {r.available && (
            <button type="button" onClick={again} disabled={busy !== null} className={`${BTN} bg-ink-800 border border-white/10 hover:border-accent-500 text-ink-100`}>
              {busy === 'again' ? 'Searching…' : 'Search again'}
            </button>
          )}
          <button
            type="button"
            onClick={cancel}
            onBlur={confirm.disarm}
            disabled={busy !== null}
            className={`${BTN} ${
              confirm.armed ? 'bg-red-500 hover:bg-red-400 text-white font-semibold' : 'bg-ink-800 border border-white/10 text-ink-100 hover:border-red-400 hover:text-red-300'
            }`}
          >
            {busy === 'cancel' ? 'Taking back…' : confirm.armed ? CONFIRM_AGAIN : 'Take back'}
          </button>
        </div>
      </div>
      {why && r.kind !== 'artist' && <WhyNothingModal item={{ kind: r.kind, id: r.id, title: r.title, year: r.year }} onClose={() => setWhy(false)} />}
    </div>
  )
})

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
  // One failures lookup for the list (not one subscription per row).
  const { data: failures } = useArrFailures(Boolean(data?.length))
  const [all, setAll] = useState(false)
  const [grid, cols] = useColumns()
  const items = useMemo(() => {
    const busy = new Set((queue ?? []).map((q) => `${q.kind}-${q.refId}`))
    return (data ?? []).filter((r) => !busy.has(r.key))
  }, [data, queue])
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
          <Row key={r.key} r={r} failure={failures?.get(r.key)} />
        ))}
      </div>
      {foldable && (
        <button type="button" onClick={() => setAll((v) => !v)} className={`mt-3 ${BTN} bg-ink-800 border border-white/10 hover:border-accent-500 text-ink-100`}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  )
}
