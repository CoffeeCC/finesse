import { useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  createMomentCollection,
  deleteMomentCollection,
  removeFromCollection,
  updateMomentCollection,
  useMomentCollection,
  useMomentCollections,
  useMomentCollectionsOn,
  type MomentCollection,
  type MomentEntry,
} from '../api/momentCollections'
import { clock, momentHref } from '../api/moments'
import { ConfirmDialog } from '../components/ConfirmDialog'
import PeoplePicker from '../components/PeoplePicker'
import SaveMoment from '../components/moments/SaveMoment'
import { useToast } from '../components/Toast'

// Moments: collections of favourite moments. Each entry is a reference (a title, where in it,
// the note, who flagged it), not a copy of the video. Sharing one lets chosen people here see
// and play the entries they can open themselves; it doesn't give anyone access to a title.

const BTN = 'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-60'
const BTN_MAIN = `${BTN} bg-white text-ink-950 hover:bg-ink-200`
const BTN_SOFT = `${BTN} bg-white/10 border border-white/15 text-white hover:bg-white/15`
const H2 = 'text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-400'

export default function MomentsPage() {
  const on = useMomentCollectionsOn()
  if (!on)
    return (
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="page-title">Moments</h1>
        <p className="mt-3 text-[14px] text-ink-300">This server’s Finesse is older and can’t keep moment collections yet. Ask whoever runs it to update Finesse.</p>
      </div>
    )
  return (
    <Routes>
      <Route index element={<CollectionsHome />} />
      <Route path=":id" element={<CollectionPage />} />
    </Routes>
  )
}

