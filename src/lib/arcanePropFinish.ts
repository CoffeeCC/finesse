import type * as Three from 'three'

/** Subpixel wear under the shared light, not a painted highlight or baked shadow. */
export function createPropGrain(T: typeof Three) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const image = context.createImageData(128, 128)
  let seed = 76123
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const value = 190 + (seed >>> 26)
    image.data.set([value, value, value, 255], i)
  }
  context.putImageData(image, 0, 0)
  const grain = new T.CanvasTexture(canvas); grain.wrapS = grain.wrapT = T.RepeatWrapping; grain.repeat.set(6, 6)
  return grain
}
