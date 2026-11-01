import { Link } from 'react-router-dom'
import { useViews, useWatchlistItems } from '../api/queries'
import ArcaneFolio from './ArcaneFolio'
import DownloadsSection from './DownloadsSection'

export default function ArcaneSavedFolio() {
  const items = useWatchlistItems(), views = useViews()
  if (items.isLoading) return <div className="p-12" role="status">Opening your saved stories…</div>
  if (items.isError) return <div className="p-12" role="alert"><h1>Your saved stories couldn’t load.</h1><button className="mt-4 p-3 border rounded-lg" onClick={() => void items.refetch()}>Try again</button></div>
  return <>
    <ArcaneFolio saved savedItems={items.data ?? []} view={{ Id: 'saved', Name: 'Saved stories', Type: 'CollectionFolder' }} decks={(views.data?.Items ?? []).filter((v) => /^(movies|tvshows)$/.test(v.CollectionType ?? ''))} />
    <section className="px-6 lg:px-12 py-8"><DownloadsSection title="Your requests" /><Link className="inline-flex min-h-11 items-center text-accent-300" to="/request">Requests and downloads ↗</Link></section>
  </>
}
