import { useEffect, useRef, useState } from 'react'
import { setMood, useMood } from '../lib/mood'

const DWELL_MS = 260

/** Full-screen colour wash behind everything, tinted by the current mood
 *  (lib/mood). Two layers crossfade by opacity — compositor-only, no restyle.
 *  Also follows the pointer/focus: resting on any [data-mood] element sets it. */
export default function MoodWash() {
  const mood = useMood()
  const [layers, setLayers] = useState<{ a: string | null; b: string | null; front: 'a' | 'b' }>({
    a: null,
    b: null,
    front: 'a',
  })
  const shown = useRef<string | null>(null)

  useEffect(() => {
    if (mood === shown.current) return
    shown.current = mood
    setLayers((l) => (l.front === 'a' ? { ...l, b: mood, front: 'b' } : { ...l, a: mood, front: 'a' }))
  }, [mood])

  // Follow what you rest on (hover or focus), after a short dwell so sweeping
  // across a shelf doesn't strobe the room.
  useEffect(() => {
    let timer = 0
    const consider = (target: EventTarget | null) => {
      const el = (target as HTMLElement | null)?.closest?.('[data-mood]')
      const rgb = el?.getAttribute('data-mood')
      window.clearTimeout(timer)
      if (!rgb) return
      timer = window.setTimeout(() => setMood(rgb), DWELL_MS)
    }
    const onFocus = (e: FocusEvent) => consider(e.target)
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') consider(e.target)
    }
    window.addEventListener('focusin', onFocus)
    window.addEventListener('pointerover', onOver)
    return () => {
      window.removeEventListener('focusin', onFocus)
      window.removeEventListener('pointerover', onOver)
      window.clearTimeout(timer)
    }
  }, [])

  const layer = (rgb: string | null, visible: boolean) => (
    <div
      className="mood-layer"
      style={{
        opacity: visible && rgb ? 1 : 0,
        background: rgb
          ? `radial-gradient(90% 55% at 50% -8%, rgba(${rgb}, 0.30), transparent 72%),` +
            `radial-gradient(55% 45% at 100% 105%, rgba(${rgb}, 0.14), transparent 70%),` +
            `radial-gradient(45% 40% at 0% 70%, rgba(${rgb}, 0.08), transparent 70%)`
          : undefined,
      }}
    />
  )

  return (
    <div aria-hidden className="mood-wash">
      {layer(layers.a, layers.front === 'a')}
      {layer(layers.b, layers.front === 'b')}
    </div>
  )
}
