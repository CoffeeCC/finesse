import { decode } from 'blurhash'

const dataUrlCache = new Map<string, string>()
const colorCache = new Map<string, [number, number, number]>()

/** Decode a blurhash into a small data-URL (cached). Returns null on bad hashes. */
export function blurhashToDataURL(hash: string | undefined, w = 32, h = 48): string | null {
  if (!hash) return null
  const cached = dataUrlCache.get(hash)
  if (cached) return cached
  try {
    const pixels = decode(hash, w, h)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(w, h)
    img.data.set(pixels)
    ctx.putImageData(img, 0, 0)
    const url = canvas.toDataURL()
    dataUrlCache.set(hash, url)
    return url
  } catch {
    return null
  }
}

/** Average color of a blurhash — used for per-title accent theming. */
export function blurhashAverageColor(hash: string | undefined): [number, number, number] | null {
  if (!hash) return null
  const cached = colorCache.get(hash)
  if (cached) return cached
  try {
    const px = decode(hash, 4, 4)
    let r = 0
    let g = 0
    let b = 0
    const n = px.length / 4
    for (let i = 0; i < px.length; i += 4) {
      r += px[i]
      g += px[i + 1]
      b += px[i + 2]
    }
    const avg: [number, number, number] = [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
    colorCache.set(hash, avg)
    return avg
  } catch {
    return null
  }
}

/** First Primary blurhash on an item, if any. */
export function primaryBlurhash(item: {
  ImageBlurHashes?: Record<string, Record<string, string>>
}): string | undefined {
  const primary = item.ImageBlurHashes?.Primary
  return primary ? Object.values(primary)[0] : undefined
}

export function backdropBlurhash(item: {
  ImageBlurHashes?: Record<string, Record<string, string>>
}): string | undefined {
  const bd = item.ImageBlurHashes?.Backdrop
  return bd ? Object.values(bd)[0] : undefined
}

/** A few distinct, vivid colours from a blurhash (most colourful first) — the
 *  lyric-video visualizer paints with the album's own palette. */
export function blurhashPalette(hash: string | undefined, n = 3): [number, number, number][] {
  if (!hash) return []
  let px: Uint8ClampedArray
  try {
    px = decode(hash, 6, 6)
  } catch {
    return []
  }
  const cands: { h: number; s: number; score: number }[] = []
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255
    const g = px[i + 1] / 255
    const b = px[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    const l = (max + min) / 2
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    let h = 0
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    cands.push({ h: (h * 60 + 360) % 360, s, score: s * (0.4 + l) })
  }
  cands.sort((a, b) => b.score - a.score)
  const picked: { h: number; s: number }[] = []
  for (const c of cands) {
    if (picked.every((p) => Math.min(Math.abs(p.h - c.h), 360 - Math.abs(p.h - c.h)) > 28)) picked.push(c)
    if (picked.length === n) break
  }
  // Near-greyscale art: fan out around the dominant hue instead.
  while (picked.length < n) picked.push({ h: ((picked[0]?.h ?? 230) + 40 * picked.length) % 360, s: 0.5 })
  return picked.map(({ h, s }) => hsl(h, Math.max(0.55, Math.min(0.85, s)), 0.6))
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (k0: number) => {
    const k = (k0 + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}
