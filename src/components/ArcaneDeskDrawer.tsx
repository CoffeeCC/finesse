import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSecondaryDestinations } from './NavBar'
import { useOverlayFocus } from '../lib/overlayFocus'
import { pushBackHandler } from '../lib/back'
import { arcaneTrinkets, destinationTrinket } from '../lib/arcaneTrinkets'
import { DESK_SEQUENCE_MS, DRAWER_SEQUENCE_MS, deskPose, drawerPose, deskSoundCrossings, drawerSoundCrossings, partialCloseCue, partialOpenCue, resumePreparedMechanism, type DeskSound } from '../lib/deskSequence'
import { playArcaneSound } from '../lib/sound'
import wideInterior from '../assets/card-table/arcane-desk-wide-v1-open.webp'
import portraitInterior from '../assets/card-table/arcane-desk-portrait-v1-open.webp'
import wideDrawer from '../assets/card-table/arcane-desk-wide-v1-drawer.webp'
import portraitDrawer from '../assets/card-table/arcane-desk-portrait-v1-drawer.webp'
import drawerPull from '../assets/card-table/drawer-pull-v1-still.webp'
import ArcaneLightControls from './ArcaneLightControls'
import { useThemeEffects } from '../lib/theme'
import { DESK_CASE_LAYOUT } from '../assets/card-table/desk-case-layout'
import './arcane-desk-case.css'
const Instruments = lazy(() => import('./ArcaneDeskInstruments'))

