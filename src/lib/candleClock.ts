export type CandlePhase = 'burning' | 'guttering' | 'moonlight' | 'relighting'
export interface CandleClock { burned: number; phase: CandlePhase; transition: number }
export const CANDLE_BURN_MS = 45 * 60_000
export const CANDLE_IDLE_MS = 120_000
export const freshCandle = (): CandleClock => ({ burned: 0, phase: 'burning', transition: 0 })

/** Visible time only. Eligibility is rechecked throughout burnout, not just at its start. */
export function stepCandle(state: CandleClock, dt: number, eligible: boolean, duration = CANDLE_BURN_MS): CandleClock {
  const delta = Math.max(0, Math.min(1000, dt))
  if (state.phase === 'moonlight') return state
  if (state.phase === 'guttering') {
    if (!eligible) return { ...state, phase: 'burning', transition: 0 }
    const transition = state.transition + delta
    return { ...state, transition, phase: transition >= 6000 ? 'moonlight' : 'guttering' }
  }
  if (state.phase === 'relighting') {
    const transition = state.transition + delta
    return transition >= 2200 ? freshCandle() : { ...state, transition }
  }
  const burned = Math.min(duration, state.burned + delta)
  return { burned, phase: burned >= duration && eligible ? 'guttering' : 'burning', transition: 0 }
}

export function wakeCandle(state: CandleClock): CandleClock {
  return state.phase === 'moonlight' || state.phase === 'guttering'
    ? { burned: 0, phase: 'relighting', transition: 0 } : state
}
