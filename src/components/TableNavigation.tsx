import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { JfItem } from '../api/types'
import { openSearch, useSearchOverlay } from '../lib/searchOverlay'
import { IS_TV } from '../lib/device'
import ScryingOrb from './ScryingOrb'
import DeckTrinket from './DeckTrinket'
import './arcane-hand-source.css'

function DeckEntrance({ decks, kind, index, reduced }: {
  decks: JfItem[]
  kind: 'movies' | 'tvshows'
  index: number
  reduced: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const single = decks.length === 1
  const shows = kind === 'tvshows'
  const label = single ? decks[0].Name : shows ? 'Shows' : 'Movies'
  const target = single ? `/library/${decks[0].Id}` : `/libraries?kind=${kind}`

  return (
    <Link
      to={target}
      className="table-object deck-box-object"
      data-deck-kind={kind}
      aria-label={`Open ${label} ${shows ? 'show' : 'movie'} ${single ? 'library' : 'libraries'}`}
      title={label}
      style={{ '--object-angle': `${index % 2 ? 5 : -5}deg` } as CSSProperties}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <DeckTrinket kind={shows ? 'shows' : 'movies'} enabled={false} reduced={reduced} active={hovered || focused} selected={false} busy={false} />
      <span className="object-label">
        <strong className="deck-entrance-name">{label}</strong>
        <small>{single ? 'Browse the full deck' : `${decks.length} library decks`}</small>
      </span>
    </Link>
  )
}

export default function TableNavigation({ decks, reduced }: {
  decks: JfItem[]; reduced: boolean
}) {
  const [engaged, setEngaged] = useState(false)
  const orbButton = useRef<HTMLButtonElement>(null)
  const returnToOrb = useRef(false)
  const { open } = useSearchOverlay()
  useEffect(() => {
    if (!open && returnToOrb.current) {
      returnToOrb.current = false
      orbButton.current?.focus({ preventScroll: true })
    }
  }, [open])
  const navigate = useNavigate()
  return (
    <nav className="table-object-nav" aria-label="Table navigation">
      <button ref={orbButton} type="button" className="table-object search-object" aria-label="Search your library"
        onClick={() => { if (IS_TV || matchMedia('(max-width:759px)').matches) navigate('/search'); else { returnToOrb.current = true; openSearch() } }}
        onPointerEnter={() => setEngaged(true)} onPointerLeave={() => setEngaged(false)}
        onFocus={() => setEngaged(true)} onBlur={() => setEngaged(false)}>
        <ScryingOrb reduced={reduced} enabled={false} active={engaged} />
        <span className="object-label">Search <small>The scrying orb</small></span>
      </button>
      <div className="table-deck-boxes" role="group" aria-label="Library decks">
        {(['movies', 'tvshows'] as const).map((kind, index) => {
          const matchingDecks = decks.filter(deck => deck.CollectionType === kind)
          return matchingDecks.length > 0 && (
            <DeckEntrance key={kind} kind={kind} index={index} reduced={reduced} decks={matchingDecks} />
          )
        })}
      </div>
    </nav>
  )
}
