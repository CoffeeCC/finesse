import { useEffect, useRef, useState } from 'react'
import { reducedMotion } from '../lib/settings'
import { playArcaneSound } from '../lib/sound'
import sun from '../assets/card-table/celestial-coin-sun-v1.webp'
import moon from '../assets/card-table/celestial-coin-moon-v1.webp'

/** A small desk toy. Its result never changes the library or starts playback. */
export default function ArcaneCoin() {
  const [face, setFace] = useState<'Sun' | 'Moon'>('Sun'), [toss, setToss] = useState(0), [busy, setBusy] = useState(false)
  const timer = useRef(0), button = useRef<HTMLButtonElement>(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const flip = () => {
    if (busy) return
    const result = crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? 'Moon' : 'Sun'
    const still = reducedMotion() || Boolean(button.current?.closest('.no-table-motion'))
    setFace(result); setToss((n) => n + 1)
    if (still) { playArcaneSound('coin-land'); return }
    setBusy(true); playArcaneSound('coin-flip')
    timer.current = window.setTimeout(() => { setBusy(false); playArcaneSound('coin-land') }, 1550)
  }
  return <button ref={button} type="button" className={`arcane-coin ${busy ? 'coin-tossing' : ''}`} data-ui-sound="handled" data-coin-toss={toss} data-coin-face={face} aria-label="Flip the celestial coin" aria-busy={busy} aria-disabled={busy} onClick={flip}>
    <span className="arcane-coin-art" aria-hidden="true"><img src={face === 'Sun' ? sun : moon} alt="" /></span>
    <span className="coin-label">Flip a coin</span><span className="coin-result" role="status">{busy ? 'In the air…' : toss ? face : 'Sun or moon'}</span>
  </button>
}
