import { useEffect, useRef, useState } from 'react'
import { IS_TV } from '../lib/device'
import { getPrefs, reducedMotion } from '../lib/settings'

// Liquid light: ribbons of light in the focused title's own colour, drifting behind the home
// stage like an aurora. A small fragment shader drawn at a third of the screen's size (the
// browser smooths it up, which is the look), at 30 frames a second, and only while it's on
// screen and the tab is visible. The light leans gently toward the pointer; nothing on the
// page moves with it. It's off unless someone turns it on (Settings → Appearance): without
// it, and on TVs, with "reduce motion", data saver or no WebGL, there are two soft orbs.

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'
const FRAG = `
precision mediump float;
uniform vec2 r;
uniform float t;
uniform vec3 c;
uniform vec2 m;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*n(p);p=p*2.02+vec2(1.7,9.2);a*=.5;}return s;}
void main(){
  vec2 uv=gl_FragCoord.xy/r;
  vec2 p=vec2(uv.x*r.x/r.y,uv.y);
  float tt=t*.05;
  vec2 q=vec2(fbm(p*1.1+vec2(0.,tt)),fbm(p*1.1+vec2(5.2,-tt*.8)));
  vec2 w=p+1.5*q+.22*(m-uv);
  float f=fbm(w*1.3+vec2(tt*.6,tt*.25));
  // Thin bright threads along the flow, over a soft body of light.
  float thread=pow(1.-abs(sin(f*7.5+uv.x*1.6-tt*2.)),7.);
  float body=smoothstep(.32,.85,f);
  // Rises from the bottom edge and from the left, where the page is dark.
  float rise=smoothstep(1.05,.05,uv.y)*(.55+.45*smoothstep(1.1,.0,uv.x));
  float d=distance(vec2(uv.x*r.x/r.y,uv.y),vec2(m.x*r.x/r.y,m.y));
  float near=exp(-d*d*7.)*.22;
  vec3 hot=mix(c,vec3(1.),.38);
  vec3 cool=mix(c,c.gbr,.3);
  vec3 col=cool*body*.7+hot*thread*.75+c*near;
  col*=rise;
  // A touch of grain so the gradients never band.
  col+=(h(gl_FragCoord.xy+t)-.5)*.012;
  gl_FragColor=vec4(max(col,0.),1.);
}`

const parseTint = (s: string): [number, number, number] => {
  const n = s.split(',').map((x) => Number(x.trim()) / 255)
  return n.length === 3 && n.every((x) => Number.isFinite(x)) ? (n as [number, number, number]) : [0.46, 0.54, 0.85]
}

function allowed(): boolean {
  if (!getPrefs().liquidLight || IS_TV || reducedMotion()) return false
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return !conn?.saveData
}

export default function LiquidLight({ tint }: { tint: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tintRef = useRef(parseTint(tint))
  tintRef.current = parseTint(tint)
  const [ok, setOk] = useState(allowed)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ok) return
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: false })
    if (!gl) return setOk(false)
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return setOk(false)
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const uR = gl.getUniformLocation(prog, 'r')
    const uT = gl.getUniformLocation(prog, 't')
    const uC = gl.getUniformLocation(prog, 'c')
    const uM = gl.getUniformLocation(prog, 'm')

    const size = () => {
      const w = Math.max(64, Math.min(640, Math.round(canvas.clientWidth / 3)))
      const hgt = Math.max(48, Math.round((w * canvas.clientHeight) / Math.max(1, canvas.clientWidth)))
      if (canvas.width !== w || canvas.height !== hgt) {
        canvas.width = w
        canvas.height = hgt
        gl.viewport(0, 0, w, hgt)
      }
    }
    const ro = new ResizeObserver(size)
    ro.observe(canvas)
    size()

    let raf = 0
    let visible = true
    let lost = false
    let last = 0
    let clock = Math.random() * 100
    const col = [...tintRef.current]
    const mouse = [0.3, 0.3]
    const want = [0.3, 0.3]
    const frame = (now: number) => {
      raf = 0
      if (!visible || lost || document.hidden) return
      raf = requestAnimationFrame(frame)
      const dt = now - last
      if (dt < 31) return // 30 a second is plenty for something this slow
      last = now
      clock += Math.min(dt, 100) / 1000
      for (let i = 0; i < 3; i++) col[i] += (tintRef.current[i] - col[i]) * 0.06
      for (let i = 0; i < 2; i++) mouse[i] += (want[i] - mouse[i]) * 0.05
      gl.uniform2f(uR, canvas.width, canvas.height)
      gl.uniform1f(uT, clock)
      gl.uniform3f(uC, col[0], col[1], col[2])
      gl.uniform2f(uM, mouse[0], mouse[1])
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const start = () => {
      if (!raf && visible && !lost && !document.hidden) {
        last = 0
        raf = requestAnimationFrame(frame)
      }
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      start()
    })
    io.observe(canvas)
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const b = canvas.getBoundingClientRect()
      want[0] = (e.clientX - b.left) / Math.max(1, b.width)
      want[1] = 1 - (e.clientY - b.top) / Math.max(1, b.height)
    }
    const onLost = (e: Event) => {
      e.preventDefault()
      lost = true
      setOk(false)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('visibilitychange', start)
    canvas.addEventListener('webglcontextlost', onLost)
    start()
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', start)
      canvas.removeEventListener('webglcontextlost', onLost)
    }
  }, [ok])

  if (!ok) {
    return (
      <>
        <div className="os-orb a" />
        <div className="os-orb b" />
      </>
    )
  }
  return <canvas ref={canvasRef} className="os-liquid" />
}
