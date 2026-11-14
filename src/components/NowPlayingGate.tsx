import { Suspense } from 'react'
import { useAudio } from '../audio/AudioPlayerContext'
import { lazyPage } from '../lib/lazyPage'

// The full-screen music player (with lyrics, the lyric video and the visualizer) is a big piece
// of code that nobody needs until a song is on. It loads when one is.
const NowPlaying = lazyPage(() => import('./NowPlaying'))

export default function NowPlayingGate() {
  const { current } = useAudio()
  if (!current) return null
  return (
    <Suspense fallback={null}>
      <NowPlaying />
    </Suspense>
  )
}
