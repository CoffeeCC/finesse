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
