import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSecondaryDestinations } from './NavBar'
import { useOverlayFocus } from '../lib/overlayFocus'
import { pushBackHandler } from '../lib/back'
import { arcaneTrinkets, destinationTrinket } from '../lib/arcaneTrinkets'
const Instruments = lazy(() => import('./ArcaneDeskInstruments'))

export default function ArcaneDeskDrawer({ motion = true }: { motion?: boolean }) {
  const [open, setOpen] = useState(false), [present, setPresent] = useState(false), ref = useRef<HTMLDivElement>(null)
  const animations = useRef<Animation[]>([]), requested = useRef(open)
  requested.current = open
  const destinations = useSecondaryDestinations()
  useOverlayFocus(present, ref)
  useEffect(() => {
    const board = ref.current?.closest<HTMLElement>('.celestial-table')
    if (!present || !board) return
    board.dataset.deskCompartment = 'open'
    return () => { delete board.dataset.deskCompartment }
  }, [present])
  useEffect(() => { if (present) return pushBackHandler(() => { setOpen(false); return true }) }, [present])
  useLayoutEffect(() => {
    const root = ref.current, lid = root?.querySelector('.desk-hinged-lid')
    if (!present || !root || !lid || !motion) return
    const options: KeyframeAnimationOptions = { duration: 650, easing: 'cubic-bezier(.2,.65,.25,1)', fill: 'both' }
    animations.current = [lid.animate([{ transform: 'rotateX(-88deg)', filter: 'brightness(.35)' }, { transform: 'rotateX(-18deg)', filter: 'brightness(1)' }], options),
      root.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], options)]
    animations.current.forEach((a) => { a.pause(); a.currentTime = 0 })
    return () => { animations.current.forEach((a) => a.cancel()); animations.current = [] }
  }, [present, motion])
  useLayoutEffect(() => {
    if (!present) return
    if (!motion) { if (!open) setPresent(false); return }
    animations.current.forEach((a) => { a.updatePlaybackRate(open ? 1 : -1); a.play() })
    const hinge = animations.current[0]
    if (!open && hinge) void hinge.finished.then(() => { if (!requested.current) setPresent(false) }).catch(() => {})
  }, [open, present, motion])
  const show = () => { setPresent(true); setOpen(true) }
  const close = () => setOpen(false)
  const tools = [{ to: '/libraries', label: 'All libraries' }, { to: '/mylist', label: 'Saved stories' }, ...destinations,
    { to: '/settings', label: 'Settings & account' }, { to: '/remote', label: 'Remote control' }]
  return <>
    <button type="button" className="desk-atlas-object" aria-label="Open the desk compartment" aria-haspopup="dialog" aria-expanded={present} onClick={show}><img src={arcaneTrinkets.desk} alt="" /><span>Open the desk</span></button>
    {present && <div className="desk-drawer-shade" onClick={close}><div ref={ref} className="desk-drawer" role="dialog" aria-modal="true" aria-label="Inside the arcane desk" onClick={(event) => event.stopPropagation()}>
      <Suspense fallback={null}><Instruments motion={motion} /></Suspense>
      <div className="desk-hinged-lid" aria-hidden="true"><i /><i /><span>✧</span></div>
      <header><p>WITHIN THE COLLECTOR'S DESK</p><h2>Tools for your journey.</h2><button type="button" className="drawer-latch" aria-label="Close the desk compartment" onClick={close}><img src={arcaneTrinkets.desk} alt="" /><span>Close the desk</span></button></header>
      <nav aria-label="Desk instruments">{tools.map((tool) => { const id = destinationTrinket(tool.to); return <Link key={tool.to} to={tool.to} data-trinket={id ?? undefined} onClick={close}>{id && <img src={arcaneTrinkets[id]} alt="" />}<span>{tool.label}</span></Link> })}</nav>
    </div></div>}
  </>
}
