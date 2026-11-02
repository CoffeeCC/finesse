import { useEffect, useRef } from 'react'
import type * as Three from 'three'
import { useThemeEffects } from '../lib/theme'
import { getArcaneScene } from '../lib/arcaneScene'
import { getCandle } from '../lib/candle'
import { candleLight } from '../lib/candleLight'
import { stepTrinketMotion, type TrinketSpring } from '../lib/trinketMotion'
import { createPropGrain } from '../lib/arcanePropFinish'
import { orbVertex, orbFragment } from '../lib/arcaneShaders'
import backURL from '../assets/card-table/celestial-back-v1.webp'
import folioURL from '../assets/card-table/collection-folio-art-v1.webp'

const models = {
  library: () => import('../assets/card-table/archive-chest-v1.glb?url'),
  mylist: () => import('../assets/card-table/story-codex-v1.glb?url'),
  anime: () => import('../assets/card-table/fox-mask-v1.glb?url'),
  music: () => import('../assets/card-table/silver-lyre-v1.glb?url'),
  games: () => import('../assets/card-table/obsidian-die-v1.glb?url'),
  friends: () => import('../assets/card-table/linked-rings-v1.glb?url'),
  collections: () => import('../assets/card-table/collection-folio-v1.glb?url'),
  together: () => import('../assets/card-table/gathering-brazier-v1.glb?url'),
  moments: () => import('../assets/card-table/memory-vessel-v1.glb?url'),
  smart: () => import('../assets/card-table/oracle-prism-v1.glb?url'),
  requests: () => import('../assets/card-table/dispatch-seal-v1.glb?url'),
  activity: () => import('../assets/card-table/chronicle-hourglass-v1.glb?url'),
  settings: () => import('../assets/card-table/artificer-armillary-v1.glb?url'),
  remote: () => import('../assets/card-table/command-wand-v1.glb?url'),
}

