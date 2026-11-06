import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Mesh, MeshStandardMaterial, Points, Texture } from 'three'
import { getCandle, useCandle } from '../lib/candle'
import { CANDLE_BURN_MS } from '../lib/candleClock'
import { reducedMotion } from '../lib/settings'
import { useThemeEffects } from '../lib/theme'
import candleHolder from '../assets/card-table/candle-holder-v1.webp'
import candleWax from '../assets/card-table/candle-wax-v1.webp'
import { CANDLE_WICK_X, CANDLE_WICK_Y, CANDLE_WAX_BASE_Y } from '../assets/card-table/candle-layout'
import { orbVertex, orbFragment, starVertex, starFragment } from '../lib/arcaneShaders'
import { createLiveCards } from '../lib/arcaneLiveCards'
import { watchDispatchModels } from '../lib/arcaneDispatchModels'
import { folioLeafAngle } from '../lib/folioMotion'
import cardFrameURL from '../assets/card-table/celestial-frame-v1.webp'
import { candleLight } from '../lib/candleLight'
import { createDeskMaterial } from '../lib/arcaneDeskMaterial'
import { getArcaneScene } from '../lib/arcaneScene'
import { createPropGrain } from '../lib/arcanePropFinish'
import { Sheet } from './Sheet'
import ArcaneLightControls from './ArcaneLightControls'
import { stepTrinketMotion } from '../lib/trinketMotion'
import './arcane-lighting.css'
const LightingDrawer = __WEBOS__ ? null : lazy(() => import('./ArcaneDeskDrawer'))

