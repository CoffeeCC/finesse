import { useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'
import { useSearch } from '../api/queries'
import {
  addToQueue,
  createQueue,
  deleteQueue,
  leaveQueue,
  pickInQueue,
  removeFromQueue,
  updateQueue,
  useQueue,
  useQueues,
  useQueuesOn,
  voteInQueue,
  type Queue,
  type QueueItem,
} from '../api/queues'
import { ConfirmDialog } from '../components/ConfirmDialog'
import PeoplePicker from '../components/PeoplePicker'
import { usePartiesOn, usePartyInvites } from '../api/parties'
import { useToast } from '../components/Toast'
import { playChoice } from '../lib/playChoice'
import type { JfItem } from '../api/types'

// Watch together: shortlists for picking something with other people here. Start one, name
// who's in it, add titles (here or from any title's More menu), everyone gets one vote, and
// whoever started it picks. Picking doesn't start playback on anyone's device.

const BTN = 'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60'
const BTN_MAIN = `${BTN} bg-white text-ink-950 hover:bg-ink-200`
const BTN_SOFT = `${BTN} bg-white/10 border border-white/15 text-white hover:bg-white/15`
const FIELD = 'h-10 rounded-lg border border-white/15 bg-white/[0.05] px-3 text-[15px] text-white outline-none focus:border-white/40'

export default function TogetherPage() {
  const on = useQueuesOn()
  if (!on)
    return (
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="page-title">Watch together</h1>
        <p className="mt-3 text-[14px] text-ink-300">This server’s Finesse is older and can’t do this yet. Ask whoever runs it to update Finesse.</p>
      </div>
    )
  return (
    <Routes>
      <Route index element={<TogetherHome />} />
      <Route path="shortlist/:id" element={<ShortlistPage />} />
    </Routes>
  )
}

function TogetherHome() {
  const { data, isLoading, isError, refetch } = useQueues()
  const [making, setMaking] = useState(false)
  const open = (data ?? []).filter((q) => !q.archived)
  const archived = (data ?? []).filter((q) => q.archived)
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      <h1 className="page-title">Watch together</h1>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-400">
        Pick something to watch with people here, then watch it together. Shortlists: add titles, everyone votes once, whoever started it picks. Watch parties: everyone plays the same title in step, each on their own screen.
      </p>
      <PartiesSection />
      <section className="mt-8" aria-label="Shortlists">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">Shortlists</h2>
          {!making && (
            <button type="button" onClick={() => setMaking(true)} className={BTN_MAIN}>
              New shortlist
            </button>
          )}
        </div>
        {making && <NewShortlist onCancel={() => setMaking(false)} />}
        {isLoading ? (
          <div className="mt-4 h-20 rounded-xl shimmer" />
        ) : isError ? (
          <p className="mt-4 text-sm text-amber-200">
            Couldn’t load your shortlists.{' '}
            <button type="button" className="font-semibold underline" onClick={() => void refetch()}>
              Try again
            </button>
          </p>
        ) : open.length === 0 && !making ? (
          <p className="mt-4 text-[14px] text-ink-400">No shortlists yet. Start one and add the people you’re watching with.</p>
        ) : (
          <ul className="mt-3 space-y-1">
            {open.map((q) => (
              <li key={q.id}>
                <Link to={`/together/shortlist/${q.id}`} className="flex items-center gap-3 rounded-xl px-3 py-3 outline-none hover:bg-white/5 focus-visible:bg-white/10">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-white">{q.name}</span>
                    <span className="block truncate text-[12.5px] text-ink-400">
                      {q.isHost ? 'You started it' : `Started by ${q.host}`} · {q.members} {q.members === 1 ? 'person' : 'people'} · {q.items} {q.items === 1 ? 'title' : 'titles'}
                    </span>
                  </span>
                  {q.picked && <span className="shrink-0 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-200">Picked</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer px-3 text-[13px] text-ink-400">Archived ({archived.length})</summary>
            <ul className="mt-1 space-y-1">
              {archived.map((q) => (
                <li key={q.id}>
                  <Link to={`/together/shortlist/${q.id}`} className="block rounded-xl px-3 py-2 text-[14px] text-ink-300 hover:bg-white/5">
                    {q.name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}

function NewShortlist({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  return (
    <form
      className="mt-4 space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          const q = await createQueue(name, members)
          await qc.invalidateQueries({ queryKey: ['queues', 'list'] })
          navigate(`/together/shortlist/${q.id}`)
        } catch (err) {
          setError((err as Error).message)
          setBusy(false)
        }
      }}
    >
      <label className="block">
        <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Friday film" className={`${FIELD} mt-1.5 w-full`} />
      </label>
      <div>
        <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Who’s in it (besides you)</span>
        <div className="mt-1.5">
          <PeoplePicker chosen={members} onChange={setMembers} />
        </div>
        <p className="mt-1.5 text-[12px] text-ink-400">They’ll see it under Watch together. People on friends’ servers can’t join shortlists yet.</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !name.trim()} className={BTN_MAIN}>
          {busy ? 'Starting…' : 'Start shortlist'}
        </button>
        <button type="button" onClick={onCancel} className={BTN_SOFT}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** "Everyone can open it", or who can't, or that a friend's title can't be checked for each person. */
function availabilityLine(it: QueueItem): { text: string; tone: string } {
  const a = it.availability ?? []
  const no = a.filter((x) => x.state === 'no')
  const unknown = a.filter((x) => x.state === 'unknown')
  if (no.length) return { text: `${no.map((x) => x.name).join(', ')} can’t open it`, tone: 'text-amber-200' }
  if (unknown.length) return { text: 'On a friend’s server: Finesse can’t check it for each person', tone: 'text-ink-400' }
  return { text: 'Everyone in the shortlist can open it', tone: 'text-emerald-300/90' }
}

function ShortlistPage() {
  const { id } = useParams()
  const { data: q, isLoading, isError, error } = useQueue(id)
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const ids = useMemo(() => (q?.items ?? []).map((i) => i.item).filter((x): x is string => !!x), [q])
  // The titles themselves (artwork, where you are in them), asked of each server as this profile.
  const { data: titles } = useQuery({
    queryKey: ['queues', 'titles', ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => new Map((await api.getItems({ ids: ids.join(','), fields: 'PrimaryImageAspectRatio,ProductionYear' })).Items.map((i) => [i.Id, i])),
  })
  const [confirm, setConfirm] = useState<null | 'delete' | 'leave'>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      const next = await fn()
      if (next && typeof next === 'object' && 'items' in (next as object)) qc.setQueryData(['queues', 'one', id], next as Queue)
      else await qc.invalidateQueries({ queryKey: ['queues'] })
      if (done) toast(done)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <div className="mx-auto mt-8 h-48 max-w-3xl rounded-2xl shimmer" />
  if (isError || !q)
    return (
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="page-title">Shortlist not found</h1>
        <p className="mt-2 text-[14px] text-ink-300">{(error as Error | null)?.message ?? 'It may have been removed, or you’re no longer in it.'}</p>
        <Link to="/together" className={`${BTN_SOFT} mt-4`}>
          Back to Watch together
        </Link>
      </div>
    )

  const picked = q.picked ? q.items.find((i) => i.key === q.picked) : undefined
  const pickedItem = picked?.item ? titles?.get(picked.item) : undefined
  const ranked = [...q.items].sort((a, b) => b.votes - a.votes)

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      <Link to="/together" className="text-[13px] font-semibold text-accent-300 hover:text-white">
        ‹ Watch together
      </Link>
      <h1 className="page-title mt-1">{q.name}</h1>
      <p className="mt-1 text-[13.5px] text-ink-400">
        {q.isHost ? 'You started it' : `Started by ${q.host.name}`} · With {q.members.map((m) => m.name).join(', ')}
        {q.archived && ' · Archived'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {q.isHost ? (
          <>
            <button type="button" className={BTN_SOFT} onClick={() => setEditing((v) => !v)}>
              {editing ? 'Done' : 'Name and people'}
            </button>
            <button type="button" className={BTN_SOFT} disabled={busy} onClick={() => act(() => updateQueue(q.id, { archived: !q.archived }), q.archived ? 'Brought back' : 'Archived')}>
              {q.archived ? 'Bring back' : 'Archive'}
            </button>
            <button type="button" className={BTN_SOFT} onClick={() => setConfirm('delete')}>
              Remove
            </button>
          </>
        ) : (
          <button type="button" className={BTN_SOFT} onClick={() => setConfirm('leave')}>
            Leave
          </button>
        )}
      </div>
      {editing && q.isHost && <EditShortlist q={q} onSaved={(next) => qc.setQueryData(['queues', 'one', id], next)} />}

      {picked && (
        <section className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.07] p-4" aria-label="The pick">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-emerald-200">The pick</p>
          <p className="mt-1 text-xl font-semibold text-white">{picked.title}</p>
          {picked.hidden ? (
            <p className="mt-1 text-[13.5px] text-amber-200">Your profile can’t open this one.</p>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-ink-300">Everyone plays it on their own device. Picking doesn’t start anything for anyone.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {pickedItem && (pickedItem.Type === 'Movie' || pickedItem.Type === 'Episode') && (
                  <Link to={playChoice(pickedItem).href} className={BTN_MAIN}>
                    {playChoice(pickedItem).label}
                  </Link>
                )}
                {picked.item && (
                  <Link to={`/item/${picked.item}`} className={BTN_SOFT}>
                    Open
                  </Link>
                )}
                {q.isHost && (
                  <button type="button" className={BTN_SOFT} disabled={busy} onClick={() => act(() => pickInQueue(q.id, null))}>
                    Undo the pick
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <section className="mt-8" aria-label="Titles">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">Titles · you have one vote{q.myVote ? ' (used)' : ''}</h2>
        {q.items.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-400">Nothing on it yet. Add titles below, or from a title’s More menu: Add to a shortlist.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {ranked.map((it) => (
              <ShortlistRow key={it.key} q={q} it={it} jf={it.item ? titles?.get(it.item) : undefined} busy={busy} act={act} />
            ))}
          </ul>
        )}
      </section>

      {!q.archived && <AddTitles q={q} onAdded={(next) => qc.setQueryData(['queues', 'one', id], next)} />}

      {confirm === 'delete' && (
        <ConfirmDialog
          title={`Remove “${q.name}”?`}
          confirmLabel="Remove"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            act(async () => {
              await deleteQueue(q.id)
              navigate('/together', { replace: true })
            }, 'Shortlist removed')
          }
        >
          It goes for everyone in it, with its votes. The titles stay in the library.
        </ConfirmDialog>
      )}
      {confirm === 'leave' && (
        <ConfirmDialog
          title={`Leave “${q.name}”?`}
          confirmLabel="Leave"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            act(async () => {
              await leaveQueue(q.id)
              navigate('/together', { replace: true })
            }, 'You left the shortlist')
          }
        >
          Your vote goes with you. {q.host.name} can add you again.
        </ConfirmDialog>
      )}
    </div>
  )
}

function ShortlistRow({ q, it, jf, busy, act }: { q: Queue; it: QueueItem; jf?: JfItem; busy: boolean; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const line = it.hidden ? { text: 'Your profile can’t open this title', tone: 'text-ink-400' } : availabilityLine(it)
  const poster = jf ? api.posterUrl(jf, 100) : null
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl px-2.5 py-2 ${q.picked === it.key ? 'bg-emerald-400/[0.06]' : ''}`}>
      <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-ink-800">{poster && <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />}</span>
      <span className="min-w-0 flex-1 basis-40">
        {it.item ? (
          <Link to={`/item/${it.item}`} className="block truncate text-[15px] font-semibold text-white hover:underline">
            {it.title}
            {it.subtitle && <span className="font-normal text-ink-400"> · {it.subtitle}</span>}
          </Link>
        ) : (
          <span className="block truncate text-[15px] italic text-ink-300">{it.title}</span>
        )}
        <span className={`block truncate text-[12.5px] ${line.tone}`}>
          {it.addedBy ? `Added by ${it.addedBy} · ` : ''}
          {line.text}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:pl-[3.25rem]">
      <span className="shrink-0 text-[13px] tabular-nums text-ink-300 max-sm:mr-auto" aria-label={`${it.votes} ${it.votes === 1 ? 'vote' : 'votes'}`}>
        {it.votes} {it.votes === 1 ? 'vote' : 'votes'}
      </span>
      {!q.archived && !it.hidden && (
        <button
          type="button"
          disabled={busy}
          aria-pressed={it.mine}
          onClick={() => act(() => voteInQueue(q.id, it.mine ? null : it.key))}
          className={`h-9 shrink-0 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-60 ${it.mine ? 'bg-accent-fill text-white' : 'border border-white/15 bg-white/10 text-white hover:bg-white/15'}`}
        >
          {it.mine ? 'Your vote' : 'Vote'}
        </button>
      )}
      {q.isHost && !it.hidden && q.picked !== it.key && (
        <button type="button" disabled={busy} onClick={() => act(() => pickInQueue(q.id, it.key), `Picked “${it.title}”`)} className="h-9 shrink-0 rounded-lg border border-white/15 px-3 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60">
          Pick
        </button>
      )}
      {it.canRemove && (
        <button type="button" disabled={busy} aria-label={`Take ${it.hidden ? 'this title' : it.title} off the shortlist`} title="Take it off" onClick={() => act(() => removeFromQueue(q.id, it.key))} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-white/10 hover:text-white">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      </span>
    </li>
  )
}

function EditShortlist({ q, onSaved }: { q: Queue; onSaved: (q: Queue) => void }) {
  const [name, setName] = useState(q.name)
  const [members, setMembers] = useState(q.members.map((m) => m.id).filter((m) => m !== q.host.id))
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  return (
    <div className="mt-4 space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <label className="block">
        <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`${FIELD} mt-1.5 w-full`} />
      </label>
      <div>
        <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Who’s in it</span>
        <div className="mt-1.5">
          <PeoplePicker chosen={members} onChange={setMembers} />
        </div>
        <p className="mt-1.5 text-[12px] text-ink-400">Taking someone off removes their vote.</p>
      </div>
      <button
        type="button"
        disabled={busy}
        className={BTN_MAIN}
        onClick={async () => {
          setBusy(true)
          try {
            onSaved(await updateQueue(q.id, { name, members }))
            toast('Saved')
          } catch (e) {
            toast((e as Error).message, 'error')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

function AddTitles({ q, onAdded }: { q: Queue; onAdded: (q: Queue) => void }) {
  const [term, setTerm] = useState('')
  const { data, isFetching } = useSearch(term.trim().length > 1 ? term : '')
  const toast = useToast()
  const have = new Set(q.items.map((i) => i.item))
  const hits = (data?.Items ?? []).filter((i) => i.Type === 'Movie' || i.Type === 'Series').slice(0, 8)
  return (
    <section className="mt-8" aria-label="Add titles">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">Add titles</h2>
      <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search your library" className={`${FIELD} mt-2 w-full max-w-md`} aria-label="Search your library to add a title" />
      {term.trim().length > 1 && (
        <ul className="mt-2 space-y-0.5">
          {isFetching && !data && <li className="px-2.5 py-2 text-sm text-ink-400">Searching…</li>}
          {data && hits.length === 0 && <li className="px-2.5 py-2 text-sm text-ink-400">No films or shows match “{term.trim()}”.</li>}
          {hits.map((i) => (
            <li key={i.Id} className="flex items-center gap-3 rounded-xl px-2.5 py-1.5 hover:bg-white/5">
              <span className="min-w-0 flex-1 truncate text-[14.5px] text-white">
                {i.Name}
                {i.ProductionYear ? <span className="text-ink-400"> · {i.ProductionYear}</span> : null}
              </span>
              {have.has(i.Id) ? (
                <span className="text-[13px] text-ink-400">On the shortlist</span>
              ) : (
                <button
                  type="button"
                  className="h-8 rounded-lg border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/15"
                  onClick={async () => {
                    try {
                      onAdded(await addToQueue(q.id, i.Id))
                    } catch (e) {
                      toast((e as Error).message, 'error')
                    }
                  }}
                >
                  Add
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[12.5px] text-ink-400">Titles on friends’ servers: open one, then More → Add to a shortlist.</p>
    </section>
  )
}

/** Watch parties you're invited to or in (start one from a title's More menu). */
function PartiesSection() {
  const on = usePartiesOn()
  const { data } = usePartyInvites()
  if (!on) return null
  return (
    <section className="mt-8" aria-label="Watch parties">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400">Watch parties</h2>
      {data?.length ? (
        <ul className="mt-2 space-y-1">
          {data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-white">{p.title}</span>
                <span className="block truncate text-[12.5px] text-ink-400">
                  {p.host} hosting · {p.people} watching
                </span>
              </span>
              <Link to={`/play/${p.item}?party=${encodeURIComponent(p.id)}`} className={BTN_MAIN}>
                {p.joined ? 'Back to it' : 'Join'}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[14px] text-ink-400">None right now. To start one, open a film or episode and choose More → Watch party: everyone plays it in step, each on their own screen.</p>
      )}
    </section>
  )
}
