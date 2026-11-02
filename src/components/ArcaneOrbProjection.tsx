import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { goBack, pushBackHandler } from '../lib/back'
import { useOverlayFocus } from '../lib/overlayFocus'
import ItemPage from '../pages/ItemPage'
import orb from '../assets/card-table/scrying-orb-still-v1.webp'
import seal from '../assets/card-table/home-waystone-v1-still.webp'
import './arcane-orb-projection.css'

/** The existing detail model/actions are retained inside an in-mat apparition.
 * Background routes stay mounted, preserving the dealt hand and focused card. */
export default function ArcaneOrbProjection() {
  const navigate = useNavigate(), ref = useRef<HTMLDivElement>(null)
  const [mat, setMat] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    // A direct title link may reach this component before the home query resolves.
    const findMat = () => {
      const board = document.querySelector<HTMLElement>('.arcane-viewport .celestial-table')
      if (board) { setMat(board); return true }
      return false
    }
    if (findMat()) return
    const observer = new MutationObserver(() => { if (findMat()) observer.disconnect() })
    observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  useEffect(() => pushBackHandler(() => { goBack(navigate); return true }), [navigate])
  useEffect(() => {
    if (!mat || !ref.current) return
    mat.dataset.scrying = 'true'
    const prior = new Map<HTMLElement, boolean>()
    const shield = () => {
      for (const surface of mat.children) {
        if (!(surface instanceof HTMLElement) || surface === ref.current || prior.has(surface)) continue
        prior.set(surface, surface.inert); surface.inert = true
      }
    }
    shield()
    // Direct entry can mount the projection before the background hand resolves.
    const observer = new MutationObserver(shield)
    observer.observe(mat, { childList: true })
    return () => { observer.disconnect(); delete mat.dataset.scrying; prior.forEach((inert, surface) => { surface.inert = inert }) }
  }, [mat])
  // Restore the underlying controls before returning keyboard focus to the card.
  useOverlayFocus(Boolean(mat), ref)
  if (!mat) return null
  return createPortal(<div ref={ref} className="orb-projection" role="dialog" aria-modal="true" aria-label="Scrying orb — title details">
    <div className="orb-projection-source" aria-hidden="true"><img src={orb} alt="" /></div>
    <div className="orb-summoning-thread" aria-hidden="true" />
    <div className="orb-reading-folio">
      <header><p>THE SCRYING GLASS</p><button type="button" className="orb-return-signet" aria-label="Return to the table" onClick={() => goBack(navigate)}><img src={seal} alt="" /><span>Return to table</span></button></header>
      <div className="orb-reading-content"><Routes><Route path="/item/:itemId" element={<ItemPage projection />} /></Routes></div>
    </div>
  </div>, mat)
}
