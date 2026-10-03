import { Link } from 'react-router-dom'
import { useWatchlistItems } from '../api/queries'
import MediaCard from '../components/MediaCard'
import DownloadsSection from '../components/DownloadsSection'
import { CardSkeleton } from '../components/Skeletons'
import { DiceIcon, useSurprise } from '../lib/surprise'

/** My List: the server-synced watchlist, plus what you've asked the server to
 *  download (so a request isn't a fire-and-forget into another page). */
export default function MyListPage() {
  const { data: items, isLoading } = useWatchlistItems()
  const { surprise, busy } = useSurprise()
  const empty = !isLoading && (!items || items.length === 0)

  return (
    <div className="pb-16 px-4 sm:px-6 lg:px-12 py-6">
      <h1 className="page-title mb-1">My List</h1>
      <p className="text-sm text-ink-400 mb-6">Saved to watch later, synced across your devices.</p>

      {empty ? (
        <div className="rounded-2xl border border-white/5 bg-ink-900/50 px-6 py-10 sm:p-12 text-center max-w-2xl">
          <p className="text-lg font-semibold text-white">Your list is empty</p>
          <p className="text-sm text-ink-300 mt-1.5">
            Tap <span className="font-semibold text-white">My List</span> on any movie or show and it lands here, on every device.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Link
              to="/"
              className="inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
            >
              See what's new
            </Link>
            <button
              type="button"
              onClick={() => surprise({ includeItemTypes: 'Movie,Series' })}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-white/10 border border-white/15 px-4 text-sm font-semibold text-white hover:bg-white/15 transition-colors disabled:opacity-60"
            >
              <DiceIcon spinning={busy} />
              Surprise me
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2.5 sm:gap-4 grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
          {isLoading
            ? Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)
            : items!.map((item) => <MediaCard key={item.Id} item={item} />)}
        </div>
      )}

      <div className="mt-10">
        <DownloadsSection title="Your requests" />
        <Link to="/request" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-300 hover:text-white transition-colors">
          Requests and downloads
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
