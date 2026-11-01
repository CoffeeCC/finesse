import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { openSearch, useSearchOverlay } from '../lib/searchOverlay'
import orbStill from '../assets/card-table/scrying-orb-still-v1.webp'

/** A native control; its model is drawn by the same light space as the candle. */
export default function ArcaneSearchTrinket({ className = '' }: { className?: string }) {
  const navigate = useNavigate(), ref = useRef<HTMLButtonElement>(null), restore = useRef(false)
  const { open } = useSearchOverlay()
  useEffect(() => { if (!open && restore.current) { restore.current = false; ref.current?.focus({ preventScroll: true }) } }, [open])
  return <button ref={ref} type="button" className={`arcane-search-trinket ${className}`} aria-label="Search your library" onClick={() => {
    if (matchMedia('(max-width:759px)').matches) navigate('/search')
    else { restore.current = true; openSearch() }
  }}><span className="folio-orb-art" aria-hidden="true"><img src={orbStill} alt="" /></span><span className="object-label">Search</span></button>
}
