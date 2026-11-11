import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { IS_TV } from '../lib/device'
import { getPrefs, reducedMotion } from '../lib/settings'

// Pixel folk: a strip of tiny people along the bottom of the app, living a small history of their
// own. Every launch is a different world (a new seed picks the land, what gets built where, and
// who's who). Two camps settle either side and grow up through three ages, a block at a time:
// huts, trees and campfires; then houses, stone towers and windmills; then factories, street lamps
// and radio masts. Once both have everything, the rivalry boils over: they march on each other
// and lob shots over the middle that knock blocks off each other's buildings. Then they make
// peace, build one rocket together, count down, and fly it off the top of the screen. A new
// world begins.
//
// As the screensaver (full), the world is the whole screen, and what they build with has to come
// from somewhere: a little pixel Finesse hangs in the sky (its name, a row of posters), and they
// take it apart block by block, each one falling to the ground to be carried off. When there's
// nothing left of it, it comes back.
//
// They wear the app's colours: one camp the accent, the other its opposite on the wheel, so
// changing the accent in Settings re-dresses them. They notice you: they scatter from a fast
// mouse, gather round a still one, and a click drops a star they run to. They hear Finesse: each
// tick and chime of the interface makes the nearest ones hop (higher notes, higher hops), and
// while music plays they bob in time.
//
// It's a tiny canvas (a third of the screen's width, 46 pixels tall) stretched with hard edges,
// behind the page's own content (cards and buttons pass in front of it), stepped 20 times a
// second, paused in a hidden tab, and it never takes a click from the app.
// Not on TVs, phones, the player, or with reduced motion; Settings → Appearance turns it off.

const SCALE = 3
const H = 46
const GROUND = H - 3
const STEP_MS = 50

type RGB = [number, number, number]
const css = (c: RGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as RGB

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Any CSS colour → RGB, by letting a canvas paint it. */
function parseColour(value: string, fallback: RGB): RGB {
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.fillStyle = `rgb(${fallback.join(',')})`
    g.fillStyle = value
    g.fillRect(0, 0, 1, 1)
    const d = g.getImageData(0, 0, 1, 1).data
    return [d[0]!, d[1]!, d[2]!]
  } catch {
    return fallback
  }
}

/** The colour opposite on the wheel, at a similar brightness. */
function opposite([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 510
  const d = (max - min) / 255
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = d === 0 ? 0 : max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  h = (h * 60 + 360 + 165) % 360
  const c = (1 - Math.abs(2 * l - 1)) * Math.max(0.55, s)
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)]
}

interface Cell {
  x: number
  y: number
  c: RGB
  /** Lit windows and lamps twinkle. */
  lit?: boolean
}
interface Plan {
  cells: Cell[]
  placed: number
  team: number
  kind: string
  /** Which age it belongs to (0 huts, 1 stone, 2 industry; 3 the rocket). */
  age: number
  x: number
  w: number
}
interface Folk {
  x: number
  y: number
  vy: number
  dir: number
  team: number
  /** idle, fetch (to the depot), carry (to the plan), flee, march, cheer, board */
  state: string
  target: number
  wait: number
  hop: number
  alive: boolean
  skin: RGB
}
interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  c: RGB
  g: number
}

const FONT: Record<string, string[]> = {
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
}
function hsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

