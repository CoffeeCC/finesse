import { useSyncExternalStore } from 'react'

export const THEMES = [
  { id: 'default', name: 'Finesse', description: 'The familiar stage and shelves.', swatches: ['#11141c', '#7589d8', '#d2d6e0'] },
  { id: 'midnight', name: 'Midnight Cinema', description: 'Ink blue, warm paper, and a quieter glow.', swatches: ['#090d16', '#26364b', '#d8b877'] },
  { id: 'card-table', name: 'Arcane Table', description: 'A fantasy hand drawn from your movies and shows.', swatches: ['#102132', '#b8955e', '#8bb6dc'] },
] as const
export type ThemeId = typeof THEMES[number]['id']
const KEY = 'finesse.theme'
const EVENT = 'finesse:theme'

export function validTheme(value: unknown): ThemeId {
  return THEMES.find((theme) => theme.id === value)?.id ?? 'default'
}

function storedTheme(): ThemeId {
  try { return validTheme(localStorage.getItem(KEY)) } catch { return 'default' }
}

// Local review links select the intended theme even in a different browser.
// Production keeps its normal device preference; unknown values do nothing.
function initialTheme(): ThemeId {
  if (import.meta.env.DEV) {
    const requested = new URLSearchParams(window.location.search).get('theme')
    const theme = THEMES.find((option) => option.id === requested)
    if (theme) {
      try { localStorage.setItem(KEY, theme.id) } catch { /* Keep it in memory. */ }
      return theme.id
    }
  }
  return storedTheme()
}

let current = initialTheme()

export function applyTheme(theme: ThemeId): void {
  current = validTheme(theme)
  document.documentElement.dataset.theme = current
}

export function setTheme(theme: ThemeId): void {
  applyTheme(theme)
  try { localStorage.setItem(KEY, current) } catch { /* Keep the selection in memory. */ }
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(callback: () => void): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) { applyTheme(storedTheme()); callback() }
  }
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', storage)
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', storage) }
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, () => current, () => 'default')
}

const EFFECTS_KEY = 'finesse.theme3d'
const EFFECTS_EVENT = 'finesse:theme3d'
let effects = true
try { effects = localStorage.getItem(EFFECTS_KEY) !== 'off' } catch { /* Default on. */ }
export function setThemeEffects(enabled: boolean): void {
  effects = enabled
  try { localStorage.setItem(EFFECTS_KEY, enabled ? 'on' : 'off') } catch { /* Optional storage. */ }
  window.dispatchEvent(new Event(EFFECTS_EVENT))
}
export function useThemeEffects(): boolean {
  return useSyncExternalStore((callback) => {
    const storage = (event: StorageEvent) => {
      if (event.key === EFFECTS_KEY || event.key === null) {
        try { effects = localStorage.getItem(EFFECTS_KEY) !== 'off' } catch { effects = true }
        callback()
      }
    }
    window.addEventListener(EFFECTS_EVENT, callback)
    window.addEventListener('storage', storage)
    return () => { window.removeEventListener(EFFECTS_EVENT, callback); window.removeEventListener('storage', storage) }
  }, () => effects, () => false)
}

applyTheme(current)
