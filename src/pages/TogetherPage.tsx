import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '../api/client'
import { useSearch } from '../api/queries'
import {
  addToQueue,
  createQueue,
  deleteQueue,
  getQueue,
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
  type QueueSummary,
} from '../api/queues'
import { startParty, usePartiesOn, usePartyInvites, type PartyInvite } from '../api/parties'
import { useAuth } from '../auth/AuthContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import PeoplePicker from '../components/PeoplePicker'
import { useToast } from '../components/Toast'
import { episodeChip } from '../lib/episodes'
import { playChoice } from '../lib/playChoice'
import type { JfItem } from '../api/types'

// Watch together: full-width visual hub for Watch Parties (synchronized playback)
// and Shortlists (group voting to pick what to watch next).

const PAD = 'px-4 sm:px-6 lg:px-12 pb-16 pt-6'
const BTN = 'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-60'
const BTN_MAIN = `${BTN} bg-white text-ink-950 hover:bg-ink-200`
const BTN_ACCENT = `${BTN} bg-accent-fill text-white hover:brightness-110`
const BTN_SOFT = `${BTN} bg-white/10 border border-white/15 text-white hover:bg-white/15`
const FIELD = 'h-10 rounded-lg border border-white/15 bg-white/[0.05] px-3 text-[15px] text-white outline-none focus:border-white/40'
const H2 = 'text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400'

function titleHue(title: string): number {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360
  return h
}

function useItemMap(ids: string[]) {
  const unique = useMemo(() => [...new Set(ids.filter(Boolean))].sort(), [ids])
  return useQuery({
    queryKey: ['together', 'items', unique],
    enabled: unique.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const res = await api.getItems({ ids: unique.slice(0, 60).join(','), fields: 'PrimaryImageAspectRatio,ProductionYear,SeriesPrimaryImageTag' })
      return new Map<string, JfItem>(res.Items.map((i) => [i.Id, i]))
    },
  })
}

export default function TogetherPage() {
  const queuesOn = useQueuesOn()
  const partiesOn = usePartiesOn()
  if (!queuesOn && !partiesOn)
    return (
      <div className={PAD}>
        <h1 className="page-title">Watch together</h1>
        <p className="mt-3 max-w-xl text-[14px] text-ink-300">
          This server’s Finesse is older and can’t do this yet. Ask whoever runs it to update Finesse.
        </p>
      </div>
    )
  return (
    <Routes>
      <Route index element={<TogetherHome queuesOn={queuesOn} partiesOn={partiesOn} />} />
      {queuesOn && <Route path="shortlist/:id" element={<ShortlistPage />} />}
    </Routes>
  )
}

