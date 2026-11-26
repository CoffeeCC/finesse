import { useEffect, useRef } from 'react'
import { useAudio } from '../audio/AudioPlayerContext'
import { IS_TV } from '../lib/device'
import { reducedMotion } from '../lib/settings'

export type PixelScene = 'auto' | 'skyline' | 'cabin' | 'starship' | 'arcade' | 'rain' | 'lighthouse'

export const PIXEL_SCENES: { id: PixelScene; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'skyline', label: 'Neon Skyline' },
  { id: 'cabin', label: 'Lo-Fi Cabin' },
  { id: 'rain', label: 'Cyber Rain' },
  { id: 'starship', label: 'Starfighter' },
  { id: 'arcade', label: 'Arcade Stage' },
  { id: 'lighthouse', label: 'Lighthouse' },
]

const CONCRETE_SCENES: Exclude<PixelScene, 'auto'>[] = ['skyline', 'cabin', 'rain', 'starship', 'arcade', 'lighthouse']

// 4x4 Bayer matrix (0..15) for authentic 16-bit ordered dithering.
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

// Crisp 8x8 pixel bitmaps for sprites (notes, starfighter, cat, hearts).
const SPRITE_NOTE_1 = [
  '....111.',
  '....1..1',
  '....1...',
  '....1...',
  '..111...',
  '.1111...',
  '.111....',
  '........',
]
const SPRITE_NOTE_2 = [
  '..111111',
  '..1....1',
  '..111111',
  '..1....1',
  '.11...11',
  '111..111',
  '.1....1.',
  '........',
]
const SPRITE_SHIP = [
  '......11......',
  '.....1221.....',
  '....123321....',
  '...12233221...',
  '..1122222211..',
  '.141122221141.',
  '14412211221441',
  '111.11..11.111',
  '....55..55....',
]
const SPRITE_CAT = [
  '.1...1..',
  '111111..',
  '121121..',
  '111111..',
  '.111111.',
  '.1111111',
  '.11111.1',
  '.1...1..',
]
const SPRITE_UMBRELLA = [
  '...11111...',
  '.112222211.',
  '12222222221',
  '.....3.....',
  '....343....',
  '....444....',
  '....444....',
  '....4.4....',
  '....4.4....',
]
const SPRITE_BOAT = [
  '......1....',
  '......11...',
  '......111..',
  '......1111.',
  '....1.11111',
  '...11.1....',
  '..222222222',
  '...2222222.',
]

interface Raindrop {
  x: number
  y: number
  vy: number
  len: number
}

interface Ripple {
  x: number
  y: number
  r: number
  life: number
}

interface Ember {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  color: number
}

interface ShootingStar {
  x: number
  y: number
  vx: number
  vy: number
  life: number
}

interface Laser {
  x: number
  y: number
  vy: number
  life: number
}

interface FloatingNote {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  kind: 0 | 1
  color: string
}

interface Building {
  x: number
  w: number
  baseH: number
  band: number
  layer: 0 | 1
  antenna: boolean
  billboard: boolean
  seed: number
}

interface Star {
  x: number
  y: number
  z: number
  twinkle: number
  bright: boolean
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123
  return x - Math.floor(x)
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim()
  if (clean.length === 3) {
    return [
      parseInt(clean[0]! + clean[0]!, 16) || 117,
      parseInt(clean[1]! + clean[1]!, 16) || 137,
      parseInt(clean[2]! + clean[2]!, 16) || 216,
    ]
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16) || 117,
      parseInt(clean.slice(2, 4), 16) || 137,
      parseInt(clean.slice(4, 6), 16) || 216,
    ]
  }
  return [117, 137, 216]
}

function rgbStr(r: number, g: number, b: number, a = 1): string {
  const rr = Math.max(0, Math.min(255, Math.round(r)))
  const gg = Math.max(0, Math.min(255, Math.round(g)))
  const bb = Math.max(0, Math.min(255, Math.round(b)))
  return a >= 1 ? `rgb(${rr},${gg},${bb})` : `rgba(${rr},${gg},${bb},${a.toFixed(2)})`
}

function mixRgb(a: [number, number, number], b: [number, number, number], f: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, f))
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function drawBitmap(
  ctx: CanvasRenderingContext2D,
  sprite: string[],
  ox: number,
  oy: number,
  palette: Record<string, string>,
  scale = 1,
) {
  const rx = Math.round(ox)
  const ry = Math.round(oy)
  for (let y = 0; y < sprite.length; y++) {
    const row = sprite[y]!
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!
      if (ch === '.') continue
      const col = palette[ch]
      if (!col) continue
      ctx.fillStyle = col
      ctx.fillRect(rx + x * scale, ry + y * scale, scale, scale)
    }
  }
}

/** Bayer 4x4 ordered-dithered vertical sky gradient between discrete palette stops. */
function drawDitherSky(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  stops: [number, number, number][],
) {
  const segs = stops.length - 1
  if (segs <= 0) return
  for (let y = 0; y < h; y++) {
    const pos = (y / Math.max(1, h - 1)) * segs
    const idx = Math.min(segs - 1, Math.floor(pos))
    const frac = pos - idx
    const c0 = stops[idx]!
    const c1 = stops[idx + 1]!
    // Pure band optimization when not in dither transition
    if (frac < 0.06) {
      ctx.fillStyle = rgbStr(c0[0], c0[1], c0[2])
      ctx.fillRect(0, y, w, 1)
      continue
    }
    if (frac > 0.94) {
      ctx.fillStyle = rgbStr(c1[0], c1[1], c1[2])
      ctx.fillRect(0, y, w, 1)
      continue
    }
    const rowB = BAYER4[y & 3]!
    const col0 = rgbStr(c0[0], c0[1], c0[2])
    const col1 = rgbStr(c1[0], c1[1], c1[2])
    ctx.fillStyle = col0
    ctx.fillRect(0, y, w, 1)
    ctx.fillStyle = col1
    const thresh = Math.floor(frac * 16)
    for (let m = 0; m < 4; m++) {
      if (rowB[m]! < thresh) {
        for (let x = m; x < w; x += 4) ctx.fillRect(x, y, 1, 1)
      }
    }
  }
}

/**
 * Handcrafted 16-bit Pixel Art Audio Visualizer.
 * Renders on a crisp virtual pixel buffer (320×180, or 240×135 on TV) with
 * nearest-neighbor scaling, Bayer 4×4 ordered dithering, transient beat
 * detection, and 4 rich audio-reactive worlds.
 */
