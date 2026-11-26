import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import MediaCard from '../components/MediaCard'
import AlbumCard from '../components/AlbumCard'
import { CardSkeleton } from '../components/Skeletons'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { pushBackHandler } from '../lib/back'
import { IS_TV } from '../lib/device'
import { getItems, posterUrl } from '../api/client'
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

// Smart collections: auto-updating shelves built from simple filters ("unwatched
// movies under 100 minutes"). /smart lists your shelves + 1-click live starter
// recipes, /smart/new and /smart/:id/edit provide a visual rule builder with
// instant poster preview, and /smart/:id shows every match with a random picker.

const GRID = 'grid gap-2.5 sm:gap-4 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]'
const BTN = 'inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition active:scale-[0.97]'
const BTN_MAIN = `${BTN} bg-white text-ink-950 hover:bg-ink-200 disabled:opacity-60`
const BTN_SOFT = `${BTN} border border-white/15 bg-white/[0.06] text-white hover:bg-white/15 disabled:opacity-60`

const RUNTIME_PRESETS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Any length', min: null, max: null },
  { label: 'Under 90m', min: null, max: 90 },
  { label: 'Under 2h', min: null, max: 120 },
  { label: '2h+ epic', min: 120, max: null },
]

const ERA_PRESETS: { label: string; from: number | null; to: number | null }[] = [
  { label: 'Any era', from: null, to: null },
  { label: '2020s', from: 2020, to: 2029 },
  { label: '2010s', from: 2010, to: 2019 },
  { label: '2000s', from: 2000, to: 2009 },
  { label: '90s', from: 1990, to: 1999 },
  { label: 'Classic (<1990)', from: null, to: 1989 },
]

const SORT_LABELS: Record<SmartSort, string> = {
  added: 'Newest added',
  title: 'Title A–Z',
  year: 'Oldest year',
  runtime: 'Shortest first',
}

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

function Card({
  item,
  rules,
  onRemove,
  removeLabel,
}: {
  item: JfItem
  rules: SmartRules
  onRemove?: (item: JfItem) => void
  removeLabel?: string
}) {
  const why = reasons(item, rules)
  return (
    <div className="group/scard relative min-w-0">
      {item.Type === 'MusicAlbum' ? (
        <AlbumCard album={item} />
      ) : (
        <MediaCard item={item} onDismiss={onRemove} />
      )}
      {item.Type === 'MusicAlbum' && onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove(item)
          }}
          aria-label={removeLabel ?? `Remove ${item.Name}`}
          title={removeLabel ?? 'Remove from collection'}
          className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-ink-200 opacity-0 transition group-hover/scard:opacity-100 group-focus-within/scard:opacity-100 focus:opacity-100 hover:bg-black hover:text-white"
        >
          ×
        </button>
      )}
      {why.length > 0 && (
        <p className="mt-1 truncate text-[11.5px] text-ink-400" title={why.join(' · ')}>
          <span className="sr-only">In because: </span>
          {why.join(' · ')}
        </p>
      )}
    </div>
  )
}