/** One light space for the candle, orb, boxes, folio and receiving desk. Native UI remains above it. */
export default function ArcaneLighting({ folio = false, staticOnly = false, workspace = false, interactive = true, vault = false, sceneRevision = '' }: { folio?: boolean; staticOnly?: boolean; workspace?: boolean; interactive?: boolean; vault?: boolean; sceneRevision?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const effects = useThemeEffects()
  const candle = useCandle()
  const [ready, setReady] = useState(false)
  const [tend, setTend] = useState(0)
  const [lightingOpen, setLightingOpen] = useState(false)
  const [portraitFolio, setPortraitFolio] = useState(() => innerWidth < 760)
  useEffect(() => {
    const board = host.current?.parentElement
    if (!folio || !board) return
    const resize = new ResizeObserver(() => setPortraitFolio(board.clientWidth < 760))
    resize.observe(board); return () => resize.disconnect()
  }, [folio])
  useEffect(() => {
    const element = host.current, board = element?.parentElement
    if (!element || !board || !effects || staticOnly || __WEBOS__) return
    let cancelled = false, release: (() => void) | undefined
    void Promise.all([import('three'), import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/environments/RoomEnvironment.js'),
      import('../assets/card-table/candle-v1.glb?url'), import('../assets/card-table/scrying-orb-v1.glb?url'),
      import('../assets/card-table/deck-movies-v1.glb?url'), import('../assets/card-table/deck-shows-v1.glb?url'),
      import('../assets/card-table/collection-folio-v1.glb?url'), import('../assets/card-table/quiet-desk-v1.webp'),
      import('../assets/card-table/collection-folio-art-v1.webp'),
      import('../assets/card-table/celestial-back-v1.webp'),
      import('../assets/card-table/celestial-coin-v1.glb?url'),
      import('../assets/card-table/story-codex-v1.glb?url'), import('../assets/card-table/draw-deck-v1.glb?url'),
      workspace ? import('../assets/card-table/scribe-desk-v1.webp') : Promise.resolve(null),
      workspace ? import('../assets/card-table/dispatch-seal-v1.glb?url') : Promise.resolve(null),
      workspace ? import('../assets/card-table/linked-rings-v1.glb?url') : Promise.resolve(null),
      workspace ? import('../assets/card-table/memory-vessel-v1.glb?url') : Promise.resolve(null),
    ]).then(async ([T, { GLTFLoader }, { RoomEnvironment }, candleURL, orbURL, movieURL, showURL, folioURL, deskURL, folioArtURL, backURL, coinURL, codexURL, drawURL, scribeURL, dispatchURL, ringsURL, memoryURL]) => {
      if (cancelled) return
      let renderer: InstanceType<typeof T.WebGLRenderer>
      try { renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }) } catch { return }
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 600 ? 1 : 1.5))
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15
      renderer.shadowMap.enabled = innerWidth >= 600; renderer.shadowMap.type = T.PCFSoftShadowMap
      renderer.localClippingEnabled = true
      renderer.domElement.setAttribute('aria-hidden', 'true'); element.appendChild(renderer.domElement)
      let rendererFreed=false
      const freeRenderer=()=>{if(rendererFreed)return;rendererFreed=true;const context=renderer.getContext();renderer.dispose();if(!context.isContextLost())renderer.forceContextLoss();renderer.domElement.remove()}
      const scene = new T.Scene(), camera = new T.OrthographicCamera(-6, 6, 4, -4, .1, 60)
      const systemMotion = matchMedia('(prefers-reduced-motion: reduce)')
      const scope = board.closest('.arcane-folio-page, [data-theme-surface="detail"]') ?? board
      camera.position.set(0, 12, 12); camera.lookAt(0, 0, 0)
      const room = new RoomEnvironment(), pmrem = new T.PMREMGenerator(renderer), env = pmrem.fromScene(room, .04)
      scene.environment = env.texture; scene.environmentIntensity = .35; room.dispose(); pmrem.dispose()
      const ambient = new T.HemisphereLight(0x8eafd8, 0x131923, 1.1); scene.add(ambient)
      const moon = new T.DirectionalLight(0x7dafff, 1.3); moon.position.set(-6, 8, -4); scene.add(moon)
      const flameLight = new T.PointLight(0xffb55b, 16, 20, 1.45)
      const candleAmber = new T.Color(0xffb55b), candleGold = new T.Color(0xffc273)
      flameLight.castShadow = innerWidth >= 600; flameLight.shadow.mapSize.set(1024, 1024)
      flameLight.shadow.bias = -.00015; flameLight.shadow.normalBias = .008; flameLight.shadow.radius = 9
      flameLight.shadow.intensity = folio ? .38 : .68; flameLight.shadow.camera.near = .1; flameLight.shadow.camera.far = 32; scene.add(flameLight)
      // Restrained unshadowed bounce keeps the holder's cast shadow from becoming a black cutout.
      // This approximates warm desk bounce; it is not path-traced global illumination.
      const warmBounce = new T.PointLight(0xffb66c, 1.6, 5, 2); scene.add(warmBounce)
      const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0)
      const ground = (x: number, y: number) => {
        ray.setFromCamera(new T.Vector2(x, y), camera)
        return ray.ray.intersectPlane(plane, new T.Vector3()) ?? new T.Vector3()
      }
      const texLoader = new T.TextureLoader(), gltfLoader = new GLTFLoader()
      const disposal = new Set<InstanceType<typeof T.Texture>>()
      const propGrain = createPropGrain(T); disposal.add(propGrain)
      release = () => { dispose(scene); disposal.forEach((t) => t.dispose()); env.dispose(); freeRenderer() }
      const desk = await texLoader.loadAsync(scribeURL?.default ?? deskURL.default)
      if (cancelled) { desk.dispose(); freeRenderer(); env.dispose(); return }
      desk.colorSpace = T.SRGBColorSpace; disposal.add(desk)
      const backTexture = workspace ? new T.Texture() : await texLoader.loadAsync(backURL.default); backTexture.colorSpace = T.SRGBColorSpace; disposal.add(backTexture)
      const frameTexture = workspace ? new T.Texture() : await texLoader.loadAsync(cardFrameURL); frameTexture.colorSpace = T.SRGBColorSpace; disposal.add(frameTexture)
      if (cancelled) { disposal.forEach((t) => t.dispose()); env.dispose(); freeRenderer(); return }
      const deskSurface = workspace ? { material: new T.MeshStandardMaterial({ map: desk, roughness: .85, metalness: .08 }), maps: [] } : createDeskMaterial(T, desk)
      deskSurface.maps.forEach((map) => disposal.add(map))
      const deskMesh = new T.Mesh(new T.PlaneGeometry(1, 1), deskSurface.material)
      deskMesh.rotation.x = -Math.PI / 2; deskMesh.receiveShadow = true; scene.add(deskMesh)
      const objects: { root: InstanceType<typeof T.Group>; selector: string; lid?: InstanceType<typeof T.Object3D>; cards?: InstanceType<typeof T.Object3D>; clasp?: InstanceType<typeof T.Object3D>; mechanisms?: { node: InstanceType<typeof T.Object3D>; position: InstanceType<typeof T.Vector3>; rotation: InstanceType<typeof T.Euler> }[]; packets?: { node: InstanceType<typeof T.Object3D>; position: InstanceType<typeof T.Vector3>; rotation: InstanceType<typeof T.Euler> }[]; open: number; lidStart: number; cardStart: number; cardYaw: number }[] = []
      const folioSurfaceHeight = () => {
        const book=objects.find(item=>item.selector.includes('.folio-spread'))?.root
        const surface=book?.getObjectByName('PortraitIlluminatedLeaf')??book?.getObjectByName('FolioIllustratedLeaf')
        return surface?.getWorldPosition(new T.Vector3()).y??0
      }
      const liveCards = workspace ? null : createLiveCards(T, scene, camera, board, frameTexture, ground, scope as HTMLElement, folio, folioSurfaceHeight)
      const orbs: { selector: string; material: InstanceType<typeof T.ShaderMaterial>; sparkle: InstanceType<typeof T.ShaderMaterial>; stars: InstanceType<typeof T.Points>; lamp: InstanceType<typeof T.PointLight>; halo: InstanceType<typeof T.Mesh>; glow: InstanceType<typeof T.ShaderMaterial> }[] = []
      const emitterScale = new T.Vector3()
      const folioLeaves: InstanceType<typeof T.Object3D>[] = []
      let releaseDispatchModels: (() => void) | undefined
      const load = async (url: string, selector: string, portraitBook = false) => {
        const gltf = await gltfLoader.loadAsync(url)
        if (cancelled) { dispose(gltf.scene); return null }
        const root = new T.Group(); root.add(gltf.scene); scene.add(root)
        const dispatchClip = selector.includes('.dispatch-') ? Array.from({length:4},()=>new T.Plane()) : null
        if(dispatchClip)root.userData.dispatchClip=dispatchClip
        if (portraitBook) {
          const leaf = gltf.scene.getObjectByName('PortraitLeafPivot'); if (leaf) { leaf.userData.openSide=1;folioLeaves.push(leaf) }
        } else if (selector.includes('.folio-spread')) {
          const art = await texLoader.loadAsync(folioArtURL.default); art.colorSpace = T.SRGBColorSpace; disposal.add(art)
          if (cancelled) { art.dispose(); root.removeFromParent(); dispose(gltf.scene); return null }
          const material = new T.MeshStandardMaterial({ map: art, transparent: true, alphaTest: .05, roughness: .78, metalness: .1, side: T.DoubleSide })
          for (const side of [-1, 1]) {
            const left = side < 0, width = left ? 3.712 : 2.688
            const pivot = gltf.scene.getObjectByName(left ? 'FolioLeftPivot' : 'FolioRightPivot') ?? new T.Group()
            pivot.userData.openSide=side
            if (!pivot.parent) { pivot.position.set(.512, .25, 0); gltf.scene.add(pivot) }
            const geometry = new T.PlaneGeometry(width, 4.5), uv = geometry.getAttribute('uv')
            for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (left ? .58 : .42) + (left ? 0 : .58))
            const face = new T.Mesh(geometry, material)
            face.name = 'FolioIllustratedLeaf'
            face.rotation.x = -Math.PI / 2; face.position.set(side * width / 2, .09, 0); face.receiveShadow = true; pivot.add(face); folioLeaves.push(pivot)
          }
          gltf.scene.scale.z = 1.5
          gltf.scene.scale.y = .2
        }
        gltf.scene.traverse((o) => {
          // The approved folio plate has a 58/42 gutter at the authored leaf pivot.
          // Align the original spine geometry to it instead of shadowing the left page.
          if(!portraitBook && selector.includes('.folio-spread') && /^(BindingSpine|SpineStitch)/.test(o.name))o.position.x+=.512
          if (/NebulaSource|StarSource/.test(o.name)) o.visible = false
          const mesh = o as Mesh
          if (mesh.isMesh) {
            // Keep the illuminated feather from throwing a long, opaque stripe across the writing.
            // The inkwell still casts its contact shadow onto the desk.
            mesh.castShadow = !(selector === '.collection-query-art' && /^(FeatherBarb|QuillShaft|GoldNib)/.test(o.name)); mesh.receiveShadow = true
            if (/^(CodexInlay|DrawBack)/.test(o.name)) {
              mesh.material = new T.MeshStandardMaterial({ map: backTexture, roughness: .52, metalness: .24, bumpMap: backTexture, bumpScale: .004 })
            }
            if (/Lid.?leather/i.test(o.name)) {
              const positions = mesh.geometry.getAttribute('position'), box = new T.Box3().setFromBufferAttribute(positions as InstanceType<typeof T.BufferAttribute>)
              const uv = new Float32Array(positions.count * 2)
              for (let i = 0; i < positions.count; i++) uv.set([(positions.getX(i) - box.min.x) / Math.max(.001, box.max.x - box.min.x), (positions.getY(i) - box.min.y) / Math.max(.001, box.max.y - box.min.y)], i * 2)
              mesh.geometry.setAttribute('uv', new T.BufferAttribute(uv, 2))
              for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if ((m as MeshStandardMaterial).isMeshStandardMaterial) {
                // Clone: front and side leather share the source material in the GLB.
                const cover = (m as MeshStandardMaterial).clone(); cover.map = backTexture; cover.color.set(0xffffff); cover.roughness = .5; cover.metalness = .24; mesh.material = cover
              }
            }
            for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              const finish = m as MeshStandardMaterial
              if(dispatchClip){finish.clippingPlanes=dispatchClip;finish.clipShadows=true;finish.needsUpdate=true}
              if(portraitBook && o.name==='PortraitIlluminatedLeaf' && finish.isMeshStandardMaterial){finish.transparent=true;finish.alphaTest=.04;finish.depthWrite=true;finish.side=T.DoubleSide;finish.roughnessMap=propGrain;finish.bumpMap=propGrain;finish.bumpScale=.0025;finish.needsUpdate=true}
              if (finish.isMeshStandardMaterial && mesh.geometry.getAttribute('uv')) {
                const leather = /leather/i.test(finish.name), metal = finish.metalness > .5
                if ((leather || metal) && !finish.roughnessMap) {
                  finish.roughnessMap = propGrain; finish.roughness = Math.max(finish.roughness, metal ? .32 : .55)
                  if (!finish.normalMap && !finish.bumpMap) { finish.bumpMap = propGrain; finish.bumpScale = leather ? .003 : .0008 }
                }
              }
              for (const value of Object.values(m)) if ((value as Texture)?.isTexture) disposal.add(value as Texture)
            }
            if (o.name === 'CrystalShell') {
              const old = mesh.material
              mesh.material = new T.MeshPhysicalMaterial({ color: 0x608fc9, metalness: .08, roughness: .12, clearcoat: 1, transparent: true, opacity: .38, depthWrite: false })
              for (const m of Array.isArray(old) ? old : [old]) m.dispose()
            }
          }
        })
        const lid = root.getObjectByName('LidPivot') ?? root.getObjectByName('ChestLid') ?? root.getObjectByName('CodexCoverPivot'), cards = root.getObjectByName('CardLift') ?? (selector.includes('groups') ? root.getObjectByName('RingAssembly') : undefined)
        const clasp = root.getObjectByName('CodexClaspPivot')
        const packets = selector === '.action-deck-art' ? ['PacketA', 'PacketB', 'TopCard'].flatMap((name) => {
          const node = root.getObjectByName(name); return node ? [{ node, position: node.position.clone(), rotation: node.rotation.clone() }] : []
        }) : undefined
        if (selector.includes('orb') || selector.includes('memory')) {
          const material = new T.ShaderMaterial({ transparent: true, depthWrite: false,
            uniforms: { time: { value: 0 }, energy: { value: .2 } },
            vertexShader: orbVertex, fragmentShader: orbFragment })
          const core = new T.Mesh(new T.SphereGeometry(.78, 36, 24), material); core.position.y = 1.38; gltf.scene.add(core)
          const points = new Float32Array(45 * 3)
          for (let i = 0; i < 45; i++) {
            const y = (i / 45 - .5) * 1.3, r = Math.sqrt(.7 * .7 - y * y)
            points.set([Math.cos(i * 2.399) * r, y, Math.sin(i * 2.399) * r], i * 3)
          }
          const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(points, 3))
          const sparkle = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: { time: { value: 0 }, energy: { value: 0 } }, vertexShader: starVertex, fragmentShader: starFragment })
          const stars = new T.Points(geo, sparkle)
          stars.position.y = 1.38; gltf.scene.add(stars)
          const blueLight = new T.PointLight(0x69baff, 11, 9.5, 1.5); blueLight.position.y = 1.45; gltf.scene.add(blueLight)
          const glow = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
            uniforms: { strength: { value: 1 } },
            vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
            fragmentShader: 'varying vec2 vUv;uniform float strength;void main(){float r=length(vUv-.5)*2.;float a=pow(max(0.,1.-r),2.5)*.36*strength;gl_FragColor=vec4(.15,.48,1.,a);}' })
          const halo = new T.Mesh(new T.PlaneGeometry(3.8, 3.8), glow); halo.position.y = 1.38; gltf.scene.add(halo)
          orbs.push({ selector, material, sparkle, stars, lamp: blueLight, halo, glow })
        }
        const mechanismNames = selector.includes('.dispatch-retry-art') ? ['CourierHornPivot'] : selector.includes('.dispatch-pause-art') ? ['EscapementLeverPivot'] : selector.includes('.dispatch-cancel-art') ? ['ShearLeftPivot','ShearRightPivot'] : selector === '.collection-query-art' ? ['QuillPivot'] : selector === '.collection-genres-art' ? ['VialStopperPivot0','VialStopperPivot1','VialStopperPivot2'] : selector === '.collection-watch-art' ? ['LanternHandlePivot'] : selector === '.collection-sort-art' ? ['SextantArmPivot'] : selector === '.collection-erase-art' ? ['EraserHandlePivot'] : []
        if(selector==='.fortune-lots-art')for(let i=0;i<7;i++)mechanismNames.push(`LotPivot${i}`)
        const mechanisms = mechanismNames.flatMap(name => { const node=root.getObjectByName(name);return node?[{node,position:node.position.clone(),rotation:node.rotation.clone()}]:[] })
        objects.push({ root, selector, lid, cards, clasp, packets, mechanisms, open: 0, lidStart: selector === '.action-codex-art' ? lid?.rotation.z ?? 0 : lid?.rotation.x ?? 0, cardStart: cards?.position.y ?? 0, cardYaw: cards?.rotation.y ?? 0 })
        return root
      }
      function dispose(root: InstanceType<typeof T.Object3D>) {
        root.traverse((o) => {
          const renderable = o as Mesh | Points
          if ((renderable as Mesh).isMesh || (renderable as Points).isPoints) {
            renderable.geometry.dispose()
            for (const m of Array.isArray(renderable.material) ? renderable.material : [renderable.material]) m.dispose()
          }
        })
      }
      // These meshes are physical models in this scene; the HTML cards remain a documented hybrid.
      let candleModel: InstanceType<typeof T.Group> | null = null
      let waxBead: InstanceType<typeof T.Mesh> | null = null
      const pending = [load(candleURL.default, '.candle-model-anchor').then((o) => {
        candleModel = o
        if (o) {
          waxBead = new T.Mesh(new T.SphereGeometry(.027, 12, 10), new T.MeshPhysicalMaterial({ color: 0xb69b6c, roughness: .3, transmission: .08 }))
          waxBead.scale.y = 1.6; o.add(waxBead)
        }
      })]
      if (workspace && dispatchURL && ringsURL && memoryURL) {
        pending.push(load(dispatchURL.default, '.dispatch-trinket-art').then(() => {}))
        pending.push(load(ringsURL.default, '.groups-trinket-art').then(() => {}))
        pending.push(load(memoryURL.default, '.memory-trinket-art').then(() => {}))
      } else if(vault){
        pending.push(load(orbURL.default,'.folio-orb-art').then(()=>{}))
        pending.push(import('../assets/card-table/archive-chest-v2.glb?url').then(url=>load(url.default,'.vault-archive-art')).then(()=>{}))
        pending.push(import('../assets/card-table/fortune-lots-v1.glb?url').then(url=>load(url.default,'.fortune-lots-art')).then(()=>{}))
        pending.push(load(codexURL.default,'.action-codex-art').then(()=>{}))
        pending.push(import('../assets/card-table/dispatch-seal-v1.glb?url').then(url=>load(url.default,'.dispatch-trinket-art')).then(()=>{}))
        for(const anchor of board.querySelectorAll<HTMLElement>('[data-vault-deck]')){
          const index=anchor.dataset.vaultDeck
          pending.push(load(anchor.dataset.deckKind==='tvshows'?showURL.default:movieURL.default,`[data-vault-deck="${index}"]`).then(()=>{}))
        }
      } else if (folio) {
        pending.push((portraitFolio ? import('../assets/card-table/collection-folio-portrait-v2.glb?url').then(url=>load(url.default,'.folio-spread, .arcane-detail-inspection',true)) : load(folioURL.default, '.folio-spread, .arcane-detail-inspection')).then(() => {}))
        pending.push(load(orbURL.default, '.folio-orb-art').then(() => {}))
        pending.push(import('../assets/card-table/collection-quill-v1.glb?url').then(url=>load(url.default,'.collection-query-art')).then(()=>{}))
        pending.push(import('../assets/card-table/genre-vials-v1.glb?url').then(url=>load(url.default,'.collection-genres-art')).then(()=>{}))
        pending.push(import('../assets/card-table/watch-lantern-v1.glb?url').then(url=>load(url.default,'.collection-watch-art')).then(()=>{}))
        pending.push(import('../assets/card-table/sort-sextant-v1.glb?url').then(url=>load(url.default,'.collection-sort-art')).then(()=>{}))
        pending.push(import('../assets/card-table/collection-eraser-v1.glb?url').then(url=>load(url.default,'.collection-erase-art')).then(()=>{}))
      }
      else {
        pending.push(load(orbURL.default, '.search-object .scrying-orb-art').then(() => {}))
        pending.push(load(movieURL.default, '.deck-box-object:nth-child(1) .deck-trinket-art').then(() => {}))
        pending.push(load(showURL.default, '.deck-box-object:nth-child(2) .deck-trinket-art').then(() => {}))
        pending.push(load(coinURL.default, '.arcane-coin-art').then(() => {}))
        pending.push(load(codexURL.default, '.action-codex-art').then(() => {}))
        pending.push(load(drawURL.default, '.action-deck-art').then(() => {}))
      }
      const flameMaterial = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        uniforms: { time: { value: 0 }, strength: { value: 1 }, lean: { value: 0 }, energy: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: `varying vec2 vUv; uniform float time; uniform float strength; uniform float lean; uniform float energy;
          void main(){vec2 p=vUv; p.x-=.5+lean*p.y*p.y+sin(p.y*7.-time*4.)*.022*p.y;
          float width=.20*pow(max(.001,1.-p.y),.6); float shape=smoothstep(width,width*.2,abs(p.x));
          float a=shape*smoothstep(0.,.12,p.y)*smoothstep(1.,.65,p.y)*strength;
          vec3 c=mix(vec3(.12,.35,1.),vec3(1.,.43,.075),smoothstep(.02,.25,p.y));
          c=mix(c,vec3(1.,.94,.68),pow(shape,4.)*.8);gl_FragColor=vec4(c*1.8*energy,a);}` })
      const flame = new T.Mesh(new T.PlaneGeometry(.32, .65), flameMaterial); flame.renderOrder = 8; scene.add(flame)
      const emberMaterial = new T.MeshBasicMaterial({ color: 0xff7638, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
      const ember = new T.Mesh(new T.SphereGeometry(.016, 10, 8), emberMaterial); scene.add(ember)
      const smokeMaterial = new T.ShaderMaterial({ transparent: true, depthWrite: false,
        uniforms: { time: { value: 0 }, opacity: { value: 0 } },
        vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: `varying vec2 vUv;uniform float time;uniform float opacity;
          void main(){float x=vUv.x-.5-sin(vUv.y*8.-time)*.13;
          float a=exp(-x*x*90.)*sin(vUv.y*3.14159)*opacity;gl_FragColor=vec4(.48,.56,.63,a*.22);}` })
      const smoke = new T.Mesh(new T.PlaneGeometry(.65, 1.6), smokeMaterial); scene.add(smoke)
      const dustPositions = new Float32Array(55 * 3)
      for (let i = 0; i < 55; i++) dustPositions.set([Math.sin(i * 13.3) * 6, .25 + (i % 11) * .16, Math.cos(i * 4.3) * 5], i * 3)
      const dustGeo = new T.BufferGeometry(); dustGeo.setAttribute('position', new T.BufferAttribute(dustPositions, 3))
      const dustMat = new T.PointsMaterial({ color: 0xb0c9df, size: .018, transparent: true, opacity: .22, depthWrite: false })
      const dust = new T.Points(dustGeo, dustMat); scene.add(dust)
      let frame = 0, last = 0, visible = true, graphicsLost = false, time = 0, light = 1, width = 1, height = 1
      let lastLeaf = '', leafTurn = -10, lastDispatchLeaf = ''
      let moonSince = -10, previousPhase = ''
      let layoutAt = 0, layoutStamp = ''
      let candleHover = 0, lastTend = '0', tendAt = -10, inspectionApproach = 0
      const place = () => {
        if (graphicsLost || cancelled) return
        const bounds = board.getBoundingClientRect()
        width = Math.max(1, bounds.width); height = Math.max(1, bounds.height)
        const ratio = Math.min(devicePixelRatio || 1, innerWidth < 600 ? 1 : 1.5)
        if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio)
        renderer.shadowMap.enabled = innerWidth >= 600; flameLight.castShadow = innerWidth >= 600
        renderer.setSize(width, height, false); camera.top = 6 * height / width; camera.bottom = -camera.top; camera.updateProjectionMatrix()
        camera.updateMatrixWorld(true)
        // A phone is a close view of the hide, not a vertically stretched desktop illustration.
        if (width < 760 && folio) { const crop = Math.min(.8, width / height / 1.5 * .7); desk.repeat.set(crop, .7); desk.offset.set((1 - crop) / 2, .15) }
        else if (width < 760) { const crop = Math.min(1, width / height / 1.5); desk.repeat.set(crop, 1); desk.offset.set((1 - crop) / 2, 0) }
        else { desk.repeat.set(1, 1); desk.offset.set(0, 0) }
        for (const map of deskSurface.maps) { map.repeat.copy(desk.repeat); map.offset.copy(desk.offset) }
        deskMesh.scale.set(12, camera.top * 2 * Math.SQRT2, 1)
        for (const o of objects) {
          const anchor = scope.querySelector(o.selector), rect = anchor?.getBoundingClientRect()
          o.root.visible = Boolean(rect && rect.width > 0)
          if (!rect || !rect.width) continue
          if (o.selector.includes('deck-box-object')) {
            o.root.rotation.y = (parseFloat(getComputedStyle(anchor!).getPropertyValue('--object-angle')) || 0) * Math.PI / 180
          }
          if(anchor?.hasAttribute('data-vault-deck'))o.root.rotation.y=(parseFloat(getComputedStyle(anchor.closest('.vault-deck')!).getPropertyValue('--vault-angle'))||0)*Math.PI/180
          if(o.selector==='.fortune-lots-art')o.root.rotation.y=.12
          if (o.selector === '.action-codex-art') o.root.rotation.y = -.12
          if (o.selector === '.action-deck-art') o.root.rotation.y = .10
          o.root.scale.setScalar(1); o.root.position.set(0, 0, 0); o.root.updateMatrixWorld(true)
          const box = (o.root.userData.restBounds ??= new T.Box3().setFromObject(o.root)) as InstanceType<typeof T.Box3>, points = []
          for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(new T.Vector3(x, y, z).project(camera))
          const extent = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y))
          const extentX = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x))
          const scale = Math.min(rect.height / (extent * height / 2), rect.width / (extentX * width / 2))
          if (o.selector.includes('.folio-spread')) o.root.scale.set(rect.width / (extentX * width / 2), scale, rect.height / (extent * height / 2))
          else o.root.scale.setScalar(scale)
          o.root.updateMatrixWorld(true)
          const clips=o.root.userData.dispatchClip as InstanceType<typeof T.Plane>[]|undefined
          if(clips){
            const floor=folioSurfaceHeight()
            o.root.position.y+=floor+.015-new T.Box3().setFromObject(o.root).min.y;o.root.updateMatrixWorld(true)
            const page=anchor?.closest('.collection-index-writing')?.getBoundingClientRect()??bounds
            const left=Math.max(page.left,bounds.left),right=Math.min(page.right,bounds.right),top=Math.max(page.top,bounds.top),bottom=Math.min(page.bottom,bounds.bottom)
            const axisX=new T.Vector3(1,0,0).applyQuaternion(camera.quaternion),axisY=new T.Vector3(0,1,0).applyQuaternion(camera.quaternion)
            const point=(x:number,y:number)=>new T.Vector3((x-bounds.left)/width*2-1,1-(y-bounds.top)/height*2,0).unproject(camera)
            clips[0].setFromNormalAndCoplanarPoint(axisX,point(left,top));clips[1].setFromNormalAndCoplanarPoint(axisX.clone().negate(),point(right,top))
            clips[2].setFromNormalAndCoplanarPoint(axisY,point(left,bottom));clips[3].setFromNormalAndCoplanarPoint(axisY.clone().negate(),point(left,top))
          }
          const center = new T.Box3().setFromObject(o.root).getCenter(new T.Vector3()).project(camera)
          const target = ground((rect.left - bounds.left + rect.width / 2) / width * 2 - 1, 1 - (rect.top - bounds.top + rect.height / 2) / height * 2)
          const origin = ground(center.x, center.y); o.root.position.add(target.sub(origin))
          if(!clips)anchor?.classList.add('shared-model-ready')
          if (o.selector === '.arcane-coin-art') { o.root.userData.restY = o.root.position.y; o.root.userData.restZ = o.root.position.z }
        }
      }
      const draw = (now: number) => {
        frame = 0
        if (cancelled || document.hidden || !visible || graphicsLost) { last = 0; return }
        frame = requestAnimationFrame(draw)
        // The cabinet owns the foreground canvas while open; retain the last desk frame.
        if (board.dataset.deskCompartment === 'open' || (scope as HTMLElement).dataset.deskCompartment === 'open') { last = 0; return }
        const still = systemMotion.matches || document.documentElement.dataset.motion === 'reduce' || board.closest('.no-table-motion') !== null
        if (last && now - last < (still ? 100 : innerWidth < 600 ? 50 : 33)) return
        const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now; time += dt
        const approachTarget = (board.dataset.scrying === 'true' || (scope as HTMLElement).dataset.scrying === 'true') && !still ? 1 : 0
        inspectionApproach = still ? 0 : inspectionApproach + (approachTarget - inspectionApproach) * Math.min(1, dt * 6)
        const zoom = 1 + inspectionApproach * .08
        if (Math.abs(camera.zoom - zoom) > .0001) { camera.zoom = zoom; camera.updateProjectionMatrix() }
        // Late fonts/theme CSS can move an anchor without resizing the board.
        // Refit resting props at a low rate so visual art stays on its hit target.
        if (now - layoutAt > 400 && !scope.querySelector('.arcane-coin[aria-busy="true"]')) {
          layoutAt = now
          const base = board.getBoundingClientRect()
          const stamp = objects.map((o) => {
            const anchor = scope.querySelector(o.selector), rect = anchor?.getBoundingClientRect()
            return rect ? `${Number(anchor?.classList.contains('shared-model-ready'))}:` + [rect.left - base.left, rect.top - base.top, rect.width, rect.height].map((n) => Math.round(n * 4)).join(',') : '-'
          }).join('|')
          if (stamp !== layoutStamp) { layoutStamp = stamp; place() }
        }
        const state = getCandle()
        if (state.phase !== previousPhase) { if (state.phase === 'moonlight') moonSince = time; previousPhase = state.phase }
        const target = state.phase === 'moonlight' ? 0 : state.phase === 'guttering' ? Math.max(0, 1 - state.transition / 4500) : state.phase === 'relighting' ? Math.min(1, state.transition / 1600) : 1
        light += (target - light) * Math.min(1, dt * 3)
        const flicker = candleLight(time, still)
        const sceneSettings = getArcaneScene()
        renderer.toneMappingExposure = 1.15 * sceneSettings.brightness
        const candleControl = scope.querySelector<HTMLElement>('.candle-object')
        const engagedCandle = Boolean(candleControl?.matches(':hover, :focus-visible'))
        const nextTend = candleControl?.dataset.candleTend ?? '0'
        if (nextTend !== lastTend) { lastTend = nextTend; tendAt = time }
        candleHover = still ? 0 : candleHover + ((engagedCandle ? 1 : 0) - candleHover) * Math.min(1, dt * 5)
        const tendAge = time - tendAt
        const pulse = !still && tendAge < 2 ? Math.sin(Math.min(1, tendAge / .25) * Math.PI / 2) * Math.exp(-Math.max(0, tendAge - .25) * 2.5) : 0
        flameLight.intensity = 16 * light * flicker.intensity * (1 + candleHover * .65 + pulse * .28) * sceneSettings.lights
        warmBounce.intensity = 1.6 * light * sceneSettings.lights
        flameLight.distance = 20 + candleHover * 6 + pulse * 3
        flameLight.color.copy(candleAmber).lerp(candleGold, flicker.warmth * .2)
        ambient.intensity = .18 + light * .30; moon.intensity = .75 - light * .45
        scene.environmentIntensity = .08 + light * .14
        flameMaterial.uniforms.time.value = still ? 0 : time; flameMaterial.uniforms.strength.value = light
        flameMaterial.uniforms.lean.value = (flicker.lean + candleHover * .06 + pulse * .12) * light
        flameMaterial.uniforms.energy.value = flicker.intensity * (1 + candleHover * .18 + pulse * .1)
        flame.visible = light > .005
        smokeMaterial.uniforms.time.value = still ? 0 : time
        smokeMaterial.uniforms.opacity.value = still ? 0 : state.phase === 'guttering' && state.transition > 3500 ? Math.sin(Math.min(1, (state.transition - 3500) / 4500) * Math.PI) : state.phase === 'moonlight' ? Math.max(0, 1 - (time - moonSince) / 3.5) * .6 : 0
        emberMaterial.opacity = state.phase === 'guttering' ? Math.max(0, (state.transition - 4000) / 2000) * .8 : state.phase === 'moonlight' ? Math.max(0, 1 - (time - moonSince) / 3) * .8 : 0
        dust.visible = !still; if (!still) dust.rotation.y = time * .003
        for (const orb of orbs) {
          orb.material.uniforms.time.value = still ? 0 : time; orb.sparkle.uniforms.time.value = still ? 0 : time
          const engaged = orb.selector === '.orb-projection-source' ? board.dataset.scrying === 'true' : scope.querySelector(orb.selector)?.closest('a,button')?.matches(':hover, :focus-visible')
          orb.material.uniforms.energy.value += ((engaged && !still ? .9 : .2) - orb.material.uniforms.energy.value) * Math.min(1, dt * 3)
          const memory = orb.selector.includes('memory')
          const response = still ? 0 : Math.max(0, (orb.material.uniforms.energy.value - .2) / .7)
          orb.sparkle.uniforms.energy.value = memory ? response : 0
          // Cool, slow breathing belongs to the orb; never copy the candle's flutter.
          const breath = still ? 1 : 1 + Math.sin(time * .7) * .045
          const glowStrength = (.24 + light * .76) * breath * (1 + orb.material.uniforms.energy.value * .4)
          // Smaller folio props need proportionally less power; otherwise the tiny orb
          // bleaches the nearby inspection page while the Home composition looks correct.
          const emitterSize = Math.min(1, orb.lamp.getWorldScale(emitterScale).x / .4)
          orb.lamp.intensity = 11 * glowStrength * sceneSettings.lights * emitterSize * emitterSize
          orb.lamp.distance = 9.5 * emitterSize
          orb.glow.uniforms.strength.value = glowStrength
          orb.halo.quaternion.copy(camera.quaternion)
          orb.stars.rotation.y = still ? 0 : time * .045 + (memory ? response * .75 : 0)
          orb.stars.scale.setScalar(memory ? 1 - response * .12 : 1)
        }
        const leaf = scope.querySelector('.folio-spread')?.getAttribute('data-leaf') ?? '-'
        if (leaf !== lastLeaf) { if (lastLeaf) leafTurn = time; lastLeaf = leaf }
        const turn = time - leafTurn, settled=still||time>1.55&&turn>.75
        folioLeaves.forEach((pivot, index) => { pivot.rotation.z = folioLeafAngle(time,turn,pivot.userData.openSide??(index?1:-1),still) })
        if(folio&&settled&&lastDispatchLeaf!==lastLeaf){lastDispatchLeaf=lastLeaf;place()}
        if (candleModel) {
          const quick = import.meta.env.DEV && new URLSearchParams(location.search).get('candle-test') === '1'
          const heightScale = state.phase === 'relighting' && !still ? .28 + .72 * Math.min(1, state.transition / 1600) : 1 - Math.min(1, state.burned / (quick ? 14000 : CANDLE_BURN_MS)) * .72
          // Body, trails and wick share the same vertical melt envelope above the unmoving holder.
          candleModel.traverse((o) => {
            if (/^(WaxBody|WaxTrail|WaxDrop|Wick)/.test(o.name)) {
              if (o.userData.originalY === undefined) { o.userData.originalY = o.position.y; o.userData.originalScale = o.scale.y }
              o.position.y = .43 + (o.userData.originalY - .43) * heightScale
              o.scale.y = o.userData.originalScale * heightScale
            }
          })
          const wick = candleModel.getObjectByName('Wick')
          if (wick) {
            const tip = new T.Vector3(.02, 1.69, 0); wick.localToWorld(tip)
            const flameGrowth = candleHover * .45 + pulse * .25
            flame.position.copy(tip); flame.position.y += (.18 + .325 * flameGrowth) * candleModel.scale.y
            flame.scale.set(candleModel.scale.y * (1 + candleHover * .18 + pulse * .08), candleModel.scale.y * (1 + flameGrowth), candleModel.scale.y); flame.quaternion.copy(camera.quaternion)
            flameLight.position.copy(tip); flameLight.position.y += (.42 + candleHover * .1 + pulse * .06) * candleModel.scale.y
            flameLight.position.x += (flicker.x + candleHover * .02 + pulse * .03) * candleModel.scale.x * light
            flameLight.position.z += flicker.z * candleModel.scale.z * light
            warmBounce.position.copy(flameLight.position)
            ember.position.copy(tip); ember.scale.setScalar(candleModel.scale.y)
            smoke.position.copy(tip); smoke.position.y += .5 * candleModel.scale.y
            smoke.scale.setScalar(candleModel.scale.y); smoke.quaternion.copy(camera.quaternion)
          }
          if (waxBead) {
            const run = ((time + 10) % 27) / 27
            waxBead.visible = !still && light > .5 && run > .68
            waxBead.position.set(.07 + Math.sin(run * 8) * .012, .45 + 1.12 * (1 - Math.max(0, run - .68) / .32) * heightScale, .26)
          }
          candleModel.traverse((o) => {
            if (/^PooledWax/.test(o.name)) {
              if (!o.userData.poolScale) o.userData.poolScale = o.scale.clone()
              o.scale.copy(o.userData.poolScale); o.scale.x *= 1 + (1 - heightScale) * .45; o.scale.z *= 1 + (1 - heightScale) * .3
            }
          })
        }
        for (const o of objects) {
          if (o.selector === '.arcane-coin-art') {
            const control = board.querySelector<HTMLElement>('.arcane-coin')
            const toss = control?.dataset.coinToss ?? '0', moonFace = control?.dataset.coinFace === 'Moon'
            if (o.root.userData.toss !== toss) {
              const first = o.root.userData.toss === undefined
              o.root.userData.toss = toss; o.root.userData.tossStart = time
              o.root.userData.fromAngle = o.root.rotation.x
              o.root.userData.toAngle = Math.ceil(o.root.rotation.x / (Math.PI * 2)) * Math.PI * 2 + (first ? 0 : Math.PI * 6) + (moonFace ? Math.PI : 0)
              if (first || still) o.root.rotation.x = o.root.userData.toAngle
            }
            const t = Math.min(1, Math.max(0, (time - o.root.userData.tossStart) / 1.5))
            const airborne = !still && control?.getAttribute('aria-busy') === 'true'
            const ease = 1 - Math.pow(1 - t, 2)
            o.root.rotation.x = airborne ? o.root.userData.fromAngle + (o.root.userData.toAngle - o.root.userData.fromAngle) * ease : o.root.userData.toAngle
            const settle = airborne && t > .78 ? Math.sin((t - .78) / .22 * Math.PI * 3) * (1 - t) * .35 : 0
            o.root.rotation.z = settle
            o.root.position.y = (o.root.userData.restY ?? 0) + (airborne ? Math.sin(Math.PI * t) * 1.3 : 0)
          }
          if(o.mechanisms?.length){
            const anchor=scope.querySelector(o.selector),control=anchor?.closest('button'),engaged=Boolean(!control?.disabled&&(control?.matches(':hover, :focus-visible')||control?.dataset.confirmArmed==='true'))
            if(o.root.userData.dispatchClip){
              const rect=anchor?.getBoundingClientRect(),page=anchor?.closest('.collection-index-writing'),clip=page?.getBoundingClientRect()
              o.root.visible=Boolean(rect&&clip&&rect.width&&rect.bottom>clip.top&&rect.top<clip.bottom&&Number(getComputedStyle(page!).opacity)>.98&&settled)
              anchor?.classList.toggle('shared-model-ready',o.root.visible)
            }
            const spring=stepTrinketMotion(o.root.userData.toolSpring??{value:0,velocity:0},engaged,dt,still);o.root.userData.toolSpring=spring
            o.mechanisms.forEach((part,index)=>{
              part.node.position.copy(part.position);part.node.rotation.copy(part.rotation)
              if(o.selector==='.fortune-lots-art'){
                const active=control?.getAttribute('aria-busy')==='true'
                part.node.position.y+=still?0:spring.value*(.06+index*.007)+(active ? .12+Math.sin(time*8+index)*.035 : 0)
                part.node.rotation.y+=still?0:spring.value*.18+(active?Math.sin(time*6+index)*.18:0)
              }
              else if(o.selector.includes('.dispatch-retry-art')){part.node.rotation.y+=spring.value*.12;part.node.position.y+=spring.value*.035}
              else if(o.selector.includes('.dispatch-pause-art'))part.node.rotation.y+=(control?.dataset.paused==='true' ? .50 : 0)+spring.value*.20
              else if(o.selector.includes('.dispatch-cancel-art'))part.node.rotation.y+=(index?-1:1)*spring.value*.18
              else if(o.selector.includes('query')){part.node.rotation.z+=spring.value*.11;part.node.rotation.x+=spring.value*.045}
              else if(o.selector.includes('genres')){part.node.position.y+=spring.value*(.07+index*.018);part.node.rotation.y+=spring.value*.10}
              else if(o.selector.includes('watch'))part.node.rotation.z+=spring.value*.20
              else if(o.selector.includes('erase'))part.node.rotation.x+=spring.value*.16
              else part.node.rotation.y+=spring.value*.34
            })
          }
          if (o.lid || o.packets || o.cards) {
            const control = scope.querySelector(o.selector)?.closest('a,button')
            const engaged = o.selector === '.action-codex-art' && control?.hasAttribute('disabled') ? false
              : control?.matches(':hover, :focus-visible') || control?.getAttribute('aria-pressed') === 'true' && control?.hasAttribute('disabled')
            o.open = still ? 0 : o.open + ((engaged ? 1 : 0) - o.open) * Math.min(1, dt * 7)
            const trinket = /dispatch|groups|memory/.test(o.selector)
            if (trinket) {
              const spring = stepTrinketMotion(o.root.userData.trinketSpring ?? { value: 0, velocity: 0 }, Boolean(engaged) && light > .5, dt, still)
              o.root.userData.trinketSpring = spring; o.open = spring.value
            }
            if (o.lid && o.selector === '.action-codex-art') {
              o.lid.rotation.z = o.lidStart + o.open * .18
              if (o.clasp) o.clasp.rotation.z = -Math.min(1, o.open * 2) * .65
            } else if (o.lid) o.lid.rotation.x = o.lidStart - (o.selector === '.vault-archive-art' ? 1.05 : o.open * 1.12)
            if (o.cards) o.cards.position.y = o.cardStart + o.open * .14
            if (o.cards && o.selector.includes('groups')) o.cards.rotation.y = o.cardYaw + o.open * .12
            if (o.cards && trinket) {
              const rest = o.cards.userData.trinketRest ??= { x: o.cards.position.x, z: o.cards.position.z, rx: o.cards.rotation.x, rz: o.cards.rotation.z }
              if (o.selector.includes('dispatch')) {
                o.cards.position.y = o.cardStart + o.open * .36
                o.cards.position.x = rest.x + o.open * .075
                o.cards.rotation.z = rest.rz - o.open * .13
              } else if (o.selector.includes('groups')) {
                o.cards.position.y = o.cardStart + o.open * .065
                o.cards.rotation.x = rest.rx + o.open * .19
                o.cards.rotation.y = o.cardYaw + o.open * .22
              } else {
                o.cards.position.y = o.cardStart + o.open * .075
                o.cards.rotation.y = o.cardYaw + o.open * .42
              }
            }
            if (o.packets) {
              const phase = board.dataset.phase ?? 'idle'
              if (o.root.userData.packetPhase !== phase) { o.root.userData.packetPhase = phase; o.root.userData.packetTime = time }
              const age = time - o.root.userData.packetTime
              const shuffle = !still && phase === 'shuffling' ? Math.sin(Math.min(1, age / 1.15) * Math.PI) : 0
              o.packets.forEach((packet, index) => {
                packet.node.position.copy(packet.position); packet.node.rotation.copy(packet.rotation)
                if (still) return
                const direction = index % 2 ? 1 : -1
                packet.node.position.x += direction * shuffle * .22
                packet.node.position.y += index * shuffle * .045 + (index === 2 ? o.open * .075 : 0)
                packet.node.rotation.y += direction * shuffle * .24 + (index === 2 ? o.open * .055 : 0)
                if (index === 2) packet.node.position.x += o.open * .035
                if (index === 2) packet.node.rotation.z += o.open * .035
              })
            }
          }
        }
        liveCards?.update(light, dt, still)
        renderer.render(scene, camera)
      }
      const sync = () => { if (frame) cancelAnimationFrame(frame); frame = 0; last = 0; if (!cancelled && visible && !document.hidden && !graphicsLost) frame = requestAnimationFrame(draw) }
      const observer = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync() }); observer.observe(board)
      const resize = new ResizeObserver(place); resize.observe(board)
      document.addEventListener('visibilitychange', sync)
      const lost = (e: Event) => {
        e.preventDefault(); graphicsLost = true; releaseDispatchModels?.(); liveCards?.hide(); setReady(false); board.classList.remove('shared-scene-ready')
        scope.querySelectorAll('.shared-model-ready').forEach((e) => e.classList.remove('shared-model-ready'))
        visible = false; sync()
      }
      renderer.domElement.addEventListener('webglcontextlost', lost)
      release = () => {
        if (frame) cancelAnimationFrame(frame)
        releaseDispatchModels?.()
        resize.disconnect(); observer.disconnect(); document.removeEventListener('visibilitychange', sync)
        renderer.domElement.removeEventListener('webglcontextlost', lost); board.classList.remove('shared-scene-ready')
        liveCards?.dispose(); dispose(scene); disposal.forEach((t) => t.dispose()); env.dispose(); flameLight.shadow.map?.dispose(); freeRenderer()
        scope.querySelectorAll('.shared-model-ready').forEach((e) => e.classList.remove('shared-model-ready'))
        board.style.removeProperty('--candle-light'); board.style.removeProperty('--candle-flicker')
      }
      await Promise.allSettled(pending)
      if (cancelled) { release(); return }
      place(); setReady(true); board.classList.add('shared-scene-ready')
      if(folio)releaseDispatchModels=watchDispatchModels(scope as HTMLElement,load,root=>{
        const index=objects.findIndex(item=>item.root===root)
        if(index>=0){const selector=objects[index].selector;objects.splice(index,1);if(!objects.some(item=>item.selector===selector))scope.querySelector(selector)?.classList.remove('shared-model-ready')}
        root.removeFromParent();dispose(root)
      },place)
      sync()
    }).catch(() => { release?.(); setReady(false) })
    return () => { cancelled = true; release?.(); setReady(false) }
  }, [effects, folio, staticOnly, workspace, portraitFolio, vault, sceneRevision])
  const quick = import.meta.env.DEV && new URLSearchParams(location.search).get('candle-test') === '1'
  const waxHeight = candle.phase === 'relighting' && !reducedMotion() ? .28 + .72 * Math.min(1, candle.transition / 1600) : 1 - Math.min(1, candle.burned / (quick ? 14000 : CANDLE_BURN_MS)) * .72
  const flameStrength = candle.phase === 'moonlight' ? 0 : candle.phase === 'guttering' ? Math.max(0, 1 - candle.transition / 4500) : candle.phase === 'relighting' ? Math.min(1, candle.transition / 1600) : 1
  const candleArt = <span className="candle-model-anchor" aria-hidden="true"><span className="candle-fallback-art"><img src={candleHolder} alt="" /><span className="candle-wax-sprite" style={{ transform: `scaleY(${waxHeight})`, transformOrigin: `50% ${CANDLE_WAX_BASE_Y * 100}%` }}><img src={candleWax} alt="" /></span><span key={tend} className={`candle-fallback-flame ${tend ? 'flame-tended' : ''}`} style={{ left: `calc(${CANDLE_WICK_X * 100}% - 4px)`, top: `calc(${(CANDLE_WAX_BASE_Y + (CANDLE_WICK_Y - CANDLE_WAX_BASE_Y) * waxHeight) * 100}% - 20px)`, opacity: flameStrength }} /></span></span>
  return <>
    <button type="button" className="candle-anchor candle-object" inert={!interactive} data-candle-tend={tend} aria-label="Tend the candle" aria-haspopup="dialog" aria-expanded={lightingOpen} onClick={() => { setTend((value) => value + 1); setLightingOpen(true) }}>{candleArt}<span className="candle-label">Adjust lighting</span></button>
    {lightingOpen && (LightingDrawer && !workspace
      ? <Suspense fallback={null}><LightingDrawer mode="lighting" motion={!reducedMotion() && !host.current?.closest('.no-table-motion')} onClosed={() => setLightingOpen(false)} /></Suspense>
      : <Sheet title="By candlelight" onClose={() => setLightingOpen(false)} className="arcane-candle-dialog"><p className="arcane-candle-note">Set the atmosphere at your table. Your candle keeps its slow burn.</p><ArcaneLightControls /></Sheet>)}
    <div ref={host} className={`arcane-lighting ${ready ? 'lighting-ready' : ''}`} aria-hidden="true" />
    <div className={`arcane-moon-veil phase-${candle.phase}`} aria-hidden="true" />
  </>
}
