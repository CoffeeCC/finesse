import type { JfItem } from '../api/types'
import { arcaneTrinkets } from '../lib/arcaneTrinkets'
import { playArcaneSound } from '../lib/sound'
import ArcaneDeskDrawer from './ArcaneDeskDrawer'
import './arcane-hand-source.css'

/** Changes the library used for discovery deals from inside the keyed desk. */
export default function ArcaneHandSource({ decks, selected, busy, reduced, onChoose }: {
  decks: JfItem[]
  selected?: string
  busy: boolean
  reduced: boolean
  onChoose: (id: string) => void
}) {
  return (
    <ArcaneDeskDrawer
      motion={!reduced}
      blocked={busy || !decks.length}
      trigger={{
        id: 'handSource',
        label: 'Choose the library for your hand',
        caption: 'Your hand’s library',
        className: 'hand-source-object',
      }}
      heading="Choose a library for your hand."
      contents={close => decks.map(deck => {
        const shows = deck.CollectionType === 'tvshows'
        const current = deck.Id === selected
        return (
          <button
            key={deck.Id}
            type="button"
            data-trinket="handSourceChoice"
            data-ui-sound="handled"
            aria-label={`${deck.Name}, ${shows ? 'shows' : 'movies'}`}
            aria-pressed={current}
            disabled={busy}
            title={deck.Name}
            onClick={() => {
              playArcaneSound('tally')
              onChoose(deck.Id)
              close()
            }}
          >
            <img src={arcaneTrinkets.handSourceChoice} alt="" />
            <span>
              <strong className="hand-library-name">{deck.Name}</strong>
              <small>{shows ? 'Series hand' : 'Movie hand'}{current && ' · Your current source'}</small>
            </span>
          </button>
        )
      })}
    />
  )
}
