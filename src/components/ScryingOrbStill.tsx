import still from '../assets/card-table/scrying-orb-still-v1.webp'

// Build-time TV replacement: do not ship a live renderer to older TV engines.
export default function ScryingOrbStill(_props: { reduced: boolean; enabled: boolean; active: boolean }) {
  return <span className="scrying-orb-art" aria-hidden="true"><img src={still} alt="" /></span>
}
