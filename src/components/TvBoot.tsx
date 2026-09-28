import { useEffect, useState } from 'react'
import { currentDaypart, DAYPART_GREETING } from '../lib/timeAmbience'

/** TV-only branded splash that trades a moment of startup for a fully-dressed
 *  first frame: it covers the UI until the first screenful of poster images has
 *  actually downloaded AND decoded (or a hard timeout), so Home appears complete
 *  instead of popping in image-by-image while you start scrolling.
 *
 *  Static gradients + opacity fade only — nothing here costs the TV per-frame. */
export default function TvBoot() {
  const [phase, setPhase] = useState<'hold' | 'fade' | 'gone'>('hold')

  useEffect(() => {
    const started = performance.now()
    const timer = window.setInterval(() => {
      let decoded = 0
      document.querySelectorAll('img').forEach((img) => {
        if ((img as HTMLImageElement).complete) decoded++
      })
      const elapsed = performance.now() - started
      // Enough posters ready (and a beat for layout), or give up waiting.
      if ((decoded >= 12 && elapsed > 900) || elapsed > 4500) {
        window.clearInterval(timer)
        setPhase('fade')
        window.setTimeout(() => setPhase('gone'), 500)
      }
    }, 200)
    return () => window.clearInterval(timer)
  }, [])

  if (phase === 'gone') return null

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(circle at 20% 15%, rgba(98,121,205,0.20), transparent 55%),' +
          'radial-gradient(circle at 80% 85%, rgba(146,90,191,0.14), transparent 55%),' +
          '#0b0d12',
        opacity: phase === 'fade' ? 0 : 1,
        transition: 'opacity 0.5s ease',
        pointerEvents: phase === 'fade' ? 'none' : 'auto',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            font: 'italic 600 64px Georgia, serif',
            background: 'linear-gradient(120deg, #6279cd, #a86ad1)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          Finesse.
        </div>
        <div style={{ marginTop: 12, color: '#6b7280', fontSize: 15, letterSpacing: 2 }}>
          {DAYPART_GREETING[currentDaypart()]}
        </div>
      </div>
    </div>
  )
}
