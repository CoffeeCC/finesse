import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import * as api from '../api/client'
import MediaCard from '../components/MediaCard'
import { CardSkeleton } from '../components/Skeletons'

// A "see all" hub: every row on the home page can deep-link here with its
// underlying query encoded as URL params, rendered as a full grid.
export default function BrowsePage() {
  const [params] = useSearchParams()
  const title = params.get('title') ?? 'Browse'

  const query: api.ItemsQuery = {
    parentId: params.get('parentId') ?? undefined,
    includeItemTypes: params.get('includeItemTypes') ?? undefined,
    genres: params.get('genres') ?? undefined,
    filters: params.get('filters') ?? undefined,
    years: params.get('years') ?? undefined,
    tags: params.get('tags') ?? undefined,
    sortBy: params.get('sortBy') ?? 'SortName',
    sortOrder: params.get('sortOrder') ?? 'Ascending',
    recursive: true,
    limit: 240,
    fields: 'PrimaryImageAspectRatio,ProductionYear',
  }

  const { data, isLoading } = useQuery({
    queryKey: ['browse', Object.fromEntries(params)],
    queryFn: () => api.getItems(query),
    staleTime: 5 * 60_000,
  })

  return (
    <div className="px-4 sm:px-6 lg:px-12 py-8">
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="page-title">{title}</h1>
        {data && <span className="text-sm text-ink-400">{data.TotalRecordCount} items</span>}
      </div>

      <div
        className="grid gap-2.5 sm:gap-4 grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
      >
        {isLoading
          ? Array.from({ length: 18 }).map((_, i) => <CardSkeleton key={i} />)
          : data?.Items.map((item) => <MediaCard key={item.Id} item={item} />)}
      </div>

      {!isLoading && data?.Items.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-white">Nothing here yet</p>
          <p className="mt-1 text-sm text-ink-400">Titles show up as they're added to your library.</p>
          <Link to="/" className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors">
            Back to Home
          </Link>
        </div>
      )}
    </div>
  )
}

/** Build a /browse href from a query + title (used by home rows' "See all"). */
export function browseHref(title: string, q: api.ItemsQuery): string {
  const p = new URLSearchParams({ title })
  if (q.parentId) p.set('parentId', q.parentId)
  if (q.includeItemTypes) p.set('includeItemTypes', q.includeItemTypes)
  if (q.genres) p.set('genres', q.genres)
  if (q.filters) p.set('filters', q.filters)
  if (q.years) p.set('years', q.years)
  if (q.tags) p.set('tags', q.tags)
  if (q.sortBy) p.set('sortBy', q.sortBy)
  if (q.sortOrder) p.set('sortOrder', q.sortOrder)
  return `/browse?${p.toString()}`
}
