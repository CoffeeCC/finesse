// User preferences, persisted in localStorage. Read synchronously so the
// device profile and player can use them without a round-trip.

export interface Prefs {
  /** Max streaming bitrate in bits/sec. 0 = unlimited (direct, no cap). */
  maxBitrate: number
  /** Turn subtitles on by default when a stream has them. */
  subtitlesDefault: boolean
  /** Auto-play the next episode when one finishes. */
  autoPlayNext: boolean
}

const KEY = 'finesse.prefs'

const DEFAULTS: Prefs = {
  maxBitrate: 0,
  subtitlesDefault: false,
  autoPlayNext: true,
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
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
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
