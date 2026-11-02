import { useEffect, useRef, useState } from 'react'
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
import cardFrameURL from '../assets/card-table/celestial-frame-v1.webp'
import { candleLight } from '../lib/candleLight'
import { createDeskMaterial } from '../lib/arcaneDeskMaterial'
import './arcane-lighting.css'

/** One light space for the candle, orb, boxes, folio and receiving desk. Native UI remains above it. */
export default function ArcaneLighting({ folio = false, staticOnly = false }: { folio?: boolean; staticOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const effects = useThemeEffects()
  const candle = useCandle()
  const [ready, setReady] = useState(false)
  const [tend, setTend] = useState(0)
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
    ]).then(async ([T, { GLTFLoader }, { RoomEnvironment }, candleURL, orbURL, movieURL, showURL, folioURL, deskURL, folioArtURL, backURL, coinURL, codexURL, drawURL]) => {
      if (cancelled) return
      let renderer: InstanceType<typeof T.WebGLRenderer>
      try { renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }) } catch { return }
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 600 ? 1 : 1.5))
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15
      renderer.shadowMap.enabled = innerWidth >= 600; renderer.shadowMap.type = T.PCFSoftShadowMap
      renderer.domElement.setAttribute('aria-hidden', 'true'); element.appendChild(renderer.domElement)
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
      flameLight.shadow.bias = -.00015; flameLight.shadow.normalBias = .008; flameLight.shadow.radius = 3; scene.add(flameLight)
      const ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0)
      const ground = (x: number, y: number) => {
        ray.setFromCamera(new T.Vector2(x, y), camera)
        return ray.ray.intersectPlane(plane, new T.Vector3()) ?? new T.Vector3()
      }
      const texLoader = new T.TextureLoader(), gltfLoader = new GLTFLoader()
      const disposal = new Set<InstanceType<typeof T.Texture>>()
      release = () => { dispose(scene); disposal.forEach((t) => t.dispose()); env.dispose(); renderer.dispose(); renderer.domElement.remove() }
      const desk = await texLoader.loadAsync(deskURL.default)
      if (cancelled) { desk.dispose(); renderer.dispose(); renderer.domElement.remove(); env.dispose(); return }
      desk.colorSpace = T.SRGBColorSpace; disposal.add(desk)
      const backTexture = await texLoader.loadAsync(backURL.default); backTexture.colorSpace = T.SRGBColorSpace; disposal.add(backTexture)
      const frameTexture = await texLoader.loadAsync(cardFrameURL); frameTexture.colorSpace = T.SRGBColorSpace; disposal.add(frameTexture)
      if (cancelled) { disposal.forEach((t) => t.dispose()); env.dispose(); renderer.dispose(); renderer.domElement.remove(); return }
      const deskSurface = createDeskMaterial(T, desk)
      deskSurface.maps.forEach((map) => disposal.add(map))
      const deskMesh = new T.Mesh(new T.PlaneGeometry(1, 1), deskSurface.material)
      deskMesh.rotation.x = -Math.PI / 2; deskMesh.receiveShadow = true; scene.add(deskMesh)
      const liveCards = createLiveCards(T, scene, camera, board, frameTexture, ground, scope as HTMLElement, folio)
      const objects: { root: InstanceType<typeof T.Group>; selector: string; lid?: InstanceType<typeof T.Object3D>; cards?: InstanceType<typeof T.Object3D>; clasp?: InstanceType<typeof T.Object3D>; packets?: { node: InstanceType<typeof T.Object3D>; position: InstanceType<typeof T.Vector3>; rotation: InstanceType<typeof T.Euler> }[]; open: number; lidStart: number; cardStart: number }[] = []
      const orbs: { material: InstanceType<typeof T.ShaderMaterial>; sparkle: InstanceType<typeof T.ShaderMaterial>; stars: InstanceType<typeof T.Points>; lamp: InstanceType<typeof T.PointLight>; halo: InstanceType<typeof T.Mesh>; glow: InstanceType<typeof T.ShaderMaterial> }[] = []
      const folioLeaves: InstanceType<typeof T.Object3D>[] = []
      const load = async (url: string, selector: string) => {
        const gltf = await gltfLoader.loadAsync(url)
        if (cancelled) { dispose(gltf.scene); return null }
        const root = new T.Group(); root.add(gltf.scene); scene.add(root)
        if (selector.includes('.folio-spread')) {
          const art = await texLoader.loadAsync(folioArtURL.default); art.colorSpace = T.SRGBColorSpace; disposal.add(art)
          if (cancelled) { art.dispose(); root.removeFromParent(); dispose(gltf.scene); return null }
          const material = new T.MeshStandardMaterial({ map: art, transparent: true, alphaTest: .05, roughness: .78, metalness: .1, side: T.DoubleSide })
          for (const side of [-1, 1]) {
            const left = side < 0, width = left ? 3.712 : 2.688
            const pivot = gltf.scene.getObjectByName(left ? 'FolioLeftPivot' : 'FolioRightPivot') ?? new T.Group()
            if (!pivot.parent) { pivot.position.set(.512, .25, 0); gltf.scene.add(pivot) }
            const geometry = new T.PlaneGeometry(width, 4.5), uv = geometry.getAttribute('uv')
            for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (left ? .58 : .42) + (left ? 0 : .58))
            const face = new T.Mesh(geometry, material)
            face.rotation.x = -Math.PI / 2; face.position.set(side * width / 2, .09, 0); face.receiveShadow = true; pivot.add(face); folioLeaves.push(pivot)
          }
          gltf.scene.scale.z = 1.5
          gltf.scene.scale.y = .2
        }
        gltf.scene.traverse((o) => {
          if (/NebulaSource|StarSource/.test(o.name)) o.visible = false
          const mesh = o as Mesh
          if (mesh.isMesh) {
            mesh.castShadow = true; mesh.receiveShadow = true
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
              for (const value of Object.values(m)) if ((value as Texture)?.isTexture) disposal.add(value as Texture)
            }
            if (o.name === 'CrystalShell') {
              const old = mesh.material
              mesh.material = new T.MeshPhysicalMaterial({ color: 0x608fc9, metalness: .08, roughness: .12, clearcoat: 1, transparent: true, opacity: .38, depthWrite: false })
              for (const m of Array.isArray(old) ? old : [old]) m.dispose()
            }
          }
        })
        const lid = root.getObjectByName('LidPivot') ?? root.getObjectByName('CodexCoverPivot'), cards = root.getObjectByName('CardLift')
        const clasp = root.getObjectByName('CodexClaspPivot')
        const packets = selector === '.action-deck-art' ? ['PacketA', 'PacketB', 'TopCard'].flatMap((name) => {
          const node = root.getObjectByName(name); return node ? [{ node, position: node.position.clone(), rotation: node.rotation.clone() }] : []
        }) : undefined
        if (selector.includes('orb')) {
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
          const sparkle = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, uniforms: { time: { value: 0 } }, vertexShader: starVertex, fragmentShader: starFragment })
          const stars = new T.Points(geo, sparkle)
          stars.position.y = 1.38; gltf.scene.add(stars)
          const blueLight = new T.PointLight(0x69baff, 11, 9.5, 1.5); blueLight.position.y = 1.45; gltf.scene.add(blueLight)
          const glow = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
            uniforms: { strength: { value: 1 } },
            vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
            fragmentShader: 'varying vec2 vUv;uniform float strength;void main(){float r=length(vUv-.5)*2.;float a=pow(max(0.,1.-r),2.5)*.36*strength;gl_FragColor=vec4(.15,.48,1.,a);}' })
          const halo = new T.Mesh(new T.PlaneGeometry(3.8, 3.8), glow); halo.position.y = 1.38; gltf.scene.add(halo)
          orbs.push({ material, sparkle, stars, lamp: blueLight, halo, glow })
        }
        objects.push({ root, selector, lid, cards, clasp, packets, open: 0, lidStart: selector === '.action-codex-art' ? lid?.rotation.z ?? 0 : lid?.rotation.x ?? 0, cardStart: cards?.position.y ?? 0 })
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
      if (folio) {
        pending.push(load(folioURL.default, '.folio-spread, .arcane-detail-inspection').then(() => {}))
        pending.push(load(orbURL.default, '.folio-orb-art').then(() => {}))
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
      let lastLeaf = '', leafTurn = -10
      let moonSince = -10, previousPhase = ''
      let layoutAt = 0, layoutStamp = ''
      let candleHover = 0, lastTend = '0', tendAt = -10
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
          if (o.selector.includes('.folio-spread') && innerWidth < 760) { o.root.visible = false; anchor?.classList.remove('shared-model-ready'); continue }
          o.root.visible = Boolean(rect && rect.width > 0)
          if (!rect || !rect.width) continue
          if (o.selector.includes('deck-box-object')) {
            o.root.rotation.y = (parseFloat(getComputedStyle(anchor!).getPropertyValue('--object-angle')) || 0) * Math.PI / 180
          }
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
          const center = new T.Box3().setFromObject(o.root).getCenter(new T.Vector3()).project(camera)
          const target = ground((rect.left - bounds.left + rect.width / 2) / width * 2 - 1, 1 - (rect.top - bounds.top + rect.height / 2) / height * 2)
          const origin = ground(center.x, center.y); o.root.position.add(target.sub(origin))
          anchor?.classList.add('shared-model-ready')
          if (o.selector === '.arcane-coin-art') { o.root.userData.restY = o.root.position.y; o.root.userData.restZ = o.root.position.z }
        }
      }
      const draw = (now: number) => {
        frame = 0
        if (cancelled || document.hidden || !visible || graphicsLost) { last = 0; return }
        frame = requestAnimationFrame(draw)
        const still = systemMotion.matches || document.documentElement.dataset.motion === 'reduce' || board.closest('.no-table-motion') !== null
        if (last && now - last < (still ? 100 : innerWidth < 600 ? 50 : 33)) return
        const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now; time += dt
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
        const candleControl = scope.querySelector<HTMLElement>('.candle-object')
        const engagedCandle = Boolean(candleControl?.matches(':hover, :focus-visible'))
        const nextTend = candleControl?.dataset.candleTend ?? '0'
        if (nextTend !== lastTend) { lastTend = nextTend; tendAt = time }
        candleHover = still ? 0 : candleHover + ((engagedCandle ? 1 : 0) - candleHover) * Math.min(1, dt * 5)
        const tendAge = time - tendAt
        const pulse = !still && tendAge < 2 ? Math.sin(Math.min(1, tendAge / .25) * Math.PI / 2) * Math.exp(-Math.max(0, tendAge - .25) * 2.5) : 0
        flameLight.intensity = 16 * light * flicker.intensity * (1 + candleHover * .65 + pulse * .28)
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
          const engaged = scope.querySelector('.search-object, .arcane-search-trinket')?.matches(':hover, :focus-visible')
          orb.material.uniforms.energy.value += ((engaged && !still ? .9 : .2) - orb.material.uniforms.energy.value) * Math.min(1, dt * 3)
          // Cool, slow breathing belongs to the orb; never copy the candle's flutter.
          const breath = still ? 1 : 1 + Math.sin(time * .7) * .045
          const glowStrength = (.24 + light * .76) * breath * (1 + orb.material.uniforms.energy.value * .4)
          orb.lamp.intensity = 11 * glowStrength
          orb.glow.uniforms.strength.value = glowStrength
          orb.halo.quaternion.copy(camera.quaternion)
          orb.stars.rotation.y = still ? 0 : time * .045
        }
        const leaf = scope.querySelector('.folio-spread')?.getAttribute('data-leaf') ?? '-'
        if (leaf !== lastLeaf) { if (lastLeaf) leafTurn = time; lastLeaf = leaf }
        const turn = time - leafTurn, opening = Math.max(0, 1 - time / 1.5)
        folioLeaves.forEach((pivot, index) => { pivot.rotation.z = still ? 0 : (index ? 1 : -1) * (opening * .16 + (turn < .65 ? Math.sin(turn / .65 * Math.PI) * .055 : 0)) })
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
          if (o.lid || o.packets) {
            const control = scope.querySelector(o.selector)?.closest('a,button')
            const engaged = o.selector === '.action-codex-art' && control?.hasAttribute('disabled') ? false
              : control?.matches(':hover, :focus-visible') || control?.getAttribute('aria-pressed') === 'true' && control?.hasAttribute('disabled')
            o.open = still ? 0 : o.open + ((engaged ? 1 : 0) - o.open) * Math.min(1, dt * 7)
            if (o.lid && o.selector === '.action-codex-art') {
              o.lid.rotation.z = o.lidStart + o.open * .18
              if (o.clasp) o.clasp.rotation.z = -Math.min(1, o.open * 2) * .65
            } else if (o.lid) o.lid.rotation.x = o.lidStart - o.open * 1.12
            if (o.cards) o.cards.position.y = o.cardStart + o.open * .14
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
        liveCards?.update(light)
        renderer.render(scene, camera)
      }
      const sync = () => { if (frame) cancelAnimationFrame(frame); frame = 0; last = 0; if (!cancelled && visible && !document.hidden && !graphicsLost) frame = requestAnimationFrame(draw) }
      const observer = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync() }); observer.observe(board)
      const resize = new ResizeObserver(place); resize.observe(board)
      document.addEventListener('visibilitychange', sync)
      const lost = (e: Event) => {
        e.preventDefault(); graphicsLost = true; liveCards.hide(); setReady(false); board.classList.remove('shared-scene-ready')
        scope.querySelectorAll('.shared-model-ready').forEach((e) => e.classList.remove('shared-model-ready'))
        visible = false; sync()
      }
      renderer.domElement.addEventListener('webglcontextlost', lost)
      release = () => {
        if (frame) cancelAnimationFrame(frame)
        resize.disconnect(); observer.disconnect(); document.removeEventListener('visibilitychange', sync)
        renderer.domElement.removeEventListener('webglcontextlost', lost); board.classList.remove('shared-scene-ready')
        liveCards?.dispose(); dispose(scene); disposal.forEach((t) => t.dispose()); env.dispose(); flameLight.shadow.map?.dispose(); renderer.dispose(); renderer.domElement.remove()
        scope.querySelectorAll('.shared-model-ready').forEach((e) => e.classList.remove('shared-model-ready'))
        board.style.removeProperty('--candle-light'); board.style.removeProperty('--candle-flicker')
      }
      await Promise.allSettled(pending)
      if (cancelled) { release(); return }
      place(); setReady(true); board.classList.add('shared-scene-ready'); sync()
    }).catch(() => { release?.(); setReady(false) })
    return () => { cancelled = true; release?.(); setReady(false) }
  }, [effects, folio, staticOnly])
  const quick = import.meta.env.DEV && new URLSearchParams(location.search).get('candle-test') === '1'
  const waxHeight = candle.phase === 'relighting' && !reducedMotion() ? .28 + .72 * Math.min(1, candle.transition / 1600) : 1 - Math.min(1, candle.burned / (quick ? 14000 : CANDLE_BURN_MS)) * .72
  const flameStrength = candle.phase === 'moonlight' ? 0 : candle.phase === 'guttering' ? Math.max(0, 1 - candle.transition / 4500) : candle.phase === 'relighting' ? Math.min(1, candle.transition / 1600) : 1
  const candleArt = <span className="candle-model-anchor" aria-hidden="true"><span className="candle-fallback-art"><img src={candleHolder} alt="" /><span className="candle-wax-sprite" style={{ transform: `scaleY(${waxHeight})`, transformOrigin: `50% ${CANDLE_WAX_BASE_Y * 100}%` }}><img src={candleWax} alt="" /></span><span key={tend} className={`candle-fallback-flame ${tend ? 'flame-tended' : ''}`} style={{ left: `calc(${CANDLE_WICK_X * 100}% - 4px)`, top: `calc(${(CANDLE_WAX_BASE_Y + (CANDLE_WICK_Y - CANDLE_WAX_BASE_Y) * waxHeight) * 100}% - 20px)`, opacity: flameStrength }} /></span></span>
  return <>
    {folio ? <div className="candle-anchor" aria-hidden="true">{candleArt}</div>
      : <button type="button" className="candle-anchor candle-object" data-candle-tend={tend} aria-label="Tend the candle" onClick={() => setTend((value) => value + 1)}>{candleArt}<span className="candle-label">Tend flame</span></button>}
    <div ref={host} className={`arcane-lighting ${ready ? 'lighting-ready' : ''}`} aria-hidden="true" />
    <div className={`arcane-moon-veil phase-${candle.phase}`} aria-hidden="true" />
  </>
}
