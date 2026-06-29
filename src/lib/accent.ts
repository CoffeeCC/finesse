// Per-account accent theming. Tailwind v4 emits accent utilities as
// `var(--color-accent-NNN)`, so overriding those vars on <html> re-themes the
// whole app live. The choice is mirrored to localStorage for instant apply on
// load (no color flash) and to DisplayPreferences for cross-device sync.

export interface AccentPreset {
  name: string
  label: string
  shades: { 300: string; 400: string; 500: string; 600: string }
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'indigo', label: 'Indigo', shades: { 300: '#93a5e8', 400: '#7589d8', 500: '#6279cd', 600: '#4f63b4' } },
  { name: 'violet', label: 'Violet', shades: { 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed' } },
  { name: 'sky', label: 'Sky', shades: { 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' } },
  { name: 'teal', label: 'Teal', shades: { 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488' } },
  { name: 'emerald', label: 'Emerald', shades: { 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669' } },
  { name: 'amber', label: 'Amber', shades: { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' } },
  { name: 'rose', label: 'Rose', shades: { 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48' } },
  { name: 'crimson', label: 'Crimson', shades: { 300: '#f59ca8', 400: '#ee6b7e', 500: '#e23b54', 600: '#c52742' } },
]

export const DEFAULT_ACCENT = 'indigo'
const KEY = 'finesse.accent'

export function getPresetByName(name: string | null | undefined): AccentPreset {
  return ACCENT_PRESETS.find((p) => p.name === name) ?? ACCENT_PRESETS[0]
}

/** Override the accent CSS variables on <html> so every accent utility updates. */
export function applyAccent(name: string): void {
  const root = document.documentElement
  const { shades } = getPresetByName(name)
  root.style.setProperty('--color-accent-300', shades[300])
  root.style.setProperty('--color-accent-400', shades[400])
  root.style.setProperty('--color-accent-500', shades[500])
  root.style.setProperty('--color-accent-600', shades[600])
}

export function getStoredAccent(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_ACCENT
  } catch {
    return DEFAULT_ACCENT
  }
}

export function setStoredAccent(name: string): void {
  try {
    localStorage.setItem(KEY, name)
  } catch {
    /* ignore */
  }
}

// Apply the last-used accent immediately at import time (before first paint),
// so returning users never see a flash of the default color.
applyAccent(getStoredAccent())
