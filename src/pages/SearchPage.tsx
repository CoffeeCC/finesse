import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSearch } from '../api/queries'
import MediaRow from '../components/MediaRow'

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const term = searchParams.get('q') ?? ''
  const { data, isLoading } = useSearch(term)

  const groups = useMemo(() => {
    const items = data?.Items ?? []
    return {
      movies: items.filter((i) => i.Type === 'Movie'),
      series: items.filter((i) => i.Type === 'Series'),
      episodes: items.filter((i) => i.Type === 'Episode'),
    }
  }, [data])

  const empty =
    !isLoading &&
    data &&
    groups.movies.length === 0 &&
    groups.series.length === 0 &&
    groups.episodes.length === 0

  return (
    <div className="pb-16">
      <div className="px-6 lg:px-12 py-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          {term ? <>Results for “{term}”</> : 'Search'}
        </h1>
      </div>

      {empty && (
        <p className="px-6 lg:px-12 text-ink-400">Nothing found. Try a different search.</p>
      )}

      <div className="space-y-10">
        <MediaRow title="Movies" items={groups.movies} loading={isLoading} />
        <MediaRow title="Shows" items={groups.series} loading={false} />
        <MediaRow title="Episodes" items={groups.episodes} loading={false} />
      </div>
    </div>
  )
}
