import { useEffect, useRef, useState } from 'react'
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
import { deskPose, drawerPose } from '../lib/deskSequence'
import { createBaizeMaps, createContactShadow } from '../lib/arcaneBaize'

const models = {
  library: () => import('../assets/card-table/archive-chest-v2.glb?url'),
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
  lightingReset: () => import('../assets/card-table/lighting-tuning-fork-v1.glb?url'),
}

/** One temporary canvas for the cabinet, released when it closes. Native links own input. */
export default function ArcaneDeskInstruments({ motion, mode = 'desk' }: { motion: boolean; mode?: 'desk' | 'lighting' }) {
  const host = useRef<HTMLDivElement>(null), effects = useThemeEffects()
  const [portrait, setPortrait] = useState(() => innerWidth / innerHeight < .85)
  useEffect(() => {
    const cabinet = host.current?.parentElement
    if (!cabinet) return
    const observer = new ResizeObserver(() => setPortrait(cabinet.clientWidth / Math.max(1, cabinet.clientHeight) < .85))
    observer.observe(cabinet); return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const element = host.current, cabinet = element?.parentElement, nav = cabinet?.querySelector<HTMLElement>('[data-desk-content]')
    if (!element || !cabinet || !nav || !effects) return
    let cancelled = false, frame = 0, release: (() => void) | undefined
    const fallback = () => { delete cabinet.dataset.caseReady;cabinet.dataset.caseFailed='true'; nav.querySelectorAll('[data-model-ready]').forEach((node) => node.removeAttribute('data-model-ready')) }
    delete cabinet.dataset.caseFailed
    void Promise.all([import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/environments/RoomEnvironment.js')]).then(async ([T, { GLTFLoader }, { RoomEnvironment }]) => {
      if (cancelled) return
      let renderer: Three.WebGLRenderer
      try { renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }) } catch { fallback();return }
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 600 ? 1 : 1.5))
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.shadowMap.enabled = innerWidth >= 600; renderer.shadowMap.type = T.PCFSoftShadowMap
      renderer.localClippingEnabled = true
      renderer.domElement.setAttribute('aria-hidden', 'true'); element.appendChild(renderer.domElement)
      release=()=>{fallback();renderer.dispose();renderer.domElement.remove()}
      const scene = new T.Scene(), camera = new T.OrthographicCamera(-6, 6, 6, -6, .1, 100)
      camera.position.set(0, 12, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true)
      const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(), env = pmrem.fromScene(room, .04)
      room.dispose(); pmrem.dispose(); scene.environment = env.texture; scene.environmentIntensity = .3
      scene.add(new T.HemisphereLight(0xb7d1e8, 0x302719, 1.3))
      const moon = new T.DirectionalLight(0x729fdb, 1.4); moon.position.set(-5, 10, 3); scene.add(moon)
      const warm = new T.PointLight(0xffbd6a, 18, 40, 2); warm.castShadow = innerWidth >= 600; warm.shadow.mapSize.set(1024, 1024); warm.shadow.normalBias = .015; scene.add(warm)
      warm.shadow.intensity=.6;warm.shadow.radius=6
      const shadow = new T.Mesh(new T.PlaneGeometry(70, 70), new T.ShadowMaterial({ opacity: .3 }))
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.03; shadow.receiveShadow = true; scene.add(shadow)
      shadow.visible = false // The modeled velvet/baize now receives the actual contact shadows.
      const grain = createPropGrain(T), loader = new GLTFLoader(), ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0)
      const textureLoader = new T.TextureLoader(), textures = new Set<Three.Texture>([grain])
      const baize=createBaizeMaps(T);Object.values(baize).forEach(texture=>textures.add(texture))
      const contactTexture=createContactShadow(T);textures.add(contactTexture)
      const ground = (x: number, y: number) => { ray.setFromCamera(new T.Vector2(x, y), camera); return ray.ray.intersectPlane(plane, new T.Vector3()) ?? new T.Vector3() }
      type Part = { node: Three.Object3D; position: Three.Vector3; rotation: Three.Euler; scale: Three.Vector3 }
      type Instrument = { id: string; link: HTMLElement; image: HTMLImageElement; root: Three.Group; box: Three.Box3; spring: TrinketSpring; parts: Part[]; origin: Three.Vector3; contact: Three.Mesh }
      const objects: Instrument[] = []
      const clipPlanes = Array.from({ length: 4 }, () => new T.Plane())
      const dispose = (root: Three.Object3D) => root.traverse((node) => {
        const mesh = node as Three.Mesh
        mesh.geometry?.dispose()
        const materials = mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []
        for (const material of materials) { for (const value of Object.values(material)) if (value instanceof T.Texture && value !== grain && value !== env.texture) value.dispose(); material.dispose() }
      })
      let released = false,onContextLost:((event:Event)=>void)|undefined
      release = () => {
        if (released) return
        released = true;cancelAnimationFrame(frame);fallback()
        if(onContextLost)renderer.domElement.removeEventListener('webglcontextlost',onContextLost)
        dispose(scene);textures.forEach(t=>t.dispose());env.dispose();warm.shadow.map?.dispose()
        const context=renderer.getContext();renderer.dispose()
        if(!context.isContextLost())renderer.forceContextLoss()
        renderer.domElement.remove()
      }
      if (cancelled) { release(); return }
      onContextLost = (event: Event) => { event.preventDefault(); cancelled = true; release?.() }
      renderer.domElement.addEventListener('webglcontextlost', onContextLost, { once: true })
      const loadTexture = async (url: string) => {
        const texture = await textureLoader.loadAsync(url)
        if (cancelled || released) { texture.dispose(); throw Error('Cabinet closed') }
        texture.colorSpace = T.SRGBColorSpace; textures.add(texture); return texture
      }
      const [back, folio] = await Promise.all([loadTexture(backURL), loadTexture(folioURL)])
      const caseURL = portrait ? await import('../assets/card-table/arcane-desk-portrait-v1.glb?url') : await import('../assets/card-table/arcane-desk-wide-v1.glb?url')
      const desk = (await loader.loadAsync(caseURL.default)).scene
      if (cancelled || released) { dispose(desk); return }
      scene.add(desk)
      desk.traverse((node) => {
        const mesh = node as Three.Mesh
        if (!mesh.isMesh) return
        mesh.castShadow = true; mesh.receiveShadow = true
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const m = material as Three.MeshStandardMaterial
          if(/baize/i.test(m.name)&&m.isMeshStandardMaterial){m.map=baize.color;m.color.set(0xffffff);m.normalMap=baize.normal;m.normalScale.set(.22,.22);m.roughnessMap=baize.roughness;m.roughness=.94;m.metalness=0;m.needsUpdate=true}
          if (m.isMeshStandardMaterial && mesh.geometry.getAttribute('uv') && !m.normalMap) { m.bumpMap = grain; m.bumpScale = /velvet/i.test(m.name) ? .006 : .002; m.needsUpdate = true }
        }
      })
      const hinge = desk.getObjectByName('DeskLidHinge'), travel = desk.getObjectByName('DeskKeyTravel'), keyTurn = desk.getObjectByName('DeskKeyTurn'), lock = desk.getObjectByName('DeskLockTurn'), bolt = desk.getObjectByName('LockBolt'), drawer = desk.getObjectByName('LightingDrawer')
      const rest = { hinge: hinge?.quaternion.clone(), travel: travel?.position.clone(), key: keyTurn?.quaternion.clone(), lock: lock?.quaternion.clone(), bolt: bolt?.position.clone() }
      const drawerRest = drawer?.position.clone(), drawerLength = portrait ? 7 : 4.4, lighting = mode === 'lighting'
      const dustPositions=new Float32Array(14*3),dustDelays=new Float32Array(14)
      for(let i=0;i<14;i++){const a=i*2.399,r=.3+(i*37%97)/140;dustPositions.set([Math.cos(a)*r,Math.sin(a)*.35,Math.sin(a)*r*.4],i*3);dustDelays[i]=i/14*.18}
      const dustGeometry=new T.BufferGeometry();dustGeometry.setAttribute('position',new T.BufferAttribute(dustPositions,3));dustGeometry.setAttribute('delay',new T.BufferAttribute(dustDelays,1))
      const dustMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,uniforms:{age:{value:2},strength:{value:0}},
        vertexShader:'attribute float delay;uniform float age;uniform float strength;varying float alpha;void main(){float t=max(0.,age-delay);float life=1.-smoothstep(.2,1.,t);vec3 p=position*(.10+t*.40);p.y+=t*.35;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=1.4+life*2.;alpha=step(delay,age)*life*strength*.35;}',
        fragmentShader:'varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(.92,.73,.38,pow(max(0.,1.-r),2.)*alpha);}'})
      const lockDust=new T.Points(dustGeometry,dustMaterial);scene.add(lockDust)
      const lockAccent=new T.PointLight(0x9dcfff,0,2.2,2);scene.add(lockAccent)
      const turnAxis = new T.Vector3(1, 0, 0), hingeAxis = new T.Vector3(1, 0, 0), yawAxis = new T.Vector3(0,1,0), barrelAxis = new T.Vector3(0, 0, -1), turnQuat = new T.Quaternion()
      const caseWidth = portrait ? 6.6 : 10.6, caseLength = portrait ? 14 : 7.2
      const floorCorners = [new T.Vector3(-caseWidth/2+.5,.06,-caseLength/2+.5),new T.Vector3(caseWidth/2-.5,.06,-caseLength/2+.5),new T.Vector3(-caseWidth/2+.5,.06,caseLength/2-.5),new T.Vector3(caseWidth/2-.5,.06,caseLength/2-.5)]
      void Promise.allSettled([...nav.querySelectorAll<HTMLElement>('[data-trinket]')].map(async (link) => {
        const id = link.dataset.trinket as keyof typeof models, image = link.querySelector('img')
        if (!image || !models[id]) return
        const url = await models[id](), gltf = await loader.loadAsync(url.default)
        if (cancelled || released) { dispose(gltf.scene); return }
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
            material.clippingPlanes = clipPlanes; material.clipShadows = true
            const p = material as Three.MeshStandardMaterial
            if (p.isMeshStandardMaterial && mesh.geometry.getAttribute('uv') && !p.normalMap) { p.bumpMap = grain; p.bumpScale = p.metalness > .4 ? .008 : .015; p.needsUpdate = true }
          }
        })
        root.updateMatrixWorld(true)
        const contact=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:contactTexture,transparent:true,depthWrite:false,toneMapped:false,clippingPlanes:clipPlanes}));contact.rotation.x=-Math.PI/2;scene.add(contact)
        objects.push({ id, image, link, root, parts, box: new T.Box3().setFromObject(root), spring: { value: 0, velocity: 0 }, origin: new T.Vector3(),contact })
      }))
      if (cancelled) return
      let last = 0, time = 0, width = 0, height = 0, layoutStamp='',previousProgress=0,cameraPlaced=false
      const desiredPosition=new T.Vector3(),desiredTarget=new T.Vector3(),cameraTarget=new T.Vector3()
      const draw = (now: number) => {
        if (cancelled) return
        frame = requestAnimationFrame(draw)
        if (document.hidden || (last && now - last < (motion ? innerWidth < 600 ? 50 : 33 : 150))) return
        const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now; time += dt
        const base = cabinet.getBoundingClientRect()
        if (base.width < 1 || base.height < 1) return
        if (width !== base.width || height !== base.height) {
          width = base.width; height = base.height; renderer.setSize(width, height, false)
          renderer.shadowMap.enabled=width>=600;warm.castShadow=renderer.shadowMap.enabled
          renderer.setPixelRatio(Math.min(devicePixelRatio||1,width<600?1:1.5))
        }
        const progress = Number(cabinet.dataset.deskProgress ?? (motion ? 0 : 1)), pose = deskPose(lighting ? 0 : progress), drawerState = drawerPose(lighting ? progress : 0)
        const half = lighting ? (portrait ? 4.4 : 6) * (1-drawerState.camera) + (portrait ? 3.4 : 4.15) * drawerState.camera : portrait ? 4.4 : 6
        camera.left = -half; camera.right = half; camera.top = half * height / width; camera.bottom = -camera.top
        // A gentle approach to the opened writing surface, keeping the lock in view.
        let desiredZoom=1
        if (lighting) {
          const c=drawerState.camera, focusZ=caseLength/2+drawerLength*.32, x=portrait?0:-.15
          desiredPosition.set(x*c,(portrait?18:12)*(1-c)+(portrait?14:10)*c,(portrait?6.5:12)*(1-c)+(focusZ+(portrait?5:7))*c)
          desiredTarget.set(x*c,-.65*c,focusZ*c)
        } else {
          desiredPosition.set(.25 * (1 - pose.camera), portrait ? 18 : 12, portrait ? 6.5 : 12)
          desiredTarget.set(0,0,.35 * pose.camera + (portrait ? 2 : 1.2) * pose.keyFocus);desiredZoom=.96+.055*pose.camera+.14*pose.keyFocus
        }
        const approach=motion&&cameraPlaced?1-Math.exp(-dt*10):1
        camera.position.lerp(desiredPosition,approach);cameraTarget.lerp(desiredTarget,approach);camera.lookAt(cameraTarget);camera.zoom+=(desiredZoom-camera.zoom)*approach;cameraPlaced=true
        camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
        if (hinge && rest.hinge) hinge.quaternion.copy(rest.hinge).multiply(turnQuat.setFromAxisAngle(hingeAxis, -105 * Math.PI / 180 * pose.lid))
        if (travel && rest.travel) {
          travel.position.copy(rest.travel); travel.position.x *= 1-pose.keyTravel
          travel.position.z += 1.40*pose.keyTravel;travel.position.y -= .51*pose.keyTravel
          travel.position.y += Math.sin(pose.keyTravel*Math.PI)*.18
        }
        if (keyTurn && rest.key) keyTurn.quaternion.copy(rest.key).multiply(turnQuat.setFromAxisAngle(yawAxis,Math.PI/2*pose.keyTravel)).multiply(new T.Quaternion().setFromAxisAngle(turnAxis, Math.PI / 2 * pose.keyTurn))
        if (lock && rest.lock) lock.quaternion.copy(rest.lock).multiply(turnQuat.setFromAxisAngle(barrelAxis, Math.PI / 2 * pose.keyTurn))
        if (bolt && rest.bolt) { bolt.position.copy(rest.bolt); bolt.position.x += .52 * pose.bolt }
        if (drawer && drawerRest) { drawer.position.copy(drawerRest); drawer.position.z += drawerLength * .82 * drawerState.travel }
        desk.updateMatrixWorld(true)
        let surfaceCorners = floorCorners
        const drawerFloor = desk.getObjectByName('DrawerBaize')
        if (lighting && drawerFloor) {
          const box = new T.Box3().setFromObject(drawerFloor);box.min.z=Math.min(box.max.z-.05,Math.max(box.min.z,caseLength/2+.12))
          surfaceCorners=[];for(const x of [box.min.x,box.max.x])for(const z of [box.min.z,box.max.z])surfaceCorners.push(new T.Vector3(x,box.max.y,z))
        }
        const projected = surfaceCorners.map(p => p.clone().project(camera))
        const left = Math.max(8,(Math.min(...projected.map(p=>p.x))+1)*width/2 + 5), right = Math.min(width-8,(Math.max(...projected.map(p=>p.x))+1)*width/2 - 5)
        const top = (1-Math.max(...projected.map(p=>p.y)))*height/2, bottom = (1-Math.min(...projected.map(p=>p.y)))*height/2
        const stamp=[left,right,top,bottom].map(value=>Math.round(value*100)).join(':')
        if(stamp!==layoutStamp){
          cabinet.style.setProperty('--desk-floor-left', `${left}px`); cabinet.style.setProperty('--desk-floor-width', `${Math.max(120,right-left)}px`)
          cabinet.style.setProperty('--desk-heading-top', `${top+8}px`); cabinet.style.setProperty('--desk-floor-top', `${top+(lighting?62:portrait?75:65)}px`)
          cabinet.style.setProperty('--desk-floor-height', `${Math.max(100,bottom-top-(lighting?70:portrait?82:72))}px`)
          layoutStamp=stamp
        }
        const keyBow = desk.getObjectByName(lighting ? 'DrawerPull' : 'KeyBow'), latch = cabinet.querySelector<HTMLElement>('.drawer-latch')
        if (keyBow && latch) {
          const p = new T.Box3().setFromObject(keyBow).getCenter(new T.Vector3()).project(camera)
          latch.style.left = `${Math.max(5,Math.min(width-89,(p.x+1)*width/2-42))}px`
          latch.style.top = `${Math.max(5,Math.min(height-86,(1-p.y)*height/2-30))}px`
        }
        const clip = nav.getBoundingClientRect(), rightAxis = new T.Vector3().setFromMatrixColumn(camera.matrixWorld,0), upAxis = new T.Vector3().setFromMatrixColumn(camera.matrixWorld,1)
        const x0=(clip.left-base.left)/width*2-1,x1=(clip.right-base.left)/width*2-1,y0=1-(clip.bottom-base.top)/height*2,y1=1-(clip.top-base.top)/height*2
        clipPlanes[0].setFromNormalAndCoplanarPoint(rightAxis,new T.Vector3(x0,0,0).unproject(camera))
        clipPlanes[1].setFromNormalAndCoplanarPoint(rightAxis.clone().negate(),new T.Vector3(x1,0,0).unproject(camera))
        clipPlanes[2].setFromNormalAndCoplanarPoint(upAxis,new T.Vector3(0,y0,0).unproject(camera))
        clipPlanes[3].setFromNormalAndCoplanarPoint(upAxis.clone().negate(),new T.Vector3(0,y1,0).unproject(camera))
        const settings = getArcaneScene(), candle = getCandle(), flicker = candleLight(time, !motion)
        const releaseAge=(progress-.36)/.32,opening=progress>=previousProgress
        lockDust.visible=motion&&!lighting&&opening&&releaseAge>=0&&releaseAge<=1
        const escutcheon=desk.getObjectByName('LockEscutcheon')
        if(escutcheon){lockDust.position.copy(new T.Box3().setFromObject(escutcheon).getCenter(new T.Vector3()));lockDust.position.z+=.08;lockAccent.position.copy(lockDust.position)}
        dustMaterial.uniforms.age.value=releaseAge;dustMaterial.uniforms.strength.value=settings.lights
        lockAccent.intensity=lockDust.visible?Math.sin(Math.PI*Math.max(0,Math.min(1,releaseAge)))*1.2*settings.lights:0
        previousProgress=progress
        renderer.toneMappingExposure = 1.15 * settings.brightness
        const candleRect = cabinet.closest('.celestial-table')?.querySelector('.candle-anchor')?.getBoundingClientRect()
        const candlePoint = candleRect ? ground((candleRect.left + candleRect.width / 2 - base.left) / width * 2 - 1, 1 - (candleRect.top + candleRect.height / 2 - base.top) / height * 2) : new T.Vector3(4, 0, -4)
        warm.position.copy(candlePoint); warm.position.y = 3
        const flame = candle.phase === 'moonlight' ? 0 : candle.phase === 'guttering' ? Math.max(0, 1 - candle.transition / 4500) : candle.phase === 'relighting' ? Math.min(1, candle.transition / 1600) : 1
        warm.intensity = 18 * flame * flicker.intensity * settings.lights
        for (const o of objects) {
          const rect = o.image.getBoundingClientRect()
          o.root.visible = (lighting ? drawerState.contents : pose.contents) > .02 && rect.bottom > clip.top && rect.top < clip.bottom && rect.width > 0
          o.contact.visible=o.root.visible&&!renderer.shadowMap.enabled
          if (!o.root.visible) continue
          o.spring = stepTrinketMotion(o.spring, o.link.matches(':hover,:focus-visible'), dt, !motion)
          const e = o.spring.value
          o.root.position.set(0, 0, 0); o.root.rotation.set(0, 0, 0); o.root.scale.setScalar(1)
          const points: Three.Vector3[] = []
          for (const x of [o.box.min.x, o.box.max.x]) for (const y of [o.box.min.y, o.box.max.y]) for (const z of [o.box.min.z, o.box.max.z]) points.push(new T.Vector3(x, y, z).project(camera))
          const spanX = Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), spanY = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))
          o.root.scale.setScalar(Math.min(rect.width / (spanX * width / 2), rect.height / (spanY * height / 2)) * .82)
          o.root.position.y = (lighting ? -.73 : .07) - o.box.min.y * o.root.scale.y
          o.root.updateMatrixWorld(true)
          const center = new T.Box3().setFromObject(o.root).getCenter(new T.Vector3()).project(camera)
          const target = ground((rect.left + rect.width / 2 - base.left) / width * 2 - 1, 1 - (rect.top + rect.height / 2 - base.top) / height * 2)
          o.root.position.add(target.sub(ground(center.x, center.y))); o.origin.copy(o.root.position)
          for (const p of o.parts) {
            const n = p.node, name = n.name
            n.position.copy(p.position); n.rotation.copy(p.rotation); n.scale.copy(p.scale)
            if (o.id === 'library' && name === 'ChestLid') n.rotation.x -= e * .85
            if (o.id === 'mylist' && name === 'CodexCoverPivot') n.rotation.z += e * .25
            if (o.id === 'music' && name.startsWith('LyreString')) n.rotation.y += Math.sin(time * 38 + p.position.x * 10) * e * .015
            if (o.id === 'lightingReset' && name.startsWith('TuningFork')) n.rotation.y += Math.sin(time*42)*e*.015
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
              n.visible = rect.top >= clip.top && rect.bottom <= clip.bottom
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
          if(o.contact.visible){
            const bounds=new T.Box3().setFromObject(o.root),center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3())
            o.contact.position.set(center.x,lighting?-.735:.062,center.z);o.contact.scale.set(Math.max(.12,size.x*.9),Math.max(.12,size.z*.9),1)
          }
          o.link.dataset.modelReady = 'true'
        }
        renderer.setScissorTest(false); renderer.render(scene, camera)
        if(cabinet.dataset.caseReady!=='true')cabinet.dataset.caseReady = 'true'
      }
      frame = requestAnimationFrame(draw)
    }).catch(() => { fallback(); release?.() })
    return () => { cancelled = true; cancelAnimationFrame(frame); release?.() }
  }, [effects, motion, portrait, mode])
  return <div className="desk-instrument-scene" ref={host} aria-hidden="true" />
}
