import { useEffect, useRef, useState } from 'react'
import { IS_TV } from '../lib/device'
import still from '../assets/card-table/scrying-orb-still-v1.webp'

/** A decorative live scene inside a native Search button. Failure never removes Search. */
export default function ScryingOrb({ reduced, enabled, active }: { reduced: boolean; enabled: boolean; active: boolean }) {
  const host = useRef<HTMLSpanElement>(null)
  const engaged = useRef(active)
  const [ready, setReady] = useState(false)
  useEffect(() => { engaged.current = active }, [active])

  useEffect(() => {
    setReady(false)
    const element = host.current
    if (__WEBOS__ || !element || reduced || !enabled || IS_TV) return
    let cancelled = false
    let release: (() => void) | undefined
    // Keep Three out of the ordinary startup path and off older TV engines.
    void Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/environments/RoomEnvironment.js'),
      import('../assets/card-table/scrying-orb-v1.glb?url'),
    ]).then(([T, { GLTFLoader }, { RoomEnvironment }, { default: modelUrl }]) => {
      if (cancelled) return
      let renderer: InstanceType<typeof T.WebGLRenderer>
      try { renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' }) }
      catch { return }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.setClearColor(0, 0)
      renderer.toneMapping = T.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.25
      renderer.domElement.setAttribute('aria-hidden', 'true')
      element.appendChild(renderer.domElement)
      const scene = new T.Scene()
      const camera = new T.PerspectiveCamera(32, 1, .1, 30)
      camera.position.set(2.7, 2.7, 5.2)
      camera.lookAt(0, 1.08, 0)
      const room = new RoomEnvironment()
      const pmrem = new T.PMREMGenerator(renderer)
      const environment = pmrem.fromScene(room, .04)
      scene.environment = environment.texture
      scene.environmentIntensity = .8
      room.dispose(); pmrem.dispose()
      scene.add(new T.HemisphereLight(0xa0c7f3, 0x342010, 1.8))
      const key = new T.DirectionalLight(0xffd6a0, 4)
      key.position.set(-3, 5, 4); scene.add(key)
      const rim = new T.DirectionalLight(0x729dda, 2)
      rim.position.set(3, 2, -3); scene.add(rim)
      const innerLight = new T.PointLight(0x579bff, 5, 4, 2)
      innerLight.position.set(0, 1.38, .15); scene.add(innerLight)

      const nebulaMaterial = new T.ShaderMaterial({
        uniforms: { time: { value: 0 }, energy: { value: 0 } },
        transparent: true, depthWrite: false,
        vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV;
          void main(){ vP=position; vec4 p=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-p.xyz); gl_Position=projectionMatrix*p; }`,
        fragmentShader: `precision highp float;
          uniform float time; uniform float energy; varying vec3 vP; varying vec3 vN; varying vec3 vV;
          float hash(vec3 p){p=fract(p*.3183099+vec3(.17,.31,.47));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
          float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
            return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
          float fbm(vec3 p){float s=0.,a=.55;for(int i=0;i<4;i++){s+=a*noise(p);p=p*2.03+vec3(3.1,1.7,2.8);a*=.5;}return s;}
          void main(){vec3 p=vP*3.; float a=time*.12+p.y*.8; p.xz=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xz;
            float cloud=fbm(p+vec3(0.,time*.08,0.)); float tendril=fbm(p*1.8+cloud*2.-vec3(time*.06,0.,0.));
            float light=smoothstep(.38,.78,cloud*.65+tendril*.5);
            vec3 col=mix(vec3(.012,.025,.085),vec3(.055,.24,.48),light);
            col=mix(col,vec3(.37,.18,.56),smoothstep(.52,.8,tendril)*.55);
            float thread=pow(max(0.,1.-abs(cloud-.55)*12.),6.);
            col+=vec3(.18,.55,.78)*thread*(.35+energy*.3);
            float edge=pow(1.-max(0.,dot(normalize(vN),normalize(vV))),2.);
            col+=vec3(.10,.24,.38)*edge;
            gl_FragColor=vec4(col*(1.3+energy*.35),.83+edge*.13);
          }`,
      })
      const nebula = new T.Mesh(new T.SphereGeometry(.81, 40, 28), nebulaMaterial)
      nebula.position.y = 1.38; scene.add(nebula)
      const starsGeometry = new T.BufferGeometry()
      const stars = new Float32Array(72 * 3)
      for (let i = 0; i < 72; i++) {
        const y = -.65 + (i + .5) / 72 * 1.3
        const r = Math.sqrt(Math.max(0, .72 * .72 - y * y))
        stars.set([Math.cos(i * 2.39996) * r, y, Math.sin(i * 2.39996) * r], i * 3)
      }
      starsGeometry.setAttribute('position', new T.BufferAttribute(stars, 3))
      const starsMaterial = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        uniforms: { time: { value: 0 } },
        vertexShader: `uniform float time; varying float brightness; void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=3.5; brightness=.45+.4*sin(time*.9+position.y*15.+position.x*9.);}`,
        fragmentShader: `varying float brightness; void main(){float r=length(gl_PointCoord-.5);float a=smoothstep(.5,.05,r); gl_FragColor=vec4(.65,.83,1.,a*brightness);}`,
      })
      const constellation = new T.Points(starsGeometry, starsMaterial)
      constellation.position.y = 1.38; scene.add(constellation)
      const disposeObject = (root: InstanceType<typeof T.Object3D>) => root.traverse((object) => {
        if (object instanceof T.Mesh || object instanceof T.Points) {
          object.geometry.dispose()
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
        }
      })
      let frame = 0, visible = true, loaded = false, last = 0, elapsed = 0
      const resize = () => {
        const size = element.getBoundingClientRect()
        renderer.setSize(Math.max(1, size.width), Math.max(1, size.height), false)
        camera.aspect = size.width / Math.max(1, size.height); camera.updateProjectionMatrix()
      }
      const draw = (now: number) => {
        frame = 0
        if (cancelled || !visible || document.hidden || !loaded) { last = 0; return }
        frame = requestAnimationFrame(draw)
        if (last && now - last < 33) return
        elapsed += last ? Math.min(.08, (now - last) / 1000) : 0; last = now
        nebulaMaterial.uniforms.time.value = elapsed
        nebulaMaterial.uniforms.energy.value += ((engaged.current ? 1 : 0) - nebulaMaterial.uniforms.energy.value) * .08
        starsMaterial.uniforms.time.value = elapsed
        constellation.rotation.y = elapsed * .045
        innerLight.intensity = 4.5 + Math.sin(elapsed * .7) * .5 + nebulaMaterial.uniforms.energy.value * 3
        innerLight.position.x = Math.sin(elapsed * .25) * .2
        renderer.render(scene, camera)
      }
      const sync = () => {
        if (frame) cancelAnimationFrame(frame)
        frame = 0; last = 0
        if (loaded && visible && !document.hidden && !cancelled) frame = requestAnimationFrame(draw)
      }
      const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() })
      observer.observe(element)
      const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element)
      document.addEventListener('visibilitychange', sync)
      const lost = (event: Event) => { event.preventDefault(); loaded = false; setReady(false); sync() }
      renderer.domElement.addEventListener('webglcontextlost', lost)
      resize()
      new GLTFLoader().load(modelUrl, (gltf) => {
        if (cancelled) { disposeObject(gltf.scene); return }
        gltf.scene.traverse((object) => {
          if (/NebulaSource|StarSource/.test(object.name)) object.visible = false
          if (object instanceof T.Mesh && object.name === 'CrystalShell') {
            // Reflection shell is transparent so the independently animated core remains visible.
            const old = object.material
            object.material = new T.MeshPhysicalMaterial({ color: 0x6f9fc7, metalness: .02, roughness: .08, transparent: true, opacity: .16, depthWrite: false, clearcoat: 1, envMapIntensity: 1.6 })
            for (const material of Array.isArray(old) ? old : [old]) material.dispose()
            object.renderOrder = 3
          }
        })
        scene.add(gltf.scene); loaded = true; setReady(true); sync()
      }, undefined, () => { /* The rendered fallback is already visible. */ })
      release = () => {
        if (frame) cancelAnimationFrame(frame)
        observer.disconnect(); resizeObserver.disconnect()
        document.removeEventListener('visibilitychange', sync)
        renderer.domElement.removeEventListener('webglcontextlost', lost)
        disposeObject(scene); environment.dispose(); renderer.dispose()
        renderer.domElement.remove()
      }
    }).catch(() => { /* Keep the fallback if an optional renderer cannot load. */ })
    return () => { cancelled = true; release?.() }
  }, [reduced, enabled])

  return <span ref={host} className={`scrying-orb-art ${ready ? 'orb-live' : ''}`} aria-hidden="true"><img src={still} alt="" /></span>
}
