import { useSyncExternalStore } from 'react'

// `preview`: still being made. Offered only after Settings → Appearance → Unfinished themes.
// `tv: false`: left out of the LG TV app altogether (its styles and art aren't in that build).
export const THEMES = [
  { id: 'default', name: 'Finesse', description: 'The familiar stage and shelves.', swatches: ['#11141c', '#7589d8', '#d2d6e0'], preview: false, tv: true },
  { id: 'midnight', name: 'Midnight Cinema', description: 'Ink blue, warm paper, and a quieter glow.', swatches: ['#090d16', '#26364b', '#d8b877'], preview: true, tv: true },
  { id: 'card-table', name: 'Arcane Table', description: 'A fantasy hand drawn from your movies and shows.', swatches: ['#102132', '#b8955e', '#8bb6dc'], preview: true, tv: false },
] as const
export type ThemeId = typeof THEMES[number]['id']
const KEY = 'finesse.theme'
const EVENT = 'finesse:theme'
const PREVIEWS_KEY = 'finesse.themePreviews'

function storedPreviews(): boolean {
  try { return localStorage.getItem(PREVIEWS_KEY) === 'on' } catch { return false }
}
let previews = storedPreviews()

/** Can this device use the theme right now? Unfinished ones need the switch; some aren't on TV. */
export function themeAvailable(id: unknown, unfinished = previews): boolean {
  const theme = THEMES.find((option) => option.id === id)
  if (!theme) return false
  if (__WEBOS__ && !theme.tv) return false
  return !theme.preview || unfinished
}

export function availableThemes() {
  return THEMES.filter((theme) => themeAvailable(theme.id))
}

/** A saved or requested theme this device may use, or the standard look. */
export function validTheme(value: unknown): ThemeId {
  return themeAvailable(value) ? THEMES.find((theme) => theme.id === value)!.id : 'default'
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
      previews = true
      try { localStorage.setItem(KEY, theme.id) } catch { /* Keep it in memory. */ }
      return theme.id
    }
  }
  return storedTheme()
}

let current = initialTheme()

// Arcane Table's styles (and the artwork they name) load only once someone picks it, so
// nobody else downloads them. The TV build never contains them.
let arcaneStyles: Promise<unknown> | null = null
export function loadThemeStyles(theme: ThemeId) {
  if (__WEBOS__ || theme !== 'card-table' || arcaneStyles) return
  arcaneStyles = import('../card-table.css').then(() => import('../celestial-table.css')).catch(() => { arcaneStyles = null })
}

export function applyTheme(theme: ThemeId): void {
  current = validTheme(theme)
  loadThemeStyles(current)
  document.documentElement.dataset.theme = current
}

export function setTheme(theme: ThemeId): void {
  applyTheme(theme)
  try { localStorage.setItem(KEY, current) } catch { /* Keep the selection in memory. */ }
  window.dispatchEvent(new Event(EVENT))
}

/** Settings → Appearance → Unfinished themes. Off puts this device back on the standard look. */
export function setThemePreviews(on: boolean): void {
  previews = on
  try { localStorage.setItem(PREVIEWS_KEY, on ? 'on' : 'off') } catch { /* Keep it in memory. */ }
  if (!themeAvailable(current)) setTheme('default')
  else window.dispatchEvent(new Event(EVENT))
}

function subscribe(callback: () => void): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === PREVIEWS_KEY || event.key === null) {
      previews = storedPreviews()
      applyTheme(storedTheme())
      callback()
    }
  }
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', storage)
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', storage) }
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, () => current, () => 'default')
}

export function useThemePreviews(): boolean {
  return useSyncExternalStore(subscribe, () => previews, () => false)
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
