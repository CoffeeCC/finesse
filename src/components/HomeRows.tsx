import { useQueryClient } from '@tanstack/react-query'
import MediaRow from './MediaRow'
import DownloadsSection from './DownloadsSection'
import {
  useBecauseYouWatched,
  useItemsRow,
  useLatest,
  useNextUp,
  useResume,
  useWatchlistItems,
} from '../api/queries'
import * as api from '../api/client'
import type { ItemsQuery } from '../api/client'
import type { JfItem } from '../api/types'

// Each home row is self-contained — it fetches its own data and renders a
// MediaRow (which renders nothing when empty). That lets HomePage render an
// arbitrary, reorderable list of rows without violating React's hook rules.
// `hideTitle` is set when an outer collapse-frame already shows the title.

export function ComingSoonRow({ hideTitle }: { hideTitle?: boolean }) {
  return (
    <div className="px-4 sm:px-6 lg:px-12">
      <DownloadsSection title={hideTitle ? '' : 'Coming Soon'} limit={6} />
    </div>
  )
}

export function ResumeRow({ hideTitle }: { hideTitle?: boolean }) {
  const { data, isLoading } = useResume()
  const qc = useQueryClient()
  const dismiss = async (item: JfItem) => {
    // Optimistic: pull the card immediately, then confirm with the server.
    qc.setQueryData(['resume'], (prev: typeof data) =>
      prev ? { ...prev, Items: prev.Items.filter((i) => i.Id !== item.Id) } : prev,
    )
    try {
      await api.clearResumePosition(item.Id)
    } finally {
      qc.invalidateQueries({ queryKey: ['resume'] })
    }
  }
  return (
    <MediaRow
      title="Continue Watching"
      items={data?.Items}
      loading={isLoading}
      hideTitle={hideTitle}
      onDismissItem={dismiss}
    />
  )
}

export function NextUpRow({ hideTitle }: { hideTitle?: boolean }) {
  const { data, isLoading } = useNextUp()
  return <MediaRow title="Next Up" items={data?.Items} loading={isLoading} hideTitle={hideTitle} />
}

export function WatchlistRow({ hideTitle }: { hideTitle?: boolean }) {
  const { data, isLoading } = useWatchlistItems()
  return <MediaRow title="Your Watchlist" items={data} loading={isLoading} seeAllHref="/watchlist" hideTitle={hideTitle} />
}

export function BecauseRow({ hideTitle }: { hideTitle?: boolean }) {
  const because = useBecauseYouWatched()
  if (!because.seedName) return null
  return (
    <MediaRow
      title={`Because you watched ${because.seedName}`}
      items={because.items}
      loading={because.loading}
      hideTitle={hideTitle}
    />
  )
}

export function LatestRow({ parentId, title, hideTitle }: { parentId: string; title: string; hideTitle?: boolean }) {
  const { data, isLoading } = useLatest(parentId)
  return <MediaRow title={title} items={data} loading={isLoading} hideTitle={hideTitle} />
}

export function QueryRow({
  label,
  title,
  query,
  seeAllHref,
  hideTitle,
}: {
  label: string
  title: string
  query: ItemsQuery | null
  seeAllHref?: string
  hideTitle?: boolean
}) {
  const { data, isLoading } = useItemsRow(label, query)
  return <MediaRow title={title} items={data?.Items} loading={isLoading} seeAllHref={seeAllHref} hideTitle={hideTitle} />
}