function CollectionsHome() {
  const { data, isLoading, isError, refetch } = useMomentCollections()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const row = (c: { id: string; name: string; entries: number; owner: string; shared?: number }, mine: boolean) => (
    <li key={c.id}>
      <Link to={`/moments/${c.id}`} className="block rounded-xl px-3 py-3 outline-none hover:bg-white/5 focus-visible:bg-white/10">
        <span className="block truncate text-[15px] font-semibold text-white">{c.name}</span>
        <span className="block truncate text-[12.5px] text-ink-400">
          {c.entries} {c.entries === 1 ? 'moment' : 'moments'}
          {mine ? (c.shared ? ` · shared with ${c.shared} ${c.shared === 1 ? 'person' : 'people'}` : ' · only you') : ` · from ${c.owner}`}
        </span>
      </Link>
    </li>
  )
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      <h1 className="page-title">Moments</h1>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-400">
        Keep favourite moments together. Save one from the Moments bell (what’s been sent to you). A collection holds where each moment is and its note, not the video, and only you see it until you share it.
      </p>
      <form
        className="mt-6 flex max-w-md gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const c = await createMomentCollection(name)
            await qc.invalidateQueries({ queryKey: ['momentCollections'] })
            navigate(`/moments/${c.id}`)
          } catch (err) {
            toast((err as Error).message, 'error')
            setBusy(false)
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="New collection, like “Best openings”" aria-label="New collection name" className="h-10 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/[0.05] px-3 text-[15px] text-white outline-none focus:border-white/40" />
        <button type="submit" disabled={busy || !name.trim()} className={BTN_MAIN}>
          Make
        </button>
      </form>
      {isLoading ? (
        <div className="mt-8 h-24 rounded-xl shimmer" />
      ) : isError ? (
        <p className="mt-8 text-sm text-amber-200">
          Couldn’t load your collections.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <>
          <section className="mt-8" aria-label="Your collections">
            <h2 className={H2}>Your collections</h2>
            {data?.mine.length ? <ul className="mt-2 space-y-1">{data.mine.map((c) => row(c, true))}</ul> : <p className="mt-2 px-3 text-[14px] text-ink-400">None yet. Make one above, or save a moment from the bell.</p>}
          </section>
          {Boolean(data?.shared.length) && (
            <section className="mt-8" aria-label="Shared with you">
              <h2 className={H2}>Shared with you</h2>
              <ul className="mt-2 space-y-1">{data!.shared.map((c) => row(c, false))}</ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function CollectionPage() {
  const { id } = useParams()
  const { data: c, isLoading, isError, error } = useMomentCollection(id)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [sharing, setSharing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<MomentEntry | null>(null)
  const set = (next: MomentCollection) => {
    qc.setQueryData(['momentCollections', 'one', id], next)
    void qc.invalidateQueries({ queryKey: ['momentCollections', 'list'] })
  }

  if (isLoading) return <div className="mx-auto mt-8 h-48 max-w-3xl rounded-2xl shimmer" />
  if (isError || !c)
    return (
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="page-title">Collection not found</h1>
        <p className="mt-2 text-[14px] text-ink-300">{(error as Error | null)?.message ?? 'It may have been removed, or it isn’t shared with you any more.'}</p>
        <Link to="/moments" className={`${BTN_SOFT} mt-4`}>
          Back to Moments
        </Link>
      </div>
    )
  const gone = c.entries.filter((e) => !e.available).length
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      <Link to="/moments" className="text-[13px] font-semibold text-accent-300 hover:text-white">
        ‹ Moments
      </Link>
      <h1 className="page-title mt-1">{c.name}</h1>
      <p className="mt-1 text-[13.5px] text-ink-400">
        {c.mine
          ? c.sharedWith?.length
            ? `Shared with ${c.sharedWith.map((p) => p.name).join(', ')}. They see where each moment is and its note, and play the ones they can open themselves.`
            : 'Only you see this collection.'
          : `${c.owner.name} shared this with you. It’s theirs: save a moment to one of yours to keep it.`}
      </p>
      {c.mine && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={BTN_SOFT} onClick={() => setSharing((v) => !v)}>
            {sharing ? 'Done' : 'Share'}
          </button>
          <button type="button" className={BTN_SOFT} onClick={() => setRemoving(true)}>
            Remove
          </button>
        </div>
      )}
      {sharing && c.mine && <ShareEditor c={c} onSaved={set} />}
      {gone > 0 && (
        <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-[13px] text-amber-100">
          {gone === 1 ? 'One moment is' : `${gone} moments are`} of a title {c.mine ? 'that isn’t available to you any more: it may have been removed, or a friend’s server stopped sharing it.' : 'you can’t open.'}
        </p>
      )}
      {c.entries.length === 0 ? (
        <p className="mt-8 text-[14px] text-ink-400">{c.mine ? 'Nothing in it yet. Open the Moments bell and choose Save to a collection on one.' : 'Nothing in it yet.'}</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {c.entries.map((e) => (
            <li key={e.key} className={`rounded-xl px-3 py-3 ${e.available ? 'bg-white/[0.03]' : 'opacity-70'}`}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-[15px] font-semibold text-white">
                    {e.title}
                    {e.subtitle && <span className="font-normal text-ink-400"> · {e.subtitle}</span>}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-400">
                    {e.start != null && e.end != null && <span className="mr-2 rounded bg-white/10 px-1.5 py-px font-mono text-[11.5px] text-ink-200">{clock(e.start)}–{clock(e.end)}</span>}
                    {e.from && `Flagged by ${e.from}`}
                  </p>
                  {e.note && <p className="mt-1 text-[14px] text-white">“{e.note}”</p>}
                  {!e.available && <p className="mt-1 text-[12.5px] text-amber-200">{c.mine ? 'Not available to you any more.' : 'Your profile can’t open this title.'}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {e.available && e.item && (
                    <Link to={momentHref({ item: e.item, start: e.start })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3.5 text-sm font-semibold text-ink-950 hover:bg-ink-200">
                      ▶ {e.start != null ? `Play from ${clock(e.start)}` : 'Open'}
                    </Link>
                  )}
                  {!c.mine && e.available && (
                    <button type="button" onClick={() => setSaving(e)} className="h-9 rounded-lg border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/15">
                      Save to mine
                    </button>
                  )}
                  {c.mine && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          set(await removeFromCollection(c.id, e.key))
                        } catch (err) {
                          toast((err as Error).message, 'error')
                        } finally {
                          setBusy(false)
                        }
                      }}
                      aria-label={`Take “${e.title}” out of the collection`}
                      title="Take it out"
                      className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-white/10 hover:text-white"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {saving && <SaveMoment what={{ from: { collection: c.id, key: saving.key } }} label={`${saving.from ? `${saving.from}’s` : 'A'} moment in “${saving.title}”`} onClose={() => setSaving(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Remove “${c.name}”?`}
          confirmLabel="Remove"
          busy={busy}
          onCancel={() => setRemoving(false)}
          onConfirm={async () => {
            setBusy(true)
            try {
              await deleteMomentCollection(c.id)
              await qc.invalidateQueries({ queryKey: ['momentCollections'] })
              navigate('/moments', { replace: true })
            } catch (err) {
              toast((err as Error).message, 'error')
              setBusy(false)
              setRemoving(false)
            }
          }}
        >
          The collection goes{c.sharedWith?.length ? ', for everyone it’s shared with too' : ''}. The moments themselves and the titles stay.
        </ConfirmDialog>
      )}
    </div>
  )
}

function ShareEditor({ c, onSaved }: { c: MomentCollection; onSaved: (c: MomentCollection) => void }) {
  const [who, setWho] = useState((c.sharedWith ?? []).map((p) => p.id))
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-[13.5px] text-ink-300">Who can see it. They see where each moment is and its note; they play a moment only if their own profile can open the title. Nothing new becomes watchable for them.</p>
      <PeoplePicker chosen={who} onChange={setWho} />
      <button
        type="button"
        disabled={busy}
        className={BTN_MAIN}
        onClick={async () => {
          setBusy(true)
          try {
            onSaved(await updateMomentCollection(c.id, { sharedWith: who }))
            toast(who.length ? 'Shared' : 'Only you see it now')
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
