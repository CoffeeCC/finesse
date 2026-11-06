import movieStill from '../assets/card-table/deck-movies-still-v1.webp'
import showStill from '../assets/card-table/deck-shows-still-v1.webp'

export type DeckTrinketProps = { kind: 'movies' | 'shows'; enabled: boolean; reduced: boolean; active: boolean; selected: boolean; busy: boolean }
export default function DeckTrinketStill({ kind }: DeckTrinketProps) {
  return <span className="deck-trinket-art" aria-hidden="true"><img src={kind === 'shows' ? showStill : movieStill} alt="" /></span>
}
