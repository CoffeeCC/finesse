import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tracksQuery } from '../api/queries'
import { useAudio } from '../audio/AudioPlayerContext'

/** Play (or shuffle) an album from anywhere — a card's hover button, the
 *  album page — fetching its tracks through the shared cache. */
export function usePlayAlbum() {
  const qc = useQueryClient()
  const { playQueue } = useAudio()
  return useCallback(
    async (albumId: string, opts: { shuffle?: boolean; startIndex?: number } = {}) => {
      const res = await qc.fetchQuery(tracksQuery(albumId))
      if (res.Items.length) playQueue(res.Items, opts.startIndex ?? 0, { shuffle: opts.shuffle })
    },
    [qc, playQueue],
  )
}