/** Live library search box to hand-pick movies, shows, or albums into any collection. */
function LibrarySearchAdder({
  kind,
  includedIds,
  onToggle,
  placeholder,
}: {
  kind: SmartKind
  includedIds: string[]
  onToggle: (item: JfItem) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<JfItem[]>([])
  const [searching, setSearching] = useState(false)
  const includedSet = useMemo(() => new Set(includedIds), [includedIds])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    const t = window.setTimeout(() => {
      void getItems({
        searchTerm: q,
        includeItemTypes: kind,
        recursive: true,
        limit: 8,
        fields: 'PrimaryImageAspectRatio,ProductionYear',
      })
        .then((res) => {
          if (alive) setResults(res.Items ?? [])
        })
        .catch(() => {
          if (alive) setResults([])
        })
        .finally(() => {
          if (alive) setSearching(false)
        })
    }, 220)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [query, kind])

  const what = KIND_LABEL[kind].toLowerCase()

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? `Search your ${what} to add…`}
          aria-label={`Search ${what} to add`}
          className="h-10 w-full rounded-xl border border-white/15 bg-ink-950/75 px-3.5 text-sm text-white placeholder:text-ink-500 outline-none focus:border-accent-400/70"
        />
        {searching && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">
            Searching…
          </span>
        )}
      </div>
      {query.trim() !== '' && !searching && results.length === 0 && (
        <p className="px-1 text-xs text-ink-400">No {what} in your library match “{query.trim()}”.</p>
      )}
      {results.length > 0 && (
        <ul className="max-h-64 divide-y divide-white/5 overflow-y-auto rounded-xl border border-white/10 bg-ink-950/85">
          {results.map((item) => {
            const added = includedSet.has(item.Id)
            const poster = posterUrl(item, 120)
            return (
              <li key={item.Id} className="flex items-center gap-3 px-3 py-2">
                {poster ? (
                  <img src={poster} alt="" className="h-11 w-8 shrink-0 rounded object-cover bg-ink-800" />
                ) : (
                  <span className="flex h-11 w-8 shrink-0 items-center justify-center rounded bg-ink-800 text-[10px] text-ink-400">
                    {KIND_LABEL[kind][0]}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{item.Name}</p>
                  <p className="truncate text-xs text-ink-400">
                    {item.ProductionYear ?? item.AlbumArtist ?? KIND_LABEL[kind]}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onToggle(item)}
                  className={`h-8 shrink-0 rounded-full px-3 text-xs font-semibold transition active:scale-[0.97] ${
                    added
                      ? 'border border-emerald-400/30 bg-emerald-500/15 text-emerald-200 hover:bg-red-500/20 hover:border-red-400/30 hover:text-red-200'
                      : 'bg-white text-ink-950 hover:bg-ink-200'
                  }`}
                >
                  {added ? '✓ Added' : '+ Add'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** One starter recipe with live match count, mini posters from YOUR library, and 1-click Add. */
function PresetCard({
  preset,
  alreadyAdded,
  onAdded,
}: {
  preset: (typeof PRESETS)[number]
  alreadyAdded: boolean
  onAdded: () => void
}) {
  const rules = useMemo(() => ({ ...emptyRules(preset.rules.kind), ...preset.rules }), [preset])
  const { data, isLoading } = useSmartMatches(rules)
  const [adding, setAdding] = useState(false)
  const qc = useQueryClient()
  const toast = useToast()
  const items = data?.items ?? []
  const posters = items.map((it) => posterUrl(it, 180)).filter(Boolean).slice(0, 4) as string[]

  const quickAdd = async () => {
    if (adding || alreadyAdded) return
    setAdding(true)
    try {
      const saved = await createSmart(preset.name, cleanRules(rules))
      await qc.invalidateQueries({ queryKey: ['smart', 'list'] })
      toast(`Added “${saved.name}” to your smart collections`)
      onAdded()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 transition hover:border-white/20 hover:bg-white/[0.05]">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/[0.09]" />
      <div>
        {/* Mini poster strip from the user's real library */}
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div className="flex -space-x-2">
            {isLoading ? (
              [0, 1, 2].map((i) => <span key={i} className="h-14 w-10 rounded-md shimmer ring-1 ring-ink-950" />)
            ) : posters.length > 0 ? (
              posters.map((src, i) => (
                <img
                  key={src + i}
                  src={src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-14 w-10 rounded-md object-cover ring-2 ring-ink-950 shadow-md"
                />
              ))
            ) : (
              <span className="flex h-14 w-10 items-center justify-center rounded-md border border-dashed border-white/15 bg-white/[0.02] text-xs text-ink-400">
                0
              </span>
            )}
          </div>
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-ink-200">
            {isLoading ? '…' : `${items.length}${data?.partial ? '+' : ''} match${items.length === 1 ? '' : 'es'}`}
          </span>
        </div>

        <h3 className="font-display italic text-2xl leading-tight text-white">{preset.name}</h3>
        <p className="mt-1 text-[13px] text-ink-400">{describe(rules)}</p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void quickAdd()}
          disabled={adding || alreadyAdded}
          className={`inline-flex h-9 flex-1 items-center justify-center rounded-full px-3.5 text-xs font-semibold transition active:scale-[0.97] ${
            alreadyAdded
              ? 'border border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
              : 'bg-white text-ink-950 hover:bg-ink-200 disabled:opacity-60'
          }`}
        >
          {alreadyAdded ? 'Added' : adding ? 'Adding…' : 'Add shelf'}
        </button>
        <Link
          to={`/smart/new?preset=${preset.id}`}
          className="inline-flex h-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-3.5 text-xs font-semibold text-ink-200 hover:border-white/25 hover:bg-white/10 hover:text-white active:scale-[0.97] transition"
        >
          Customize
        </Link>
      </div>
    </div>
  )
}

function SmartList() {
  const { data, isLoading, isError, refetch } = useSmartCollections()
  const [showStarters, setShowStarters] = useState(false)
  const existingNames = useMemo(() => new Set((data ?? []).map((c) => c.name.toLowerCase())), [data])
  const hasCollections = (data?.length ?? 0) > 0

  return (
    <div className="px-4 pb-16 pt-6 sm:px-6 lg:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="page-title mb-1.5">Collections</h1>
          <p className="text-sm text-ink-300">
            Make custom shelves your way: search and hand-pick specific movies, shows, or albums — or turn on automatic filters (like “unwatched movies under 2h”) so a shelf updates itself as your library grows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasCollections && (
            <button
              type="button"
              onClick={() => setShowStarters((v) => !v)}
              className={BTN_SOFT}
            >
              {showStarters ? 'Hide ideas' : 'Auto-shelf ideas'}
            </button>
          )}
          <Link to="/smart/new?mode=manual" className={BTN_SOFT}>
            + Hand-picked collection
          </Link>
          <Link to="/smart/new" className={BTN_MAIN}>
            + Smart shelf
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 rounded-2xl shimmer" />
          ))}
        </div>
      ) : isError ? (
        <div className="mt-8 max-w-xl rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6">
          <p className="text-white font-medium">Couldn’t load your smart collections.</p>
          <button type="button" onClick={() => void refetch()} className={`${BTN_SOFT} mt-3`}>
            Try again
          </button>
        </div>
      ) : !hasCollections ? (
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="row-title text-white">Ready-made shelves from your library</h2>
            <span className="text-xs text-ink-400">One click to add, or customize any filter</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PRESETS.map((p) => (
              <PresetCard
                key={p.id}
                preset={p}
                alreadyAdded={existingNames.has(p.name.toLowerCase())}
                onAdded={() => setShowStarters(false)}
              />
            ))}
          </div>
        </section>
      ) : (
        <>
          {showStarters && (
            <section className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-300">One-click starter shelves</h2>
                <button type="button" onClick={() => setShowStarters(false)} className="text-xs text-ink-400 hover:text-white">
                  Close
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {PRESETS.map((p) => (
                  <PresetCard
                    key={p.id}
                    preset={p}
                    alreadyAdded={existingNames.has(p.name.toLowerCase())}
                    onAdded={() => {}}
                  />
                ))}
              </div>
            </section>
          )}
          <div className="mt-7 space-y-10">
            {data!.map((c) => (
              <CollectionRow key={c.id} c={c} />
            ))}
          </div>
        </>
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
          <Link to={`/smart/${c.id}`} className="font-display italic text-2xl sm:text-[28px] leading-tight text-white hover:text-accent-200 transition-colors">
            {c.name}
          </Link>
          <p className="truncate text-[13px] text-ink-400">
            {describe(c.rules)}
            {data ? ` · ${items.length}${data.partial ? '+' : ''} ${items.length === 1 ? 'title' : 'titles'}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold">
          <Link to={`/smart/${c.id}`} className="text-accent-300 hover:text-white transition-colors">
            See all
          </Link>
          <Link to={`/smart/${c.id}/edit`} className="text-ink-300 hover:text-white transition-colors">
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
      {!isLoading && !isError && items.length === 0 && (
        <p className="mt-2 text-sm text-ink-400">Nothing matches right now. It fills in automatically as titles are added or watched.</p>
      )}
    </section>
  )
}

function SmartDetail() {
  const { id } = useParams()
  const { data: list, isLoading: listLoading } = useSmartCollections()
  const c = list?.find((x) => x.id === id)
  const { data, isLoading } = useSmartMatches(c?.rules)
  const [removing, setRemoving] = useState(false)
  const [addingOpen, setAddingOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    if (!addingOpen) return
    return pushBackHandler(() => {
      setAddingOpen(false)
      return true
    })
  }, [addingOpen])

  if (listLoading) return <div className="mx-4 mt-8 h-48 rounded-2xl shimmer sm:mx-6 lg:mx-12" />
  if (!c)
    return (
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="page-title">That collection is gone</h1>
        <Link to="/smart" className={`${BTN_SOFT} mt-4`}>
          Back to collections
        </Link>
      </div>
    )

  const items = data?.items ?? []
  const includedIds = c.rules.includeIds ?? []
  const excludedIds = c.rules.excludeIds ?? []

  const saveRules = async (next: SmartRules, msg: string) => {
    try {
      await updateSmart(c.id, { rules: cleanRules(next) })
      await qc.invalidateQueries({ queryKey: ['smart'] })
      toast(msg)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const toggleItem = (item: JfItem) => {
    const has = includedIds.includes(item.Id)
    const nextInclude = has ? includedIds.filter((x) => x !== item.Id) : [...includedIds, item.Id]
    const nextExclude = excludedIds.filter((x) => x !== item.Id)
    void saveRules(
      { ...c.rules, includeIds: nextInclude, excludeIds: nextExclude },
      has ? `Removed “${item.Name}” from ${c.name}` : `Added “${item.Name}” to ${c.name}`,
    )
  }

  const removeCard = (item: JfItem) => {
    if (includedIds.includes(item.Id)) {
      void saveRules(
        { ...c.rules, includeIds: includedIds.filter((x) => x !== item.Id) },
        `Removed “${item.Name}” from ${c.name}`,
      )
    } else {
      void saveRules(
        { ...c.rules, excludeIds: [...excludedIds, item.Id] },
        `Hid “${item.Name}” from ${c.name}`,
      )
    }
  }

  const pickRandom = () => {
    if (!items.length) return
    const pick = items[Math.floor(Math.random() * items.length)]!
    navigate(pick.Type === 'MusicAlbum' ? `/album/${pick.Id}` : `/item/${pick.Id}`)
  }

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
      <Link to="/smart" className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-ink-400 hover:text-white transition-colors">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        Collections
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title mb-1">{c.name}</h1>
          <p className="text-sm text-ink-400">{describe(c.rules)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAddingOpen((v) => !v)} className={BTN_MAIN}>
            {addingOpen ? 'Done adding' : `+ Add ${KIND_LABEL[c.rules.kind].toLowerCase()}`}
          </button>
          {items.length > 1 && (
            <button type="button" onClick={pickRandom} className={BTN_SOFT}>
              Pick one for me
            </button>
          )}
          <Link to={`/smart/${c.id}/edit`} className={BTN_SOFT}>
            Edit
          </Link>
          <button type="button" onClick={() => setRemoving(true)} className={BTN_SOFT}>
            Remove
          </button>
        </div>
      </div>

      {addingOpen && (
        <div className="mt-5 max-w-xl rounded-2xl border border-white/10 bg-ink-900/75 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">
            Search your library to add to “{c.name}”
          </p>
          <LibrarySearchAdder kind={c.rules.kind} includedIds={includedIds} onToggle={toggleItem} />
        </div>
      )}

      <p className="mt-6 text-[13px] text-ink-400">
        {isLoading ? 'Looking…' : `${items.length} ${items.length === 1 ? 'title' : 'titles'} in this collection.`}
        {data?.partial && ' Only the first titles the library returned were checked; narrow the filters to see everything.'}
        {items.length > 0 && !IS_TV && ' Hover any poster and click × to remove it from this collection.'}
      </p>
      <div className={`${GRID} mt-3`}>
        {isLoading
          ? Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)
          : items.map((it) => (
              <div key={it.Id} className="cv-card">
                <Card
                  item={it}
                  rules={c.rules}
                  onRemove={removeCard}
                  removeLabel={includedIds.includes(it.Id) ? `Remove ${it.Name}` : `Hide ${it.Name} from ${c.name}`}
                />
              </div>
            ))}
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
  const startManual = search.get('mode') === 'manual'
  const preset = useMemo(() => PRESETS.find((p) => p.id === presetId), [presetId])
  const [name, setName] = useState(preset?.name ?? '')
  const [rules, setRules] = useState<SmartRules>(() => ({
    ...emptyRules(preset?.rules.kind),
    ...(preset?.rules ?? {}),
    ...(startManual && !preset ? { manualOnly: true } : {}),
  }))
  const [loaded, setLoaded] = useState(!editing)
  const [customRuntime, setCustomRuntime] = useState(false)
  const [customYears, setCustomYears] = useState(false)

  useEffect(() => {
    if (existing && !loaded) {
      setName(existing.name)
      setRules(existing.rules)
      const matchedRun = RUNTIME_PRESETS.some((p) => p.min === existing.rules.minMinutes && p.max === existing.rules.maxMinutes)
      const matchedEra = ERA_PRESETS.some((p) => p.from === existing.rules.yearFrom && p.to === existing.rules.yearTo)
      setCustomRuntime(!matchedRun && (existing.rules.minMinutes !== null || existing.rules.maxMinutes !== null))
      setCustomYears(!matchedEra && (existing.rules.yearFrom !== null || existing.rules.yearTo !== null))
      setLoaded(true)
    }
  }, [existing, loaded])

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
    const t = setTimeout(() => setShown(cleanRules(rules)), 300)
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
  const label = 'block font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400'
  const field = 'mt-1.5 h-10 rounded-xl border border-white/12 bg-white/[0.05] px-3 text-sm text-white outline-none focus:border-accent-400/70'
  const chip = (on: boolean) =>
    `inline-flex h-8 items-center rounded-full px-3 text-[13px] transition active:scale-[0.97] ${
      on
        ? 'bg-white font-semibold text-ink-950 shadow-sm'
        : 'border border-white/12 bg-white/[0.03] text-ink-200 hover:border-white/25 hover:bg-white/[0.08] hover:text-white'
    }`
  const sorts: SmartSort[] = f.runtime ? ['added', 'title', 'year', 'runtime'] : ['added', 'title', 'year']

  return (
    <div className="px-4 pb-16 pt-6 sm:px-6 lg:px-12">
      <Link to="/smart" className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-ink-400 hover:text-white transition-colors">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
        Smart collections
      </Link>
      <h1 className="page-title mb-1">{editing ? 'Edit collection' : 'Create a collection'}</h1>
      <p className="text-sm text-ink-400">
        Hand-pick specific titles from your library, use automatic filters so the shelf updates itself, or mix both.
      </p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] items-start">
        <form
          className="space-y-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div>
            <span className={label}>How it fills</span>
            <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="How this collection fills">
              <button
                type="button"
                role="radio"
                aria-checked={Boolean(rules.manualOnly)}
                onClick={() => set({ manualOnly: true })}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  rules.manualOnly
                    ? 'border-white bg-white text-ink-950'
                    : 'border-white/12 bg-white/[0.03] text-ink-200 hover:border-white/25 hover:text-white'
                }`}
              >
                <span className="block text-xs font-semibold">Hand-picked</span>
                <span className={`block text-[11px] ${rules.manualOnly ? 'text-ink-700' : 'text-ink-400'}`}>
                  Only titles you search & add
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!rules.manualOnly}
                onClick={() => set({ manualOnly: false })}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${
                  !rules.manualOnly
                    ? 'border-white bg-white text-ink-950'
                    : 'border-white/12 bg-white/[0.03] text-ink-200 hover:border-white/25 hover:text-white'
                }`}
              >
                <span className="block text-xs font-semibold">Auto-updating</span>
                <span className={`block text-[11px] ${!rules.manualOnly ? 'text-ink-700' : 'text-ink-400'}`}>
                  Filters + pinned titles
                </span>
              </button>
            </div>
          </div>

          {!editing && !rules.manualOnly && (
            <div>
              <span className={label}>Quick templates</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={chip(false)}
                    onClick={() => {
                      setName(p.name)
                      setRules({ ...emptyRules(p.rules.kind), ...p.rules })
                      setCustomRuntime(false)
                      setCustomYears(false)
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="block">
            <span className={label}>Collection name</span>
            <input
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={rules.manualOnly ? 'Date night favorites' : 'Tonight’s short films'}
              className={`${field} w-full`}
            />
          </label>

          <div>
            <span className={label}>What it holds</span>
            <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="What it holds">
              {(Object.keys(KIND_LABEL) as SmartKind[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={rules.kind === k} className={chip(rules.kind === k)} onClick={() => setKind(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className={label}>
                {rules.manualOnly ? 'Search & add titles' : 'Pin specific titles (optional)'}
                {(rules.includeIds?.length ?? 0) > 0 ? ` · ${rules.includeIds!.length} added` : ''}
              </span>
              {(rules.includeIds?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => set({ includeIds: [] })}
                  className="text-[11.5px] font-medium text-ink-400 hover:text-white transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <LibrarySearchAdder
              kind={rules.kind}
              includedIds={rules.includeIds ?? []}
              onToggle={(item) => {
                const cur = rules.includeIds ?? []
                const has = cur.includes(item.Id)
                const nextInclude = has ? cur.filter((x) => x !== item.Id) : [...cur, item.Id]
                const nextExclude = (rules.excludeIds ?? []).filter((x) => x !== item.Id)
                set({ includeIds: nextInclude, excludeIds: nextExclude })
              }}
            />
          </div>

          {!rules.manualOnly && (
            <>

          {f.watched.length > 0 && (
            <div>
              <span className={label}>Watch status</span>
              <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Watch status">
                <button type="button" role="radio" aria-checked={rules.watched === null} className={chip(rules.watched === null)} onClick={() => set({ watched: null })}>
                  Any
                </button>
                {f.watched.map((w: WatchedRule) => (
                  <button key={w} type="button" role="radio" aria-checked={rules.watched === w} className={chip(rules.watched === w)} onClick={() => set({ watched: w })}>
                    {WATCHED_LABEL[rules.kind][w]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {f.runtime && (
            <div>
              <div className="flex items-center justify-between">
                <span className={label}>Length</span>
                <button
                  type="button"
                  onClick={() => setCustomRuntime((v) => !v)}
                  className="text-[11.5px] font-medium text-ink-400 hover:text-white transition-colors"
                >
                  {customRuntime ? 'Hide exact' : 'Custom min…'}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {RUNTIME_PRESETS.map((p) => {
                  const active = !customRuntime && rules.minMinutes === p.min && rules.maxMinutes === p.max
                  return (
                    <button
                      key={p.label}
                      type="button"
                      className={chip(active)}
                      onClick={() => {
                        setCustomRuntime(false)
                        set({ minMinutes: p.min, maxMinutes: p.max })
                      }}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
              {customRuntime && (
                <div className="mt-2.5 flex flex-wrap gap-3">
                  <label className="text-xs text-ink-400">
                    Min (min)
                    <input type="number" inputMode="numeric" value={rules.minMinutes ?? ''} onChange={(e) => set({ minMinutes: num(e.target.value) })} placeholder="Any" className={`${field} block w-28`} />
                  </label>
                  <label className="text-xs text-ink-400">
                    Max (min)
                    <input type="number" inputMode="numeric" value={rules.maxMinutes ?? ''} onChange={(e) => set({ maxMinutes: num(e.target.value) })} placeholder="Any" className={`${field} block w-28`} />
                  </label>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <span className={label}>Release era</span>
              <button
                type="button"
                onClick={() => setCustomYears((v) => !v)}
                className="text-[11.5px] font-medium text-ink-400 hover:text-white transition-colors"
              >
                {customYears ? 'Hide exact' : 'Custom years…'}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ERA_PRESETS.map((p) => {
                const active = !customYears && rules.yearFrom === p.from && rules.yearTo === p.to
                return (
                  <button
                    key={p.label}
                    type="button"
                    className={chip(active)}
                    onClick={() => {
                      setCustomYears(false)
                      set({ yearFrom: p.from, yearTo: p.to })
                    }}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
            {customYears && (
              <div className="mt-2.5 flex flex-wrap gap-3">
                <label className="text-xs text-ink-400">
                  From year
                  <input type="number" inputMode="numeric" value={rules.yearFrom ?? ''} onChange={(e) => set({ yearFrom: num(e.target.value) })} placeholder="Any" className={`${field} block w-28`} />
                </label>
                <label className="text-xs text-ink-400">
                  To year
                  <input type="number" inputMode="numeric" value={rules.yearTo ?? ''} onChange={(e) => set({ yearTo: num(e.target.value) })} placeholder="Any" className={`${field} block w-28`} />
                </label>
              </div>
            )}
          </div>

          <div>
            <span className={label}>Added to library</span>
            <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Added to library">
              <button type="button" role="radio" aria-checked={rules.addedWithinDays === null} className={chip(rules.addedWithinDays === null)} onClick={() => set({ addedWithinDays: null })}>
                Any time
              </button>
              {ADDED_CHOICES.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={rules.addedWithinDays === d} className={chip(rules.addedWithinDays === d)} onClick={() => set({ addedWithinDays: d })}>
                  {d === 365 ? 'Last year' : `Last ${d}d`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className={label}>Genres {rules.genres.length ? `(${rules.genres.length})` : '(any)'}</span>
              {rules.genres.length > 0 && (
                <button type="button" onClick={() => set({ genres: [] })} className="text-[11.5px] font-medium text-ink-400 hover:text-white transition-colors">
                  Clear
                </button>
              )}
            </div>
            <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto pr-1">
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
            </>
          )}

          <div>
            <span className={label}>Order</span>
            <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Order">
              {sorts.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={rules.sort === s} className={chip(rules.sort === s)} onClick={() => set({ sort: s })}>
                  {SORT_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {(problem || error) && (
            <p role="alert" className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
              {problem ?? error}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.08]">
            <button type="submit" disabled={saving || Boolean(problem)} className={BTN_MAIN}>
              {saving ? 'Saving…' : editing ? 'Save shelf' : 'Create shelf'}
            </button>
            <button type="button" onClick={() => navigate(-1)} className={BTN_SOFT}>
              Cancel
            </button>
          </div>
        </form>

        <section aria-label="Preview" aria-live="polite" className="lg:sticky lg:top-20">
          <div className="mb-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
            <p className="text-[13.5px] text-ink-200">
              {problem ? (
                'Fix the filter warning to see matching titles.'
              ) : preview.isLoading || !shown || pending ? (
                'Updating live preview…'
              ) : preview.isError ? (
                'Couldn’t reach your library right now.'
              ) : (
                <>
                  <span className="font-semibold text-white">
                    {items.length}
                    {preview.data?.partial ? '+' : ''} {items.length === 1 ? 'title matches' : 'titles match'}
                  </span>
                  <span className="text-ink-400"> · {describe(shown)}</span>
                </>
              )}
            </p>
          </div>
          {!problem && !preview.isLoading && shown && items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-6 py-12 text-center">
              <p className="text-base font-semibold text-white">
                {rules.manualOnly ? 'No titles added yet' : 'No matches in your library right now'}
              </p>
              <p className="mt-1 text-sm text-ink-400">
                {rules.manualOnly
                  ? 'Use the search box on the left to find and add movies, shows, or albums.'
                  : 'Loosen a filter on the left, pin titles with the search box, or save it anyway — it’ll populate automatically when matching titles arrive.'}
              </p>
            </div>
          ) : (
            <div className={`${GRID} transition-opacity ${pending ? 'opacity-50' : ''}`}>
              {items.slice(0, 18).map((it) =>
                shown ? (
                  <div key={it.Id} className="cv-card">
                    <Card
                      item={it}
                      rules={shown}
                      onRemove={(target) => {
                        const cur = rules.includeIds ?? []
                        if (cur.includes(target.Id)) set({ includeIds: cur.filter((x) => x !== target.Id) })
                        else set({ excludeIds: [...(rules.excludeIds ?? []), target.Id] })
                      }}
                    />
                  </div>
                ) : null,
              )}
            </div>
          )}
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
    includeIds: [],
    excludeIds: [],
    minMinutes: f.runtime ? r.minMinutes : null,
    maxMinutes: f.runtime ? r.maxMinutes : null,
    watched: r.watched && f.watched.includes(r.watched) ? r.watched : null,
    sort: r.sort === 'runtime' && !f.runtime ? 'added' : r.sort,
  }
}