/** Blueprints, bottom row first, so things rise from the ground. */
function blueprint(kind: string, x0: number, r: () => number, wall: RGB, trim: RGB, glow: RGB): Cell[] {
  const cells: Cell[] = []
  const put = (x: number, y: number, c: RGB, lit = false) => cells.push({ x: x0 + x, y: GROUND - 1 - y, c, lit })
  if (kind === 'house') {
    const w = 5 + Math.floor(r() * 4)
    const h = 3 + Math.floor(r() * 3)
    const door = 1 + Math.floor(r() * (w - 2))
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, y < 2 && x === door ? mix(wall, [0, 0, 0], 0.6) : y === h - 2 && x !== door && x > 0 && x < w - 1 && (x + door) % 2 === 0 ? glow : wall, y === h - 2 && x !== door && (x + door) % 2 === 0)
    for (let y = 0; y <= Math.ceil(w / 2); y++) for (let x = y - 1; x < w + 1 - y; x++) put(x, h + y, trim)
    if (r() < 0.6) for (let y = 0; y < 3; y++) put(w - 2, h + 1 + y, mix(wall, [0, 0, 0], 0.35))
  } else if (kind === 'tower') {
    const w = 3 + Math.floor(r() * 2)
    const h = 9 + Math.floor(r() * 10)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, y % 4 === 2 && x === 1 ? glow : mix(wall, [0, 0, 0], (x === 0 ? 0.18 : 0) + (y % 2 ? 0.06 : 0)), y % 4 === 2 && x === 1)
    for (let x = -1; x <= w; x++) put(x, h, trim)
    for (let x = -1; x <= w; x += 2) put(x, h + 1, trim)
    for (let y = 2; y < 6; y++) put(Math.floor(w / 2), h + y, mix(trim, [255, 255, 255], 0.3))
    for (let y = 4; y < 6; y++) for (let x = 1; x < 4; x++) put(Math.floor(w / 2) + x, h + y, glow)
  } else if (kind === 'windmill') {
    const h = 7 + Math.floor(r() * 3)
    for (let y = 0; y < h; y++) for (let x = (y > h / 2 ? 1 : 0); x < (y > h / 2 ? 3 : 4); x++) put(x, y, wall)
    for (let k = 1; k < 5; k++) {
      put(1 + k, h + k - 1, trim)
      put(1 - k, h + k - 1, trim)
      put(1 + k, h - k - 1, trim)
      put(1 - k, h - k - 1, trim)
    }
    put(1, h - 1, glow, true)
  } else if (kind === 'lamp') {
    const h = 4 + Math.floor(r() * 3)
    for (let y = 0; y < h; y++) put(0, y, mix(wall, [0, 0, 0], 0.4))
    put(-1, h, trim)
    put(1, h, trim)
    put(0, h, glow, true)
  } else if (kind === 'tree') {
    const h = 3 + Math.floor(r() * 3)
    const leaf = mix(trim, [40, 160, 90], 0.55)
    for (let y = 0; y < h; y++) put(0, y, [110, 78, 54])
    for (let y = 0; y < 4; y++) for (let x = -2 + (y > 2 ? 1 : 0); x <= 2 - (y > 2 ? 1 : 0); x++) if (!(y === 0 && Math.abs(x) === 2)) put(x, h + y, mix(leaf, [0, 0, 0], r() * 0.25))
  } else if (kind === 'hut') {
    const w = 3 + Math.floor(r() * 2)
    for (let y = 0; y < 2; y++) for (let x = 0; x < w; x++) put(x, y, y === 0 && x === 1 ? mix(wall, [0, 0, 0], 0.6) : mix(wall, [120, 84, 60], 0.5))
    for (let y = 0; y < 2; y++) for (let x = y - 1; x < w + 1 - y; x++) put(x, 2 + y, mix(trim, [150, 120, 70], 0.6))
  } else if (kind === 'fire') {
    put(-1, 0, [110, 78, 54])
    put(0, 0, [110, 78, 54])
    put(1, 0, [110, 78, 54])
    put(0, 1, [255, 150, 60], true)
    put(0, 2, [255, 214, 120], true)
  } else if (kind === 'factory') {
    const w = 7 + Math.floor(r() * 3)
    for (let y = 0; y < 4; y++) for (let x = 0; x < w; x++) put(x, y, y === 2 && x % 2 === 1 ? glow : mix(wall, [70, 74, 90], 0.5), y === 2 && x % 2 === 1)
    for (let x = 0; x < w; x += 3) {
      put(x, 4, trim)
      put(x + 1, 4, trim)
      put(x, 5, trim)
    }
    for (let y = 4; y < 10; y++) put(w - 2, y, mix(wall, [0, 0, 0], 0.4))
    put(w - 2, 10, glow, true)
  } else if (kind === 'antenna') {
    const h = 10 + Math.floor(r() * 6)
    for (let y = 0; y < h; y++) put(0, y, mix(wall, [200, 204, 214], 0.5))
    for (const y of [3, 6]) {
      put(-1, y, trim)
      put(1, y, trim)
    }
    put(-1, 0, trim)
    put(1, 0, trim)
    put(0, h, glow, true)
  } else if (kind === 'rocket') {
    const h = 13
    for (let y = 0; y < 4; y++) {
      put(-2, y, mix(trim, [0, 0, 0], 0.2))
      put(4, y, mix(trim, [0, 0, 0], 0.2))
    }
    for (let y = 1; y < h; y++) for (let x = 0; x < 3; x++) put(x, y, y === 8 && x === 1 ? glow : y % 5 === 0 ? trim : [226, 228, 236], y === 8 && x === 1)
    put(-1, 1, trim)
    put(3, 1, trim)
    put(-1, 2, trim)
    put(3, 2, trim)
    put(0, h, trim)
    put(1, h, trim)
    put(2, h, trim)
    put(1, h + 1, trim)
    put(1, h + 2, glow, true)
  }
  return cells.sort((a, b) => b.y - a.y || a.x - b.x)
}

