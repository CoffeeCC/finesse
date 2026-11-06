import { useSyncExternalStore } from 'react'
import { CANDLE_BURN_MS, freshCandle, type CandleClock } from './candleClock'

const listeners = new Set<() => void>()
let clock: CandleClock = freshCandle()
try {
  const burned = Number(sessionStorage.getItem('finesse.candleBurned'))
  if (Number.isFinite(burned)) clock.burned = Math.max(0, Math.min(CANDLE_BURN_MS, burned))
} catch { /* A private browser can still keep the candle in memory. */ }
export const getCandle = () => clock
export function setCandle(next: CandleClock) {
  if (next === clock) return
  clock = next
  document.documentElement.dataset.candlePhase = next.phase
  if (next.phase === 'moonlight') document.documentElement.dataset.arcaneSleep = 'true'
  else delete document.documentElement.dataset.arcaneSleep
  listeners.forEach((listener) => listener())
}
export function saveCandle() {
  try { sessionStorage.setItem('finesse.candleBurned', String(clock.burned)) } catch { /* Optional. */ }
}
export function useCandle() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, getCandle, getCandle)
}
