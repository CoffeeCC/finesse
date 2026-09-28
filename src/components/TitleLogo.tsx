import { useEffect, useState, type ReactNode } from 'react'

// Title logos from artwork sites aren't always usable as-is: some are solid
// black (invisible on our dark heroes), some sit in a corner of a huge empty
// canvas (a speck on screen). Each logo is measured once on a tiny canvas:
// dark ones are shown white — how streaming apps render monochrome wordmarks —
// and near-empty ones give way to the text title. If the image can't be read
// (cross-origin on the TV, say), the logo is shown as it is.

type Tone = 'light' | 'dark' | 'bad'
const KEY = 'finesse.logoTones'
const tones = new Map<string, Tone>() // logo URL (minus auth) → tone
try {
  for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Tone>)) tones.set(k, v)
} catch {
  /* private mode */
}

const keyOf = (src: string) => src.replace(/([?&])(api_?key|ApiKey)=[^&]*/g, '$1')

function remember() {
  try {
    const odd = [...tones].filter(([, v]) => v !== 'light').slice(-300)
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(odd)))
  } catch {
    /* full or private */
  }
}

function measure(src: string): Promise<Tone> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const w = 96
        const h = Math.max(1, Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * w))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) return resolve('light')
        ctx.drawImage(img, 0, 0, w, h)
        const d = ctx.getImageData(0, 0, w, h).data
        let sum = 0
        let n = 0
        let x0 = w
        let x1 = -1
        let y0 = h
        let y1 = -1
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3]! < 128) continue
          const p = i / 4
          const x = p % w
          const y = (p - x) / w
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
          sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!
          n++
        }
        // A real logo spans most of its (trimmed) canvas.
        const span = n ? Math.max((x1 - x0 + 1) / w, (y1 - y0 + 1) / h) : 0
        if (span < 0.4) return resolve('bad')
        resolve(sum / n < 56 ? 'dark' : 'light')
      } catch {
        resolve('light') // tainted canvas: leave the logo alone
      }
    }
    img.onerror = () => resolve('light')
    img.src = src
  })
}

export default function TitleLogo({ src, alt, className = '', fallback }: { src: string; alt: string; className?: string; fallback: ReactNode }) {
  const key = keyOf(src)
  const [tone, setTone] = useState<Tone | undefined>(() => tones.get(key))

  useEffect(() => {
    const known = tones.get(key)
    setTone(known)
    if (known !== undefined) return
    let live = true
    // Never keep a logo hidden for long, even if measuring is slow.
    const t = window.setTimeout(() => live && setTone((v) => v ?? 'light'), 500)
    measure(src).then((m) => {
      tones.set(key, m)
      if (m !== 'light') remember()
      if (live) setTone(m)
    })
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [src, key])

  if (tone === 'bad') return <>{fallback}</>
  return (
    <img
      src={src}
      alt={alt}
      className={`${className} ${tone === 'dark' ? 'brightness-0 invert' : ''} transition-opacity duration-200 ${tone === undefined ? 'opacity-0' : 'opacity-100'}`}
    />
  )
}
