import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import MediaCard from '../components/MediaCard'
import AlbumCard from '../components/AlbumCard'
import { CardSkeleton } from '../components/Skeletons'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { createSmart, deleteSmart, updateSmart, useGenresFor, useSmartCollections, useSmartMatches, useSmartOn, type SmartCollection } from '../api/smart'
import {
  ADDED_CHOICES,
  cleanName,
  cleanRules,
  describe,
  emptyRules,
  fieldsFor,
  KIND_LABEL,
  NAME_MAX,
  PRESETS,
  reasons,
  WATCHED_LABEL,
  type SmartKind,
  type SmartRules,
  type SmartSort,
  type WatchedRule,
} from '../lib/smartRules'
import type { JfItem } from '../api/types'

// Smart collections: saved rules that pick titles each time they're opened ("unwatched films
// under 100 minutes"), so they stay up to date. /smart lists them, /smart/new and
// /smart/:id/edit make and change one (with a live preview), /smart/:id shows every match
// and why it's in. Each person's are their own.

const GRID = 'grid gap-2.5 sm:gap-4 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]'
const BTN = 'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors'
const BTN_MAIN = `${BTN} bg-white text-ink-950 hover:bg-ink-200 disabled:opacity-60`
const BTN_SOFT = `${BTN} bg-white/10 border border-white/15 text-white hover:bg-white/15 disabled:opacity-60`

export default function SmartCollectionsPage() {
  const on = useSmartOn()
  if (!on)
    return (
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="page-title">Smart collections</h1>
        <p className="mt-3 text-[14px] text-ink-300">This server’s Finesse is older and can’t keep smart collections yet. Ask whoever runs it to update Finesse.</p>
      </div>
    )
  return (
    <Routes>
      <Route index element={<SmartList />} />
      <Route path="new" element={<SmartEditor />} />
      <Route path=":id/edit" element={<SmartEditor />} />
      <Route path=":id" element={<SmartDetail />} />
    </Routes>
  )
}

function Card({ item, rules }: { item: JfItem; rules: SmartRules }) {
  const why = reasons(item, rules)
  return (
    <div className="min-w-0">
      {item.Type === 'MusicAlbum' ? <AlbumCard album={item} /> : <MediaCard item={item} />}
      {why.length > 0 && (
        <p className="mt-1 truncate text-[11.5px] text-ink-400" title={why.join(' · ')}>
          <span className="sr-only">In because: </span>
          {why.join(' · ')}
        </p>
      )}
    </div>
  )
}

