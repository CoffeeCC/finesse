import { useEffect, useRef } from 'react'
import { useAudio } from '../audio/AudioPlayerContext'

const REDUCED =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Mirrored frequency-bar visualizer driven by the player's Web Audio analyser.
 * Falls back to a calm idle shimmer if the analyser is unavailable (e.g. CORS).
 */
export default function AudioVisualizer({ className = '' }: { className?: string }) {
  const { getAnalyser, playing } = useAudio()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let analyser = getAnalyser()
    let data: Uint8Array | null = analyser ? new Uint8Array(analyser.frequencyBinCount) : null

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent-400').trim() || '#7589d8'
    const accent2 = getComputedStyle(document.documentElement).getPropertyValue('--color-accent-300').trim() || '#93a5e8'
    let t = 0

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      if (document.hidden) return
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx.clearRect(0, 0, w, h)

      // Lazily (re)acquire the analyser once playback has built the graph
      if (!analyser) {
        analyser = getAnalyser()
        if (analyser) data = new Uint8Array(analyser.frequencyBinCount)
      }

      const BARS = 64
      const gap = 2
      const barW = (w - gap * (BARS - 1)) / BARS
      const grad = ctx.createLinearGradient(0, h, 0, 0)
      grad.addColorStop(0, accent)
      grad.addColorStop(1, accent2)
      ctx.fillStyle = grad

      t += 0.05
      for (let i = 0; i < BARS; i++) {
        let v: number
        if (analyser && data) {
          // Sample low-mid band (more musical energy) and apply a gentle curve
          const idx = Math.floor((i / BARS) * (data.length * 0.7))
          analyser.getByteFrequencyData(data)
          v = (data[idx] / 255) ** 1.4
        } else {
          // Idle shimmer when no analyser / not playing
          v = REDUCED || !playing ? 0.04 : (Math.sin(t + i * 0.35) * 0.5 + 0.5) * 0.18 + 0.03
        }
        const barH = Math.max(2, v * h)
        const x = i * (barW + gap)
        const y = h - barH
        const r = Math.min(barW / 2, 3)
        ctx.beginPath()
        ctx.roundRect(x, y, barW, barH, r)
        ctx.fill()
      }
    }
    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [getAnalyser, playing])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}
