import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
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
        <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
        {data && <span className="text-sm text-ink-400">{data.TotalRecordCount} items</span>}
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
      >
        {isLoading
          ? Array.from({ length: 18 }).map((_, i) => <CardSkeleton key={i} />)
          : data?.Items.map((item) => <MediaCard key={item.Id} item={item} />)}
      </div>

      {!isLoading && data?.Items.length === 0 && (
        <p className="text-ink-400 py-12 text-center">Nothing here yet.</p>
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
