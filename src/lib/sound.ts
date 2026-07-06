// UI sound design: a subtle tick as focus moves, a soft confirm on select.
// Pure WebAudio (no assets), gated behind the `uiSounds` pref. Volume is user-
// controlled, and every blip is slightly randomized (pitch + level) so repeats
// feel organic instead of machine-stamped.

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
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// A tick over a *playing* (unmuted) movie/track would be jarring — stay silent
// then. Muted hover-previews don't count, so browsing still chirps.
function mediaIsPlaying(): boolean {
  const media = document.querySelectorAll<HTMLMediaElement>('video, audio')
  for (const m of media) {
    if (!m.paused && !m.muted && m.currentTime > 0) return true
  }
  return false
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function blip(freq: number, dur: number, peak: number, type: OscillatorType = 'sine') {
  const p = getPrefs()
  const vol = clamp(p.uiSoundsVolume ?? 0.6, 0, 1)
  if (!p.uiSounds || vol <= 0 || mediaIsPlaying()) return
  const ac = audioCtx()
  if (!ac) return
  // Randomize a touch: ±3% pitch, ±12% level — similar, never identical.
  const fJitter = 1 + (Math.random() - 0.5) * 0.06
  const gJitter = 1 + (Math.random() - 0.5) * 0.24
  const gain = clamp(peak * vol * 3 * gJitter, 0.0002, 0.28)
  const t = ac.currentTime
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq * fJitter, t)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(ac.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

let lastNav = 0

/** Subtle high tick as focus moves (D-pad / arrow nav, and mouse hover if on). */
export function playNav() {
  const now = performance.now()
  if (now - lastNav < 45) return // don't machine-gun on held keys / fast hovers
  lastNav = now
  blip(2000 + Math.random() * 260, 0.05, 0.035, 'sine')
}

/** Soft two-note confirm when a link/button is activated. */
export function playSelect() {
  const base = 720 + Math.random() * 90
  blip(base, 0.09, 0.05, 'triangle')
  window.setTimeout(() => blip(base * 1.5, 0.12, 0.045, 'triangle'), 50 + Math.random() * 20)
}

let installed = false

/** Install the global select-confirm (+ optional hover-tick) listeners. */
export function initUiSounds() {
  if (installed || typeof window === 'undefined') return
  installed = true

  // `click` fires for pointer taps and keyboard/remote (Enter/OK) alike.
  window.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.('a[href], button')
      if (el && !(el as HTMLButtonElement).disabled) playSelect()
    },
    { capture: true },
  )

  // Optional: tick on mouse hover of a card/control. Only once per element
  // entered (not per pixel), and only when the user opts in.
  let lastHover: Element | null = null
  window.addEventListener(
    'pointerover',
    (e) => {
      if (e.pointerType !== 'mouse' || !getPrefs().uiSoundsHover) return
      const el = (e.target as HTMLElement | null)?.closest?.('a[href], button')
      if (el && el !== lastHover) {
        lastHover = el
        playNav()
      }
    },
    { capture: true },
  )
}
