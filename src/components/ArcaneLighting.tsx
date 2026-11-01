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
import './arcane-lighting.css'

/** One light space for the candle, orb, boxes, folio and receiving desk. Native UI remains above it. */
export default function ArcaneLighting({ folio = false, staticOnly = false }: { folio?: boolean; staticOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const effects = useThemeEffects()
  const candle = useCandle()
  const [ready, setReady] = useState(false)
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
    ]).then(async ([T, { GLTFLoader }, { RoomEnvironment }, candleURL, orbURL, movieURL, showURL, folioURL, deskURL, folioArtURL, backURL]) => {
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
      const flameLight = new T.PointLight(0xffb55b, 18, 13, 1.7)
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
      const deskMesh = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshStandardMaterial({ map: desk, roughness: .85, metalness: .12 }))
      deskMesh.rotation.x = -Math.PI / 2; deskMesh.receiveShadow = true; scene.add(deskMesh)
      const liveCards = createLiveCards(T, scene, camera, board, frameTexture, ground, scope as HTMLElement, folio)
      const objects: { root: InstanceType<typeof T.Group>; selector: string; lid?: InstanceType<typeof T.Object3D>; cards?: InstanceType<typeof T.Object3D>; open: number; lidStart: number; cardStart: number }[] = []
      const orbs: { material: InstanceType<typeof T.ShaderMaterial>; sparkle: InstanceType<typeof T.ShaderMaterial>; stars: InstanceType<typeof T.Points> }[] = []
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
        const lid = root.getObjectByName('LidPivot'), cards = root.getObjectByName('CardLift')
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
          stars.position.y = 1.38; gltf.scene.add(stars); orbs.push({ material, sparkle, stars })
          const blueLight = new T.PointLight(0x557fc9, 2.5, 4, 2); blueLight.position.y = 1.45; gltf.scene.add(blueLight)
        }
        objects.push({ root, selector, lid, cards, open: 0, lidStart: lid?.rotation.x ?? 0, cardStart: cards?.position.y ?? 0 })
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
      const pending = [load(candleURL.default, '.candle-anchor').then((o) => {
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
      }
      const flameMaterial = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        uniforms: { time: { value: 0 }, strength: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: `varying vec2 vUv; uniform float time; uniform float strength;
          void main(){vec2 p=vUv; p.x-=.5+sin(p.y*7.-time*4.)*.045*p.y;
          float width=.20*pow(max(.001,1.-p.y),.6); float shape=smoothstep(width,width*.2,abs(p.x));
          float a=shape*smoothstep(0.,.12,p.y)*smoothstep(1.,.65,p.y)*strength;
          vec3 c=mix(vec3(.12,.35,1.),vec3(1.,.43,.075),smoothstep(.02,.25,p.y));
          c=mix(c,vec3(1.,.94,.68),pow(shape,4.)*.8);gl_FragColor=vec4(c*1.8,a);}` })
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
      const place = () => {
        if (graphicsLost || cancelled) return
        const bounds = board.getBoundingClientRect()
        width = Math.max(1, bounds.width); height = Math.max(1, bounds.height)
        renderer.setSize(width, height, false); camera.top = 6 * height / width; camera.bottom = -camera.top; camera.updateProjectionMatrix()
        camera.updateMatrixWorld(true)
        // A phone is a close view of the hide, not a vertically stretched desktop illustration.
        if (width < 760 && folio) { const crop = Math.min(.8, width / height / 1.5 * .7); desk.repeat.set(crop, .7); desk.offset.set((1 - crop) / 2, .15) }
        else if (width < 760) { const crop = Math.min(1, width / height / 1.5); desk.repeat.set(crop, 1); desk.offset.set((1 - crop) / 2, 0) }
        else { desk.repeat.set(1, 1); desk.offset.set(0, 0) }
        deskMesh.scale.set(12, camera.top * 2 * Math.SQRT2, 1)
        for (const o of objects) {
          const anchor = scope.querySelector(o.selector), rect = anchor?.getBoundingClientRect()
          if (o.selector.includes('.folio-spread') && innerWidth < 760) { o.root.visible = false; anchor?.classList.remove('shared-model-ready'); continue }
          o.root.visible = Boolean(rect && rect.width > 0)
          if (!rect || !rect.width) continue
          if (o.selector.includes('deck-box-object')) {
            o.root.rotation.y = (parseFloat(getComputedStyle(anchor!).getPropertyValue('--object-angle')) || 0) * Math.PI / 180
          }
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
        }
      }
      const draw = (now: number) => {
        frame = 0
        if (cancelled || document.hidden || !visible || graphicsLost) { last = 0; return }
        frame = requestAnimationFrame(draw)
        const still = systemMotion.matches || document.documentElement.dataset.motion === 'reduce' || board.closest('.no-table-motion') !== null
        if (last && now - last < (still ? 100 : innerWidth < 600 ? 50 : 33)) return
        const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now; time += dt
        const state = getCandle()
        if (state.phase !== previousPhase) { if (state.phase === 'moonlight') moonSince = time; previousPhase = state.phase }
        const target = state.phase === 'moonlight' ? 0 : state.phase === 'guttering' ? Math.max(0, 1 - state.transition / 4500) : state.phase === 'relighting' ? Math.min(1, state.transition / 1600) : 1
        light += (target - light) * Math.min(1, dt * 3)
        const flicker = still ? 1 : 1 + Math.sin(time * 7.3) * .055 + Math.sin(time * 13.1 + .8) * .025
        flameLight.intensity = 5 * light * flicker; ambient.intensity = .42 + light * .7; moon.intensity = 1.1 - light * .6
        scene.environmentIntensity = .12 + light * .23
        flameMaterial.uniforms.time.value = still ? 0 : time; flameMaterial.uniforms.strength.value = light
        flame.visible = light > .005
        smokeMaterial.uniforms.time.value = still ? 0 : time
        smokeMaterial.uniforms.opacity.value = still ? 0 : state.phase === 'guttering' && state.transition > 3500 ? Math.sin(Math.min(1, (state.transition - 3500) / 4500) * Math.PI) : state.phase === 'moonlight' ? Math.max(0, 1 - (time - moonSince) / 3.5) * .6 : 0
        emberMaterial.opacity = state.phase === 'guttering' ? Math.max(0, (state.transition - 4000) / 2000) * .8 : state.phase === 'moonlight' ? Math.max(0, 1 - (time - moonSince) / 3) * .8 : 0
        dust.visible = !still; if (!still) dust.rotation.y = time * .003
        for (const orb of orbs) {
          orb.material.uniforms.time.value = still ? 0 : time; orb.sparkle.uniforms.time.value = still ? 0 : time
          const engaged = scope.querySelector('.search-object, .arcane-search-trinket')?.matches(':hover, :focus-visible')
          orb.material.uniforms.energy.value += ((engaged ? .9 : .2) - orb.material.uniforms.energy.value) * .08
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
            flame.position.copy(tip); flame.position.y += .18 * candleModel.scale.y
            flame.scale.setScalar(candleModel.scale.y); flame.quaternion.copy(camera.quaternion)
            flameLight.position.copy(tip); flameLight.position.y += .45
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
          if (o.lid) {
            const control = board.querySelector(o.selector)?.closest('button')
            const engaged = control?.matches(':hover, :focus-visible') || control?.getAttribute('aria-pressed') === 'true' && control?.hasAttribute('disabled')
            o.open = still ? 0 : o.open + ((engaged ? 1 : 0) - o.open) * Math.min(1, dt * 7)
            o.lid.rotation.x = o.lidStart - o.open * 1.12
            if (o.cards) o.cards.position.y = o.cardStart + o.open * .14
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
  return <>
    <div className="candle-anchor" aria-hidden="true"><span className="candle-fallback-art"><img src={candleHolder} alt="" /><span className="candle-wax-sprite" style={{ transform: `scaleY(${waxHeight})`, transformOrigin: `50% ${CANDLE_WAX_BASE_Y * 100}%` }}><img src={candleWax} alt="" /></span><span className="candle-fallback-flame" style={{ left: `calc(${CANDLE_WICK_X * 100}% - 4px)`, top: `calc(${(CANDLE_WAX_BASE_Y + (CANDLE_WICK_Y - CANDLE_WAX_BASE_Y) * waxHeight) * 100}% - 20px)`, opacity: flameStrength }} /></span></div>
    <div ref={host} className={`arcane-lighting ${ready ? 'lighting-ready' : ''}`} aria-hidden="true" />
    <div className={`arcane-moon-veil phase-${candle.phase}`} aria-hidden="true" />
  </>
}