export default function ArcaneDeskDrawer({ motion = true, mode = 'desk', onClosed }: { motion?: boolean; mode?: 'desk' | 'lighting'; onClosed?: () => void }) {
  const lighting = mode === 'lighting', duration = lighting ? DRAWER_SEQUENCE_MS : DESK_SEQUENCE_MS
  const [open, setOpen] = useState(lighting), [present, setPresent] = useState(lighting), ref = useRef<HTMLDivElement>(null)
  const animations = useRef<Animation[]>([]), requested = useRef(open)
  const voices = useRef<(() => void)[]>([])
  const sound = (kind: DeskSound) => { const cancel=playArcaneSound(kind);if(cancel)voices.current.push(cancel) }
  const silence = () => { voices.current.forEach(cancel=>cancel());voices.current=[] }
  const [phase, setPhase] = useState('Desk open'), [contentsReady, setContentsReady] = useState(!motion)
  requested.current = open
  useEffect(() => { if (lighting && !present) onClosed?.() }, [lighting, present, onClosed])
  useEffect(() => { if (lighting && !motion) playArcaneSound('drawer-open') }, [lighting, motion])
  const destinations = useSecondaryDestinations()
  useLayoutEffect(()=>{
    const root=ref.current
    if(!present||!root)return
    const place=()=>{
      if(root.dataset.caseReady==='true')return
      const width=root.clientWidth,height=root.clientHeight,portrait=width/Math.max(1,height)<.85
      const layout=DESK_CASE_LAYOUT[portrait?'portrait':'wide'][mode],scale=Math.min(width/layout.image[0],height/layout.image[1])
      const ox=(width-layout.image[0]*scale)/2,oy=(height-layout.image[1]*scale)/2
      const x=ox+layout.surface[0]*layout.image[0]*scale,y=oy+layout.surface[1]*layout.image[1]*scale
      const w=layout.surface[2]*layout.image[0]*scale,h=layout.surface[3]*layout.image[1]*scale,padding=lighting?62:portrait?75:65
      root.style.setProperty('--desk-floor-left',`${Math.max(8,x+5)}px`);root.style.setProperty('--desk-floor-width',`${Math.max(120,w-10)}px`)
      root.style.setProperty('--desk-heading-top',`${y+8}px`);root.style.setProperty('--desk-floor-top',`${y+padding}px`);root.style.setProperty('--desk-floor-height',`${Math.max(100,h-padding-8)}px`)
      const latch=root.querySelector<HTMLElement>('.drawer-latch')
      if(latch){latch.style.left=`${Math.max(5,Math.min(width-89,ox+layout.latch[0]*layout.image[0]*scale-42))}px`;latch.style.top=`${Math.max(5,Math.min(height-86,oy+layout.latch[1]*layout.image[1]*scale-30))}px`}
    }
    const resize=new ResizeObserver(place),fallback=new MutationObserver(place)
    resize.observe(root);fallback.observe(root,{attributes:true,attributeFilter:['data-case-ready','data-case-failed']});place()
    return()=>{resize.disconnect();fallback.disconnect()}
  },[present,mode,lighting])
  const effects=useThemeEffects()
  useEffect(()=>{
    if(!effects||lighting)return
    const controller=new AbortController(),media=matchMedia('(max-aspect-ratio:17/20)')
    const warm=async()=>{
      try{
        const url=media.matches?await import('../assets/card-table/arcane-desk-portrait-v1.glb?url'):await import('../assets/card-table/arcane-desk-wide-v1.glb?url')
        const response=await fetch(url.default,{signal:controller.signal,cache:import.meta.env.DEV?'reload':'force-cache'})
        if(response.ok)await response.arrayBuffer()
      }catch{ /* Artwork remains available if preload is unavailable or cancelled. */ }
    }
    void warm();media.addListener(warm)
    return()=>{controller.abort();media.removeListener(warm)}
  },[effects,lighting])
  useOverlayFocus(present, ref)
  useEffect(() => {
    const board = ref.current?.closest<HTMLElement>('.celestial-table')
    if (!present || !board) return
    board.dataset.deskCompartment = 'open'
    return () => { delete board.dataset.deskCompartment }
  }, [present])
  useEffect(() => { if (present) return pushBackHandler(() => { if (!motion) playArcaneSound(lighting ? 'drawer-close' : 'lock-latch'); setOpen(false); return true }) }, [present, motion, lighting])
  useLayoutEffect(() => {
    const root = ref.current, clock = root?.querySelector('.desk-motion-clock')
    if (!present || !root || !clock) return
    const write = (progress: number) => {
      const p = deskPose(progress), drawer = drawerPose(progress)
      root.dataset.deskProgress = String(p.progress)
      root.style.setProperty('--desk-contents', String(lighting ? drawer.contents : p.contents))
      root.style.setProperty('--desk-lid-angle', `${-105 * p.lid}deg`)
      root.style.setProperty('--desk-key-turn', `${90 * p.keyTurn}deg`)
      root.style.setProperty('--desk-key-travel', String(p.keyTravel))
      setContentsReady((lighting ? drawer.contents : p.contents) > .05)
      setPhase(lighting ? requested.current ? drawer.phase : 'Closing lighting drawer' : requested.current ? p.phase : p.lid > .01 ? 'Closing desk' : p.keyTurn > .01 ? 'Locking desk' : 'Returning key')
    }
    if (!motion) { write(1); return }
    const animation = clock.animate([{ opacity: 0 }, { opacity: 1 }], { duration, fill: 'both' })
    animation.pause(); animation.currentTime = 0; animations.current = [animation]
    let frame = 0, previous = 0
    const tick = () => {
      const progress = Math.max(0, Math.min(1, Number(animation.currentTime ?? 0) / duration))
      if(progress!==previous){
        for (const sound of (lighting ? drawerSoundCrossings : deskSoundCrossings)(previous, progress)) {
          const cancel=playArcaneSound(sound);if(cancel)voices.current.push(cancel)
        }
        write(progress)
      }
      previous = progress; frame = requestAnimationFrame(tick)
    }
    write(0); frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); animation.cancel(); animations.current = [];silence() }
  }, [present, motion, lighting, duration])
  useLayoutEffect(() => {
    if (!present) return
    if (!motion) { if (!open) setPresent(false); return }
    silence()
    const cue=(open?partialOpenCue:partialCloseCue)(Number(animations.current[0]?.currentTime??0)/duration,mode);if(cue)sound(cue)
    const ready=!effects||ref.current?.dataset.caseReady==='true'||ref.current?.dataset.caseFailed==='true'
    animations.current.forEach((a) => { a.updatePlaybackRate(open ? 1 : -1); if((!open||ready)&&!(open&&a.playState==='finished'&&Number(a.currentTime)>=duration))a.play() })
    if(open&&!ready){ref.current?.setAttribute('aria-busy','true');setPhase(lighting?'Preparing lighting drawer':'Readying the lock')}
    const hinge = animations.current[0]
    if (!open && hinge) void hinge.finished.then(() => { if (!requested.current) setPresent(false) }).catch(() => {})
  }, [open, present, motion, duration, mode, effects, lighting])
  useLayoutEffect(()=>{
    const root=ref.current
    if(!present||!motion||!root)return
    const ready=()=>{
      if(root.dataset.caseReady==='true'||root.dataset.caseFailed==='true'||!effects){
        root.removeAttribute('aria-busy')
        if(requested.current)animations.current.forEach(resumePreparedMechanism)
      }
    }
    const observer=new MutationObserver(ready);observer.observe(root,{attributes:true,attributeFilter:['data-case-ready','data-case-failed']})
    // Slow or unavailable graphics degrade to artwork, never an indefinitely locked interface.
    const timeout=window.setTimeout(()=>{if(root.dataset.caseReady!=='true')root.dataset.caseFailed='true'},1500)
    ready();return()=>{observer.disconnect();clearTimeout(timeout)}
  },[present,motion,effects])
  const show = () => { if (!present) playArcaneSound(motion ? 'key-lift' : 'lock-release'); setPresent(true); setOpen(true) }
  const close = () => { if (!motion) playArcaneSound(lighting ? 'drawer-close' : 'lock-latch'); setOpen(value=>!value) }
  const tools = [{ to: '/libraries', label: 'All libraries' }, { to: '/mylist', label: 'Saved stories' }, ...destinations,
    { to: '/settings', label: 'Settings & account' }, { to: '/remote', label: 'Remote control' }]
  return <>
    {!lighting && <button type="button" className="desk-atlas-object" data-ui-sound="handled" aria-label="Open the desk compartment" aria-haspopup="dialog" aria-expanded={present} onClick={show}><img src={arcaneTrinkets.desk} alt="" /><span>Unlock the desk</span></button>}
    {present && <div className="desk-drawer-shade" onClick={close}><div ref={ref} className={`desk-drawer ${lighting ? 'desk-lighting-drawer' : ''}`} data-desk-mode={mode} role="dialog" aria-modal="true" aria-label={lighting ? 'By candlelight' : 'Inside the arcane desk'} onClick={(event) => event.stopPropagation()}>
      <span className="desk-motion-clock" aria-hidden="true" />
      <picture className="desk-case-fallback" aria-hidden="true"><source media="(max-aspect-ratio:17/20)" srcSet={lighting ? portraitDrawer : portraitInterior} /><img src={lighting ? wideDrawer : wideInterior} alt="" /></picture>
      {!lighting && <div className="desk-fallback-lid" aria-hidden="true" />}
      <Suspense fallback={null}><Instruments motion={motion} mode={mode} /></Suspense>
      <header><p>{lighting ? 'THE CANDLEKEEPER’S DRAWER' : 'WITHIN THE COLLECTOR’S DESK'}</p><h2>{lighting ? 'By candlelight.' : 'Tools for your journey.'}</h2></header>
      <button type="button" className="drawer-latch" data-ui-sound="handled" aria-label={open ? lighting ? 'Close the lighting drawer' : 'Close the desk compartment' : lighting ? 'Reopen the lighting drawer' : 'Reopen the desk compartment'} onClick={close}><img src={lighting ? drawerPull : arcaneTrinkets.desk} alt="" /><span>{open ? lighting ? 'Close drawer' : 'Close & lock' : lighting ? 'Reopen drawer' : 'Unlock again'}</span></button>
      <p className="desk-sequence-status" role="status">{phase === 'Desk open' || phase === 'Drawer open' ? '' : phase}</p>
      {lighting ? <div className="desk-lighting-content" data-desk-content inert={!contentsReady}><ArcaneLightControls physical /></div> : <nav aria-label="Desk instruments" data-desk-content inert={!contentsReady}>{tools.map((tool) => { const id = destinationTrinket(tool.to); return <Link key={tool.to} to={tool.to} data-trinket={id ?? undefined} onClick={close}>{id && <img src={arcaneTrinkets[id]} alt="" />}<span>{tool.label}</span></Link> })}</nav>}
    </div></div>}
  </>
}
