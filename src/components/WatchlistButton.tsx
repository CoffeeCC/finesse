import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWatchlistIds } from '../api/queries'
import { setInWatchlist } from '../api/client'
import { useToast } from './Toast'
import type { JfItem } from '../api/types'

/** Bookmark toggle: add/remove the title from the user's watchlist (server-synced). */
export default function WatchlistButton({ item }: { item: JfItem }) {
  const { data: ids } = useWatchlistIds()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const inList = ids?.includes(item.Id) ?? false

  const toggle = async () => {
    setBusy(true)
    const add = !inList
    try {
      const next = await setInWatchlist(item.Id, add)
      // Push the new ids into cache so every WatchlistButton + the row update at once.
      queryClient.setQueryData(['watchlistIds'], next)
      queryClient.invalidateQueries({ queryKey: ['watchlistItems'] })
      toast(add ? 'Added to watchlist' : 'Removed from watchlist')
    } catch {
      toast('Couldn’t update watchlist', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={inList ? 'Remove from watchlist' : 'Add to watchlist'}
      title={inList ? 'In your watchlist' : 'Add to watchlist'}
      className={`h-10 w-10 rounded-full flex items-center justify-center backdrop-blur-md transition-all active:scale-90 disabled:opacity-50 ${
        inList ? 'bg-accent-500/25 text-accent-300 hover:bg-accent-500/35' : 'bg-white/10 text-white hover:bg-white/20'
      }`}
    >
      <svg className="h-5 w-5" fill={inList ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
      </svg>
    </button>
  )
}
