// UI sound design: a subtle tick as focus moves, a soft confirm on select.
// Pure WebAudio (no assets) — a few oscillator blips, gated behind the opt-in
// `uiSounds` pref. This is the detail that makes Netflix/PS5 feel *expensive*.

import { getPrefs } from './settings'

let ctx: AudioContext | null = null

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) {
    try {
      ctx = new AC()
    } catch {
      return null
    }
  }
  // Browsers start the context suspended until a user gesture; our callers all
  // fire inside gestures (keydown / click), so resuming here is allowed.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// A tick over a playing movie/track would be jarring — stay silent then.
function mediaIsPlaying(): boolean {
  const media = document.querySelectorAll<HTMLMediaElement>('video, audio')
  for (const m of media) {
    if (!m.paused && !m.muted && m.currentTime > 0) return true
  }
  return false
}

function blip(freq: number, dur: number, peak: number, type: OscillatorType = 'sine') {
  if (!getPrefs().uiSounds || mediaIsPlaying()) return
  const ac = audioCtx()
  if (!ac) return
  const t = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  // Fast attack, exponential decay — a soft "tick", not a beep.
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(gain).connect(ac.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

let lastNav = 0

/** Subtle high tick as focus moves between elements (D-pad / arrow nav). */
export function playNav() {
  // Held arrow keys repeat fast; don't machine-gun the tick.
  const now = performance.now()
  if (now - lastNav < 45) return
  lastNav = now
  blip(2100, 0.05, 0.035, 'sine')
}

/** Soft two-note confirm when a link/button is activated. */
export function playSelect() {
  blip(760, 0.09, 0.05, 'triangle')
  window.setTimeout(() => blip(1140, 0.12, 0.045, 'triangle'), 55)
}

let installed = false

/** Install the global select-confirm listener. Idempotent; safe to call once. */
export function initUiSounds() {
  if (installed || typeof window === 'undefined') return
  installed = true
  // `click` fires for both pointer taps and keyboard/remote (Enter/OK on a
  // focused <a>/<button>), so one listener covers mouse, touch, and D-pad.
  window.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.('a[href], button')
      if (el && !(el as HTMLButtonElement).disabled) playSelect()
    },
    { capture: true },
  )
}