export default function PixelFolk({ full = false }: { full?: boolean } = {}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const location = useLocation()
  const hiddenHere = !full && /^\/(play|games\/play|games\/stream|setup|login|invite)/.test(location.pathname)
  const [allowed] = useState(() => full || (!IS_TV && !reducedMotion() && getPrefs().pixelFolk !== false && typeof window !== 'undefined' && window.matchMedia('(min-width: 900px) and (hover: hover)').matches))
  // The screensaver draws them big: the same world, each pixel twice or three times the size.
  const scale = full ? Math.max(4, Math.min(9, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) / 150))) : SCALE
  const hiddenRef = useRef(hiddenHere)
  hiddenRef.current = hiddenHere

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !allowed) return
    const g = canvas.getContext('2d')
    if (!g) return
    const seed = (Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0
    const r = rng(seed)
    let W = 0
    // The screensaver's canvas is the whole screen: the same world along the bottom, sky above it.
    const HT = full ? Math.max(H + 40, Math.floor(window.innerHeight / scale)) : H
    const oy = HT - H
    /** The little pixel Finesse in the sky (screensaver), and blocks of it on their way down. */
    let sky: { x: number; y: number; c: RGB; there: boolean }[] = []
    let drops: { x: number; y: number; vy: number; c: RGB; landed: boolean }[] = []

    // The app's colours: one camp wears the accent, the other its opposite.
    let teams: RGB[] = [[117, 137, 216], [216, 160, 96]]
    const dress = () => {
      const accent = parseColour(getComputedStyle(document.documentElement).getPropertyValue('--color-accent-400').trim() || '#7589d8', [117, 137, 216])
      teams = [accent, opposite(accent)]
    }
    dress()
    const watchTheme = new MutationObserver(dress)
    watchTheme.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })

    let plans: Plan[] = []
    let folk: Folk[] = []
    let sparks: Spark[] = []
    let stars: { x: number; y: number; vy: number; landed: boolean }[] = []
    let tick = 0
    /** build (three ages) → war → peace → rocket → launch → rest → a new world. */
    let chapter: 'build' | 'rocket' | 'launch' | 'war' | 'peace' | 'rest' = 'build'
    let chapterAt = 0
    let age = 0
    let shots: { x: number; y: number; vx: number; vy: number; team: number }[] = []
    let progressAt = 0
    let rocket: { plan: Plan; y: number; vy: number } | null = null
    let music = false
    const mouse = { x: -99, y: -99, speed: 0, still: 0, near: false }

    const tint = (team: number, t: number): RGB => mix(teams[team] ?? teams[0]!, [18, 20, 30], t)
    const person = (x: number, team: number): Folk => ({ x, y: GROUND, vy: 0, dir: r() < 0.5 ? -1 : 1, team, state: 'idle', target: x, wait: Math.floor(r() * 60), hop: 0, alive: true, skin: mix([255, 222, 196], [120, 84, 60], r()) })

    const settle = () => {
      // New ground: a scatter of things to build, and the people to build them.
      plans = []
      sparks = []
      stars = []
      rocket = null
      shots = []
      drops = []
      age = 0
      progressAt = tick
      if (full && !sky.some((c) => c.there)) {
        // A new little Finesse to take apart: its name, then a shelf of posters.
        sky = []
        const word = 'FINESSE'
        const k = Math.max(1, Math.min(4, Math.floor((W * 0.6) / (word.length * 6))))
        const x0 = Math.round((W - word.length * 6 * k) / 2)
        const y0 = -oy + Math.round(oy * 0.16)
        ;[...word].forEach((ch, i) =>
          FONT[ch]!.forEach((row, ry) =>
            [...row].forEach((bit, rx) => {
              if (bit !== '1') return
              for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) sky.push({ x: x0 + (i * 6 + rx) * k + a, y: y0 + ry * k + b, c: mix([245, 243, 238], teams[0]!, (i * 6 + rx) / (word.length * 6)), there: true })
            }),
          ),
        )
        const tiles = Math.max(4, Math.min(9, Math.floor((W * 0.7) / (6 * k + 3))))
        const tw = 5 * k
        const th = 7 * k
        const tx0 = Math.round((W - tiles * (tw + 3)) / 2)
        const ty0 = y0 + 7 * k + Math.max(4, 2 * k)
        for (let t = 0; t < tiles; t++) {
          const hue = Math.floor(r() * 360)
          for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) sky.push({ x: tx0 + t * (tw + 3) + x, y: ty0 + y, c: mix(hsl(hue, 0.5, 0.42), hsl((hue + 40) % 360, 0.55, 0.16), (x + y) / (tw + th)), there: true })
        }
        if (tick > 0) for (let i = 0; i < 4; i++) setTimeout(() => firework(W * 0.2 + r() * W * 0.6), i * 300)
      }
      // Each camp gets its half of the land, and something from every age to grow into.
      const AGES = [['hut', 'fire', 'tree', 'hut'], ['house', 'tower', 'windmill', 'house'], ['factory', 'lamp', 'antenna', 'lamp']]
      const perTeam = Math.max(3, Math.min(8, Math.floor(W / 2 / 30)))
      const slot = (W / 2 - 8) / perTeam
      for (const team of [0, 1]) {
        // Shuffled, so old and new stand side by side instead of in rows by age.
        const order = Array.from({ length: perTeam }, (_, i) => i).sort(() => r() - 0.5)
        order.forEach((place, i) => {
          const a = i % 3
          const kind = AGES[a]![Math.floor(r() * AGES[a]!.length)]!
          const x = Math.round((team === 0 ? 6 : W / 2 + 4) + slot * place + 3 + r() * Math.max(1, slot - 14))
          const cells = blueprint(kind, x, r, tint(team, 0.45 + r() * 0.2), tint(team, 0.1), mix(teams[team]!, [255, 244, 200], 0.7))
          const xs = cells.map((c) => c.x)
          plans.push({ cells, placed: kind === 'tree' ? cells.length : 0, team, kind, age: a, x: Math.min(...xs), w: Math.max(...xs) - Math.min(...xs) + 1 })
        })
      }
      const n = Math.max(8, Math.min(26, Math.floor(W / 22)))
      folk = Array.from({ length: n }, (_, i) => person(i % 2 === 0 ? 4 + r() * 20 : W - 5 - r() * 20, i % 2))
      chapter = 'build'
      chapterAt = tick
    }

    const size = () => {
      const w = Math.max(120, Math.ceil(window.innerWidth / scale))
      if (w === W) return
      W = w
      canvas.width = W
      canvas.height = HT
      sky = []
      settle()
    }
    size()

    const burst = (x: number, y: number, c: RGB, n = 10, power = 1.2) => {
      for (let i = 0; i < n; i++) sparks.push({ x, y, vx: (r() - 0.5) * 2 * power, vy: -r() * 1.6 * power, life: 14 + r() * 16, c, g: 0.09 })
    }
    const firework = (x: number) => {
      const c = mix(teams[Math.floor(r() * 2)]!, [255, 255, 255], 0.35)
      const y = full ? -oy * 0.75 + r() * oy * 0.5 : 6 + r() * 14
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2
        sparks.push({ x, y, vx: Math.cos(a) * (0.5 + r() * 0.5), vy: Math.sin(a) * (0.5 + r() * 0.5), life: 18 + r() * 14, c, g: 0.02 })
      }
    }
    const open = (p: Plan) => p.placed < p.cells.length && p.age <= (chapter === 'rocket' ? 3 : age)
    const openPlan = (team: number) => plans.find((p) => p.team === team && open(p)) ?? plans.find(open)

    const step = () => {
      tick++
      const since = tick - chapterAt
      mouse.still = mouse.speed < 0.4 ? mouse.still + 1 : 0
      mouse.speed *= 0.8

      // ---- The story ----
      // Nothing placed for a long while (a site nobody can reach): the next block places itself.
      if ((chapter === 'build' || chapter === 'rocket') && tick - progressAt > 500) {
        const stuck = plans.find(open)
        if (stuck) stuck.placed++
        progressAt = tick
      }
      if (chapter === 'build' && !plans.some(open)) {
        firework(20 + r() * (W - 40))
        for (const f of folk) f.state = 'cheer'
        if (age < 2) {
          // A new age: there's more to build.
          age++
          chapterAt = tick
        } else {
          // Everything's built, and the neighbours' is nicer. They march.
          chapter = 'war'
          chapterAt = tick
          for (const f of folk) f.state = 'march'
        }
      } else if (chapter === 'rocket' && rocket && rocket.plan.placed >= rocket.plan.cells.length) {
        // Two of them climb aboard, the rest stand back and count down.
        const crew = folk.filter((f) => f.alive).sort((a, b) => Math.abs(a.x - rocket!.plan.x) - Math.abs(b.x - rocket!.plan.x))
        crew.slice(0, 2).forEach((f) => ((f.state = 'board'), (f.target = rocket!.plan.x + 3)))
        crew.slice(2).forEach((f) => ((f.state = 'cheer'), (f.target = f.x)))
        chapter = 'launch'
        chapterAt = tick
      } else if (chapter === 'launch' && rocket) {
        if (since > 70) {
          rocket.vy = Math.min(2.6, rocket.vy + 0.045)
          rocket.y += rocket.vy
          const bx = rocket.plan.x + 3
          for (let i = 0; i < 3; i++) sparks.push({ x: bx + (r() - 0.5) * 2, y: GROUND - rocket.y, vx: (r() - 0.5) * 0.7, vy: 0.4 + r(), life: 10 + r() * 14, c: r() < 0.5 ? [255, 214, 120] : [255, 140, 70], g: 0.01 })
          if (rocket.y > HT + 30) {
            plans = plans.filter((p) => p !== rocket!.plan)
            rocket = null
            for (let i = 0; i < 4; i++) setTimeout(() => firework(20 + r() * (W - 40)), i * 380)
            chapter = 'rest'
            chapterAt = tick
          }
        } else if (since % 20 === 0) burst(rocket.plan.x + 3, GROUND - 1, [220, 220, 230], 5, 0.6)
      } else if (chapter === 'war') {
        // Each camp's tallest things lob shots over the middle; a hit knocks blocks off.
        if (since % 34 === 0) {
          const team = (since / 34) % 2
          const from = plans.filter((p) => p.team === team && p.placed > 4 && (p.kind === 'tower' || p.kind === 'antenna' || p.kind === 'factory'))
          const at = plans.filter((p) => p.team !== team && p.placed > 3 && p.kind !== 'tree')
          if (from.length && at.length) {
            const a = from[Math.floor(r() * from.length)]!
            const b = at[Math.floor(r() * at.length)]!
            const sx = a.x + a.w / 2
            const dx = b.x + b.w / 2 - sx
            const flight = 46
            shots.push({ x: sx, y: GROUND - 12, vx: dx / flight, vy: -(0.5 * 0.1 * flight) + 12 / flight, team })
          }
        }
        const left = folk.filter((f) => f.alive && f.team === 0).length
        const right = folk.filter((f) => f.alive && f.team === 1).length
        if (left === 0 || right === 0 || since > 1300) {
          shots = []
          chapter = 'peace'
          chapterAt = tick
          for (const f of folk) {
            f.alive = true
            f.state = 'cheer'
            f.y = GROUND
          }
          firework(W / 2)
        }
      } else if (chapter === 'peace' && since > 160) {
        // Friends again: one rocket, built by everyone, in the middle.
        const x = Math.round(W / 2 + (r() - 0.5) * 20)
        const plan: Plan = { cells: blueprint('rocket', x, r, [226, 228, 236], teams[0]!, mix(teams[1]!, [255, 255, 255], 0.4)), placed: 0, team: 0, kind: 'rocket', age: 3, x: x - 2, w: 7 }
        plans.push(plan)
        rocket = { plan, y: 0, vy: 0 }
        for (const f of folk) f.state = 'idle'
        chapter = 'rocket'
        chapterAt = tick
        progressAt = tick
      } else if (chapter === 'rest' && since > 500) {
        settle()
      }

      // ---- The people ----
      for (const f of folk) {
        if (!f.alive) continue
        const near = Math.abs(f.x - mouse.x) < 14 && mouse.near
        if (near && mouse.speed > 2.2 && f.state !== 'board') {
          f.state = 'flee'
          f.dir = f.x < mouse.x ? -1 : 1
          f.wait = 22
        }
        if (f.y < GROUND || f.vy !== 0) {
          f.vy += 0.22
          f.y = Math.min(GROUND, f.y + f.vy)
          if (f.y >= GROUND) f.vy = 0
        }
        const hop = (power: number) => {
          if (f.y >= GROUND) f.vy = -power
        }
        const walk = (to: number, speed = 0.42) => {
          // Never past the edge of the world: a site out there would be walked toward for ever.
          to = Math.max(1, Math.min(W - 2, to))
          if (Math.abs(to - f.x) < 0.6) return true
          f.dir = to > f.x ? 1 : -1
          f.x += f.dir * speed
          return false
        }
        // Music: everyone not busy with their hands bobs in time.
        if (music && (f.state === 'idle' || f.state === 'cheer') && tick % 10 === 0) hop(0.9)

        if (f.state === 'flee') {
          f.x = Math.max(1, Math.min(W - 2, f.x + f.dir * 0.8))
          if (--f.wait <= 0) f.state = chapter === 'war' ? 'march' : 'idle'
        } else if (f.state === 'cheer') {
          if (tick % 14 === Math.floor(f.x) % 14) hop(1.4)
          if (chapter === 'build' || chapter === 'rocket') f.state = 'idle'
        } else if (f.state === 'board') {
          if (walk(f.target, 0.4)) f.alive = false
        } else if (f.state === 'march') {
          const foe = folk.find((o) => o.alive && o.team !== f.team && Math.abs(o.x - f.x) < 1.6)
          if (foe && chapter === 'war') {
            // A bop on the head: one of the two sits the rest of this one out.
            if (r() < 0.05) {
              const loser = r() < 0.5 ? f : foe
              loser.alive = false
              burst(loser.x, GROUND - 2, tint(loser.team, 0), 8, 0.8)
            } else if (tick % 6 === 0) hop(0.8)
          } else walk(f.team === 0 ? W - 4 : 3, 0.22 + (Math.floor(f.x) % 3) * 0.03)
          if (chapter !== 'war') f.state = 'idle'
        } else if (f.state === 'fetch') {
          if (walk(f.target)) {
            f.state = 'carry'
            const p = openPlan(f.team)
            f.target = p ? p.cells[Math.min(p.placed, p.cells.length - 1)]!.x : f.x
          }
        } else if (f.state === 'carry') {
          const p = openPlan(f.team)
          if (!p) f.state = 'idle'
          else if (walk(f.target)) {
            p.placed = Math.min(p.cells.length, p.placed + 1)
            progressAt = tick
            const cell = p.cells[p.placed - 1]!
            if (r() < 0.25) sparks.push({ x: cell.x, y: cell.y, vx: 0, vy: -0.2, life: 8, c: [255, 255, 255], g: 0 })
            f.state = 'idle'
            f.wait = 2 + Math.floor(r() * 10)
          }
        } else {
          // Idle: a star to run to, a still mouse to gather round, a block to fetch, or a wander.
          const star = stars.find((s) => s.landed && Math.abs(s.x - f.x) < 60)
          if (star) {
            if (walk(star.x, 0.5)) {
              stars = stars.filter((s) => s !== star)
              burst(star.x, GROUND - 2, [255, 236, 150], 14)
              hop(1.8)
            }
          } else if (mouse.near && mouse.still > 40 && Math.abs(f.x - mouse.x) < 40 && Math.abs(f.x - mouse.x) > 5) {
            walk(mouse.x + (f.x < mouse.x ? -4 : 4), 0.25)
          } else if (mouse.near && mouse.still > 40 && Math.abs(f.x - mouse.x) <= 5) {
            if (tick % 24 === Math.floor(f.x) % 24) hop(1.1)
          } else if (--f.wait <= 0) {
            const p = (chapter === 'build' || chapter === 'rocket') && openPlan(f.team)
            if (p) {
              f.state = 'fetch'
              // Blocks come from a pile beside the site (a long walk to the edge made building crawl).
              f.target = p.x + (r() < 0.5 ? -8 - r() * 6 : p.w + 8 + r() * 6)
              // The screensaver: the block comes off the little Finesse in the sky. The lowest one
              // left in some column lets go and falls; they walk to where it lands.
              const left = sky.filter((c) => c.there)
              if (left.length) {
                const col = left[Math.floor(r() * left.length)]!.x
                const cell = left.filter((c) => c.x === col).sort((a, b) => b.y - a.y)[0]!
                cell.there = false
                drops.push({ x: cell.x, y: cell.y, vy: 0, c: cell.c, landed: false })
                f.target = cell.x
              }
              if (p.kind === 'rocket' && f.team === 1 && Math.abs(f.x - p.x) > W / 3) f.target = p.x + p.w + 10
            } else {
              f.target = Math.max(2, Math.min(W - 3, f.x + (r() - 0.5) * 40))
              f.wait = 30 + Math.floor(r() * 90)
            }
          } else if (Math.abs(f.target - f.x) > 0.6) walk(f.target, 0.18)
        }
        f.x = Math.max(1, Math.min(W - 2, f.x))
      }

      for (const s of stars) {
        if (s.landed) continue
        s.vy += 0.12
        s.y += s.vy
        if (s.y >= GROUND - 1) {
          s.y = GROUND - 1
          s.landed = true
          burst(s.x, s.y, [255, 236, 150], 6, 0.6)
        }
      }
      for (const d of drops) {
        if (d.landed) continue
        d.vy = Math.min(2.2, d.vy + 0.08)
        d.y += d.vy
        if (d.y >= GROUND - 1) {
          d.y = GROUND - 1
          d.landed = true
        }
      }
      // A landed block is gone once someone's carrying one away from there (or after a while).
      drops = drops.filter((d) => !d.landed || !folk.some((f) => f.alive && f.state === 'carry' && Math.abs(f.x - d.x) < 3))
      if (drops.length > 80) drops = drops.slice(-80)
      shots = shots.filter((s) => {
        s.vy += 0.1
        s.x += s.vx
        s.y += s.vy
        if (tick % 2 === 0) sparks.push({ x: s.x, y: s.y, vx: 0, vy: 0, life: 6, c: mix(teams[s.team]!, [255, 255, 255], 0.5), g: 0 })
        if (s.y < GROUND - 1) return true
        const hit = plans.find((p) => p.team !== s.team && p.kind !== 'tree' && s.x >= p.x - 1 && s.x <= p.x + p.w)
        if (hit) hit.placed = Math.max(Math.ceil(hit.cells.length * 0.35), hit.placed - 4)
        burst(s.x, GROUND - 2, [255, 190, 110], hit ? 12 : 5, hit ? 1.1 : 0.6)
        return false
      })
      sparks = sparks.filter((s) => {
        s.vy += s.g
        s.x += s.vx
        s.y += s.vy
        return --s.life > 0 && s.y < H && s.y > -oy - 4
      })
    }

    const draw = () => {
      g.setTransform(1, 0, 0, 1, 0, oy)
      g.clearRect(0, -oy, W, HT)
      const px = (x: number, y: number, c: RGB, a = 1) => {
        g.fillStyle = css(c, a)
        g.fillRect(Math.round(x), Math.round(y), 1, 1)
      }
      for (const c of sky) if (c.there) px(c.x, c.y, c.c)
      for (const d of drops) px(d.x, d.y, d.c)
      // Ground: a soft line, each camp's half in its own colour.
      for (let x = 0; x < W; x++) {
        px(x, GROUND + 1, tint(x < W / 2 ? 0 : 1, 0.55), 0.55)
        px(x, GROUND + 2, tint(x < W / 2 ? 0 : 1, 0.8), 0.5)
      }
      for (const p of plans) {
        const lift = rocket && p === rocket.plan ? rocket.y : 0
        for (let i = 0; i < p.placed; i++) {
          const c = p.cells[i]!
          const twinkle = c.lit ? 0.75 + 0.25 * Math.sin(tick / 9 + c.x) : 1
          px(c.x, c.y - lift, c.c, twinkle)
        }
        if (p.kind === 'factory' && p.placed >= p.cells.length && tick % 9 === 0) sparks.push({ x: p.x + p.w - 2, y: GROUND - 12, vx: 0.05 + r() * 0.1, vy: -0.25, life: 26, c: [150, 154, 170], g: 0 })
        // The next block's place blinks, so you can see what they're working on.
        if (p.placed < p.cells.length && tick % 16 < 8) px(p.cells[p.placed]!.x, p.cells[p.placed]!.y, [255, 255, 255], 0.35)
      }
      for (const s of stars) {
        px(s.x, s.y, [255, 236, 150])
        if (tick % 8 < 4) {
          px(s.x - 1, s.y, [255, 236, 150], 0.5)
          px(s.x + 1, s.y, [255, 236, 150], 0.5)
          px(s.x, s.y - 1, [255, 236, 150], 0.5)
        }
      }
      for (const f of folk) {
        if (!f.alive) continue
        const moving = f.state !== 'idle' || Math.abs(f.target - f.x) > 0.6
        const stride = moving && Math.floor(tick / 3 + f.x) % 2 === 0
        px(f.x, f.y - 3, f.skin)
        px(f.x, f.y - 2, tint(f.team, 0))
        px(f.x, f.y - 1, tint(f.team, 0.25))
        if (stride) px(f.x + f.dir, f.y - 1, tint(f.team, 0.4))
        if (f.state === 'carry') px(f.x, f.y - 4, [236, 238, 244])
        if (f.state === 'cheer' && f.y < GROUND) {
          px(f.x - 1, f.y - 3, f.skin)
          px(f.x + 1, f.y - 3, f.skin)
        }
      }
      for (const s of shots) px(s.x, s.y, [255, 255, 255])
      for (const s of sparks) px(s.x, s.y, s.c, Math.min(1, s.life / 12))
      // The countdown, in dots over the rocket.
      if (chapter === 'launch' && rocket && tick - chapterAt <= 70) {
        const left = 3 - Math.floor((tick - chapterAt) / 24)
        for (let i = 0; i < left; i++) px(rocket.plan.x + 1 + i * 2, GROUND - 22, [255, 255, 255], 0.9)
      }
    }

    // ---- Noticing you, and hearing Finesse ----
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const b = canvas.getBoundingClientRect()
      const x = (e.clientX - b.left) / scale
      mouse.speed = Math.min(12, mouse.speed + Math.abs(x - mouse.x) * 0.5)
      mouse.x = x
      mouse.y = (e.clientY - b.top) / scale - oy
      mouse.near = full ? mouse.y > -20 : e.clientY > b.top - 30
    }
    const onDown = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect()
      if (full || hiddenRef.current || e.clientY < b.top - 10) return
      // Only on bare ground: a click on a button or a card is the app's, not theirs.
      if ((e.target as Element | null)?.closest?.('a,button,input,select,textarea,[role="button"],video')) return
      stars.push({ x: (e.clientX - b.left) / scale, y: Math.max(-oy, (e.clientY - b.top) / scale - oy - 6), vy: 0, landed: false })
    }
    const onBlip = (e: Event) => {
      const freq = Number((e as CustomEvent).detail) || 800
      const power = 0.9 + Math.min(1.4, Math.max(0, Math.log2(freq / 300)) * 0.45)
      const centre = mouse.near ? mouse.x : r() * W
      folk
        .filter((f) => f.alive && f.y >= GROUND)
        .sort((a, b) => Math.abs(a.x - centre) - Math.abs(b.x - centre))
        .slice(0, 4)
        .forEach((f, i) => setTimeout(() => f.y >= GROUND && (f.vy = -power), i * 45))
    }
    const onAudio = () => {
      music = [...document.querySelectorAll('audio')].some((a) => !a.paused && !a.ended)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('finesse:blip', onBlip)
    window.addEventListener('resize', size)
    document.addEventListener('playing', onAudio, true)
    document.addEventListener('pause', onAudio, true)
    document.addEventListener('ended', onAudio, true)

    // For the impatient (and for checking the endings): localStorage finesse.folkSpeed = 2…40.
    let speed = 1
    try {
      speed = Math.max(1, Math.min(40, Math.round(Number(localStorage.getItem('finesse.folkSpeed')) || 1)))
    } catch {
      /* no storage */
    }
    let raf = 0
    let last = 0
    let owed = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      // The strip rests while the screensaver's own world is up.
      if (document.hidden || hiddenRef.current || (!full && document.querySelector('.pixel-folk-full'))) {
        last = now
        return
      }
      owed = Math.min(200, owed + (now - (last || now)))
      last = now
      if (owed < STEP_MS) return
      while (owed >= STEP_MS) {
        for (let i = 0; i < speed; i++) step()
        owed -= STEP_MS
      }
      draw()
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      watchTheme.disconnect()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('finesse:blip', onBlip)
      window.removeEventListener('resize', size)
      document.removeEventListener('playing', onAudio, true)
      document.removeEventListener('pause', onAudio, true)
      document.removeEventListener('ended', onAudio, true)
    }
  }, [allowed, scale])

  if (!allowed) return null
  return <canvas ref={ref} aria-hidden className={full ? 'pixel-folk pixel-folk-full' : 'pixel-folk'} style={{ height: full ? '100%' : H * scale, display: hiddenHere ? 'none' : undefined, ...(full ? { zIndex: 1, opacity: 1 } : {}) }} />
}
