import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { tracksQuery } from '../api/queries'
import { useAudio } from '../audio/AudioPlayerContext'
import type { JfItem } from '../api/types'

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

/** Play one song from anywhere (a search result): its album from that song
 *  on, so the music keeps going; just the song if its album can't be read. */
export function usePlayTrack() {
  const qc = useQueryClient()
  const { playQueue } = useAudio()
  return useCallback(
    async (track: JfItem) => {
      if (track.AlbumId) {
        try {
          const res = await qc.fetchQuery(tracksQuery(track.AlbumId))
          const i = res.Items.findIndex((t) => t.Id === track.Id)
          if (i >= 0) {
            playQueue(res.Items, i)
            return
          }
        } catch {
          /* play the song on its own */
        }
      }
      playQueue([track], 0)
    },
    [qc, playQueue],
  )
}
