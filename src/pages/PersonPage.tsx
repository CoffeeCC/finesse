import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useItem, usePersonItems } from '../api/queries'
import { imageUrl } from '../api/client'
import type { JfItem } from '../api/types'
import { goBack } from '../lib/back'
import { IS_TV } from '../lib/device'
import MediaCard from '../components/MediaCard'
import { SelectMenu } from '../components/Menu'
import { CardSkeleton } from '../components/Skeletons'
import ItemUnavailable from '../components/ItemUnavailable'

type TypeFilter = 'all' | 'Movie' | 'Series'
type SortKey = 'newest' | 'oldest' | 'title' | 'rating'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'rating', label: 'Rating' },
]

export default function PersonPage() {
  const { personId } = useParams()
  const navigate = useNavigate()
  const { data: person, isLoading, isError, error, refetch, isFetching } = useItem(personId)
  const {
    data: items,
    isLoading: itemsLoading,
    isError: itemsError,
    refetch: refetchItems,
  } = usePersonItems(personId)

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('newest')

  const allItems = items?.Items ?? []
  const hasMovies = allItems.some((i) => i.Type === 'Movie')
  const hasShows = allItems.some((i) => i.Type === 'Series')

  const filtered = useMemo(() => {
    const list = typeFilter === 'all' ? allItems : allItems.filter((i) => i.Type === typeFilter)
    return list.slice().sort((a, b) => {
      if (sort === 'title') return (a.SortName ?? a.Name).localeCompare(b.SortName ?? b.Name)
      if (sort === 'rating') return (b.CommunityRating ?? 0) - (a.CommunityRating ?? 0) || (b.ProductionYear ?? 0) - (a.ProductionYear ?? 0)
      if (sort === 'oldest') return (a.ProductionYear ?? 9999) - (b.ProductionYear ?? 9999) || a.Name.localeCompare(b.Name)
      return (b.ProductionYear ?? 0) - (a.ProductionYear ?? 0) || a.Name.localeCompare(b.Name)
    })
  }, [allItems, typeFilter, sort])

  if (!person) {
    if (isLoading || (isFetching && !isError)) return <div className="h-[calc(var(--vh)*40)] shimmer -mt-16" />
    return <ItemUnavailable kind="person" error={error} id={personId} onRetry={() => void refetch()} retrying={isFetching} />
  }

  const headshot = person.ImageTags?.Primary
    ? imageUrl(person.Id, 'Primary', { maxWidth: 400, tag: person.ImageTags.Primary })
    : null
  const birthYear = person.PremiereDate ? new Date(person.PremiereDate).getFullYear() : null
  const birthPlace = (person as JfItem & { ProductionLocations?: string[] }).ProductionLocations?.[0]
  const bioMeta = [
    birthYear && Number.isFinite(birthYear) ? `Born ${birthYear}` : null,
    birthPlace || null,
    items ? `${items.TotalRecordCount.toLocaleString()} title${items.TotalRecordCount === 1 ? '' : 's'} in your library` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="pb-16">
      <div className="px-4 sm:px-6 lg:px-12 pt-6">
        {!IS_TV && (
          <button
            type="button"
            onClick={() => goBack(navigate)}
            className="mb-5 -ml-1 inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-ink-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
            Back
          </button>
        )}

        <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-start">
          <div className="h-40 w-40 shrink-0 rounded-2xl overflow-hidden bg-ink-800 ring-1 ring-white/10 shadow-2xl">
            {headshot ? (
              <img decoding="async" src={headshot} alt={person.Name} className="h-full w-full object-cover fade-in" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-5xl font-bold text-ink-400">
                {person.Name.charAt(0)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="page-title">{person.Name}</h1>
            {bioMeta && <p className="mt-1.5 text-sm text-ink-400">{bioMeta}</p>}
            {person.Overview && <Biography text={person.Overview} />}
          </div>
        </div>
      </div>

      <section className="mt-10 px-4 sm:px-6 lg:px-12">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <h2 className="row-title text-white mr-auto">In your library</h2>
          {hasMovies && hasShows && (
            <div role="group" aria-label="Filter by type" className="inline-flex p-0.5 rounded-full bg-ink-800/80 border border-white/10">
              {(
                [
                  ['all', 'All'],
                  ['Movie', 'Movies'],
                  ['Series', 'Shows'],
                ] as [TypeFilter, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={typeFilter === k}
                  onClick={() => setTypeFilter(k)}
                  className={`h-8 px-3.5 rounded-full text-sm transition-colors ${
                    typeFilter === k ? 'bg-white text-ink-950 font-semibold' : 'text-ink-200 hover:text-white font-medium'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {allItems.length > 1 && (
            <SelectMenu label="Sort titles by" prefix="Sort:" value={sort} options={SORT_OPTIONS} onChange={setSort} align="right" />
          )}
        </div>

        {itemsError && !items ? (
          <div className="py-10 text-center">
            <p className="text-base font-semibold text-white">Couldn’t load titles</p>
            <p className="mt-1 text-sm text-ink-400">Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => void refetchItems()}
              className="mt-4 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:gap-4 grid-cols-2 min-[480px]:grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {itemsLoading
              ? Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)
              : filtered.map((item, i) => (
                  <div key={item.Id} className="cv-card">
                    <MediaCard item={item} autoFocus={i === 0} />
                  </div>
                ))}
            {!itemsLoading && filtered.length === 0 && (
              <p className="col-span-full text-ink-400 py-8 text-center">
                Nothing from {person.Name} in your library yet.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

/** Six lines, and Read more when there's more (the rest used to be cut off for good). */
function Biography({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [text, open])
  return (
    <div className="mt-4 max-w-3xl">
      <p id="person-bio" ref={ref} className={`text-sm leading-relaxed text-ink-200 whitespace-pre-line ${open ? '' : 'line-clamp-6'}`}>
        {text}
      </p>
      {(clipped || open) && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls="person-bio"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-sm font-semibold text-accent-300 hover:text-white"
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}
