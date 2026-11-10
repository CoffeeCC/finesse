import { useState } from 'react'
import { arcaneTrinkets } from '../lib/arcaneTrinkets'
import { playArcaneSound } from '../lib/sound'
import './arcane-hand-thumbwheel.css'

export default function ArcaneHandThumbwheel({ index, count, busy, onSelect }: {
  index: number
  count: number
  busy: boolean
  onSelect: (index: number) => void
}) {
  const [detent, setDetent] = useState(0)

  function turn(direction: -1 | 1) {
    setDetent(value => value + direction)
    onSelect((index + direction + count) % count)
    playArcaneSound('thumbwheel')
  }

  return (
    <div className="hand-pager hand-thumbwheel" role="group" aria-label="Browse cards">
      <div className="hand-thumbwheel-body">
        <span className="hand-thumbwheel-art" data-detent={detent} aria-hidden="true">
          <img src={arcaneTrinkets.handThumbwheel} alt="" />
        </span>
        <button type="button" disabled={busy} data-ui-sound="handled" aria-label="Previous card" onClick={() => turn(-1)} />
        <button type="button" disabled={busy} data-ui-sound="handled" aria-label="Next card" onClick={() => turn(1)} />
      </div>
      <output aria-live="polite" aria-label="Card position">{index + 1} / {count}</output>
    </div>
  )
}