function TogetherHome({ queuesOn, partiesOn }: { queuesOn: boolean; partiesOn: boolean }) {
  const { data, isLoading, isError, refetch } = useQueues()
  const [making, setMaking] = useState(false)
  const open = useMemo(() => (data ?? []).filter((q) => !q.archived), [data])
  const archived = useMemo(() => (data ?? []).filter((q) => q.archived), [data])

  // Fetch details of open shortlists so cards can display poster strips, member badges, and picked title.
  const detailQueries = useQueries({
    queries: (queuesOn ? open.slice(0, 16) : []).map((q) => ({
      queryKey: ['queues', 'one', q.id] as const,
      queryFn: () => getQueue(q.id),
      staleTime: 30_000,
      retry: false,
    })),
  })
  const detailById = useMemo(() => {
    const map = new Map<string, Queue>()
    open.slice(0, 16).forEach((s, i) => {
      const d = detailQueries[i]?.data
      if (d) map.set(s.id, d)
    })
    return map
  }, [open, detailQueries])

  const previewItemIds = useMemo(() => {
    const out: string[] = []
    for (const q of detailById.values()) {
      for (const it of q.items.slice(0, 4)) {
        if (it.item && !it.hidden) out.push(it.item)
      }
    }
    return out
  }, [detailById])
  const { data: artItems } = useItemMap(previewItemIds)

  return (
    <div className={PAD}>
      <h1 className="page-title">Watch together</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-400">
        Start a synchronized watch party with people here, or build a shortlist so everyone votes and picks what’s next.
      </p>

      {partiesOn && <PartiesSection />}

      {queuesOn && (
        <section className="mt-10" aria-label="Shortlists">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className={H2}>Shortlists</h2>
              <p className="mt-0.5 text-xs text-ink-400">Add titles, everyone gets one vote, and the host makes the pick.</p>
            </div>
            {!making && (
              <button type="button" onClick={() => setMaking(true)} className={BTN_MAIN}>
                New shortlist
              </button>
            )}
          </div>

          {making && <NewShortlist onCancel={() => setMaking(false)} />}

          {isLoading ? (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-44 rounded-2xl shimmer" />
              ))}
            </div>
          ) : isError ? (
            <p className="mt-4 text-sm text-amber-200">
              Couldn’t load your shortlists.{' '}
              <button type="button" className="font-semibold underline" onClick={() => void refetch()}>
                Try again
              </button>
            </p>
          ) : open.length === 0 && !making ? (
            <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 max-w-2xl">
              <p className="text-base font-semibold text-white">No shortlists yet</p>
              <p className="mt-1 text-sm text-ink-400">
                Start one and invite the people you’re watching with — or add titles straight from any movie or show’s More menu.
              </p>
            </div>
          ) : (
            <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {open.map((q) => (
                <ShortlistCard key={q.id} summary={q} detail={detailById.get(q.id)} artItems={artItems} />
              ))}
            </ul>
          )}

          {archived.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-[13px] font-medium text-ink-400 hover:text-ink-200">
                Archived ({archived.length})
              </summary>
              <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {archived.map((q) => (
                  <li key={q.id}>
                    <Link
                      to={`/together/shortlist/${q.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-sm text-ink-300 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      <span className="truncate font-medium">{q.name}</span>
                      <span className="shrink-0 text-xs text-ink-400">{q.items} {q.items === 1 ? 'title' : 'titles'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  )
}

function ShortlistCard({
  summary,
  detail,
  artItems,
}: {
  summary: QueueSummary
  detail?: Queue
  artItems?: Map<string, JfItem>
}) {
  const hue = titleHue(summary.name)
  const pickedItem = detail?.picked ? detail.items.find((i) => i.key === detail.picked) : undefined
  const posters = useMemo(() => {
    const out: { id: string; url: string; title: string }[] = []
    for (const it of detail?.items ?? []) {
      if (!it.item || it.hidden) continue
      const jf = artItems?.get(it.item)
      const url = jf ? api.posterUrl(jf, 200) : null
      if (url) out.push({ id: it.item, url, title: it.title })
      if (out.length >= 4) break
    }
    return out
  }, [detail, artItems])

  return (
    <li className="cv-card">
      <Link
        to={`/together/shortlist/${summary.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900/70 transition hover:border-white/25 hover:bg-ink-900/90 focus-visible:border-accent-400"
      >
        <div
          className="relative h-28 w-full overflow-hidden px-4 py-3 flex items-end"
          style={{
            backgroundImage: `linear-gradient(135deg, hsla(${hue}, 46%, 26%, 0.85), hsla(${(hue + 46) % 360}, 44%, 13%, 0.95))`,
          }}
        >
          {posters.length > 0 ? (
            <div className="flex items-end gap-2">
              {posters.map((p) => (
                <img
                  key={p.id}
                  decoding="async"
                  src={p.url}
                  alt=""
                  loading="lazy"
                  className="h-20 w-14 rounded-lg object-cover shadow-lg ring-1 ring-white/20 transition-transform duration-300 group-hover:-translate-y-0.5"
                />
              ))}
            </div>
          ) : (
            <span className="text-xs font-medium text-white/55">No titles added yet</span>
          )}
          {summary.picked && (
            <span className="absolute right-3 top-3 max-w-[60%] truncate rounded-full bg-emerald-400/20 border border-emerald-300/35 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 backdrop-blur-md">
              {pickedItem && !pickedItem.hidden ? `Picked · ${pickedItem.title}` : 'Picked'}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-4">
          <p className="truncate text-base font-semibold text-white group-hover:text-accent-300 transition-colors">
            {summary.name}
          </p>
          <p className="mt-0.5 text-xs text-ink-400">
            {summary.isHost ? 'You started it' : `Started by ${summary.host}`} · {summary.items}{' '}
            {summary.items === 1 ? 'title' : 'titles'}
          </p>
          {detail && detail.members.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {detail.members.slice(0, 4).map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] border border-white/10 px-2 py-0.5 text-[11px] font-medium text-ink-200"
                >
                  <span className="h-3.5 w-3.5 rounded-full bg-accent-400/25 text-center text-[9.5px] font-bold leading-[14px] text-accent-200">
                    {m.name.charAt(0).toUpperCase()}
                  </span>
                  {m.name}
                </span>
              ))}
              {detail.members.length > 4 && (
                <span className="text-[11px] text-ink-400">+{detail.members.length - 4}</span>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-400">
              {summary.members} {summary.members === 1 ? 'person' : 'people'}
            </p>
          )}
        </div>
      </Link>
    </li>
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
      className="mt-4 max-w-2xl space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          const q = await createQueue(name.trim(), members)
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

/** "Everyone can open it", or how many can't, or that a friend's title can't be checked for each person. */
function availabilityLine(it: QueueItem): { text: string; tone: string } {
  const a = it.availability
  if (!a || a.state === 'unknown') return { text: 'On a friend’s server: Finesse can’t check it for each person', tone: 'text-ink-400' }
  const cant = a.members - a.canOpen
  if (cant > 0) return { text: cant === 1 ? '1 person in the shortlist can’t open it' : `${cant} people in the shortlist can’t open it`, tone: 'text-amber-200' }
  return { text: 'Everyone in the shortlist can open it', tone: 'text-emerald-300/90' }
}

function ShortlistPage() {
  const { id } = useParams()
  const { data: q, isLoading, isError, error } = useQueue(id)
  const { session } = useAuth()
  const partiesOn = usePartiesOn()
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
  const [startingParty, setStartingParty] = useState(false)

  const syncQueue = (next: Queue) => {
    qc.setQueryData(['queues', 'one', id], next)
    void qc.invalidateQueries({ queryKey: ['queues', 'list'] })
  }

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      const next = await fn()
      if (next && typeof next === 'object' && 'items' in (next as object)) {
        syncQueue(next as Queue)
      } else {
        await qc.invalidateQueries({ queryKey: ['queues'] })
      }
      if (done) toast(done)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) {
    return (
      <div className={PAD}>
        <div className="h-8 w-40 rounded shimmer" />
        <div className="mt-4 h-12 w-72 rounded-xl shimmer" />
        <div className="mt-6 h-56 rounded-2xl shimmer" />
      </div>
    )
  }
  if (isError || !q)
    return (
      <div className={PAD}>
        <Link
          to="/together"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 -ml-2 text-sm font-semibold text-accent-300 hover:bg-white/5 hover:text-white transition-colors"
        >
          ‹ Watch together
        </Link>
        <h1 className="page-title mt-2">Shortlist not found</h1>
        <p className="mt-2 max-w-xl text-[14px] text-ink-300">
          {(error as Error | null)?.message ?? 'It may have been removed, or you’re no longer in it.'}
        </p>
        <Link to="/together" className={`${BTN_SOFT} mt-4`}>
          Back to Watch together
        </Link>
      </div>
    )

  const picked = q.picked ? q.items.find((i) => i.key === q.picked) : undefined
  const pickedItem = picked?.item ? titles?.get(picked.item) : undefined
  const pickedPoster = pickedItem ? api.posterUrl(pickedItem, 240) : null
  const pickedBackdrop = pickedItem ? api.backdropUrl(pickedItem, 960) : null
  const ranked = [...q.items].sort((a, b) => b.votes - a.votes)
  const canStartPickedParty =
    partiesOn &&
    Boolean(picked && !picked.hidden && pickedItem && (pickedItem.Type === 'Movie' || pickedItem.Type === 'Episode'))

  const launchPickedParty = async () => {
    if (!pickedItem || startingParty) return
    setStartingParty(true)
    try {
      const inviteIds = q.members.map((m) => m.id).filter((uid) => uid !== session?.userId)
      const party = await startParty(pickedItem.Id, inviteIds, 0)
      void qc.invalidateQueries({ queryKey: ['parties', 'list'] })
      navigate(`/play/${pickedItem.Id}?party=${encodeURIComponent(party.id)}`)
    } catch (e) {
      toast((e as Error).message || 'Couldn’t start a watch party', 'error')
      setStartingParty(false)
    }
  }

  return (
    <div className={PAD}>
      <Link
        to="/together"
        className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 -ml-2 text-sm font-semibold text-accent-300 hover:bg-white/5 hover:text-white transition-colors"
      >
        ‹ Watch together
      </Link>

      <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{q.name}</h1>
          <p className="mt-1.5 text-[14px] text-ink-400">
            {q.isHost ? 'You started it' : `Started by ${q.host.name}`} · With {q.members.map((m) => m.name).join(', ')}
            {q.archived && ' · Archived'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {q.isHost ? (
            <>
              <button type="button" className={BTN_SOFT} onClick={() => setEditing((v) => !v)}>
                {editing ? 'Close editor' : 'Name and people'}
              </button>
              <button
                type="button"
                className={BTN_SOFT}
                disabled={busy}
                onClick={() => act(() => updateQueue(q.id, { archived: !q.archived }), q.archived ? 'Brought back' : 'Archived')}
              >
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
      </div>

      {editing && q.isHost && (
        <EditShortlist
          q={q}
          onCancel={() => setEditing(false)}
          onSaved={(next) => {
            syncQueue(next)
            setEditing(false)
          }}
        />
      )}

      {picked && (
        <section
          className="relative mt-6 overflow-hidden rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.08] p-5"
          aria-label="The pick"
        >
          {pickedBackdrop && (
            <div className="pointer-events-none absolute inset-0 -z-0 opacity-20">
              <img decoding="async" src={pickedBackdrop} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-ink-950/50" />
            </div>
          )}
          <div className="relative z-10 flex flex-wrap items-center gap-5">
            {pickedPoster && (
              <img
                decoding="async"
                src={pickedPoster}
                alt=""
                className="h-28 w-20 shrink-0 rounded-xl object-cover shadow-xl ring-1 ring-white/15"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-emerald-200">The pick</p>
              <p className="mt-1 font-display text-3xl sm:text-4xl leading-tight text-white">{picked.title}</p>
              {picked.hidden ? (
                <p className="mt-1.5 text-[13.5px] text-amber-200">Your profile can’t open this one.</p>
              ) : (
                <>
                  <p className="mt-1.5 text-[13.5px] text-ink-300">
                    Start a synchronized watch party with everyone in this shortlist, or play it on your own screen.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {canStartPickedParty && (
                      <button
                        type="button"
                        disabled={startingParty}
                        onClick={launchPickedParty}
                        className={BTN_ACCENT}
                      >
                        <PartyIcon />
                        <span>{startingParty ? 'Starting party…' : 'Start watch party'}</span>
                      </button>
                    )}
                    {pickedItem && (pickedItem.Type === 'Movie' || pickedItem.Type === 'Episode') && (
                      <Link to={playChoice(pickedItem).href} className={BTN_MAIN}>
                        {playChoice(pickedItem).label}
                      </Link>
                    )}
                    {picked.item && (
                      <Link to={`/item/${picked.item}`} className={BTN_SOFT}>
                        Open details
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
            </div>
          </div>
        </section>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start">
        <section aria-label="Titles">
          <h2 className={H2}>Titles · you have one vote{q.myVote ? ' (used)' : ''}</h2>
          {q.items.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6">
              <p className="text-sm text-ink-400">
                Nothing on it yet. Search your library {q.archived ? '' : 'on the right '}to add titles, or use a title’s More menu → Add to a shortlist.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {ranked.map((it) => (
                <ShortlistRow
                  key={it.key}
                  q={q}
                  it={it}
                  jf={it.item ? titles?.get(it.item) : undefined}
                  busy={busy}
                  act={act}
                />
              ))}
            </ul>
          )}
        </section>

        {!q.archived && <AddTitles q={q} onAdded={syncQueue} />}
      </div>

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

function ShortlistRow({
  q,
  it,
  jf,
  busy,
  act,
}: {
  q: Queue
  it: QueueItem
  jf?: JfItem
  busy: boolean
  act: (fn: () => Promise<unknown>, done?: string) => Promise<void>
}) {
  const line = it.hidden ? { text: 'Your profile can’t open this title', tone: 'text-ink-400' } : availabilityLine(it)
  const poster = jf ? api.posterUrl(jf, 120) : null
  return (
    <li
      className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-2xl border px-3 py-2.5 transition-colors ${
        q.picked === it.key ? 'border-emerald-400/30 bg-emerald-400/[0.07]' : 'border-white/5 bg-ink-900/55 hover:border-white/10'
      }`}
    >
      <span className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/10">
        {poster && <img decoding="async" src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />}
      </span>
      <span className="min-w-0 flex-1 basis-44">
        {it.item ? (
          <Link to={`/item/${it.item}`} className="block truncate text-[15px] font-semibold text-white hover:underline">
            {it.title}
            {it.subtitle && <span className="font-normal text-ink-400"> · {it.subtitle}</span>}
          </Link>
        ) : (
          <span className="block truncate text-[15px] italic text-ink-300">{it.title}</span>
        )}
        <span className={`mt-0.5 block truncate text-[12.5px] ${line.tone}`}>
          {it.addedBy ? `Added by ${it.addedBy} · ` : ''}
          {line.text}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:pl-[3.5rem]">
        <span className="shrink-0 text-[13px] tabular-nums text-ink-300 max-sm:mr-auto" aria-label={`${it.votes} ${it.votes === 1 ? 'vote' : 'votes'}`}>
          {it.votes} {it.votes === 1 ? 'vote' : 'votes'}
        </span>
        {!q.archived && !it.hidden && (
          <button
            type="button"
            disabled={busy}
            aria-pressed={it.mine}
            onClick={() => act(() => voteInQueue(q.id, it.mine ? null : it.key))}
            className={`h-9 shrink-0 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-60 ${
              it.mine ? 'bg-accent-fill text-white' : 'border border-white/15 bg-white/10 text-white hover:bg-white/15'
            }`}
          >
            {it.mine ? 'Your vote' : 'Vote'}
          </button>
        )}
        {q.isHost && !it.hidden && q.picked !== it.key && (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => pickInQueue(q.id, it.key), `Picked “${it.title}”`)}
            className="h-9 shrink-0 rounded-lg border border-white/15 px-3 text-sm font-semibold text-white transition hover:bg-white/10 active:scale-[0.97] disabled:opacity-60"
          >
            Pick
          </button>
        )}
        {it.canRemove && (
          <button
            type="button"
            disabled={busy}
            aria-label={`Take ${it.hidden ? 'this title' : it.title} off the shortlist`}
            title="Take it off"
            onClick={() => act(() => removeFromQueue(q.id, it.key))}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-white/10 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </span>
    </li>
  )
}

function EditShortlist({ q, onSaved, onCancel }: { q: Queue; onSaved: (q: Queue) => void; onCancel: () => void }) {
  const [name, setName] = useState(q.name)
  const [members, setMembers] = useState(q.members.map((m) => m.id).filter((m) => m !== q.host.id))
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  return (
    <div className="mt-4 max-w-2xl space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
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
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !name.trim()}
          className={BTN_MAIN}
          onClick={async () => {
            if (busy || !name.trim()) return
            setBusy(true)
            try {
              onSaved(await updateQueue(q.id, { name: name.trim(), members }))
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
        <button type="button" onClick={onCancel} disabled={busy} className={BTN_SOFT}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function AddTitles({ q, onAdded }: { q: Queue; onAdded: (q: Queue) => void }) {
  const [term, setTerm] = useState('')
  // Asks once typing pauses, not on every key.
  const [asked, setAsked] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setAsked(term.trim().length > 1 ? term.trim() : ''), 250)
    return () => clearTimeout(t)
  }, [term])
  const { data, isFetching } = useSearch(asked)
  const toast = useToast()
  // One add per title at a time: a double tap doesn't add (or error) twice.
  const [adding, setAdding] = useState<string | null>(null)
  const have = new Set(q.items.map((i) => i.item))
  const hits = (data?.Items ?? []).filter((i) => i.Type === 'Movie' || i.Type === 'Series').slice(0, 8)
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4" aria-label="Add titles">
      <h2 className={H2}>Add titles</h2>
      <input
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search your library…"
        className={`${FIELD} mt-2.5 w-full`}
        aria-label="Search your library to add a title"
      />
      {term.trim().length > 1 && (
        <ul className="mt-3 space-y-1.5">
          {(isFetching || asked !== term.trim()) && !hits.length && <li className="px-2 py-2 text-sm text-ink-400">Searching…</li>}
          {data && !isFetching && asked === term.trim() && hits.length === 0 && (
            <li className="px-2 py-2 text-sm text-ink-400">No films or shows match “{term.trim()}”.</li>
          )}
          {hits.map((i) => {
            const poster = api.posterUrl(i, 100)
            const badge = i.Type === 'Series' ? 'Show' : 'Movie'
            return (
              <li key={i.Id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-ink-900/50 p-2 hover:border-white/10">
                <span className="h-12 w-8 shrink-0 overflow-hidden rounded-md bg-ink-800">
                  {poster && <img decoding="async" src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{i.Name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
                    <span className="rounded bg-white/10 px-1.5 py-px font-medium text-ink-200">{badge}</span>
                    {i.ProductionYear ? <span>{i.ProductionYear}</span> : null}
                  </span>
                </span>
                {have.has(i.Id) ? (
                  <span className="shrink-0 text-xs font-medium text-emerald-300">Added</span>
                ) : (
                  <button
                    type="button"
                    disabled={adding !== null}
                    className="h-8 shrink-0 rounded-lg border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white transition hover:bg-white/15 active:scale-[0.97] disabled:opacity-60 disabled:active:scale-100"
                    onClick={async () => {
                      if (adding) return
                      setAdding(i.Id)
                      try {
                        onAdded(await addToQueue(q.id, i.Id))
                        toast(`Added “${i.Name}”`)
                      } catch (e) {
                        toast((e as Error).message, 'error')
                      } finally {
                        setAdding(null)
                      }
                    }}
                  >
                    {adding === i.Id ? 'Adding…' : 'Add'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-400">Titles on friends’ servers: open one, then More → Add to a shortlist.</p>
    </section>
  )
}

/** Watch parties you're invited to or in, plus an inline launcher to start a new one right here. */
function PartiesSection() {
  const { data } = usePartyInvites()
  const [launching, setLaunching] = useState(false)
  const partyItemIds = useMemo(
    () => (data ?? []).map((p) => p.item).filter((x): x is string => Boolean(x)),
    [data],
  )
  const { data: partyArt } = useItemMap(partyItemIds)

  return (
    <section className="mt-8" aria-label="Watch parties">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className={H2}>Watch parties</h2>
          <p className="mt-0.5 text-xs text-ink-400">Everyone plays the same movie or episode in step, each on their own screen.</p>
        </div>
        {!launching && (
          <button type="button" onClick={() => setLaunching(true)} className={BTN_ACCENT}>
            <PartyIcon />
            <span>Start a watch party</span>
          </button>
        )}
      </div>

      {launching && <PartyLauncher onCancel={() => setLaunching(false)} />}

      {data?.length ? (
        <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((p) => (
            <PartyCard key={p.id} p={p} jf={p.item ? partyArt?.get(p.item) : undefined} />
          ))}
        </ul>
      ) : !launching ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 max-w-2xl">
          <p className="text-sm text-ink-300">
            No active watch parties right now. Start one above with any movie or episode from your library, or launch from a title’s More menu.
          </p>
        </div>
      ) : null}
    </section>
  )
}

function PartyCard({ p, jf }: { p: PartyInvite; jf?: JfItem }) {
  const poster = jf ? api.posterUrl(jf, 160) : null
  const backdrop = jf ? api.backdropUrl(jf, 640) : null
  return (
    <li className="cv-card relative overflow-hidden rounded-2xl border border-accent-400/25 bg-ink-900/75 p-4">
      {backdrop && (
        <div className="pointer-events-none absolute inset-0 -z-0 opacity-20">
          <img decoding="async" src={backdrop} alt="" loading="lazy" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-ink-950/55" />
        </div>
      )}
      <div className="relative z-10 flex items-center gap-3.5">
        <span className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/10">
          {poster && <img decoding="async" src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />}
        </span>
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            Live party
          </span>
          <p className="mt-0.5 truncate text-[15px] font-semibold text-white">{p.title}</p>
          <p className="truncate text-xs text-ink-400">
            {p.host} hosting · {p.people} watching
          </p>
        </div>
        {p.item ? (
          <Link to={`/play/${p.item}?party=${encodeURIComponent(p.id)}`} className={`${BTN_MAIN} shrink-0`}>
            {p.joined ? 'Rejoin' : 'Join'}
          </Link>
        ) : (
          <span className="shrink-0 text-xs text-ink-400">Restricted</span>
        )}
      </div>
    </li>
  )
}

function PartyLauncher({ onCancel }: { onCancel: () => void }) {
  const [term, setTerm] = useState('')
  const [asked, setAsked] = useState('')
  const [selected, setSelected] = useState<JfItem | null>(null)
  const [invite, setInvite] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  useEffect(() => {
    const t = setTimeout(() => setAsked(term.trim().length > 1 ? term.trim() : ''), 250)
    return () => clearTimeout(t)
  }, [term])

  const { data, isFetching } = useQuery({
    queryKey: ['together', 'partySearch', asked],
    enabled: asked.length > 1 && !selected,
    staleTime: 60_000,
    queryFn: () =>
      api.getItems({
        searchTerm: asked,
        includeItemTypes: 'Movie,Episode',
        recursive: true,
        limit: 10,
        fields: 'PrimaryImageAspectRatio,ProductionYear,SeriesPrimaryImageTag',
      }),
  })
  const hits = data?.Items ?? []

  const launch = async () => {
    if (!selected || busy) return
    setBusy(true)
    try {
      const party = await startParty(selected.Id, invite, 0)
      void qc.invalidateQueries({ queryKey: ['parties', 'list'] })
      navigate(`/play/${selected.Id}?party=${encodeURIComponent(party.id)}`)
    } catch (e) {
      toast((e as Error).message || 'Couldn’t start watch party', 'error')
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 max-w-2xl space-y-4 rounded-2xl border border-accent-400/25 bg-white/[0.03] p-5">
      <div>
        <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">
          1. Pick a movie or episode
        </span>
        {selected ? (
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-white/10 bg-ink-900/70 p-2.5">
            <span className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-ink-800">
              {api.posterUrl(selected, 100) && (
                <img decoding="async" src={api.posterUrl(selected, 100)!} alt="" className="h-full w-full object-cover" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {selected.Type === 'Episode' && selected.SeriesName ? `${selected.SeriesName} · ` : ''}
                {selected.Name}
              </p>
              <p className="text-xs text-ink-400">
                {selected.Type === 'Episode' ? episodeChip(selected) || 'Episode' : 'Movie'}
                {selected.ProductionYear ? ` · ${selected.ProductionYear}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="h-8 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-semibold text-ink-200 hover:bg-white/10 hover:text-white"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search for a movie or episode in your library…"
              aria-label="Search for a movie or episode to start a watch party"
              className={`${FIELD} mt-2 w-full`}
            />
            {term.trim().length > 1 && (
              <ul className="mt-2.5 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {(isFetching || asked !== term.trim()) && !hits.length && (
                  <li className="px-2 py-2 text-sm text-ink-400">Searching…</li>
                )}
                {data && !isFetching && asked === term.trim() && hits.length === 0 && (
                  <li className="px-2 py-2 text-sm text-ink-400">No movies or episodes match “{term.trim()}”.</li>
                )}
                {hits.map((it) => {
                  const poster = api.posterUrl(it, 100)
                  const isEp = it.Type === 'Episode'
                  return (
                    <li key={it.Id}>
                      <button
                        type="button"
                        onClick={() => setSelected(it)}
                        className="flex w-full items-center gap-3 rounded-xl border border-white/5 bg-ink-900/50 p-2 text-left hover:border-white/15 hover:bg-white/[0.06] transition-colors"
                      >
                        <span className="h-12 w-8 shrink-0 overflow-hidden rounded-md bg-ink-800">
                          {poster && <img decoding="async" src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-white">
                            {isEp && it.SeriesName ? `${it.SeriesName} · ` : ''}
                            {it.Name}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
                            <span className="rounded bg-white/10 px-1.5 py-px font-medium text-ink-200">
                              {isEp ? episodeChip(it) || 'Episode' : 'Movie'}
                            </span>
                            {it.ProductionYear ? <span>{it.ProductionYear}</span> : null}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-accent-300">Select</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <div>
        <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">
          2. Invite people
        </span>
        <div className="mt-2">
          <PeoplePicker chosen={invite} onChange={setInvite} />
        </div>
        <p className="mt-1.5 text-xs text-ink-400">They’ll see an invite under Watch together and can join in sync.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!selected || busy} onClick={launch} className={BTN_MAIN}>
          <PartyIcon />
          <span>{busy ? 'Starting…' : 'Start watch party'}</span>
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={BTN_SOFT}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function PartyIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
    </svg>
  )
}
