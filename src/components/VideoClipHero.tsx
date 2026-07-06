import { useEffect, useRef, useState } from 'react'
import { claimPreview, releasePreview } from '../lib/preview'

/**
 * Plays a locally-generated preview clip (a short snippet of the actual file,
 * served from the NAS — works offline, always matches the title). Muted by
 * default; hovering the hero fades the audio in and back out on leave.
 */
export default function VideoClipHero({ clipUrl, onClose }: { clipUrl: string; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const fadeRef = useRef<ReturnType<typeof setInterval>>(undefined)
  const [muted, setMuted] = useState(true)

  // The hero owns the one preview slot while it's up — claiming stops any card
  // preview that was playing, and the closer runs if something else claims it.
  useEffect(() => {
    const stop = () => onClose()
    claimPreview(stop)
    return () => {
      releasePreview(stop)
      clearInterval(fadeRef.current)
    }
  }, [onClose])

  const fadeTo = (target: number) => {
    const v = ref.current
    if (!v) return
    clearInterval(fadeRef.current)
    if (target > 0) v.muted = false
    fadeRef.current = setInterval(() => {
      const step = target > v.volume ? 0.08 : -0.08
      let nv = v.volume + step
      const done = Math.abs(target - nv) <= 0.08
      if (done) nv = target
      v.volume = Math.max(0, Math.min(1, nv))
      if (done) {
        clearInterval(fadeRef.current)
        if (target === 0) v.muted = true
      }
    }, 50)
  }

  const enter = () => {
    setMuted(false)
    fadeTo(1)
  }
  const leave = () => {
    setMuted(true)
    fadeTo(0)
  }

  return (
    <div className="absolute inset-0 overflow-hidden" onMouseEnter={enter} onMouseLeave={leave}>
      <video
        ref={ref}
        src={clipUrl}
        autoPlay
        muted
        loop
        playsInline
        onVolumeChange={() => {}}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 min-w-full min-h-full object-cover"
        onError={onClose}
      />
      <div className="absolute top-20 right-4 sm:right-6 lg:right-12 flex gap-2 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation()
            muted ? enter() : leave()
          }}
          className="h-9 w-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur flex items-center justify-center text-white transition-colors"
          aria-label={muted ? 'Unmute preview' : 'Mute preview'}
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
          aria-label="Stop preview"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  )
}
