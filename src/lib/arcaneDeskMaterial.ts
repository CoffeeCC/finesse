import type * as Three from 'three'

/** Material relief for the chain painted into quiet-desk-v1. Not freestanding geometry.
 * All three maps share the desk's UV crop, including on narrow screens. */
export function createDeskMaterial(T: typeof Three, desk: Three.Texture) {
  const image = desk.image as HTMLImageElement
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) return { material: new T.MeshStandardMaterial({ map: desk, roughness: .85, metalness: .12 }), maps: [] }
  context.drawImage(image, 0, 0)
  const source = context.getImageData(0, 0, canvas.width, canvas.height)
  // Trace the chain's two shallow arcs and pendant, rather than making the wood shiny.
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.save(); context.scale(canvas.width / 1536, canvas.height / 1024)
  context.strokeStyle = 'white'; context.lineWidth = 22; context.lineCap = 'round'
  context.beginPath(); context.moveTo(578, -4); context.bezierCurveTo(728, 61, 807, 70, 958, -4); context.stroke()
  context.beginPath(); context.moveTo(1064, -4); context.bezierCurveTo(1112, 27, 1159, 67, 1228, 36); context.stroke()
  context.beginPath(); context.ellipse(1263, 34, 39, 38, 0, 0, Math.PI * 2); context.fillStyle = 'white'; context.fill()
  context.restore()
  const mask = context.getImageData(0, 0, canvas.width, canvas.height)
  const relief = context.createImageData(canvas.width, canvas.height)
  const finish = context.createImageData(canvas.width, canvas.height)
  for (let i = 0; i < source.data.length; i += 4) {
    const r = source.data[i], g = source.data[i + 1], b = source.data[i + 2]
    // Keep the links' dark holes and surrounding wood matte. Feather the bronze threshold.
    const bronze = Math.min(1, Math.max(0, (r - b - 6) / 22)) * Math.min(1, Math.max(0, (g - 23) / 40))
    const metal = mask.data[i + 3] / 255 * bronze
    const height = Math.round(metal * (.2126 * r + .7152 * g + .0722 * b))
    relief.data.set([height, height, height, 255], i)
    // MeshStandardMaterial reads roughness from green and metalness from blue.
    finish.data.set([0, Math.round(217 - metal * 145), Math.round(30 + metal * 190), 255], i)
  }
  context.putImageData(relief, 0, 0)
  const bump = new T.CanvasTexture(canvas)
  const finishCanvas = document.createElement('canvas'); finishCanvas.width = canvas.width; finishCanvas.height = canvas.height
  finishCanvas.getContext('2d')!.putImageData(finish, 0, 0)
  const surface = new T.CanvasTexture(finishCanvas)
  const material = new T.MeshStandardMaterial({ map: desk, bumpMap: bump, bumpScale: .045,
    roughnessMap: surface, roughness: 1, metalnessMap: surface, metalness: 1 })
  return { material, maps: [bump, surface] }
}
