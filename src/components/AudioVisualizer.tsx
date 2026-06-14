import { useEffect, useRef } from 'react'
import { useAudio } from '../audio/AudioPlayerContext'
import type { VisualizerStyle } from '../lib/settings'

const REDUCED =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
}

/**
 * Music visualizer with several styles, driven by the player's Web Audio
 * analyser. Designed to fill its container (use as a background layer).
 * Falls back to a calm idle motion if the analyser is unavailable (CORS).
 */
export default function AudioVisualizer({
  variant,
  className = '',
}: {
  variant: VisualizerStyle
  className?: string
}) {
  const { getAnalyser, playing } = useAudio()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const particlesRef = useRef<Particle[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let analyser = getAnalyser()
    let freq: Uint8Array | null = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    let time: Uint8Array | null = analyser ? new Uint8Array(analyser.fftSize) : null

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const css = getComputedStyle(document.documentElement)
    const accent = css.getPropertyValue('--color-accent-400').trim() || '#7589d8'
    const accent2 = css.getPropertyValue('--color-accent-300').trim() || '#93a5e8'
    let t = 0

    const refresh = () => {
      if (!analyser) {
        analyser = getAnalyser()
        if (analyser) {
          freq = new Uint8Array(analyser.frequencyBinCount)
          time = new Uint8Array(analyser.fftSize)
        }
      }
      if (analyser && freq && time) {
        analyser.getByteFrequencyData(freq)
        analyser.getByteTimeDomainData(time)
        return true
      }
      return false
    }
    const bass = () => (freq ? (freq[1] + freq[2] + freq[3] + freq[4]) / 4 / 255 : 0)

    const drawBars = (w: number, h: number, live: boolean) => {
      const BARS = 72
      const gap = 2
      const bw = (w - gap * (BARS - 1)) / BARS
      const grad = ctx.createLinearGradient(0, h, 0, 0)
      grad.addColorStop(0, accent)
      grad.addColorStop(1, accent2)
      ctx.fillStyle = grad
      for (let i = 0; i < BARS; i++) {
        let v: number
        if (live && freq) {
          const idx = Math.floor((i / BARS) * (freq.length * 0.7))
          v = (freq[idx] / 255) ** 1.4
        } else {
          v = REDUCED || !playing ? 0.03 : (Math.sin(t + i * 0.35) * 0.5 + 0.5) * 0.16 + 0.02
        }
        const bh = Math.max(2, v * h)
        const x = i * (bw + gap)
        ctx.beginPath()
        ctx.roundRect(x, h - bh, bw, bh, Math.min(bw / 2, 3))
        ctx.fill()
      }
    }

    const drawWaveform = (w: number, h: number, live: boolean) => {
      ctx.lineWidth = 2.5
      ctx.strokeStyle = accent2
      ctx.shadowBlur = 16
      ctx.shadowColor = accent
      ctx.beginPath()
      const N = 256
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w
        let y: number
        if (live && time) {
          y = (time[Math.floor((i / N) * time.length)] / 128 - 1) * (h * 0.4) + h / 2
        } else {
          y = Math.sin(i * 0.05 + t) * (REDUCED || !playing ? 4 : 14) + h / 2
        }
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    const drawRadial = (w: number, h: number, live: boolean) => {
      const cx = w / 2
      const cy = h / 2
      const r0 = Math.min(w, h) * 0.16
      const BARS = 96
      ctx.save()
      ctx.translate(cx, cy)
      const pulse = live ? 1 + bass() * 0.25 : 1 + Math.sin(t) * 0.03
      for (let i = 0; i < BARS; i++) {
        const ang = (i / BARS) * Math.PI * 2
        let v: number
        if (live && freq) {
          v = (freq[Math.floor((i / BARS) * (freq.length * 0.6))] / 255) ** 1.5
        } else {
          v = REDUCED || !playing ? 0.04 : (Math.sin(t * 1.5 + i * 0.4) * 0.5 + 0.5) * 0.2 + 0.02
        }
        const len = r0 * 0.5 + v * Math.min(w, h) * 0.32
        const r1 = r0 * pulse
        ctx.strokeStyle = i % 2 ? accent : accent2
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1)
        ctx.lineTo(Math.cos(ang) * (r1 + len), Math.sin(ang) * (r1 + len))
        ctx.stroke()
      }
      ctx.restore()
    }

    const drawParticles = (w: number, h: number, live: boolean) => {
      const cx = w / 2
      const cy = h / 2
      const b = live ? bass() : (Math.sin(t) * 0.5 + 0.5) * 0.3
      // central bloom
      const r = Math.min(w, h) * (0.08 + b * 0.18)
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3)
      g.addColorStop(0, accent2)
      g.addColorStop(0.4, accent + '88')
      g.addColorStop(1, 'transparent')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, r * 3, 0, Math.PI * 2)
      ctx.fill()
      // emit on bass
      const ps = particlesRef.current
      if (live && b > 0.45 && ps.length < 220 && playing) {
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2
          const sp = 1 + b * 4
          ps.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 })
        }
      }
      ctx.fillStyle = accent2
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]
        p.x += p.vx
        p.y += p.vy
        p.life -= 0.012
        if (p.life <= 0) {
          ps.splice(i, 1)
          continue
        }
        ctx.globalAlpha = Math.max(0, p.life)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      if (document.hidden) return
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx.clearRect(0, 0, w, h)
      t += 0.05
      const live = refresh()
      switch (variant) {
        case 'waveform':
          drawWaveform(w, h, live)
          break
        case 'radial':
          drawRadial(w, h, live)
          break
        case 'particles':
          drawParticles(w, h, live)
          break
        default:
          drawBars(w, h, live)
      }
    }
    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [getAnalyser, playing, variant])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}
