// User preferences, persisted in localStorage. Read synchronously so the
// device profile and player can use them without a round-trip.

export type VisualizerStyle = 'bars' | 'waveform' | 'radial' | 'particles'
export const VISUALIZER_STYLES: VisualizerStyle[] = ['bars', 'waveform', 'radial', 'particles']

// Preview-clip quality (hover + hero). Per-account so each person can match it
// to their own connection. Maps to the pre-generated clip resolutions on the
// NAS (see deploy/genclips.sh): low = 480p (always present), medium = 720p,
// high = 1080p, each falling back to the next one down if not yet generated.
export type PreviewQuality = 'low' | 'medium' | 'high'
export const PREVIEW_QUALITY_HEIGHT: Record<PreviewQuality, number> = {
  low: 480,
  medium: 720,
  high: 1080,
}
export const PREVIEW_QUALITY_OPTIONS: { label: string; value: PreviewQuality }[] = [
  { label: 'High — 1080p (fast/local network)', value: 'high' },
  { label: 'Medium — 720p', value: 'medium' },
  { label: 'Low — 480p (slow connections)', value: 'low' },
]

export interface Prefs {
  /** Max streaming bitrate in bits/sec. 0 = unlimited (direct, no cap). */
  maxBitrate: number
  /** Turn subtitles on by default when a stream has them. */
  subtitlesDefault: boolean
  /** Auto-play the next episode when one finishes. */
  autoPlayNext: boolean
  /** Selected music visualizer style. */
  visualizer: VisualizerStyle
  /** Whole-UI zoom factor (1 = 100%). Mainly for 10-foot TV viewing. */
  uiScale: number
  /** Subtle UI sound effects (nav tick + select confirm). On by default. */
  uiSounds: boolean
  /** Preview-clip quality (hover + hero). Per-account; matches your connection. */
  previewQuality: PreviewQuality
}

const KEY = 'finesse.prefs'

const DEFAULTS: Prefs = {
  maxBitrate: 0,
  subtitlesDefault: false,
  autoPlayNext: true,
  visualizer: 'bars',
  uiScale: 1,
  uiSounds: true,
  previewQuality: 'high',
}

// UI zoom presets surfaced in settings. CSS `zoom` reflows the layout (unlike
// transform: scale), so larger values just make everything bigger cleanly.
export const UI_SCALE_OPTIONS: { label: string; value: number }[] = [
  { label: '100% (default)', value: 1 },
  { label: '110%', value: 1.1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '175%', value: 1.75 },
  { label: '200% (couch / big TV)', value: 2 },
]

/** Apply the saved UI zoom to the document. Safe to call before React mounts. */
export function applyUiScale(scale = getPrefs().uiScale) {
  const html = document.documentElement as HTMLElement & { style: CSSStyleDeclaration }
  // `zoom` isn't in the typed CSSStyleDeclaration but Chromium/webOS support it.
  ;(html.style as unknown as Record<string, string>).zoom = !scale || scale === 1 ? '' : String(scale)
}

// Common cap presets surfaced in the settings UI (label → bits/sec).
export const BITRATE_OPTIONS: { label: string; value: number }[] = [
  { label: 'Unlimited (original quality)', value: 0 },
  { label: '20 Mbps — 1080p high', value: 20_000_000 },
  { label: '10 Mbps — 1080p', value: 10_000_000 },
  { label: '4 Mbps — 720p', value: 4_000_000 },
  { label: '2 Mbps — 480p (slow connections)', value: 2_000_000 },
  { label: '720 kbps — audio-priority', value: 720_000 },
]

export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {}
    const merged = { ...DEFAULTS, ...parsed }
    // 10-foot default: unless the user explicitly picked a size, the TV runs at
    // 130% — bigger type AND fewer cards on screen (less to paint per frame).
    if (__WEBOS__ && !('uiScale' in parsed)) merged.uiScale = 1.3
    return merged
  } catch {
    return { ...DEFAULTS }
  }
}

export function setPrefs(patch: Partial<Prefs>) {
  const next = { ...getPrefs(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}
