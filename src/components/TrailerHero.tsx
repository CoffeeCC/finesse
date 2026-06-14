import { useEffect, useRef, useState } from 'react'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<any> | null = null
function loadYouTubeAPI(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve) => {
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(window.YT)
    }
  })
  return apiPromise
}

/**
 * Trailer overlay for the detail hero. Autoplays muted; hovering the hero
 * fades the audio in (and back out on leave) via the YouTube IFrame API.
 */
export default function TrailerHero({ youtubeId, onClose }: { youtubeId: string; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const fadeRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const [muted, setMuted] = useState(true)

  // Build the player
  useEffect(() => {
    let cancelled = false
    loadYouTubeAPI().then((YT) => {
      if (cancelled || !hostRef.current) return
      playerRef.current = new YT.Player(hostRef.current, {
        videoId: youtubeId,
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          loop: 1,
          playlist: youtubeId,
        },
        events: {
          onReady: (e: any) => {
            e.target.mute()
            e.target.playVideo()
          },
        },
      })
    })
    return () => {
      cancelled = true
      clearInterval(fadeRef.current)
      try {
        playerRef.current?.destroy?.()
      } catch {
        /* ignore */
      }
    }
  }, [youtubeId])

  const fadeTo = (target: number) => {
    const p = playerRef.current
    if (!p?.setVolume) return
    clearInterval(fadeRef.current)
    if (target > 0) p.unMute?.()
    let vol = typeof p.getVolume === 'function' ? p.getVolume() : target > 0 ? 0 : 100
    fadeRef.current = setInterval(() => {
      vol += target > vol ? 8 : -8
      const done = Math.abs(target - vol) <= 8
      const v = done ? target : vol
      try {
        p.setVolume(Math.max(0, Math.min(100, v)))
        if (done) {
          clearInterval(fadeRef.current)
          if (target === 0) p.mute?.()
        }
      } catch {
        clearInterval(fadeRef.current)
      }
    }, 60)
  }

  const enter = () => {
    setMuted(false)
    fadeTo(100)
  }
  const leave = () => {
    setMuted(true)
    fadeTo(0)
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {/* YT API replaces this div with an iframe */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[177.78vh] h-[56.25vw] min-w-full min-h-full pointer-events-none">
        <div ref={hostRef} className="h-full w-full" />
      </div>

      <div className="absolute top-20 right-4 sm:right-6 lg:right-12 flex gap-2 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation()
            muted ? enter() : leave()
          }}
          className="h-9 w-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur flex items-center justify-center text-white transition-colors"
          aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
        >
          {muted ? (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18z" /></svg>
          ) : (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" /></svg>
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="h-9 w-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur flex items-center justify-center text-white transition-colors"
          aria-label="Stop trailer"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  )
}