export default function PixelVisualizer({
  scene = 'auto',
  moodRgb = null,
  className = '',
}: {
  scene?: PixelScene
  moodRgb?: [number, number, number] | null
  className?: string
}) {
  const { getAnalyser, playing, current } = useAudio()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<PixelScene>(scene)
  sceneRef.current = scene
  const trackIdRef = useRef<string>(current?.Id ?? '')
  trackIdRef.current = current?.Id ?? ''
  const moodRef = useRef<[number, number, number] | null>(moodRgb)
  moodRef.current = moodRgb

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const mainCtx = canvas.getContext('2d')
    if (!mainCtx) return

    const PW = IS_TV ? 240 : 320
    const PH = IS_TV ? 135 : 180
    const buf = document.createElement('canvas')
    buf.width = PW
    buf.height = PH
    const ctx = buf.getContext('2d')!
    ctx.imageSmoothingEnabled = false

    const css = getComputedStyle(document.documentElement)
    const accentHex = css.getPropertyValue('--color-accent-400').trim() || '#7589d8'
    const accent2Hex = css.getPropertyValue('--color-accent-300').trim() || '#a7b8ff'
    const baseAccentRgb = hexToRgb(accentHex)
    const baseAccent2Rgb = hexToRgb(accent2Hex)
    const getAccent = (): [number, number, number] => moodRef.current ?? baseAccentRgb
    const getAccent2 = (): [number, number, number] =>
      moodRef.current ? mixRgb(moodRef.current, [255, 255, 255], 0.35) : baseAccent2Rgb
    let accentRgb: [number, number, number] = getAccent()
    let accent2Rgb: [number, number, number] = getAccent2()

    let analyser = getAnalyser()
    let freq: Uint8Array | null = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    let time: Uint8Array | null = analyser ? new Uint8Array(analyser.fftSize) : null

    // Persistent scene geometry & particles
    const stars: Star[] = Array.from({ length: 78 }, (_, i) => ({
      x: Math.floor(hash(i * 3.1) * PW),
      y: Math.floor(hash(i * 7.3) * (PH * 0.62)),
      z: 0.25 + hash(i * 11.7) * 0.85,
      twinkle: hash(i * 19.3) * Math.PI * 2,
      bright: i % 5 === 0,
    }))

    const buildings: Building[] = []
    // Far skyline
    let bx = -4
    let bi = 0
    while (bx < PW + 8) {
      const w = 10 + Math.floor(hash(bi * 5.7) * 14)
      buildings.push({
        x: bx,
        w,
        baseH: 22 + Math.floor(hash(bi * 13.1) * 38),
        band: bi % 24,
        layer: 0,
        antenna: hash(bi * 29.3) > 0.65,
        billboard: false,
        seed: bi * 17,
      })
      bx += w - 1
      bi++
    }
    // Near skyline
    bx = 0
    let ni = 100
    while (bx < PW + 6) {
      const w = 12 + Math.floor(hash(ni * 4.3) * 18)
      buildings.push({
        x: bx,
        w,
        baseH: 14 + Math.floor(hash(ni * 9.7) * 28),
        band: (ni - 100) % 20,
        layer: 1,
        antenna: hash(ni * 19.1) > 0.72,
        billboard: hash(ni * 31.7) > 0.72 && w >= 15,
        seed: ni * 23,
      })
      bx += w + Math.floor(hash(ni * 2.1) * 3)
      ni++
    }

    const embers: Ember[] = []
    const shootingStars: ShootingStar[] = []
    const lasers: Laser[] = []
    const notes: FloatingNote[] = []
    const raindrops: Raindrop[] = Array.from({ length: 64 }, (_, i) => ({
      x: hash(i * 5.3) * PW,
      y: hash(i * 11.1) * PH,
      vy: 2.2 + hash(i * 17.7) * 2.1,
      len: 4 + Math.floor(hash(i * 23.9) * 5),
    }))
    const ripples: Ripple[] = []
    const peakHold = new Float32Array(24)
    const smoothBands = new Float32Array(32)

    let t = 0
    let beatEnergyAvg = 0.22
    let beatPulse = 0
    let beatCooldown = 0
    let trainX = -60
    let walkerX = -20
    let shipX = PW / 2
    let shipVx = 0
    let reelAngle = 0
    let raf = 0

    const resize = () => {
      const w = Math.max(1, canvas.clientWidth)
      const h = Math.max(1, canvas.clientHeight)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      mainCtx.imageSmoothingEnabled = false
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const pickActiveScene = (): Exclude<PixelScene, 'auto'> => {
      if (sceneRef.current !== 'auto') return sceneRef.current
      // Deterministic per-track scene pick, gently shifting every ~45s if on same track.
      const id = trackIdRef.current
      let h = 0
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
      const slot = Math.floor(t / 2700)
      return CONCRETE_SCENES[(h + slot) % CONCRETE_SCENES.length]!
    }

    const sampleAudio = () => {
      if (!analyser) {
        analyser = getAnalyser()
        if (analyser) {
          freq = new Uint8Array(analyser.frequencyBinCount)
          time = new Uint8Array(analyser.fftSize)
        }
      }
      const live = Boolean(analyser && freq && time)
      if (live && analyser && freq && time) {
        analyser.getByteFrequencyData(freq)
        analyser.getByteTimeDomainData(time)
      }

      const reduced = reducedMotion()
      let bass = 0
      let mids = 0
      let highs = 0

      for (let i = 0; i < 32; i++) {
        let raw = 0
        if (live && freq) {
          const bin = Math.min(freq.length - 1, Math.floor((i / 32) ** 1.25 * (freq.length * 0.65)))
          raw = (freq[bin]! / 255) ** 1.25
        } else if (playing && !reduced) {
          // Graceful synthetic rhythm fallback when CORS blocks Web Audio
          const beatWave = Math.pow(Math.max(0, Math.sin(t * 0.11)), 6)
          raw =
            (i < 6 ? beatWave * 0.58 : 0) +
            (Math.sin(t * 0.06 + i * 0.42) * 0.5 + 0.5) * 0.28 +
            (Math.cos(t * 0.09 - i * 0.25) * 0.5 + 0.5) * 0.14
        } else {
          raw = 0.04 + (Math.sin(t * 0.02 + i * 0.5) * 0.5 + 0.5) * 0.04
        }
        smoothBands[i] = smoothBands[i]! * 0.72 + raw * 0.28
        if (i < 5) bass += smoothBands[i]!
        else if (i < 18) mids += smoothBands[i]!
        else highs += smoothBands[i]!
      }
      bass /= 5
      mids /= 13
      highs /= 14

      // Rolling beat transient detector
      beatEnergyAvg = beatEnergyAvg * 0.96 + bass * 0.04
      beatCooldown = Math.max(0, beatCooldown - 1)
      let hit = false
      if (playing && !reduced && bass > Math.max(0.28, beatEnergyAvg * 1.28) && beatCooldown === 0) {
        hit = true
        beatPulse = 1
        beatCooldown = 14
      } else {
        beatPulse *= 0.86
      }

      // Peak hold decay
      for (let i = 0; i < peakHold.length; i++) {
        const v = smoothBands[Math.min(31, i)]!
        if (v >= peakHold[i]!) peakHold[i] = v
        else peakHold[i] = Math.max(0, peakHold[i]! - 0.012)
      }

      return { live, bass, mids, highs, hit, reduced }
    }

    // ==================== SCENE 1: NEON SKYLINE ====================
    const drawSkyline = (bass: number, mids: number, highs: number, hit: boolean, reduced: boolean) => {
      const horizon = Math.floor(PH * 0.67)
      const skyTop: [number, number, number] = [9, 10, 26]
      const skyMid = mixRgb([26, 16, 54], accentRgb, 0.32)
      const skyGlow = mixRgb([124, 38, 102], accent2Rgb, 0.42 + bass * 0.2)
      drawDitherSky(ctx, PW, horizon, [skyTop, skyMid, skyGlow])

      // Twinkling pixel stars
      for (const s of stars) {
        if (s.y > horizon - 18) continue
        const tw = Math.sin(t * 0.05 + s.twinkle) * 0.5 + 0.5
        if (tw < 0.28 && !s.bright) continue
        ctx.fillStyle = s.bright && tw > 0.72 ? '#ffffff' : rgbStr(210, 222, 255, 0.5 + tw * 0.45)
        ctx.fillRect(s.x, s.y, 1, 1)
        if (s.bright && highs > 0.38 && tw > 0.82) {
          ctx.fillRect(s.x - 1, s.y, 3, 1)
          ctx.fillRect(s.x, s.y - 1, 1, 3)
        }
      }

      // Shooting stars on treble/beat spikes
      if ((hit || highs > 0.52) && shootingStars.length < 3 && Math.random() < 0.28 && !reduced) {
        shootingStars.push({
          x: Math.floor(Math.random() * PW * 0.8),
          y: 6 + Math.floor(Math.random() * (horizon * 0.35)),
          vx: 2.2 + Math.random() * 1.4,
          vy: 0.9 + Math.random() * 0.6,
          life: 1,
        })
      }
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const st = shootingStars[i]!
        st.x += st.vx
        st.y += st.vy
        st.life -= 0.045
        if (st.life <= 0) {
          shootingStars.splice(i, 1)
          continue
        }
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = rgbStr(255, 240, 210, st.life * (1 - k / 6))
          ctx.fillRect(Math.round(st.x - st.vx * k * 0.7), Math.round(st.y - st.vy * k * 0.7), 1, 1)
        }
      }

      // Sliced retro pixel sun pulsing with bass
      const sunCx = Math.floor(PW * 0.5)
      const sunCy = horizon - 20
      const sunR = Math.round(24 + bass * 8 + beatPulse * 3)
      // Dithered aura rings
      for (let r = sunR + 10; r >= sunR + 3; r -= 4) {
        ctx.fillStyle = rgbStr(accent2Rgb[0], accent2Rgb[1], accent2Rgb[2], 0.14)
        for (let dy = -r; dy <= r; dy++) {
          const y = sunCy + dy
          if (y >= horizon || y < 0) continue
          if ((y & 1) === 0) continue
          const dx = Math.floor(Math.sqrt(r * r - dy * dy))
          ctx.fillRect(sunCx - dx, y, dx * 2, 1)
        }
      }
      for (let dy = -sunR; dy <= sunR; dy++) {
        const y = sunCy + dy
        if (y >= horizon || y < 0) continue
        // Classic horizontal synthwave cutouts on the lower half
        if (dy > 2 && ((dy + Math.floor(t * 0.15)) % 5 === 0 || (dy > sunR * 0.55 && (dy + Math.floor(t * 0.15)) % 5 === 1))) {
          continue
        }
        const frac = (dy + sunR) / (sunR * 2)
        const c = mixRgb([255, 232, 128], [255, 62, 148], frac)
        const dx = Math.floor(Math.sqrt(sunR * sunR - dy * dy))
        ctx.fillStyle = rgbStr(c[0], c[1], c[2])
        ctx.fillRect(sunCx - dx, y, dx * 2, 1)
      }

      // Far skyline (equalizer towers)
      for (const b of buildings) {
        if (b.layer !== 0) continue
        const eq = smoothBands[b.band % 28]!
        const bh = Math.round(b.baseH + eq * 34)
        const top = horizon - bh
        ctx.fillStyle = '#141129'
        ctx.fillRect(b.x, top, b.w, bh)
        ctx.fillStyle = rgbStr(accentRgb[0], accentRgb[1], accentRgb[2], 0.25 + eq * 0.4)
        ctx.fillRect(b.x, top, b.w, 1)
        if (b.antenna) {
          ctx.fillStyle = '#252144'
          ctx.fillRect(b.x + Math.floor(b.w / 2), top - 6, 1, 6)
          if (beatPulse > 0.35 || Math.sin(t * 0.08 + b.seed) > 0.3) {
            ctx.fillStyle = '#ff4b72'
            ctx.fillRect(b.x + Math.floor(b.w / 2), top - 7, 1, 1)
          }
        }
      }

      // Near skyline with audio-reactive lit windows & neon signs
      for (const b of buildings) {
        if (b.layer !== 1) continue
        const eq = smoothBands[b.band % 24]!
        const bh = Math.round(b.baseH + eq * 24)
        const top = horizon - bh
        ctx.fillStyle = '#0a0a18'
        ctx.fillRect(b.x, top, b.w, bh)
        // Rim highlight
        ctx.fillStyle = rgbStr(accent2Rgb[0], accent2Rgb[1], accent2Rgb[2], 0.4 + eq * 0.5)
        ctx.fillRect(b.x, top, b.w, 1)
        // Pixel windows grid
        const cols = Math.floor((b.w - 3) / 3)
        const rows = Math.floor((bh - 4) / 4)
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const rnd = hash(b.seed + r * 31 + c * 17)
            const lit = rnd > 0.56 - eq * 0.36
            if (!lit) continue
            const warm = rnd > 0.82
            ctx.fillStyle = warm
              ? '#ffd87a'
              : rnd > 0.68
                ? rgbStr(accent2Rgb[0], accent2Rgb[1], accent2Rgb[2], 0.9)
                : '#58e4ff'
            ctx.fillRect(b.x + 2 + c * 3, top + 3 + r * 4, 2, 2)
          }
        }
        // Rooftop neon billboard
        if (b.billboard) {
          const glow = highs > 0.25 || beatPulse > 0.3
          ctx.fillStyle = glow ? '#ff46a2' : '#7a2559'
          ctx.fillRect(b.x + 2, top - 4, b.w - 4, 3)
          ctx.fillStyle = glow ? '#fff2fb' : '#c06a99'
          ctx.fillRect(b.x + 3, top - 3, Math.max(2, b.w - 6), 1)
        }
      }

      // Little rooftop pixel cat bobbing its head to the beat on one building
      const catBuilding = buildings.find((b) => b.layer === 1 && b.x > PW * 0.18 && b.x < PW * 0.36)
      if (catBuilding) {
        const eq = smoothBands[catBuilding.band % 24]!
        const catTop = horizon - Math.round(catBuilding.baseH + eq * 24) - 8 + (beatPulse > 0.45 ? 1 : 0)
        drawBitmap(ctx, SPRITE_CAT, catBuilding.x + 3, catTop, { '1': '#090912', '2': '#ffd87a' })
      }

      // Elevated viaduct + gliding pixel monorail train
      const railY = horizon - 8
      ctx.fillStyle = '#17152e'
      ctx.fillRect(0, railY + 3, PW, 2)
      for (let px = 12; px < PW; px += 28) {
        ctx.fillStyle = '#110f22'
        ctx.fillRect(px, railY + 5, 3, horizon - (railY + 5))
      }
      if (!reduced) {
        trainX += (playing ? 1.1 + mids * 2.2 : 0.25)
        if (trainX > PW + 50) trainX = -70
      }
      const tx = Math.round(trainX)
      // Motion light trail
      for (let k = 1; k <= 12; k++) {
        ctx.fillStyle = rgbStr(88, 228, 255, 0.32 * (1 - k / 12))
        ctx.fillRect(tx - k * 2, railY + 1, 2, 1)
      }
      ctx.fillStyle = '#e7ecff'
      ctx.fillRect(tx, railY, 34, 3)
      ctx.fillStyle = '#ff46a2'
      ctx.fillRect(tx, railY + 1, 2, 1)
      ctx.fillStyle = '#58e4ff'
      for (let w = 4; w < 30; w += 5) ctx.fillRect(tx + w, railY + 1, 3, 1)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(tx + 33, railY + 1, 2, 1)

      // Shimmering water reflection below the horizon (mirrors the skyline + sun!)
      const waterH = PH - horizon
      ctx.fillStyle = '#070714'
      ctx.fillRect(0, horizon, PW, waterH)
      for (let dy = 0; dy < waterH; dy++) {
        const srcY = Math.max(0, horizon - 1 - Math.floor(dy * 1.15))
        const wave = reduced ? 0 : Math.round(Math.sin(dy * 0.38 + t * 0.14) * (1.2 + bass * 2.2))
        ctx.globalAlpha = Math.max(0.18, 0.62 - (dy / waterH) * 0.42)
        ctx.drawImage(buf, 0, srcY, PW, 1, wave, horizon + dy, PW, 1)
      }
      ctx.globalAlpha = 1
      // Crisp neon horizon edge + pixel water glints
      ctx.fillStyle = rgbStr(accent2Rgb[0], accent2Rgb[1], accent2Rgb[2], 0.55 + beatPulse * 0.35)
      ctx.fillRect(0, horizon, PW, 1)
      for (let i = 0; i < 18; i++) {
        const wy = horizon + 3 + Math.floor(hash(i * 17.3) * (waterH - 5))
        const wx = Math.floor((hash(i * 41.1) * PW + t * (0.15 + (i % 3) * 0.08)) % PW)
        const len = 3 + Math.floor(highs * 7)
        ctx.fillStyle = i % 2 === 0 ? rgbStr(255, 195, 140, 0.45) : rgbStr(88, 228, 255, 0.4)
        ctx.fillRect(wx, wy, len, 1)
      }
    }

    // ==================== SCENE 2: COZY LO-FI CABIN ====================
    const drawCabin = (bass: number, mids: number, highs: number, hit: boolean, reduced: boolean) => {
      const groundY = Math.floor(PH * 0.72)
      const skyTop: [number, number, number] = [6, 11, 24]
      const skyMid: [number, number, number] = [14, 24, 48]
      const skyBot = mixRgb([26, 40, 68], accentRgb, 0.22)
      drawDitherSky(ctx, PW, groundY, [skyTop, skyMid, skyBot])

      // Stars + pixel crescent moon
      for (const s of stars) {
        if (s.y > groundY - 22) continue
        const tw = Math.sin(t * 0.04 + s.twinkle) * 0.5 + 0.5
        ctx.fillStyle = rgbStr(225, 238, 255, 0.35 + tw * 0.6)
        ctx.fillRect(s.x, s.y, 1, 1)
      }
      const mx = Math.floor(PW * 0.8)
      const my = 26
      for (let dy = -9; dy <= 9; dy++) {
        for (let dx = -9; dx <= 9; dx++) {
          if (dx * dx + dy * dy <= 81 && (dx - 4) * (dx - 4) + (dy + 2) * (dy + 2) > 58) {
            ctx.fillStyle = '#fff5cc'
            ctx.fillRect(mx + dx, my + dy, 1, 1)
          }
        }
      }

      // Audio-reactive Pixel Aurora Borealis ribbon driven by live waveform + mids!
      for (let x = 0; x < PW; x += 2) {
        const waveSample = time ? (time[Math.floor((x / PW) * time.length)]! / 128 - 1) : Math.sin(x * 0.05 + t * 0.06) * 0.35
        const baseY = 26 + Math.sin(x * 0.03 + t * 0.025) * 10 + waveSample * (12 + bass * 14)
        const ribbonH = Math.round(12 + smoothBands[Math.floor((x / PW) * 28)]! * 26)
        for (let k = 0; k < ribbonH; k++) {
          const frac = k / Math.max(1, ribbonH)
          if ((x + k) % 2 === 1 && frac > 0.55) continue // dither fade
          const c = mixRgb([72, 245, 195], accent2Rgb, frac)
          ctx.fillStyle = rgbStr(c[0], c[1], c[2], (1 - frac) * (0.45 + mids * 0.35))
          ctx.fillRect(x, Math.round(baseY - k * 0.65), 2, 1)
        }
      }

      // Distant mountain range pulsing gently with spectrum
      for (let x = 0; x < PW; x++) {
        const b = smoothBands[Math.floor((x / PW) * 24)]!
        const peak =
          Math.sin(x * 0.028) * 14 +
          Math.cos(x * 0.071) * 7 +
          18 +
          b * 9
        const y = Math.round(groundY - peak)
        ctx.fillStyle = '#121a30'
        ctx.fillRect(x, y, 1, groundY - y)
        if (peak > 22) {
          ctx.fillStyle = rgbStr(160, 210, 235, 0.25)
          ctx.fillRect(x, y, 1, 2)
        }
      }

      // Pixel pine tree line
      for (let tx = 4; tx < PW; tx += 11) {
        if (tx > PW * 0.33 && tx < PW * 0.72) continue // clearing for cabin & campfire
        const th = 16 + Math.floor(hash(tx * 13.7) * 18)
        const sway = reduced ? 0 : Math.round(Math.sin(t * 0.04 + tx) * mids * 1.5)
        ctx.fillStyle = '#0c1522'
        for (let row = 0; row < th; row++) {
          const half = Math.max(1, Math.floor(((row % 6) + row * 0.32) * 0.6))
          ctx.fillRect(tx - half + (row < th / 2 ? sway : 0), groundY - th + row, half * 2, 1)
        }
      }

      // Cozy pixel cabin on the left-center of the clearing
      const cabX = Math.floor(PW * 0.37)
      const cabY = groundY - 22
      // Chimney + rising pixel smoke puffs
      ctx.fillStyle = '#2e2226'
      ctx.fillRect(cabX + 26, cabY - 12, 5, 14)
      for (let s = 0; s < 5; s++) {
        const phase = (t * 0.025 + s * 0.2) % 1
        const sx = Math.round(cabX + 28 + Math.sin(phase * 5 + s) * 3 + phase * 6)
        const sy = Math.round(cabY - 14 - phase * 24)
        const sz = phase > 0.5 ? 4 : 3
        ctx.fillStyle = rgbStr(190, 205, 230, (1 - phase) * 0.42)
        ctx.fillRect(sx, sy, sz, sz)
      }
      // Roof
      ctx.fillStyle = '#3b242c'
      for (let r = 0; r < 11; r++) {
        ctx.fillRect(cabX - 4 + r, cabY - r, 42 - r * 2, 1)
      }
      // Cabin walls + glowing warm window pulsing with mids
      ctx.fillStyle = '#23171d'
      ctx.fillRect(cabX, cabY, 34, 22)
      const winGlow = 0.75 + mids * 0.25 + beatPulse * 0.15
      ctx.fillStyle = rgbStr(255, 198 * winGlow, 96)
      ctx.fillRect(cabX + 6, cabY + 6, 9, 8)
      ctx.fillRect(cabX + 20, cabY + 6, 8, 8)
      ctx.fillStyle = '#23171d'
      ctx.fillRect(cabX + 10, cabY + 6, 1, 8)
      ctx.fillRect(cabX + 6, cabY + 10, 9, 1)
      ctx.fillRect(cabX + 24, cabY + 6, 1, 8)
      ctx.fillRect(cabX + 20, cabY + 10, 8, 1)

      // Pixel ground + warm campfire glow pool
      ctx.fillStyle = '#090e18'
      ctx.fillRect(0, groundY, PW, PH - groundY)

      const fireX = Math.floor(PW * 0.58)
      const fireY = groundY + 4
      // Warm dithered ground glow around fire
      const glowR = Math.round(28 + bass * 18 + beatPulse * 6)
      for (let dy = -6; dy <= 14; dy++) {
        for (let dx = -glowR; dx <= glowR; dx += 2) {
          const d = Math.sqrt((dx * dx) / (glowR * glowR) + (dy * dy) / 225)
          if (d < 1 && BAYER4[(fireY + dy) & 3]![(fireX + dx) & 3]! < (1 - d) * 14) {
            ctx.fillStyle = rgbStr(255, 128, 42, 0.26 * (1 - d))
            ctx.fillRect(fireX + dx, fireY + dy, 2, 1)
          }
        }
      }
      // Logs
      ctx.fillStyle = '#4a2b1c'
      ctx.fillRect(fireX - 7, fireY, 14, 3)
      ctx.fillStyle = '#2d1910'
      ctx.fillRect(fireX - 5, fireY + 2, 10, 2)

      // Live audio-reactive pixel campfire flames
      const flameH = Math.round(10 + bass * 16 + beatPulse * 5)
      for (let fy = 0; fy < flameH; fy++) {
        const frac = fy / Math.max(1, flameH)
        const half = Math.max(1, Math.round((1 - frac) * 6 + Math.sin(t * 0.32 + fy * 0.7) * 1.4))
        const sway = Math.round(Math.sin(t * 0.24 + fy * 0.45) * (1.2 + mids * 2))
        ctx.fillStyle = frac < 0.28 ? '#fff9cc' : frac < 0.6 ? '#ffb43b' : '#ee4c2c'
        ctx.fillRect(fireX - half + sway, fireY - fy - 1, half * 2, 1)
      }

      // Cozy listener silhouette + pixel cat nodding to the beat
      const bob = beatPulse > 0.45 ? 1 : 0
      ctx.fillStyle = '#141a2b'
      ctx.fillRect(fireX + 16, fireY - 9 + bob, 6, 6) // head
      ctx.fillRect(fireX + 14, fireY - 3, 10, 7) // hoodie body
      ctx.fillStyle = '#ff9d47'
      ctx.fillRect(fireX + 15, fireY - 7 + bob, 1, 3) // warm firelight rim on face
      drawBitmap(ctx, SPRITE_CAT, fireX - 20, fireY - 5 + bob, { '1': '#141a2b', '2': '#ffd479' })

      // Rising campfire embers + treble fireflies
      if ((hit || Math.random() < 0.35 + bass * 0.4) && embers.length < 48 && !reduced) {
        const count = hit ? 5 : 1
        for (let k = 0; k < count; k++) {
          embers.push({
            x: fireX + (Math.random() - 0.5) * 8,
            y: fireY - 4,
            vx: (Math.random() - 0.5) * 0.45,
            vy: -0.45 - Math.random() * (0.7 + bass),
            life: 1,
            maxLife: 45 + Math.random() * 45,
            color: Math.random() > 0.4 ? 0 : 1,
          })
        }
      }
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i]!
        e.x += e.vx + Math.sin(t * 0.08 + i) * 0.14
        e.y += e.vy
        e.life -= 1 / e.maxLife
        if (e.life <= 0) {
          embers.splice(i, 1)
          continue
        }
        ctx.fillStyle = e.color === 0 ? rgbStr(255, 224, 110, e.life) : rgbStr(255, 98, 52, e.life)
        ctx.fillRect(Math.round(e.x), Math.round(e.y), 1, 1)
      }

      // Treble fireflies bobbing in the dark pine trees
      for (let f = 0; f < 10; f++) {
        const fx = Math.round((f < 5 ? 8 + f * 18 : PW - 14 - (f - 5) * 16) + Math.sin(t * 0.04 + f * 2.1) * 6)
        const fy = Math.round(groundY - 6 - hash(f * 23) * 20 + Math.cos(t * 0.05 + f) * 4)
        const glow = (Math.sin(t * 0.1 + f * 3) * 0.5 + 0.5) * (0.4 + highs * 0.8)
        if (glow > 0.35) {
          ctx.fillStyle = rgbStr(182, 255, 138, Math.min(1, glow))
          ctx.fillRect(fx, fy, 1, 1)
        }
      }

      // Calm lake strip at the bottom reflecting campfire + aurora
      const lakeY = groundY + 18
      if (lakeY < PH) {
        const lakeH = PH - lakeY
        ctx.fillStyle = '#060a14'
        ctx.fillRect(0, lakeY, PW, lakeH)
        for (let dy = 0; dy < lakeH; dy++) {
          const srcY = Math.max(0, groundY - 2 - dy * 2)
          const wave = reduced ? 0 : Math.round(Math.sin(dy * 0.45 + t * 0.12) * 1.5)
          ctx.globalAlpha = 0.35
          ctx.drawImage(buf, 0, srcY, PW, 1, wave, lakeY + dy, PW, 1)
        }
        ctx.globalAlpha = 1
      }
    }

    // ==================== SCENE 3: STARSHIP HYPERDRIVE ====================
    const drawStarship = (bass: number, mids: number, highs: number, hit: boolean, reduced: boolean) => {
      const horizon = Math.floor(PH * 0.62)
      const neb1: [number, number, number] = [6, 5, 18]
      const neb2 = mixRgb([28, 12, 52], accentRgb, 0.35)
      const neb3 = mixRgb([58, 18, 74], accent2Rgb, 0.28 + bass * 0.2)
      drawDitherSky(ctx, PW, horizon, [neb1, neb2, neb3])

      // Parallax hyperdrive starfield
      const warp = playing && !reduced ? 0.5 + bass * 4.2 + beatPulse * 2 : 0.15
      for (const s of stars) {
        if (!reduced) {
          s.y += s.z * warp * 0.45
          if (s.y >= horizon) {
            s.y = 1
            s.x = Math.floor(Math.random() * PW)
          }
        }
        const streak = Math.max(1, Math.min(8, Math.round(warp * s.z * 1.4)))
        ctx.fillStyle = s.bright ? '#ffffff' : rgbStr(190, 215, 255, 0.75)
        ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, streak)
      }

      // Ringed pixel planet whose ring ripples with live waveform!
      const px = Math.floor(PW * 0.74)
      const py = Math.floor(PH * 0.25)
      const pr = 17
      for (let dy = -pr; dy <= pr; dy++) {
        const dx = Math.floor(Math.sqrt(pr * pr - dy * dy))
        const shade = (dy + pr) / (pr * 2)
        const c = mixRgb(accent2Rgb, [36, 18, 66], shade)
        ctx.fillStyle = rgbStr(c[0], c[1], c[2])
        ctx.fillRect(px - dx, py + dy, dx * 2, 1)
      }
      // Waveform planet ring
      for (let rx = -32; rx <= 32; rx++) {
        const norm = (rx + 32) / 64
        const wave = time ? (time[Math.floor(norm * time.length)]! / 128 - 1) * 4 : Math.sin(norm * 10 + t * 0.1) * 1.5
        const ry = Math.round(py + rx * 0.22 + Math.sin(norm * Math.PI) * 5 + wave)
        ctx.fillStyle = rx % 2 === 0 ? '#58f0ff' : '#ff6ac1'
        ctx.fillRect(px + rx, ry, 1, 1)
      }

      // Horizon spectrum mountain wave
      for (let i = 0; i < 32; i++) {
        const v = smoothBands[i]!
        const bw = Math.ceil(PW / 32)
        const bh = Math.round(v * 34)
        const x = i * bw
        ctx.fillStyle = rgbStr(accentRgb[0], accentRgb[1], accentRgb[2], 0.45)
        ctx.fillRect(x, horizon - bh, bw - 1, bh)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(x, horizon - bh, bw - 1, 1)
      }

      // 3D perspective synthwave pixel grid floor scrolling toward camera
      ctx.fillStyle = '#090617'
      ctx.fillRect(0, horizon, PW, PH - horizon)
      const gridH = PH - horizon
      // Horizontal perspective lines
      const speed = playing && !reduced ? 0.032 + bass * 0.05 : 0.005
      for (let g = 0; g < 9; g++) {
        const p = ((g / 9) + (t * speed)) % 1
        const y = horizon + Math.floor(p * p * gridH)
        ctx.fillStyle = rgbStr(accent2Rgb[0], accent2Rgb[1], accent2Rgb[2], 0.25 + p * 0.65)
        ctx.fillRect(0, y, PW, 1)
      }
      // Converging vertical perspective lines
      const cx = PW / 2
      for (let k = -9; k <= 9; k++) {
        const xTop = cx + k * 14
        const xBot = cx + k * 54
        ctx.fillStyle = rgbStr(accentRgb[0], accentRgb[1], accentRgb[2], 0.45)
        for (let y = horizon; y < PH; y += 2) {
          const f = (y - horizon) / Math.max(1, gridH)
          ctx.fillRect(Math.round(xTop + (xBot - xTop) * f), y, 1, 2)
        }
      }
      ctx.fillStyle = '#ff5ec4'
      ctx.fillRect(0, horizon, PW, 1)

      // Starfighter banking smoothly with audio mids + firing neon pulses on hits!
      const targetX = PW / 2 + Math.sin(t * 0.035) * (PW * 0.22) + (mids - 0.25) * 38
      shipVx = shipVx * 0.85 + (targetX - shipX) * 0.04
      shipX = Math.max(24, Math.min(PW - 24, shipX + (reduced ? 0 : shipVx)))
      const shipY = Math.round(horizon + gridH * 0.42 - bass * 8 - beatPulse * 4)

      if ((hit || highs > 0.5) && lasers.length < 10 && !reduced) {
        lasers.push({ x: shipX - 6, y: shipY - 2, vy: -4.2, life: 1 })
        lasers.push({ x: shipX + 6, y: shipY - 2, vy: -4.2, life: 1 })
      }
      for (let i = lasers.length - 1; i >= 0; i--) {
        const l = lasers[i]!
        l.y += l.vy
        l.life -= 0.04
        if (l.life <= 0 || l.y < horizon - 30) {
          lasers.splice(i, 1)
          continue
        }
        ctx.fillStyle = '#58f0ff'
        ctx.fillRect(Math.round(l.x), Math.round(l.y), 1, 5)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(Math.round(l.x), Math.round(l.y), 1, 2)
      }

      // Thruster plasma flame
      const thrust = Math.round(4 + bass * 11 + (t % 2) * 2)
      ctx.fillStyle = '#ff6a3d'
      ctx.fillRect(Math.round(shipX) - 3, shipY + 14, 2, thrust)
      ctx.fillRect(Math.round(shipX) + 1, shipY + 14, 2, thrust)
      ctx.fillStyle = '#fff394'
      ctx.fillRect(Math.round(shipX) - 3, shipY + 14, 2, Math.max(2, Math.floor(thrust * 0.5)))
      ctx.fillRect(Math.round(shipX) + 1, shipY + 14, 2, Math.max(2, Math.floor(thrust * 0.5)))

      drawBitmap(
        ctx,
        SPRITE_SHIP,
        shipX - 14,
        shipY - 4,
        {
          '1': '#1f2340',
          '2': '#e6ecff',
          '3': '#58f0ff',
          '4': '#ff4b9c',
          '5': '#ffb84d',
        },
        2,
      )
    }

    // ==================== SCENE 4: ARCADE STAGE & CASSETTE DECK ====================
    const drawArcade = (bass: number, mids: number, highs: number, hit: boolean, reduced: boolean) => {
      const stageY = Math.floor(PH * 0.78)
      drawDitherSky(ctx, PW, stageY, [
        [10, 8, 22],
        mixRgb([24, 14, 46], accentRgb, 0.3),
        [14, 10, 26],
      ])

      // Sweeping stage spotlights
      for (let b = 0; b < 3; b++) {
        const originX = Math.floor(PW * (0.2 + b * 0.3))
        const sweep = Math.sin(t * 0.03 + b * 2.1) * (40 + mids * 30)
        const col = b === 1 ? accent2Rgb : b === 0 ? [88, 228, 255] : [255, 92, 178]
        for (let y = 0; y < stageY; y += 2) {
          const f = y / Math.max(1, stageY)
          const cx = originX + sweep * f
          const half = Math.round(2 + f * (14 + bass * 8))
          ctx.fillStyle = rgbStr(col[0]!, col[1]!, col[2]!, 0.09 + beatPulse * 0.05)
          ctx.fillRect(Math.round(cx - half), y, half * 2, 2)
        }
      }

      // Giant pixel retro cassette / equalizer boombox centerpiece
      const boxW = Math.floor(PW * 0.62)
      const boxH = Math.floor(PH * 0.44)
      const boxX = Math.floor((PW - boxW) / 2)
      const boxY = Math.floor(PH * 0.17) - Math.round(beatPulse * 2)

      // Outer chassis + highlight bezel
      ctx.fillStyle = '#1b1d33'
      ctx.fillRect(boxX, boxY, boxW, boxH)
      ctx.fillStyle = '#34395e'
      ctx.fillRect(boxX, boxY, boxW, 2)
      ctx.fillRect(boxX, boxY, 2, boxH)
      ctx.fillStyle = '#0d0e1a'
      ctx.fillRect(boxX, boxY + boxH - 2, boxW, 2)
      ctx.fillRect(boxX + boxW - 2, boxY, 2, boxH)

      // Left & right pixel woofer cones pulsing on bass
      const wooferR = Math.floor(boxH * 0.32)
      const leftWx = boxX + wooferR + 10
      const rightWx = boxX + boxW - wooferR - 10
      const wy = boxY + Math.floor(boxH * 0.54)
      const conePulse = Math.round(bass * 3 + beatPulse * 2)
      for (const wx of [leftWx, rightWx]) {
        for (let dy = -wooferR; dy <= wooferR; dy++) {
          const dx = Math.floor(Math.sqrt(wooferR * wooferR - dy * dy))
          ctx.fillStyle = '#0b0c16'
          ctx.fillRect(wx - dx, wy + dy, dx * 2, 1)
        }
        const innerR = Math.max(4, wooferR - 5 + conePulse)
        for (let dy = -innerR; dy <= innerR; dy++) {
          const dx = Math.floor(Math.sqrt(innerR * innerR - dy * dy))
          ctx.fillStyle = '#252947'
          ctx.fillRect(wx - dx, wy + dy, dx * 2, 1)
        }
        const capR = Math.max(2, Math.floor(wooferR * 0.34) + (beatPulse > 0.5 ? 1 : 0))
        ctx.fillStyle = rgbStr(accent2Rgb[0], accent2Rgb[1], accent2Rgb[2])
        ctx.fillRect(wx - capR, wy - capR, capR * 2, capR * 2)
      }

      // Center cassette window with spinning pixel tape reels + segmented LED spectrum!
      const midX = leftWx + wooferR + 8
      const midW = rightWx - wooferR - 8 - midX
      if (midW > 24) {
        // Cassette bay
        const deckH = Math.floor(boxH * 0.42)
        ctx.fillStyle = '#0b0c16'
        ctx.fillRect(midX, boxY + 8, midW, deckH)
        ctx.fillStyle = '#2e3357'
        ctx.fillRect(midX, boxY + 8, midW, 1)
        if (playing && !reduced) reelAngle += 0.14 + mids * 0.12
        const r1x = midX + Math.floor(midW * 0.3)
        const r2x = midX + Math.floor(midW * 0.7)
        const ry = boxY + 8 + Math.floor(deckH * 0.52)
        for (const rx of [r1x, r2x]) {
          ctx.fillStyle = '#dce4ff'
          ctx.fillRect(rx - 4, ry - 4, 9, 9)
          ctx.fillStyle = '#0b0c16'
          ctx.fillRect(rx - 2, ry - 2, 5, 5)
          // Spinning spokes
          const sx = Math.round(Math.cos(reelAngle) * 3)
          const sy = Math.round(Math.sin(reelAngle) * 3)
          ctx.fillStyle = '#ff5ec4'
          ctx.fillRect(rx + sx, ry + sy, 1, 1)
          ctx.fillRect(rx - sx, ry - sy, 1, 1)
        }
        // Tape ribbon between reels
        ctx.fillStyle = '#58e4ff'
        ctx.fillRect(r1x + 5, ry - 1, Math.max(2, r2x - r1x - 10), 2)

        // Segmented pixel LED EQ with peak-hold caps right below cassette bay
        const eqTop = boxY + 12 + deckH
        const eqH = boxY + boxH - 8 - eqTop
        const bars = Math.min(16, Math.max(8, Math.floor(midW / 5)))
        const bw = Math.max(2, Math.floor((midW - (bars - 1)) / bars))
        for (let i = 0; i < bars; i++) {
          const val = smoothBands[i * 2]!
          const segs = Math.max(1, Math.floor(eqH / 3))
          const lit = Math.round(val * segs)
          const peakSeg = Math.min(segs - 1, Math.round(peakHold[i]! * segs))
          const bx0 = midX + i * (bw + 1)
          for (let s = 0; s < segs; s++) {
            const sy = eqTop + eqH - (s + 1) * 3
            if (s < lit) {
              ctx.fillStyle = s > segs * 0.72 ? '#ff4b8b' : s > segs * 0.42 ? '#ffd25a' : '#52f29c'
              ctx.fillRect(bx0, sy, bw, 2)
            } else {
              ctx.fillStyle = '#17192c'
              ctx.fillRect(bx0, sy, bw, 2)
            }
          }
          // Bright white peak-hold pixel cap
          if (peakHold[i]! > 0.08) {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(bx0, eqTop + eqH - (peakSeg + 1) * 3, bw, 1)
          }
        }
      }

      // Floating pixel musical notes drifting out of the speakers on treble/beats!
      if ((hit || highs > 0.34) && notes.length < 18 && !reduced && Math.random() < 0.35) {
        const fromLeft = Math.random() > 0.5
        notes.push({
          x: (fromLeft ? leftWx : rightWx) + (Math.random() - 0.5) * 14,
          y: boxY - 2,
          vx: (Math.random() - 0.5) * 0.45,
          vy: -0.45 - Math.random() * 0.55,
          life: 1,
          kind: Math.random() > 0.5 ? 1 : 0,
          color: Math.random() > 0.5 ? '#58e4ff' : Math.random() > 0.5 ? '#ff6ac1' : '#ffe074',
        })
      }
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i]!
        n.x += n.vx + Math.sin(t * 0.08 + i) * 0.25
        n.y += n.vy
        n.life -= 0.015
        if (n.life <= 0) {
          notes.splice(i, 1)
          continue
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, n.life))
        drawBitmap(ctx, n.kind === 1 ? SPRITE_NOTE_2 : SPRITE_NOTE_1, n.x, n.y, { '1': n.color })
      }
      ctx.globalAlpha = 1

      // Pixel crowd silhouettes jumping on beats + waving glowing pixel sticks!
      ctx.fillStyle = '#070612'
      ctx.fillRect(0, stageY, PW, PH - stageY)
      const count = Math.floor(PW / 12)
      for (let i = 0; i < count; i++) {
        const cx = i * 12 + 4
        const phase = Math.sin(t * 0.14 + i * 1.7)
        const jump = playing && !reduced ? Math.round(Math.max(0, phase) * (2 + bass * 6) + beatPulse * 3) : 0
        const headY = stageY - 7 - jump
        ctx.fillStyle = '#0e0d1e'
        ctx.fillRect(cx, headY, 5, 5) // head
        ctx.fillRect(cx - 2, headY + 5, 9, PH - (headY + 5)) // shoulders/body
        // Raised glowstick arm on energetic beats
        if ((i + Math.floor(t / 30)) % 3 === 0) {
          const waveX = cx + 7 + Math.round(Math.sin(t * 0.16 + i) * 2)
          ctx.fillStyle = i % 2 === 0 ? '#58e4ff' : '#ff5ec4'
          ctx.fillRect(waveX, headY - 5, 1, 5)
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(waveX, headY - 6, 1, 2)
        }
      }
    }

    // ==================== SCENE 5: CYBER RAIN ALLEY ====================
    const drawCyberRain = (bass: number, mids: number, highs: number, hit: boolean, reduced: boolean) => {
      const streetY = Math.floor(PH * 0.72)
      drawDitherSky(ctx, PW, streetY, [
        [6, 7, 18],
        mixRgb([18, 13, 38], accentRgb, 0.28),
        mixRgb([38, 18, 56], accent2Rgb, 0.3),
      ])

      // Background megablock towers with distant equalizer beacons
      for (let i = 0; i < 12; i++) {
        const bx = i * Math.ceil(PW / 11) - 6
        const bw = Math.ceil(PW / 11) + 4
        const eq = smoothBands[(i * 2) % 28]!
        const bh = 38 + Math.floor(hash(i * 19.3) * 44) + Math.round(eq * 18)
        ctx.fillStyle = '#0e1022'
        ctx.fillRect(bx, streetY - bh, bw, bh)
        ctx.fillStyle = rgbStr(accentRgb[0], accentRgb[1], accentRgb[2], 0.2 + eq * 0.35)
        ctx.fillRect(bx + 2, streetY - bh + 3, bw - 4, 1)
      }

      // Left alley ramen/synth shop with warm glowing windows & swaying paper lanterns
      const shopX = Math.floor(PW * 0.08)
      const shopW = Math.floor(PW * 0.36)
      const shopH = 56
      const shopY = streetY - shopH
      ctx.fillStyle = '#151226'
      ctx.fillRect(shopX, shopY, shopW, shopH)
      // Awning stripes
      for (let ax = 0; ax < shopW + 6; ax += 4) {
        ctx.fillStyle = (ax / 4) % 2 === 0 ? '#d9386a' : '#261b33'
        ctx.fillRect(shopX - 3 + ax, shopY + 14, 4, 7)
      }
      // Warm interior glow pulsing with mids
      ctx.fillStyle = rgbStr(255, 178 + mids * 45, 92)
      ctx.fillRect(shopX + 6, shopY + 24, shopW - 12, 24)
      // Noren curtains over counter
      for (let n = 0; n < 4; n++) {
        const nx = shopX + 7 + n * Math.floor((shopW - 14) / 4)
        const nw = Math.floor((shopW - 18) / 4)
        ctx.fillStyle = '#241838'
        ctx.fillRect(nx, shopY + 24, nw, 8 + (beatPulse > 0.5 ? 1 : 0))
      }
      // Counter stools & glowing bowls
      ctx.fillStyle = '#3d2424'
      ctx.fillRect(shopX + 6, shopY + 42, shopW - 12, 6)
      // Hanging swaying paper lanterns
      for (let l = 0; l < 3; l++) {
        const lx = shopX + 10 + l * Math.floor((shopW - 20) / 2)
        const sway = reduced ? 0 : Math.round(Math.sin(t * 0.08 + l * 1.4) * (1 + bass * 2))
        ctx.fillStyle = '#1a1226'
        ctx.fillRect(lx, shopY + 21, 1, 3)
        ctx.fillStyle = '#ff5468'
        ctx.fillRect(lx - 2 + sway, shopY + 24, 5, 7)
        ctx.fillStyle = '#ffe596'
        ctx.fillRect(lx - 1 + sway, shopY + 26, 3, 3)
      }

      // Right-side cyber arcade tower with vertical neon pixel sign & live equalizer panel
      const rightX = Math.floor(PW * 0.58)
      const rightW = Math.floor(PW * 0.34)
      const rightH = 78
      const rightY = streetY - rightH
      ctx.fillStyle = '#101324'
      ctx.fillRect(rightX, rightY, rightW, rightH)
      // Flickering vertical neon sign on left edge of tower
      const signOn = !(highs > 0.65 && t % 5 === 0)
      ctx.fillStyle = '#090b16'
      ctx.fillRect(rightX - 11, rightY + 8, 9, 44)
      ctx.fillStyle = signOn ? '#58f0ff' : '#245869'
      ctx.fillRect(rightX - 10, rightY + 9, 7, 42)
      ctx.fillStyle = '#090b16'
      for (let sy = 0; sy < 5; sy++) {
        ctx.fillRect(rightX - 9, rightY + 12 + sy * 8, 5, 1)
        ctx.fillRect(rightX - 7, rightY + 11 + sy * 8, 1, 5)
      }
      // Giant wall holographic equalizer billboard
      const eqX = rightX + 6
      const eqY = rightY + 12
      const eqW = rightW - 12
      const eqH = 34
      ctx.fillStyle = '#070814'
      ctx.fillRect(eqX, eqY, eqW, eqH)
      const bars = 12
      const bw = Math.max(2, Math.floor((eqW - (bars - 1)) / bars))
      for (let i = 0; i < bars; i++) {
        const v = smoothBands[(i * 2) % 28]!
        const bh = Math.max(2, Math.round(v * (eqH - 4)))
        const bx = eqX + i * (bw + 1)
        ctx.fillStyle = i % 2 === 0 ? rgbStr(accent2Rgb[0], accent2Rgb[1], accent2Rgb[2]) : '#ff5ec4'
        ctx.fillRect(bx, eqY + eqH - 2 - bh, bw, bh)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(bx, eqY + eqH - 2 - bh, bw, 1)
      }
      // Arcade doorway glow
      ctx.fillStyle = rgbStr(accentRgb[0], accentRgb[1], accentRgb[2], 0.65 + beatPulse * 0.3)
      ctx.fillRect(rightX + 10, streetY - 22, 16, 22)

      // Steaming alley vent puffs rising between buildings
      const ventX = Math.floor(PW * 0.5)
      for (let p = 0; p < 6; p++) {
        const ph = (t * 0.025 + p * 0.16) % 1
        const px = Math.round(ventX + Math.sin(ph * 6 + p) * 4)
        const py = Math.round(streetY - 2 - ph * 34)
        ctx.fillStyle = rgbStr(180, 210, 245, (1 - ph) * (0.22 + bass * 0.2))
        ctx.fillRect(px, py, 4, 3)
      }

      // Lone pixel umbrella pedestrian walking across the alley
      if (!reduced) {
        walkerX += playing ? 0.35 + mids * 0.25 : 0.12
        if (walkerX > PW + 16) walkerX = -16
      }
      drawBitmap(ctx, SPRITE_UMBRELLA, walkerX, streetY - 9, {
        '1': '#ff4b9c',
        '2': '#ff8cc4',
        '3': '#dce4ff',
        '4': '#0c0d18',
      })

      // Wet reflective street surface mirroring neon signs & ramen glow!
      const roadH = PH - streetY
      ctx.fillStyle = '#080914'
      ctx.fillRect(0, streetY, PW, roadH)
      for (let dy = 0; dy < roadH; dy++) {
        const srcY = Math.max(0, streetY - 1 - Math.floor(dy * 1.25))
        const jitter = reduced ? 0 : Math.round(Math.sin(dy * 0.5 + t * 0.18) * (1 + bass * 1.6))
        ctx.globalAlpha = Math.max(0.18, 0.58 - (dy / roadH) * 0.4)
        ctx.drawImage(buf, 0, srcY, PW, 1, jitter, streetY + dy, PW, 1)
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = rgbStr(88, 240, 255, 0.35)
      ctx.fillRect(0, streetY, PW, 1)

      // Slanted pixel rain + puddle splash ripples
      const rainSpeed = playing && !reduced ? 1 + bass * 1.1 : 0.45
      for (const drop of raindrops) {
        if (!reduced) {
          drop.y += drop.vy * rainSpeed
          drop.x -= 0.7 * rainSpeed
          if (drop.y >= streetY + 4 + (drop.len * 3) % Math.max(8, roadH - 6)) {
            if (ripples.length < 22) {
              ripples.push({ x: drop.x, y: Math.min(PH - 3, drop.y), r: 1, life: 1 })
            }
            drop.y = -drop.len
            drop.x = Math.random() * (PW + 40)
          }
        }
        ctx.fillStyle = rgbStr(165, 220, 255, 0.42 + highs * 0.35)
        for (let k = 0; k < drop.len; k++) {
          ctx.fillRect(Math.round(drop.x + k * 0.25), Math.round(drop.y - k), 1, 1)
        }
      }
      if (hit && ripples.length < 28 && !reduced) {
        ripples.push({ x: Math.random() * PW, y: streetY + 4 + Math.random() * Math.max(4, roadH - 8), r: 1, life: 1 })
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]!
        rp.r += 0.28
        rp.life -= 0.045
        if (rp.life <= 0) {
          ripples.splice(i, 1)
          continue
        }
        const rx = Math.round(rp.x)
        const ry = Math.round(rp.y)
        const rr = Math.round(rp.r)
        ctx.fillStyle = rgbStr(150, 235, 255, rp.life * 0.65)
        ctx.fillRect(rx - rr, ry, rr * 2, 1)
      }
    }

    // ==================== SCENE 6: OCEAN LIGHTHOUSE TWILIGHT ====================
    const drawLighthouse = (bass: number, mids: number, highs: number, hit: boolean, reduced: boolean) => {
      const horizon = Math.floor(PH * 0.6)
      drawDitherSky(ctx, PW, horizon, [
        [14, 12, 38],
        mixRgb([64, 28, 78], accentRgb, 0.3),
        [196, 74, 102],
        [255, 168, 96],
      ])

      // Twinkling dusk stars high in the sky
      for (const s of stars) {
        if (s.y > horizon * 0.52) continue
        const tw = Math.sin(t * 0.045 + s.twinkle) * 0.5 + 0.5
        ctx.fillStyle = rgbStr(255, 244, 224, 0.3 + tw * 0.6)
        ctx.fillRect(s.x, s.y, 1, 1)
      }

      // Giant setting pixel sun/moon dipping into the ocean horizon
      const sx = Math.floor(PW * 0.38)
      const sy = horizon - 4
      const sr = Math.round(20 + bass * 6 + beatPulse * 2)
      for (let dy = -sr; dy <= sr; dy++) {
        const y = sy + dy
        if (y >= horizon || y < 0) continue
        const dx = Math.floor(Math.sqrt(sr * sr - dy * dy))
        const frac = (dy + sr) / (sr * 2)
        const c = mixRgb([255, 248, 178], [255, 112, 92], frac)
        ctx.fillStyle = rgbStr(c[0], c[1], c[2])
        ctx.fillRect(sx - dx, y, dx * 2, 1)
      }

      // Pixel seagulls gliding gently across the sunset sky
      for (let g = 0; g < 4; g++) {
        const gx = Math.round(((hash(g * 31) * PW + t * (0.28 + g * 0.06)) % (PW + 20)) - 10)
        const gy = Math.round(18 + g * 9 + Math.sin(t * 0.08 + g * 2) * 3 - highs * 4)
        const flap = Math.sin(t * 0.22 + g * 1.9) > 0 ? -1 : 1
        ctx.fillStyle = '#241432'
        ctx.fillRect(gx, gy, 1, 1)
        ctx.fillRect(gx - 2, gy + flap, 2, 1)
        ctx.fillRect(gx + 1, gy + flap, 2, 1)
      }

      // Distant audio-reactive horizon islands / spectrum silhouette
      for (let x = 0; x < PW; x += 2) {
        const b = smoothBands[Math.floor((x / PW) * 28)]!
        const ih = Math.round(3 + Math.sin(x * 0.04) * 3 + b * 12)
        ctx.fillStyle = '#241438'
        ctx.fillRect(x, horizon - ih, 2, ih)
      }

      // Rocky headland + Pixel Lighthouse on the right with sweeping rotating beam!
      const lhX = Math.floor(PW * 0.78)
      const lhBase = horizon + 3
      // Sweeping lighthouse light cone
      const beamPhase = Math.sin(t * 0.032)
      const beamLen = Math.round(Math.abs(beamPhase) * PW * 0.65)
      const beamDir = beamPhase >= 0 ? -1 : 1
      const lampY = lhBase - 35
      if (beamLen > 8) {
        for (let step = 2; step < beamLen; step += 2) {
          const f = step / beamLen
          const spread = Math.round(1 + f * (9 + beatPulse * 4))
          ctx.fillStyle = rgbStr(255, 246, 178, (1 - f) * (0.34 + beatPulse * 0.22))
          ctx.fillRect(lhX + beamDir * step, lampY - spread, 2, spread * 2)
        }
      }
      // Cliff rocks
      ctx.fillStyle = '#130e24'
      for (let rx = -24; rx < 34; rx++) {
        const ch = Math.max(2, Math.round(14 - Math.abs(rx - 4) * 0.45 + Math.sin(rx * 0.5) * 2))
        ctx.fillRect(lhX + rx, lhBase - ch + 6, 1, ch)
      }
      // Lighthouse striped tower
      for (let ty = 0; ty < 30; ty++) {
        const w = ty > 20 ? 6 : ty > 10 ? 8 : 10
        ctx.fillStyle = Math.floor(ty / 6) % 2 === 0 ? '#eef2ff' : '#d93d5a'
        ctx.fillRect(lhX - Math.floor(w / 2), lhBase - 6 - ty, w, 1)
      }
      // Lantern room + pulsing beacon
      ctx.fillStyle = '#1d1c33'
      ctx.fillRect(lhX - 4, lampY - 4, 8, 2)
      ctx.fillStyle = hit || beatPulse > 0.4 ? '#ffffff' : '#ffe888'
      ctx.fillRect(lhX - 3, lampY - 2, 6, 4)

      // 3-layer rolling pixel ocean waves + shimmering golden sun path
      const seaH = PH - horizon
      ctx.fillStyle = '#131636'
      ctx.fillRect(0, horizon, PW, seaH)
      for (let layer = 0; layer < 4; layer++) {
        const ly = horizon + 4 + layer * Math.floor(seaH / 4)
        const c = mixRgb([38, 32, 78], [10, 14, 34], layer / 3)
        ctx.fillStyle = rgbStr(c[0], c[1], c[2])
        for (let x = 0; x < PW; x += 2) {
          const b = smoothBands[(Math.floor((x / PW) * 20) + layer * 3) % 28]!
          const wy = Math.round(
            ly +
              Math.sin(x * (0.045 - layer * 0.006) + t * (0.06 + layer * 0.025)) * (2 + bass * 4) -
              b * 3,
          )
          ctx.fillRect(x, wy, 2, PH - wy)
          if (Math.sin(x * 0.11 + t * 0.1 + layer) > 0.72) {
            ctx.fillStyle = rgbStr(255, 200, 155, 0.35 + mids * 0.3)
            ctx.fillRect(x, wy, 2, 1)
            ctx.fillStyle = rgbStr(c[0], c[1], c[2])
          }
        }
      }
      // Shimmering sun reflection ladder on water
      for (let dy = 1; dy < seaH - 2; dy += 2) {
        const w = Math.max(4, Math.round((sr * 1.4) * (1 - dy / (seaH * 1.25)) + Math.sin(t * 0.14 + dy) * (2 + bass * 4)))
        const ox = Math.round(Math.sin(dy * 0.3 + t * 0.12) * 3)
        ctx.fillStyle = dy < seaH * 0.4 ? '#ffe48a' : rgbStr(255, 134, 102, 0.7)
        ctx.fillRect(sx - Math.floor(w / 2) + ox, horizon + dy, w, 1)
      }

      // Little pixel sailboat bobbing on the bass swell
      const boatX = Math.round(PW * 0.24 + Math.sin(t * 0.018) * 16)
      const boatY = Math.round(horizon + seaH * 0.34 + Math.sin(t * 0.09) * (1.5 + bass * 3))
      drawBitmap(ctx, SPRITE_BOAT, boatX, boatY - 8, { '1': '#fff3e2', '2': '#3a2234' })
    }

    const render = () => {
      raf = requestAnimationFrame(render)
      if (document.hidden) return
      t += 1

      // Smoothly harmonize palette toward the current song's cover color
      const targetA = getAccent()
      const targetA2 = getAccent2()
      accentRgb = mixRgb(accentRgb, targetA, 0.04)
      accent2Rgb = mixRgb(accent2Rgb, targetA2, 0.04)

      const { bass, mids, highs, hit, reduced } = sampleAudio()
      const active = pickActiveScene()

      ctx.clearRect(0, 0, PW, PH)
      if (active === 'cabin') drawCabin(bass, mids, highs, hit, reduced)
      else if (active === 'rain') drawCyberRain(bass, mids, highs, hit, reduced)
      else if (active === 'starship') drawStarship(bass, mids, highs, hit, reduced)
      else if (active === 'arcade') drawArcade(bass, mids, highs, hit, reduced)
      else if (active === 'lighthouse') drawLighthouse(bass, mids, highs, hit, reduced)
      else drawSkyline(bass, mids, highs, hit, reduced)

      // Subtle 1px beat micro-shake on heavy drops (disabled under reduced motion)
      const shakeY = !reduced && beatPulse > 0.72 ? (t % 2 === 0 ? -1 : 1) : 0

      // Blit low-res pixel buffer cleanly to full canvas with nearest-neighbor crispness
      const cw = canvas.width
      const ch = canvas.height
      mainCtx.imageSmoothingEnabled = false
      mainCtx.clearRect(0, 0, cw, ch)
      // Cover-fit preserving square pixels (no stretching!)
      const scale = Math.max(cw / PW, ch / PH)
      const dw = Math.ceil(PW * scale)
      const dh = Math.ceil(PH * scale)
      const dx = Math.floor((cw - dw) / 2)
      const dy = Math.floor((ch - dh) / 2) + Math.round(shakeY * scale * 0.4)
      mainCtx.drawImage(buf, 0, 0, PW, PH, dx, dy, dw, dh)

      // Subtle CRT phosphor scanlines for that crisp 16-bit finish
      if (!IS_TV) {
        mainCtx.fillStyle = 'rgba(0,0,0,0.12)'
        const step = Math.max(3, Math.round(scale))
        for (let y = 0; y < ch; y += step) {
          mainCtx.fillRect(0, y, cw, 1)
        }
      }
    }

    render()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [getAnalyser, playing])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ imageRendering: 'pixelated' }}
      aria-hidden
    />
  )
}
