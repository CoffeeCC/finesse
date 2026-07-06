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

// ---------- Per-title color grading ----------
// A detail page (and a focused card's light-spill) adopts *that title's* color,
// sampled from its poster. Poster averages are muddy and desaturated, so we
// convert to HSL, keep the hue, and force a vivid, consistent saturation +
// lightness ladder — so a film reads as a deliberate color, never grey-brown.

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)))
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  const d = max - min
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h /= 6
  }
  return [h * 360, s, l]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  if (s === 0) {
    const v = clampByte(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    clampByte(hue2rgb(p, q, h + 1 / 3) * 255),
    clampByte(hue2rgb(p, q, h) * 255),
    clampByte(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => clampByte(n).toString(16).padStart(2, '0')).join('')
}

/** Hue + a punched-up saturation from a muddy sampled color. */
function gradeHueSat(r: number, g: number, b: number): [number, number] {
  const [h, s] = rgbToHsl(r, g, b)
  const sat = Math.min(0.72, Math.max(0.5, s * 1.6 + 0.25))
  return [h, sat]
}

/** Four accent shades (300/400/500/600) graded from a sampled RGB color. */
export function shadesFromRgb(r: number, g: number, b: number): AccentPreset['shades'] {
  const [h, s] = gradeHueSat(r, g, b)
  const at = (l: number) => {
    const [rr, gg, bb] = hslToRgb(h, s, l)
    return toHex(rr, gg, bb)
  }
  return { 300: at(0.74), 400: at(0.66), 500: at(0.58), 600: at(0.48) }
}

/** A vivid RGB triple for glows / light-spill, from a muddy sampled color. */
export function vividRgb(r: number, g: number, b: number): [number, number, number] {
  const [h, s] = gradeHueSat(r, g, b)
  return hslToRgb(h, s, 0.6)
}

// Apply the last-used accent immediately at import time (before first paint),
// so returning users never see a flash of the default color.
applyAccent(getStoredAccent())
