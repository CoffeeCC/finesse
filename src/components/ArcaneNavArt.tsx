import { arcaneTrinkets, destinationTrinket, type ArcaneTrinket } from '../lib/arcaneTrinkets'
import './arcane-navigation.css'
export default function ArcaneNavArt({ kind }: { kind: string }) {
  const id = kind.startsWith('/') ? destinationTrinket(kind) : kind === 'more' ? 'desk' : kind === 'tvshows' ? 'shows' : kind in arcaneTrinkets ? kind as ArcaneTrinket : null
  if (!id) return null
  const art = arcaneTrinkets[id]
  return <span className="arcane-nav-art" aria-hidden="true"><img src={art} alt="" /></span>
}
