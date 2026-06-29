import { Link } from 'react-router-dom'
import { useWatchlistItems } from '../api/queries'
import MediaCard from '../components/MediaCard'
import { CardSkeleton } from '../components/Skeletons'

export default function WatchlistPage() {
  const { data: items, isLoading } = useWatchlistItems()

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-12 py-6">
      <h1 className="text-2xl font-bold text-white tracking-tight mb-1">Watchlist</h1>
      <p className="text-sm text-ink-400 mb-6">Saved to watch later — synced across your devices.</p>

      {!isLoading && (!items || items.length === 0) ? (
        <div className="rounded-2xl border border-white/5 bg-ink-900/50 p-10 text-center">
          <p className="text-ink-300 font-medium">Your watchlist is empty.</p>
          <p className="text-sm text-ink-400 mt-1">
            Open any movie or show and tap the bookmark to save it here.
          </p>
          <Link
            to="/"
            className="inline-block mt-4 rounded-lg bg-accent-600 hover:bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            Browse the library
          </Link>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
          {isLoading
            ? Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)
            : items!.map((item) => <MediaCard key={item.Id} item={item} />)}
        </div>
      )}
    </div>
  )
}
