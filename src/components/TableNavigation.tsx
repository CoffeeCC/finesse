import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import type { JfItem } from '../api/types'
import { openSearch, useSearchOverlay } from '../lib/searchOverlay'
import { IS_TV } from '../lib/device'
import { useThemeEffects } from '../lib/theme'
import ScryingOrb from './ScryingOrb'
import DeckTrinket from './DeckTrinket'

function DeckButton({ deck, index, selected, busy, reduced, live, onChoose }: {
  deck: JfItem; index: number; selected: boolean; busy: boolean; reduced: boolean; live: boolean; onChoose: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return <button type="button" className={`table-object deck-box-object ${selected ? 'object-selected' : ''}`}
    style={{ '--object-angle': `${index % 2 ? 5 : -5}deg` } as CSSProperties}
    disabled={busy} aria-pressed={selected} onClick={() => onChoose(deck.Id)}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
    <DeckTrinket kind={deck.CollectionType === 'tvshows' ? 'shows' : 'movies'} enabled={live && index < 2}
      reduced={reduced} active={hovered || focused} selected={selected} busy={busy && selected} />
    <span className="object-label">{deck.Name}<small>{deck.CollectionType === 'tvshows' ? 'Series deck' : 'Movie deck'}</small></span>
  </button>
}

export default function TableNavigation({ decks, selected, busy, reduced, onChoose }: {
  decks: JfItem[]; selected?: string; busy: boolean; reduced: boolean; onChoose: (id: string) => void
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
  useThemeEffects() // The shared ArcaneLighting scene owns all live objects now.
  const live = false
  const navigate = useNavigate()
  return (
    <nav className="table-object-nav" aria-label="Table navigation">
      <button ref={orbButton} type="button" className="table-object search-object" aria-label="Search your library"
        onClick={() => { if (IS_TV || matchMedia('(max-width:759px)').matches) navigate('/search'); else { returnToOrb.current = true; openSearch() } }}
        onPointerEnter={() => setEngaged(true)} onPointerLeave={() => setEngaged(false)}
        onFocus={() => setEngaged(true)} onBlur={() => setEngaged(false)}>
        <ScryingOrb reduced={reduced} enabled={live} active={engaged} />
        <span className="object-label">Search <small>The scrying orb</small></span>
      </button>
      <div className="table-deck-boxes" role="group" aria-label="Library decks">
        {decks.map((deck, index) => <DeckButton key={deck.Id} deck={deck} index={index} selected={selected === deck.Id}
          busy={busy} reduced={reduced} live={live} onChoose={onChoose} />)}
      </div>
    </nav>
  )
}
