import { useSyncExternalStore } from 'react'

const KEY = 'finesse.arcaneScene', EVENT = 'finesse:arcaneScene'
const defaults = { brightness: 1, lights: 1 }
export type ArcaneSceneSettings = typeof defaults
function normalize(value: unknown): ArcaneSceneSettings {
  const input = value && typeof value === 'object' ? value as Partial<ArcaneSceneSettings> : {}
  const bounded = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 1
  return { brightness: bounded(input.brightness, .7, 1.4), lights: bounded(input.lights, .5, 1.5) }
}
function read() { try { return normalize(JSON.parse(localStorage.getItem(KEY) ?? 'null')) } catch { return defaults } }
let settings = read()
export const getArcaneScene = () => settings
export function setArcaneScene(update: Partial<ArcaneSceneSettings>) {
  settings = normalize({ ...settings, ...update })
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* Browser storage is optional. */ }
  window.dispatchEvent(new Event(EVENT))
}
function subscribe(callback: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { settings = read(); callback() } }
  window.addEventListener(EVENT, callback); window.addEventListener('storage', storage)
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', storage) }
}
export function useArcaneScene() { return useSyncExternalStore(subscribe, getArcaneScene, () => defaults) }
