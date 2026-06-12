import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSearch } from '../api/queries'
import MediaRow from '../components/MediaRow'

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const term = searchParams.get('q') ?? ''
  const [input, setInput] = useState(term)
  const { data, isLoading } = useSearch(term)

  // Keep the URL as the source of truth, debounced from typing
  useEffect(() => {
    const t = setTimeout(() => {
      if (input.trim() !== term) {
        setSearchParams(input.trim() ? { q: input.trim() } : {}, { replace: true })
      }
    }, 350)
    return () => clearTimeout(t)
  }, [input, term, setSearchParams])

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
      <div className="px-4 sm:px-6 lg:px-12 py-6">
        <h1 className="text-2xl font-bold text-white tracking-tight mb-4">
          {term ? <>Results for “{term}”</> : 'Search'}
        </h1>
        <div className="relative max-w-xl">
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
          </svg>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Movies, shows, episodes…"
            autoFocus={!term}
            className="w-full rounded-full bg-ink-800/80 border border-white/10 pl-11 pr-4 py-2.5 text-sm outline-none focus:border-accent-500 placeholder:text-ink-400"
          />
        </div>
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
