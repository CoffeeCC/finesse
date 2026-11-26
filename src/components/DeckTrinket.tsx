import { useEffect, useRef, useState } from 'react'
import { IS_TV } from '../lib/device'
import DeckTrinketStill, { type DeckTrinketProps } from './DeckTrinketStill'

/** Optional lit artwork; the containing library button owns all interaction. */
export default function DeckTrinket(props: DeckTrinketProps) {
  const { kind, enabled, reduced } = props
  const host = useRef<HTMLSpanElement>(null)
  const state = useRef(props)
  state.current = props
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(false)
    const element = host.current
    if (__WEBOS__ || !element || !enabled || reduced || IS_TV) return
    let cancelled = false
    let dispose: (() => void) | undefined
    void Promise.all([
      import('three'), import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/environments/RoomEnvironment.js'),
      kind === 'shows' ? import('../assets/card-table/deck-shows-v1.glb?url') : import('../assets/card-table/deck-movies-v1.glb?url'),
    ]).then(([T, { GLTFLoader }, { RoomEnvironment }, { default: url }]) => {
      if (cancelled) return
      let renderer: InstanceType<typeof T.WebGLRenderer>
      try { renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }) }
      catch { return }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25))
      renderer.setClearColor(0, 0); renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap
      renderer.domElement.setAttribute('aria-hidden', 'true'); element.appendChild(renderer.domElement)
      const scene = new T.Scene()
      const camera = new T.PerspectiveCamera(32, 1, .1, 30)
      camera.position.set(3, 2.9, 5); camera.lookAt(0, .93, 0)
      const room = new RoomEnvironment(), pmrem = new T.PMREMGenerator(renderer)
      const environment = pmrem.fromScene(room, .04); scene.environment = environment.texture; scene.environmentIntensity = .75
      room.dispose(); pmrem.dispose()
      scene.add(new T.HemisphereLight(0xa5c8e9, 0x312010, 1.7))
      const key = new T.DirectionalLight(0xffd2a0, 4)
      key.position.set(-3, 5, 4); key.target.position.set(0, .9, 0); scene.add(key.target)
      key.castShadow = true; key.shadow.mapSize.set(256, 256)
      Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: .1, far: 12 })
      key.shadow.bias = -.001; key.shadow.normalBias = .02; scene.add(key)
      const rim = new T.DirectionalLight(0x84b7ef, 2); rim.position.set(3, 3, -3); scene.add(rim)
      const color = kind === 'shows' ? 0x5c9eea : 0xe5a352
      const magic = new T.PointLight(color, 1.5, 4, 2); magic.position.set(0, .95, .45); scene.add(magic)
      const floor = new T.Mesh(new T.PlaneGeometry(5, 5), new T.ShadowMaterial({ opacity: .28 }))
      floor.rotation.x = -Math.PI / 2; floor.position.y = .005; floor.receiveShadow = true; scene.add(floor)
      const points = new Float32Array(28 * 3)
      for (let i = 0; i < 28; i++) points.set([Math.cos(i * 2.4) * .4, i / 28, Math.sin(i * 2.4) * .3], i * 3)
      const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(points, 3))
      const particlesMaterial = new T.ShaderMaterial({
        uniforms: { time: { value: 0 }, energy: { value: 0 }, tint: { value: new T.Color(color) } },
        transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        vertexShader: `uniform float time; uniform float energy; varying float a;
          void main(){vec3 p=position;float t=fract(p.y+time*.13);float turn=time*.3+p.y*5.;p.xz=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p.xz;p.y=.9+t*.95;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);gl_PointSize=2.5;a=sin(t*3.14159)*energy;}`,
        fragmentShader: `uniform vec3 tint; varying float a;void main(){float r=length(gl_PointCoord-.5);gl_FragColor=vec4(tint,smoothstep(.5,.04,r)*a);}`,
      })
      scene.add(new T.Points(geometry, particlesMaterial))
      const disposeObject = (root: InstanceType<typeof T.Object3D>) => root.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.Points) {
          o.geometry.dispose()
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose()
        }
      })
      let lid: InstanceType<typeof T.Object3D> | undefined, cards: InstanceType<typeof T.Object3D> | undefined
      let lidStart = 0, cardsStart = 0
      const wards: InstanceType<typeof T.MeshStandardMaterial>[] = []
      let frame = 0, visible = true, loaded = false, previous = 0, time = 0, energy = 0, opening = 0
      const resize = () => {
        const r = element.getBoundingClientRect(); renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false)
        camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix()
      }
      const draw = (now: number) => {
        frame = 0
        if (cancelled || !loaded || !visible || document.hidden) { previous = 0; return }
        frame = requestAnimationFrame(draw)
        if (previous && now - previous < 42) return
        time += previous ? Math.min(.1, (now - previous) / 1000) : 0; previous = now
        const { active, selected, busy } = state.current
        energy += ((busy ? .9 : active ? .8 : selected ? .3 : .03) - energy) * .12
        opening += ((active || busy ? 1 : 0) - opening) * .14
        if (lid) lid.rotation.x = lidStart - opening * 1.8
        if (cards) {
          cards.position.y = cardsStart + opening * .15 + (busy ? Math.sin(time * 9) * .025 : 0)
          cards.rotation.z = busy ? Math.sin(time * 7) * .018 : 0
        }
        magic.intensity = .6 + energy * 3 + Math.sin(time * .9) * energy * .2
        for (const m of wards) m.emissiveIntensity = .15 + energy * 1.4
        particlesMaterial.uniforms.time.value = time; particlesMaterial.uniforms.energy.value = energy * .65
        renderer.render(scene, camera)
      }
      const sync = () => {
        if (frame) cancelAnimationFrame(frame)
        frame = 0; previous = 0
        if (!cancelled && loaded && visible && !document.hidden) frame = requestAnimationFrame(draw)
      }
      const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() }); intersection.observe(element)
      const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
      resizeObserver?.observe(element); window.addEventListener('resize', resize)
      document.addEventListener('visibilitychange', sync)
      const lost = (event: Event) => { event.preventDefault(); loaded = false; setReady(false); sync() }
      renderer.domElement.addEventListener('webglcontextlost', lost); resize()
      new GLTFLoader().load(url, (gltf) => {
        if (cancelled) { disposeObject(gltf.scene); return }
        lid = gltf.scene.getObjectByName('LidPivot'); cards = gltf.scene.getObjectByName('CardLift')
        lidStart = lid?.rotation.x ?? 0; cardsStart = cards?.position.y ?? 0
        gltf.scene.traverse((o) => {
          if (o instanceof T.Mesh) {
            o.castShadow = true; o.receiveShadow = true
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              if (m instanceof T.MeshStandardMaterial && m.name === 'WardLight' && !wards.includes(m)) wards.push(m)
            }
          }
        })
        scene.add(gltf.scene); loaded = true; setReady(true); sync()
      }, undefined, () => { /* Keep the matching still visible. */ })
      dispose = () => {
        if (frame) cancelAnimationFrame(frame)
        intersection.disconnect(); resizeObserver?.disconnect(); window.removeEventListener('resize', resize)
        document.removeEventListener('visibilitychange', sync); renderer.domElement.removeEventListener('webglcontextlost', lost)
        disposeObject(scene); environment.dispose(); key.shadow.map?.dispose(); renderer.dispose(); renderer.domElement.remove()
      }
    }).catch(() => { /* Search and library selection do not depend on WebGL. */ })
    return () => { cancelled = true; dispose?.() }
  }, [kind, enabled, reduced])
  return <span ref={host} className={`deck-trinket-art ${ready ? 'deck-live' : ''}`} aria-hidden="true"><DeckTrinketStill {...props} /></span>
}
