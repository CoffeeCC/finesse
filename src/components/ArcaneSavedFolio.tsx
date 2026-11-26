import { useViews, useWatchlistItems } from '../api/queries'
import ArcaneFolio from './ArcaneFolio'
import DownloadsSection from './DownloadsSection'
import ArcaneCollectionOpening from './ArcaneCollectionOpening'

export default function ArcaneSavedFolio() {
  const items = useWatchlistItems(), views = useViews()
  if (items.isLoading) return <ArcaneCollectionOpening />
  if (items.isError) return <ArcaneCollectionOpening error="Your saved stories couldn’t load. Check the connection, then turn the leaf again." onRetry={() => void items.refetch()} />
  return <ArcaneFolio saved savedItems={items.data ?? []} requests={<DownloadsSection title="Your requests" physical />} view={{ Id: 'saved', Name: 'Saved stories', Type: 'CollectionFolder' }} decks={(views.data?.Items ?? []).filter((v) => /^(movies|tvshows)$/.test(v.CollectionType ?? ''))} />
}