/** One temporary canvas for the cabinet, released when it closes. Native links own input. */
export default function ArcaneDeskInstruments({ motion }: { motion: boolean }) {
  const host = useRef<HTMLDivElement>(null), effects = useThemeEffects()
  useEffect(() => {
    const element = host.current, cabinet = element?.parentElement, nav = cabinet?.querySelector('nav')
    if (!element || !cabinet || !nav || !effects) return
    let cancelled = false, frame = 0, release: (() => void) | undefined
    const fallback = () => nav.querySelectorAll('[data-model-ready]').forEach((node) => node.removeAttribute('data-model-ready'))
    void Promise.all([import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/environments/RoomEnvironment.js')]).then(async ([T, { GLTFLoader }, { RoomEnvironment }]) => {
      if (cancelled) return
      let renderer: Three.WebGLRenderer
      try { renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }) } catch { return }
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 600 ? 1 : 1.5))
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.shadowMap.enabled = innerWidth >= 600; renderer.shadowMap.type = T.PCFSoftShadowMap
      renderer.domElement.setAttribute('aria-hidden', 'true'); element.appendChild(renderer.domElement)
      const scene = new T.Scene(), camera = new T.OrthographicCamera(-6, 6, 6, -6, .1, 100)
      camera.position.set(0, 12, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true)
      const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(), env = pmrem.fromScene(room, .04)
      room.dispose(); pmrem.dispose(); scene.environment = env.texture; scene.environmentIntensity = .3
      scene.add(new T.HemisphereLight(0xb7d1e8, 0x302719, 1.3))
      const moon = new T.DirectionalLight(0x729fdb, 1.4); moon.position.set(-5, 10, 3); scene.add(moon)
      const warm = new T.PointLight(0xffbd6a, 18, 40, 2); warm.castShadow = innerWidth >= 600; warm.shadow.mapSize.set(1024, 1024); warm.shadow.normalBias = .015; scene.add(warm)
      const shadow = new T.Mesh(new T.PlaneGeometry(70, 70), new T.ShadowMaterial({ opacity: .3 }))
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.03; shadow.receiveShadow = true; scene.add(shadow)
      const grain = createPropGrain(T), loader = new GLTFLoader(), ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0)
      const textureLoader = new T.TextureLoader(), textures = new Set<Three.Texture>([grain])
      const ground = (x: number, y: number) => { ray.setFromCamera(new T.Vector2(x, y), camera); return ray.ray.intersectPlane(plane, new T.Vector3()) ?? new T.Vector3() }
      type Part = { node: Three.Object3D; position: Three.Vector3; rotation: Three.Euler; scale: Three.Vector3 }
      type Instrument = { id: string; link: HTMLElement; image: HTMLImageElement; root: Three.Group; box: Three.Box3; spring: TrinketSpring; parts: Part[]; origin: Three.Vector3 }
      const objects: Instrument[] = []
      const dispose = (root: Three.Object3D) => root.traverse((node) => {
        const mesh = node as Three.Mesh
        mesh.geometry?.dispose()
        const materials = mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []
        for (const material of materials) { for (const value of Object.values(material)) if (value instanceof T.Texture && value !== grain && value !== env.texture) value.dispose(); material.dispose() }
      })
      let released = false
      release = () => { if (released) return; released = true; cancelAnimationFrame(frame); fallback(); dispose(scene); textures.forEach(t => t.dispose()); env.dispose(); warm.shadow.map?.dispose(); renderer.dispose(); renderer.domElement.remove() }
      if (cancelled) { release(); return }
      const lost = (event: Event) => { event.preventDefault(); cancelled = true; release?.() }
      renderer.domElement.addEventListener('webglcontextlost', lost, { once: true })
      const loadTexture = async (url: string) => {
        const texture = await textureLoader.loadAsync(url)
        if (cancelled || released) { texture.dispose(); throw Error('Cabinet closed') }
        texture.colorSpace = T.SRGBColorSpace; textures.add(texture); return texture
      }
      const [back, folio] = await Promise.all([loadTexture(backURL), loadTexture(folioURL)])
      await Promise.allSettled([...nav.querySelectorAll<HTMLElement>('[data-trinket]')].map(async (link) => {
        const id = link.dataset.trinket as keyof typeof models, image = link.querySelector('img')
        if (!image || !models[id]) return
        const url = await models[id](), gltf = await loader.loadAsync(url.default)
        if (cancelled) { dispose(gltf.scene); return }
        const root = new T.Group(); root.add(gltf.scene); scene.add(root)
        if (id === 'collections') {
          for (const side of [-1, 1]) {
            const left = side < 0, width = left ? 3.712 : 2.688, pivot = gltf.scene.getObjectByName(left ? 'FolioLeftPivot' : 'FolioRightPivot')
            if (!pivot) continue
            const geometry = new T.PlaneGeometry(width, 4.5), uv = geometry.getAttribute('uv')
            for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (left ? .58 : .42) + (left ? 0 : .58))
            const face = new T.Mesh(geometry, new T.MeshStandardMaterial({ map: folio, roughness: .78, metalness: .1, side: T.DoubleSide }))
            face.rotation.x = -Math.PI / 2; face.position.set(side * width / 2, .09, 0); pivot.add(face)
          }
        }
        if (id === 'moments') {
          const core = new T.Mesh(new T.SphereGeometry(.61, 28, 18), new T.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { time: { value: 0 }, energy: { value: .2 } }, vertexShader: orbVertex, fragmentShader: orbFragment }))
          core.name = 'MemoryCore'; core.position.y = 1.38; gltf.scene.add(core)
        }
        const parts: Part[] = []
        root.traverse((node) => {
          if (node !== root) parts.push({ node, position: node.position.clone(), rotation: node.rotation.clone(), scale: node.scale.clone() })
          const mesh = node as Three.Mesh; if (!mesh.isMesh) return
          if (node.name === 'CodexInlay') mesh.material = new T.MeshStandardMaterial({ map: back, roughness: .52, metalness: .24 })
          mesh.castShadow = true; mesh.receiveShadow = true
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of mats) {
            const p = material as Three.MeshStandardMaterial
            if (p.isMeshStandardMaterial && mesh.geometry.getAttribute('uv') && !p.normalMap) { p.bumpMap = grain; p.bumpScale = p.metalness > .4 ? .008 : .015; p.needsUpdate = true }
          }
        })
        root.updateMatrixWorld(true)
        objects.push({ id, image, link, root, parts, box: new T.Box3().setFromObject(root), spring: { value: 0, velocity: 0 }, origin: new T.Vector3() })
      }))
      if (cancelled) return
      let last = 0, time = 0, width = 0, height = 0
      const draw = (now: number) => {
        if (cancelled) return
        frame = requestAnimationFrame(draw)
        if (document.hidden || (last && now - last < (motion ? innerWidth < 600 ? 50 : 33 : 150))) return
        const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now; time += dt
        const base = cabinet.getBoundingClientRect(), clip = nav.getBoundingClientRect()
        if (base.width < 1 || base.height < 1) return
        if (width !== base.width || height !== base.height) {
          width = base.width; height = base.height; renderer.setSize(width, height, false)
          camera.top = 6 * height / width; camera.bottom = -camera.top; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
        }
        const settings = getArcaneScene(), candle = getCandle(), flicker = candleLight(time, !motion)
        renderer.toneMappingExposure = 1.15 * settings.brightness
        const candleRect = cabinet.closest('.celestial-table')?.querySelector('.candle-anchor')?.getBoundingClientRect()
        const candlePoint = candleRect ? ground((candleRect.left + candleRect.width / 2 - base.left) / width * 2 - 1, 1 - (candleRect.top + candleRect.height / 2 - base.top) / height * 2) : new T.Vector3(4, 0, -4)
        warm.position.copy(candlePoint); warm.position.y = 3
        const flame = candle.phase === 'moonlight' ? 0 : candle.phase === 'guttering' ? Math.max(0, 1 - candle.transition / 4500) : candle.phase === 'relighting' ? Math.min(1, candle.transition / 1600) : 1
        warm.intensity = 18 * flame * flicker.intensity * settings.lights
        for (const o of objects) {
          const rect = o.image.getBoundingClientRect()
          o.root.visible = rect.bottom > clip.top && rect.top < clip.bottom && rect.width > 0
          if (!o.root.visible) continue
          o.spring = stepTrinketMotion(o.spring, o.link.matches(':hover,:focus-visible'), dt, !motion)
          const e = o.spring.value
          o.root.position.set(0, 0, 0); o.root.rotation.set(0, 0, 0); o.root.scale.setScalar(1)
          const points: Three.Vector3[] = []
          for (const x of [o.box.min.x, o.box.max.x]) for (const y of [o.box.min.y, o.box.max.y]) for (const z of [o.box.min.z, o.box.max.z]) points.push(new T.Vector3(x, y, z).project(camera))
          const spanX = Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), spanY = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))
          o.root.scale.setScalar(Math.min(rect.width / (spanX * width / 2), rect.height / (spanY * height / 2)) * .82)
          o.root.updateMatrixWorld(true)
          const center = new T.Box3().setFromObject(o.root).getCenter(new T.Vector3()).project(camera)
          const target = ground((rect.left + rect.width / 2 - base.left) / width * 2 - 1, 1 - (rect.top + rect.height / 2 - base.top) / height * 2)
          o.root.position.copy(target.sub(ground(center.x, center.y))); o.origin.copy(o.root.position)
          for (const p of o.parts) {
            const n = p.node, name = n.name
            n.position.copy(p.position); n.rotation.copy(p.rotation); n.scale.copy(p.scale)
            if (o.id === 'library' && name === 'ChestLid') n.rotation.x -= e * .85
            if (o.id === 'mylist' && name === 'CodexCoverPivot') n.rotation.z += e * .25
            if (o.id === 'music' && name.startsWith('LyreString')) n.rotation.y += Math.sin(time * 38 + p.position.x * 10) * e * .015
            if (o.id === 'friends' && name.startsWith('RingAssembly')) n.rotation.x += e * .17
            if (o.id === 'collections' && name === 'FolioRightPivot') n.rotation.z -= e * .16
            if (o.id === 'moments' && name === 'CardLift') n.position.y += e * .10
            if (o.id === 'requests' && name === 'CardLift') { n.position.y += e * .35; n.rotation.z -= e * .12 }
            if (o.id === 'smart' && name === 'OraclePrism') n.rotation.y += motion ? time * .18 + e * .6 : 0
            if (o.id === 'settings' && name.startsWith('ArmillaryRing')) n.rotation.y += e * Math.sin(time * .6 + p.rotation.y) * .45
            if (o.id === 'together' && name.startsWith('HearthEmber')) n.scale.y *= 1 + e * .18 * Math.sin(time * 3 + p.position.x * 4)
            if (o.id === 'activity' && name === 'FallingSand') n.scale.y *= 1 + (motion ? .025 * Math.sin(time * 4) : 0)
            const luminous = name.includes('Gem') || name === 'OraclePrism' || name === 'WandCrystal' || name.startsWith('HearthEmber') || (o.id === 'anime' && /EyeInlay|ForeheadStone/.test(name))
            if (name === 'MemoryCore') {
              const core = (n as Three.Mesh).material as Three.ShaderMaterial
              core.uniforms.time.value = motion ? time : 0; core.uniforms.energy.value = .2 + e * .5
            }
            if (luminous) {
              const material = (n as Three.Mesh).material as Three.MeshStandardMaterial | undefined
              if (material?.isMeshStandardMaterial) { material.emissive.set(o.id === 'together' ? 0xd87d32 : 0x5cb8ea); material.emissiveIntensity = .03 + e * .35 }
            }
          }
          if (o.id === 'games') { o.root.rotation.y += e * .32; o.root.rotation.z += e * .10 }
          if (o.id === 'remote') o.root.rotation.y -= e * .10
          o.link.dataset.modelReady = 'true'
        }
        renderer.setScissorTest(false); renderer.clear()
        renderer.setScissor(Math.max(0, clip.left - base.left), Math.max(0, height - (clip.bottom - base.top)), Math.min(width, clip.width), Math.min(height, clip.height))
        renderer.setScissorTest(true); renderer.render(scene, camera)
      }
      frame = requestAnimationFrame(draw)
    }).catch(() => { fallback(); release?.() })
    return () => { cancelled = true; cancelAnimationFrame(frame); release?.() }
  }, [effects, motion])
  return <div className="desk-instrument-scene" ref={host} aria-hidden="true" />
}
