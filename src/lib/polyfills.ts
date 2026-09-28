// Standard-library pieces older TV engines lack. The build down-levels syntax
// (vite target chrome53) but not APIs — and a missing one throws the moment the
// code reaches it, so whatever it was loading never appears. The LG CX (webOS
// 5) runs Chromium 68. Each shim only installs where the engine lacks it, and
// they're all tiny. Imported first thing in main.tsx.

/* eslint-disable no-extend-native */

// Chromium 76 — search's "Not in your library", Top 10 at home.
if (typeof Promise.allSettled !== 'function') {
  Promise.allSettled = function allSettled<T>(values: Iterable<T | PromiseLike<T>>) {
    return Promise.all(
      Array.from(values, (v) =>
        Promise.resolve(v).then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason: unknown) => ({ status: 'rejected' as const, reason }),
        ),
      ),
    )
  } as typeof Promise.allSettled
}

// Chromium 73 — the Browse page (Anime, genres, every "See all").
if (typeof Object.fromEntries !== 'function') {
  Object.fromEntries = function fromEntries(entries: Iterable<readonly [PropertyKey, unknown]>) {
    const out: Record<PropertyKey, unknown> = {}
    for (const [k, v] of Array.from(entries)) out[k] = v
    return out
  } as typeof Object.fromEntries
}

// Chromium 69 — TanStack Query's useQueries (Home genre tiles), motion.
if (typeof Array.prototype.flat !== 'function') {
  Object.defineProperty(Array.prototype, 'flat', {
    configurable: true,
    writable: true,
    value: function flat(this: unknown[], depth = 1): unknown[] {
      const out: unknown[] = []
      const walk = (arr: unknown[], d: number) => {
        for (const x of arr) {
          if (Array.isArray(x) && d > 0) walk(x, d - 1)
          else out.push(x)
        }
      }
      walk(this, Math.floor(depth))
      return out
    },
  })
}
if (typeof Array.prototype.flatMap !== 'function') {
  Object.defineProperty(Array.prototype, 'flatMap', {
    configurable: true,
    writable: true,
    value: function flatMap(this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => unknown, thisArg?: unknown) {
      return this.map(fn, thisArg).flat(1)
    },
  })
}

// Chromium 85.
if (typeof String.prototype.replaceAll !== 'function') {
  Object.defineProperty(String.prototype, 'replaceAll', {
    configurable: true,
    writable: true,
    value: function replaceAll(this: string, search: string | RegExp, replacement: string) {
      if (search instanceof RegExp) return this.replace(search, replacement)
      return this.split(search).join(replacement)
    },
  })
}

// Chromium 99 — canvas roundRect (the music visualizer's bars). Without it the
// Now Playing screen threw on open and never showed on the LG CX.
const C2D = typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D.prototype : null
if (C2D && typeof (C2D as { roundRect?: unknown }).roundRect !== 'function') {
  Object.defineProperty(C2D, 'roundRect', {
    configurable: true,
    writable: true,
    value: function roundRect(this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radii?: number | number[]) {
      const r0 = typeof radii === 'number' ? radii : Array.isArray(radii) && typeof radii[0] === 'number' ? radii[0] : 0
      const r = Math.max(0, Math.min(r0, Math.abs(w) / 2, Math.abs(h) / 2))
      this.moveTo(x + r, y)
      this.arcTo(x + w, y, x + w, y + h, r)
      this.arcTo(x + w, y + h, x, y + h, r)
      this.arcTo(x, y + h, x, y, r)
      this.arcTo(x, y, x + w, y, r)
      this.closePath()
    },
  })
}

export {}
