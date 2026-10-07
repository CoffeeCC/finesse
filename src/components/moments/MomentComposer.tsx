import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { clock, deleteMoment, getMomentTargets, sendMoment, type Moment } from '../../api/moments'
import { useToast } from '../Toast'
import { isBackKey } from '../../lib/back'
import { NOTE_MAX, spanLabel } from './moments'

// Flag a moment (from the player: a start and end you can nudge) or recommend a
// whole title (from its page). Pick who it's for: everyone here, some people,
// friends' servers that can watch it; nobody keeps it as your own bookmark.

export default function MomentComposer({
  item,
  title,
  span,
  existing,
  inline,
  onClose,
}: {
  item: string
  title: string
  /** From the player: where you are and how long the title is. */
  span?: { now: number; duration: number }
  /** Moments already in this title (the player's), listed so yours can be deleted. */
  existing?: Moment[]
  /** Inside the player: kept in its element, which is what's on screen in full screen. */
  inline?: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const targets = useQuery({ queryKey: ['moments', 'targets', item], queryFn: () => getMomentTargets(item), staleTime: 60_000, retry: false })
  const friendName = item.startsWith('f-') ? (targets.data?.friends.find((f) => f.id === 'owner')?.name ?? null) : null
  const max = span ? Math.max(1, span.duration || span.now + 600) : 0
  const [start, setStart] = useState(() => (span ? Math.max(0, Math.floor(span.now - 5)) : 0))
  const [end, setEnd] = useState(() => (span ? Math.min(max, Math.ceil(span.now + 10)) : 0))
  const [note, setNote] = useState('')
  const [spoiler, setSpoiler] = useState(false)
  const [to, setTo] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isBackKey(e) && !busy) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])

  const toggle = (id: string) =>
    setTo((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      // "Everyone here" covers each person here.
      if (id === 'home' && n.has('home')) for (const k of [...n]) if (k.startsWith('user:')) n.delete(k)
      if (id.startsWith('user:') && n.has(id)) n.delete('home')
      return n
    })

  const nudge = (which: 'start' | 'end', d: number) => {
    if (which === 'start') setStart((s) => Math.min(Math.max(0, s + d), end - 1))
    else setEnd((e) => Math.max(Math.min(max, e + d), start + 1, 0))
  }
  const tooLong = span ? end - start > 600 : false

  const audience = useMemo(() => {
    const t = targets.data
    if (!t) return ''
    const names: string[] = []
    if (to.has('home')) names.push('everyone here')
    for (const p of t.people) if (to.has(`user:${p.id}`)) names.push(p.name)
    for (const f of t.friends) if (to.has(f.id)) names.push(`everyone on ${f.name}`)
    return names.join(', ')
  }, [targets.data, to])

  const remove = async (key: string) => {
    try {
      await deleteMoment(key)
      await qc.invalidateQueries({ queryKey: ['moments'] })
      toast('Moment deleted')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const listed = (existing ?? []).filter((m) => m.start != null)

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      await sendMoment({ item, start: span ? start : null, end: span ? end : null, note, spoiler, to: [...to] })
      await qc.invalidateQueries({ queryKey: ['moments'] })
      toast(to.size ? `Sent to ${audience}` : 'Saved for you')
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const chip = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => toggle(id)}
      aria-pressed={to.has(id)}
      className={`h-9 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors ${
        to.has(id) ? 'border-accent-300 bg-accent-400/20 text-white' : 'border-white/15 text-ink-200 hover:border-white/30 hover:text-white'
      }`}
    >
      {label}
    </button>
  )

  // In <body>: a page's entrance animation (a transform) would otherwise pin it to the page, not the screen.
  const dialog = (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="moment-title" onClick={(e) => {
        e.stopPropagation()
        if (!busy) onClose()
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-md max-h-[calc(var(--vh,1vh)*92)] overflow-y-auto rounded-2xl border border-white/10 bg-ink-900 p-5 sm:p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 id="moment-title" className="font-display text-[26px] leading-tight text-white">
          {span ? 'Flag a moment' : 'Recommend'}
        </h2>
        <p className="mt-0.5 truncate text-[13.5px] text-ink-400">{title}</p>

        {listed.length > 0 && (
          <div className="mt-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">Already flagged here</p>
            <ul className="mt-1.5 space-y-1">
              {listed.map((m) => (
                <li key={m.key} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-[13px]">
                  <span className="shrink-0 font-mono text-[12px] text-ink-300">{clock(m.start!)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-200">
                    <span className="text-white">{m.mine ? 'You' : m.from}</span>
                    {m.note && !m.spoiler ? ` · ${m.note}` : m.spoiler ? ' · (spoiler)' : ''}
                  </span>
                  {(m.mine || m.canDelete) && (
                    <button type="button" onClick={() => void remove(m.key)} className="shrink-0 rounded-full px-2 py-0.5 text-[12px] text-ink-400 hover:bg-white/10 hover:text-red-200">
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {span && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">The moment</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {(['start', 'end'] as const).map((w) => (
                <div key={w}>
                  <p className="text-[12.5px] text-ink-300">{w === 'start' ? 'From' : 'To'}</p>
                  <div className="mt-1 flex items-center gap-1">
                    <button type="button" onClick={() => nudge(w, -5)} className="h-8 w-9 rounded-lg bg-white/5 text-[13px] text-ink-200 hover:bg-white/10" aria-label={`${w === 'start' ? 'Start' : 'End'} 5 seconds earlier`}>
                      −5
                    </button>
                    <span className="min-w-[4.2rem] text-center font-mono text-[15px] tabular-nums text-white">{clock(w === 'start' ? start : end)}</span>
                    <button type="button" onClick={() => nudge(w, 5)} className="h-8 w-9 rounded-lg bg-white/5 text-[13px] text-ink-200 hover:bg-white/10" aria-label={`${w === 'start' ? 'Start' : 'End'} 5 seconds later`}>
                      +5
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className={`mt-2 text-[12.5px] ${tooLong ? 'text-red-200' : 'text-ink-400'}`}>{tooLong ? 'A moment is at most 10 minutes long' : spanLabel(start, end)}</p>
          </div>
        )}

        <label className="mt-4 block">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">Note</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            rows={2}
            placeholder={span ? 'this scene 😭' : 'You’d love this'}
            className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-ink-950/60 px-3 py-2 text-[15px] text-white placeholder:text-ink-500 focus:border-accent-300 focus:outline-none"
          />
          <span className="block text-right text-[11.5px] text-ink-500">
            {note.length}/{NOTE_MAX}
          </span>
        </label>
        <label className="mt-1 flex items-center gap-2.5 text-[14px] text-ink-200">
          <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} className="h-4 w-4 accent-accent-400" />
          Spoiler: hide the note until they choose to see it
        </label>

        <div className="mt-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">Send to</p>
          {targets.isLoading ? (
            <p className="mt-2 text-[13.5px] text-ink-400">Finding people…</p>
          ) : targets.isError ? (
            <p className="mt-2 text-[13.5px] text-red-200">{(targets.error as Error).message}</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {chip('home', 'Everyone here')}
              {targets.data!.people.map((p) => chip(`user:${p.id}`, p.name))}
              {targets.data!.friends.map((f) => chip(f.id, f.name))}
            </div>
          )}
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-400">
            {to.size
              ? `They’ll get a notification${span ? ', and the note pops up when they reach it' : ''}.`
              : span
                ? 'Nobody picked: it’s saved just for you.'
                : 'Pick who to send it to.'}
            {friendName && ` It’s kept on ${friendName}, where the video is, so whoever runs it can see it.`}
          </p>
        </div>

        {error && <p className="mt-3 text-[13.5px] text-red-200">{error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={busy} className="h-10 rounded-full px-5 text-[14px] font-medium text-ink-200 hover:text-white disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={send} disabled={busy || tooLong || (!span && !to.size)} className="h-10 rounded-full bg-white px-6 text-[14px] font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-50">
            {busy ? 'Sending…' : to.size ? 'Send' : span ? 'Save for me' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
  return inline ? dialog : createPortal(dialog, document.body)
}