function SmartList() {
  const { data, isLoading, isError, refetch } = useSmartCollections()
  return (
    <div className="px-4 pb-16 pt-6 sm:px-6 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title mb-1">Smart collections</h1>
          <p className="max-w-xl text-sm text-ink-400">Rules that pick titles for you and stay up to date as things are added and watched. Only you see yours.</p>
        </div>
        <Link to="/smart/new" className={BTN_MAIN}>
          New smart collection
        </Link>
      </div>
      {isLoading ? (
        <div className="mt-8 h-48 rounded-2xl shimmer" />
      ) : isError ? (
        <div className="mt-8 max-w-xl rounded-2xl border border-white/5 bg-ink-900/50 p-6">
          <p className="text-white">Couldn’t load your smart collections.</p>
          <button type="button" onClick={() => void refetch()} className={`${BTN_SOFT} mt-3`}>
            Try again
          </button>
        </div>
      ) : !data?.length ? (
        <div className="mt-8 max-w-2xl rounded-2xl border border-white/5 bg-ink-900/50 px-6 py-8">
          <p className="text-lg font-semibold text-white">No smart collections yet</p>
          <p className="mt-1.5 text-sm text-ink-300">Start from one of these, or make your own.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Link key={p.id} to={`/smart/new?preset=${p.id}`} className="inline-flex h-9 items-center rounded-full border border-white/15 bg-white/[0.05] px-3.5 text-sm text-ink-100 hover:bg-white/10">
                {p.name}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-10">
          {data.map((c) => (
            <CollectionRow key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function CollectionRow({ c }: { c: SmartCollection }) {
  const { data, isLoading, isError } = useSmartMatches(c.rules)
  const items = data?.items ?? []
  return (
    <section aria-label={c.name}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <Link to={`/smart/${c.id}`} className="text-xl font-semibold text-white hover:underline">
            {c.name}
          </Link>
          <p className="truncate text-[13px] text-ink-400">
            {describe(c.rules)}
            {data ? ` · ${items.length}${data.partial ? '+' : ''} ${items.length === 1 ? 'title' : 'titles'}` : ''}
          </p>
        </div>
        <div className="flex gap-3 text-sm font-semibold">
          <Link to={`/smart/${c.id}`} className="text-accent-300 hover:text-white">
            See all
          </Link>
          <Link to={`/smart/${c.id}/edit`} className="text-ink-300 hover:text-white">
            Edit
          </Link>
        </div>
      </div>
      <div className={`${GRID} mt-3`}>
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
          : items.slice(0, 6).map((it) => <Card key={it.Id} item={it} rules={c.rules} />)}
      </div>
      {isError && <p className="mt-2 text-sm text-amber-200">Couldn’t ask the library right now. Try again in a moment.</p>}
      {!isLoading && !isError && items.length === 0 && <p className="mt-2 text-sm text-ink-400">Nothing matches right now. It fills in as titles are added or watched.</p>}
    </section>
  )
}

function SmartDetail() {
  const { id } = useParams()
  const { data: list, isLoading: listLoading } = useSmartCollections()
  const c = list?.find((x) => x.id === id)
  const { data, isLoading } = useSmartMatches(c?.rules)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  if (listLoading) return <div className="mx-4 mt-8 h-48 rounded-2xl shimmer sm:mx-6 lg:mx-12" />
  if (!c)
    return (
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="page-title">That collection is gone</h1>
        <Link to="/smart" className={`${BTN_SOFT} mt-4`}>
          Back to smart collections
        </Link>
      </div>
    )
  const items = data?.items ?? []
  const remove = async () => {
    setBusy(true)
    try {
      await deleteSmart(c.id)
      await qc.invalidateQueries({ queryKey: ['smart', 'list'] })
      toast(`Removed “${c.name}”. The titles in it are still in your library.`)
      navigate('/smart', { replace: true })
    } catch (e) {
      toast((e as Error).message, 'error')
      setBusy(false)
      setRemoving(false)
    }
  }
  return (
    <div className="px-4 pb-16 pt-6 sm:px-6 lg:px-12">
      <h1 className="page-title mb-1">{c.name}</h1>
      <p className="text-sm text-ink-400">{describe(c.rules)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/smart/${c.id}/edit`} className={BTN_SOFT}>
          Edit rules
        </Link>
        <button type="button" onClick={() => setRemoving(true)} className={BTN_SOFT}>
          Remove
        </button>
      </div>
      <p className="mt-6 text-[13px] text-ink-400">
        {isLoading ? 'Looking…' : `${items.length} ${items.length === 1 ? 'title matches' : 'titles match'} right now. Under each: why it’s in.`}
        {data?.partial && ' Only the first titles the library returned were checked; narrow the rules to see everything.'}
      </p>
      <div className={`${GRID} mt-3`}>
        {isLoading ? Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />) : items.map((it) => <Card key={it.Id} item={it} rules={c.rules} />)}
      </div>
      {removing && (
        <ConfirmDialog title={`Remove “${c.name}”?`} confirmLabel="Remove" busy={busy} onConfirm={remove} onCancel={() => setRemoving(false)}>
          Only the collection goes. Nothing is removed from your library.
        </ConfirmDialog>
      )}
    </div>
  )
}

const num = (v: string): number | null => (v.trim() === '' ? null : Number(v))

function SmartEditor() {
  const { id } = useParams()
  const editing = Boolean(id)
  const { data: list, isLoading } = useSmartCollections()
  const existing = list?.find((x) => x.id === id)
  const [search] = useSearchParams()
  const presetId = search.get('preset')
  const preset = useMemo(() => PRESETS.find((p) => p.id === presetId), [presetId])
  const [name, setName] = useState(preset?.name ?? '')
  const [rules, setRules] = useState<SmartRules>(() => ({ ...emptyRules(preset?.rules.kind), ...(preset?.rules ?? {}) }))
  const [loaded, setLoaded] = useState(!editing)
  useEffect(() => {
    if (existing && !loaded) {
      setName(existing.name)
      setRules(existing.rules)
      setLoaded(true)
    }
  }, [existing, loaded])

  // The preview follows the rules a moment after they stop changing.
  const [shown, setShown] = useState<SmartRules | null>(null)
  const problem = useMemo(() => {
    try {
      cleanRules(rules)
      return null
    } catch (e) {
      return (e as Error).message
    }
  }, [rules])
  useEffect(() => {
    if (problem) return
    const t = setTimeout(() => setShown(cleanRules(rules)), 350)
    return () => clearTimeout(t)
  }, [rules, problem])
  const preview = useSmartMatches(shown)
  const pending = !problem && JSON.stringify(cleanRules(rules)) !== JSON.stringify(shown)
  const genres = useGenresFor(rules.kind)
  const f = fieldsFor(rules.kind)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()

  const set = (patch: Partial<SmartRules>) => setRules((r) => ({ ...r, ...patch }))
  const setKind = (kind: SmartKind) => setRules((r) => cleanLoose({ ...r, kind }))

  const save = async () => {
    setError(null)
    let n: string
    let clean: SmartRules
    try {
      n = cleanName(name)
      clean = cleanRules(rules)
    } catch (e) {
      setError((e as Error).message)
      return
    }
    setSaving(true)
    try {
      const saved = editing && existing ? await updateSmart(existing.id, { name: n, rules: clean }) : await createSmart(n, clean)
      await qc.invalidateQueries({ queryKey: ['smart', 'list'] })
      toast(editing ? `Saved “${saved.name}”` : `Made “${saved.name}”`)
      navigate(`/smart/${saved.id}`, { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  if (editing && isLoading) return <div className="mx-4 mt-8 h-48 rounded-2xl shimmer sm:mx-6 lg:mx-12" />
  if (editing && !existing)
    return (
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="page-title">That collection is gone</h1>
        <Link to="/smart" className={`${BTN_SOFT} mt-4`}>
          Back to smart collections
        </Link>
      </div>
    )

  const items = preview.data?.items ?? []
  const label = 'block text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400'
  const field = 'mt-1.5 h-10 rounded-lg border border-white/15 bg-white/[0.05] px-3 text-[15px] text-white outline-none focus:border-white/40'
  const chip = (on: boolean) =>
    `inline-flex h-9 items-center rounded-full px-3.5 text-sm transition-colors ${on ? 'bg-white font-semibold text-ink-950' : 'border border-white/15 text-ink-200 hover:text-white'}`

  return (
    <div className="px-4 pb-16 pt-6 sm:px-6 lg:px-12">
      <h1 className="page-title mb-1">{editing ? 'Edit smart collection' : 'New smart collection'}</h1>
      <p className="text-sm text-ink-400">Pick the rules; the preview shows what they’d hold right now.</p>
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {!editing && (
            <div>
              <span className={label}>Start from</span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={chip(false)}
                    onClick={() => {
                      setName(p.name)
                      setRules({ ...emptyRules(p.rules.kind), ...p.rules })
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="block">
            <span className={label}>Name</span>
            <input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Tonight’s short films" className={`${field} w-full`} />
          </label>
          <div>
            <span className={label}>Holds</span>
            <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Holds">
              {(Object.keys(KIND_LABEL) as SmartKind[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={rules.kind === k} className={chip(rules.kind === k)} onClick={() => setKind(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className={label}>Genres {rules.genres.length ? `(any of ${rules.genres.length})` : '(any)'}</span>
            <div className="mt-1.5 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
              {genres.isLoading && <span className="text-sm text-ink-400">Loading genres…</span>}
              {genres.data?.length === 0 && <span className="text-sm text-ink-400">No genres in the library for these.</span>}
              {genres.data?.map((g) => {
                const on = rules.genres.includes(g)
                return (
                  <button key={g} type="button" aria-pressed={on} className={chip(on)} onClick={() => set({ genres: on ? rules.genres.filter((x) => x !== g) : [...rules.genres, g] })}>
                    {g}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label>
              <span className={label}>From year</span>
              <input type="number" inputMode="numeric" value={rules.yearFrom ?? ''} onChange={(e) => set({ yearFrom: num(e.target.value) })} placeholder="Any" className={`${field} w-28`} />
            </label>
            <label>
              <span className={label}>To year</span>
              <input type="number" inputMode="numeric" value={rules.yearTo ?? ''} onChange={(e) => set({ yearTo: num(e.target.value) })} placeholder="Any" className={`${field} w-28`} />
            </label>
          </div>
          {f.runtime && (
            <div className="flex flex-wrap gap-4">
              <label>
                <span className={label}>At least (min)</span>
                <input type="number" inputMode="numeric" value={rules.minMinutes ?? ''} onChange={(e) => set({ minMinutes: num(e.target.value) })} placeholder="Any" className={`${field} w-28`} />
              </label>
              <label>
                <span className={label}>At most (min)</span>
                <input type="number" inputMode="numeric" value={rules.maxMinutes ?? ''} onChange={(e) => set({ maxMinutes: num(e.target.value) })} placeholder="Any" className={`${field} w-28`} />
              </label>
            </div>
          )}
          <label className="block">
            <span className={label}>Added</span>
            <select value={rules.addedWithinDays ?? ''} onChange={(e) => set({ addedWithinDays: num(e.target.value) })} className={`${field} w-full`}>
              <option value="">Any time</option>
              {ADDED_CHOICES.map((d) => (
                <option key={d} value={d}>
                  In the last {d === 365 ? 'year' : `${d} days`}
                </option>
              ))}
            </select>
          </label>
          {f.watched.length > 0 && (
            <div>
              <span className={label}>Watched</span>
              <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Watched">
                <button type="button" role="radio" aria-checked={rules.watched === null} className={chip(rules.watched === null)} onClick={() => set({ watched: null })}>
                  Any
                </button>
                {f.watched.map((w: WatchedRule) => (
                  <button key={w} type="button" role="radio" aria-checked={rules.watched === w} className={chip(rules.watched === w)} onClick={() => set({ watched: w })}>
                    {WATCHED_LABEL[rules.kind][w]}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[12px] text-ink-400">Watched means watched on your profile.</p>
            </div>
          )}
          <label className="block">
            <span className={label}>Order</span>
            <select value={rules.sort} onChange={(e) => set({ sort: e.target.value as SmartSort })} className={`${field} w-full`}>
              <option value="added">Newest added first</option>
              <option value="title">Title</option>
              <option value="year">Year, oldest first</option>
              {f.runtime && <option value="runtime">Shortest first</option>}
            </select>
          </label>
          {(problem || error) && (
            <p role="alert" className="text-sm text-amber-200">
              {problem ?? error}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={saving || Boolean(problem)} className={BTN_MAIN}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Make collection'}
            </button>
            <button type="button" onClick={() => navigate(-1)} className={BTN_SOFT}>
              Cancel
            </button>
          </div>
        </form>
        <section aria-label="Preview" aria-live="polite">
          <p className="text-[13px] text-ink-300">
            {problem
              ? 'Fix the rules to see what they’d hold.'
              : preview.isLoading || !shown || pending
                ? 'Looking…'
                : preview.isError
                  ? 'Couldn’t ask the library right now.'
                  : `${items.length}${preview.data?.partial ? '+' : ''} ${items.length === 1 ? 'title matches' : 'titles match'} right now: ${describe(shown)}`}
          </p>
          <div className={`${GRID} mt-3 ${pending ? 'opacity-50' : ''}`}>{items.slice(0, 18).map((it) => (shown ? <Card key={it.Id} item={it} rules={shown} /> : null))}</div>
        </section>
      </div>
    </div>
  )
}

/** Switching kind: drop rules the new kind doesn't have, without complaining about them. */
function cleanLoose(r: SmartRules): SmartRules {
  const f = fieldsFor(r.kind)
  return {
    ...r,
    genres: [],
    minMinutes: f.runtime ? r.minMinutes : null,
    maxMinutes: f.runtime ? r.maxMinutes : null,
    watched: r.watched && f.watched.includes(r.watched) ? r.watched : null,
    sort: r.sort === 'runtime' && !f.runtime ? 'added' : r.sort,
  }
}
