import type * as THREE from 'three'

/** Camera-facing card stock and relief artwork share the table's light/shadows.
 * HTML buttons still own layout, focus, selection and dealing. A failed texture
 * leaves the original HTML card visible. The resting hand and collection leaves are enhanced. */
export function createLiveCards(T: typeof import('three'), scene: THREE.Scene, camera: THREE.OrthographicCamera,
  board: HTMLElement, frameTexture: THREE.Texture, ground: (x: number, y: number) => THREE.Vector3, scope: HTMLElement = board, folio = false, surfaceHeight: () => number = () => 0) {
  const shape = new T.Shape(), x = -.44, y = -.65, w = .88, h = 1.32, r = .065
  shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r)
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r)
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y)
  const stockGeometry = new T.ExtrudeGeometry(shape, { depth: .016, bevelEnabled: true, bevelThickness: .004, bevelSize: .005, bevelSegments: 2, steps: 1 })
  const faceGeometry = new T.PlaneGeometry(1, 1.5), posterGeometry = new T.PlaneGeometry(.84, 1.14)
  const stockMaterial = new T.MeshStandardMaterial({ color: 0x141a23, roughness: .65, metalness: .12 })
  const frameMaterial = new T.MeshStandardMaterial({ map: frameTexture, color: 0xd9bd90, alphaTest: .14, metalness: .82, roughness: .32,
    bumpMap: frameTexture, bumpScale: .009, envMapIntensity: .7, transparent: false })
  type Card = { root: THREE.Group; src: string; material?: THREE.MeshBasicMaterial; texture?: THREE.Texture; cancelled: boolean; elevation?: number }
  const cards = new Map<HTMLElement, Card>(), loader = new T.TextureLoader()
  let disposed = false
  const remove = (element: HTMLElement, card: Card) => {
    card.cancelled = true; element.classList.remove('live-card-ready'); element.closest('.folio-slot')?.classList.remove('live-slot-ready'); scene.remove(card.root)
    card.material?.dispose(); card.texture?.dispose(); cards.delete(element)
  }
  const hide = () => cards.forEach((card, element) => { card.root.visible = false; element.classList.remove('live-card-ready'); element.closest('.folio-slot')?.classList.remove('live-slot-ready') })
  return {
    hide,
    update(light: number, dt: number, still: boolean) {
      if (disposed) return
      const nodes = [...scope.querySelectorAll<HTMLElement>(folio ? '.folio-card-art' : '.playing-card')].slice(0, folio ? 8 : 5), current = new Set(nodes)
      for (const [element, card] of cards) if (!current.has(element) || !element.isConnected) remove(element, card)
      if (folio ? !scope.querySelector('.folio-spread.shared-model-ready') : board.dataset.phase !== 'idle') { hide(); return }
      const bounds = board.getBoundingClientRect()
      const bookFloor = folio ? surfaceHeight() : 0
      for (const element of nodes) {
        const img = element.querySelector<HTMLImageElement>(folio ? 'img' : '.card-art img'), src = img?.currentSrc || img?.src
        const rect = element.getBoundingClientRect(), css = getComputedStyle(element)
        const reveal = element.closest('.folio-slots, .folio-inspection')
        if (!src || !rect.width || css.visibility === 'hidden' || Number(css.opacity) === 0 || reveal && Number(getComputedStyle(reveal).opacity) < .98) {
          const card = cards.get(element); if (card) { card.root.visible = false; element.classList.remove('live-card-ready'); element.closest('.folio-slot')?.classList.remove('live-slot-ready') }
          continue
        }
        let card = cards.get(element)
        if (card && card.src !== src) { remove(element, card); card = undefined }
        if (!card) {
          const root = new T.Group(); root.visible = false; scene.add(root)
          card = { root, src, cancelled: false }; cards.set(element, card)
          const pending = card
          void loader.loadAsync(src).then((texture) => {
            if (disposed || pending.cancelled || !element.isConnected) { texture.dispose(); return }
            texture.colorSpace = T.SRGBColorSpace
            pending.texture = texture; pending.material = new T.MeshBasicMaterial({ map: texture, toneMapped: false })
            const stock = new T.Mesh(stockGeometry, stockMaterial); stock.position.z = -.016; stock.castShadow = true; stock.receiveShadow = true
            const poster = new T.Mesh(posterGeometry, pending.material); poster.position.z = .022
            const relief = new T.Mesh(faceGeometry, frameMaterial); relief.position.z = .026; relief.receiveShadow = true
            pending.root.add(stock, poster, relief)
          }).catch(() => { /* Keep the HTML artwork; no card action depends on WebGL. */ })
          continue
        }
        if (!card.material) continue
        const matrix = new DOMMatrixReadOnly(css.transform === 'none' ? undefined : css.transform)
        const sx = Math.hypot(matrix.a, matrix.b), sy = Math.hypot(matrix.c, matrix.d)
        const worldWidth = element.offsetWidth * sx / bounds.width * 12
        const worldHeight = element.offsetHeight * sy / bounds.width * 12
        if (!(worldWidth > 0 && worldHeight > 0)) continue
        const center = ground((rect.left - bounds.left + rect.width / 2) / bounds.width * 2 - 1,
          1 - (rect.top - bounds.top + rect.height / 2) / bounds.height * 2)
        // The lower card edge rests on the receiving desk; the hand leans toward the viewer.
        const selected = Boolean(element.closest('.card-selected, .slot-selected, .folio-inspect-card'))
        const targetLift = selected ? (folio ? .26 : .48) * light : nodes.indexOf(element) * .012
        card.elevation = still || card.elevation === undefined ? targetLift : card.elevation + (targetLift - card.elevation) * (1 - Math.exp(-dt * 12))
        const elevation = worldHeight * Math.SQRT1_2 / 2 + (folio ? bookFloor + .05 : .025) + card.elevation
        card.root.position.set(center.x, elevation, center.z + elevation)
        card.root.quaternion.copy(camera.quaternion); card.root.rotateZ(-Math.atan2(matrix.b, matrix.a))
        card.root.scale.set(worldWidth, worldHeight / 1.5, worldWidth)
        card.material.color.setRGB(.035 + .965 * light, .05 + .95 * light, .09 + .91 * light)
        card.root.visible = true; element.classList.add('live-card-ready'); element.closest('.folio-slot')?.classList.add('live-slot-ready')
      }
    },
    dispose() {
      disposed = true; for (const [element, card] of cards) remove(element, card)
      stockGeometry.dispose(); faceGeometry.dispose(); posterGeometry.dispose(); stockMaterial.dispose(); frameMaterial.dispose()
    },
  }
}
