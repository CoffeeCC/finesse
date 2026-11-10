// UI sound design: a subtle tick as focus moves, a soft confirm on select.
// Pure WebAudio (no assets), gated behind the `uiSounds` pref. Volume is user-
// controlled, and every blip is slightly randomized (pitch + level) so repeats
// feel organic instead of machine-stamped.

import { getPrefs } from './settings'
import { moodHue } from './mood'
import type { DeskSound } from './deskSequence'

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

const clamp = (n: number, lo: number, hi: number) => Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo

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

// Major pentatonic over two octaves from C6: any sequence of these sounds in key.
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21].map((s) => 1046.5 * 2 ** (s / 12))

/** Subtle tick as focus moves (D-pad / arrow nav, and mouse hover if on). On a
 *  card it's a soft note picked by the poster's hue — browsing a shelf plays a
 *  gentle, always-in-key melody that follows the colours. */
export function playNav(el?: Element | null) {
  const now = performance.now()
  if (now - lastNav < 45) return // don't machine-gun on held keys / fast hovers
  lastNav = now
  const mood = el?.closest?.('[data-mood]')?.getAttribute('data-mood') ?? el?.querySelector?.('[data-mood]')?.getAttribute('data-mood')
  const hue = mood ? moodHue(mood) : null
  if (hue != null) {
    blip(PENTATONIC[Math.min(PENTATONIC.length - 1, Math.floor((hue / 360) * PENTATONIC.length))], 0.09, 0.03, 'sine')
    return
  }
  blip(2000 + Math.random() * 260, 0.05, 0.035, 'sine')
}

/** Soft two-note confirm when a link/button is activated. */
export function playSelect() {
  const base = 720 + Math.random() * 90
  blip(base, 0.09, 0.05, 'triangle')
  window.setTimeout(() => blip(base * 1.5, 0.12, 0.045, 'triangle'), 50 + Math.random() * 20)
}

let installed = false

/** Original, restrained object sounds; same context, volume and media guard as Finesse. */
export function playArcaneSound(kind: 'orb' | 'deck' | 'cards' | 'card-land' | 'flame' | 'coin-flip' | 'coin-land' | 'tuning-fork' | 'quill' | 'vials' | 'lantern' | 'sextant' | 'eraser' | 'courier-horn' | 'escapement' | 'shears-open' | 'shears-cut' | 'lots' | 'tally' | DeskSound) {
  const prefs = getPrefs(), vol = clamp(prefs.uiSoundsVolume ?? .6, 0, 1)
  if (!prefs.uiSounds || vol <= 0 || mediaIsPlaying() || document.hidden) return
  const ac = audioCtx(); if (!ac) return
  const now = ac.currentTime, jitter = 1 + (Math.random() - .5) * .025
  const voices: { source: AudioScheduledSourceNode; gain: GainNode }[] = []
  const tone = (frequency: number, duration: number, level: number, delay = 0, end = frequency) => {
    const oscillator = ac.createOscillator(), gain = ac.createGain(), t = now + delay
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency * jitter, t)
    oscillator.frequency.exponentialRampToValueAtTime(end * jitter, t + duration)
    gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(Math.max(.0002, level * vol), t + .008)
    gain.gain.exponentialRampToValueAtTime(.0001, t + duration)
    oscillator.connect(gain).connect(ac.destination)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
    oscillator.start(t); oscillator.stop(t + duration + .015)
    voices.push({source:oscillator,gain})
  }
  const rustle = (delay: number, duration: number, frequency: number, level: number) => {
    const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * duration), ac.sampleRate), data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const source = ac.createBufferSource(), filter = ac.createBiquadFilter(), gain = ac.createGain(), t = now + delay
    source.buffer = buffer; filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = .8
    gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(Math.max(.0002, level * vol), t + .012)
    gain.gain.exponentialRampToValueAtTime(.0001, t + duration)
    source.connect(filter).connect(gain).connect(ac.destination)
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect() }
    source.start(t); source.stop(t + duration)
    voices.push({source,gain})
  }
  if(kind==='tally'){
    for(let i=0;i<3;i++){rustle(i*.055,.055,850+i*140,.014);tone(390+i*47,.07,.008,i*.055,280+i*37)}
  } else if(kind==='lots'){
    for(let i=0;i<5;i++){rustle(i*.045,.045,1800-i*120,.015);tone(880+i*73,.075,.006,i*.045,650+i*38)}
  } else if (kind === 'courier-horn') {
    tone(220,.24,.014,0,247);tone(440,.18,.005,.03,494);rustle(.01,.18,460,.018)
  } else if (kind === 'escapement') {
    rustle(0,.04,2400,.020);tone(1200,.075,.010,0,880);rustle(.07,.04,1800,.012)
  } else if (kind === 'shears-open') {
    rustle(0,.15,1900,.026);tone(1600,.09,.008,.015,1200)
  } else if (kind === 'shears-cut') {
    rustle(0,.07,2300,.030);tone(680,.07,.012,0,430);rustle(.04,.07,1200,.017)
  } else if (kind === 'eraser') {
    rustle(0,.20,1050,.025);rustle(.10,.16,800,.012)
  } else if (kind === 'quill') {
    rustle(0,.13,2300,.022);rustle(.11,.08,1700,.012);tone(320,.08,.006,.03,280)
  } else if (kind === 'vials') {
    tone(1640,.22,.018);tone(2460,.16,.008,.045);rustle(.01,.06,2100,.012)
  } else if (kind === 'lantern') {
    tone(650,.14,.014,0,590);rustle(.03,.18,740,.023);tone(1310,.16,.006,.04)
  } else if (kind === 'sextant') {
    rustle(0,.10,1650,.020);tone(1900,.09,.009,.02,1460);tone(830,.08,.007,.08)
  } else if (kind === 'tuning-fork') {
    tone(440,.42,.035);tone(880,.28,.008,.015);rustle(0,.06,1800,.015)
  } else if (kind === 'key-lift') {
    rustle(0,.08,2400,.018);tone(1900,.12,.009,.015,1670)
  } else if (kind === 'key-insert') {
    rustle(0, .11, 3100, .028); tone(2300, .13, .014, .035, 1700)
  } else if (kind === 'key-turn') {
    rustle(0, .22, 1350, .035); tone(570, .11, .018, .04, 430); tone(2450, .08, .008, .13, 1900)
  } else if (kind === 'lock-release') {
    tone(185, .12, .03, 0, 110); rustle(.025, .09, 1800, .04); tone(1260, .12, .008, .07)
  } else if (kind === 'lock-latch') {
    tone(130, .1, .034, 0, 85); rustle(.015, .08, 1250, .04); tone(1680, .08, .008, .045)
  } else if (kind === 'desk-open') {
    // Restrained wood strain, a deeper hinge and a short leather breath.
    tone(115, .52, .02, 0, 153); tone(238, .44, .007, .03, 271); rustle(.04, .48, 460, .045)
  } else if (kind === 'desk-close') {
    tone(145, .44, .018, 0, 95); rustle(.025, .38, 340, .04); tone(82, .14, .025, .34, 65)
  } else if (kind === 'drawer-open') {
    rustle(0, .38, 720, .045); tone(210, .22, .01, .025, 130); rustle(.29, .10, 420, .02)
  } else if (kind === 'drawer-close') {
    rustle(0, .27, 560, .038); tone(93, .15, .025, .22, 64)
  } else if (kind === 'orb') {
    // Two glass partials above a breath of air, rather than a loud magical sting.
    tone(523.25, .48, .045, 0, 554.37); tone(1569.75, .4, .018, .055, 1663.1); rustle(.02, .23, 900, .035)
  } else if (kind === 'deck') {
    rustle(0, .16, 650, .07); tone(180, .16, .05, .05, 125); tone(880, .12, .012, .13)
  } else if (kind === 'cards') {
    for (const delay of [0, .075, .15]) rustle(delay, .11, 1900 + delay * 2000, .065)
    tone(320, .09, .018, .19, 210)
  } else if (kind === 'card-land') {
    rustle(0, .07, 1450, .024); tone(210, .055, .008, .01, 155)
  } else if (kind === 'flame') {
    rustle(0, .23, 620, .04); tone(118, .15, .012, .025, 140)
  } else if (kind === 'coin-flip') {
    tone(1760, .2, .04); tone(3820, .15, .012, .015); rustle(.01, .2, 2300, .025)
  } else {
    // Unequal partials and a softer second contact give the bronze a little weight.
    tone(1046.5, .33, .055); tone(2458, .24, .025); tone(3990, .14, .01)
    tone(1046.5, .15, .023, .09); rustle(0, .075, 1150, .045)
  }
  return () => {
    const t=ac.currentTime
    for(const voice of voices) try {
      voice.gain.gain.cancelScheduledValues(t);voice.gain.gain.setTargetAtTime(.0001,t,.012);voice.source.stop(t+.05)
    } catch { /* A voice may already have ended. */ }
  }
}

/** Install the global select-confirm (+ optional hover-tick) listeners. */
export function initUiSounds() {
  if (installed || typeof window === 'undefined') return
  installed = true

  // `click` fires for pointer taps and keyboard/remote (Enter/OK) alike.
  window.addEventListener(
    'click',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.('a[href], button')
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('data-ui-sound') === 'handled') return
      if (document.documentElement.dataset.theme === 'card-table') {
        if (document.documentElement.dataset.arcaneSleep === 'true') return
        const collectionTool=el.getAttribute('data-collection-tool')
        const kind = collectionTool==='query'?'quill':collectionTool==='genres'?'vials':collectionTool==='watch'?'lantern':collectionTool==='sort'?'sextant':collectionTool==='erase'?'eraser':el.matches('.search-object, .arcane-search-trinket') ? 'orb'
          : el.matches('.candle-object') ? 'flame'
          : el.matches('.deck-box-object, .story-action, .vault-deck, .vault-codex') ? 'deck'
          : el.matches('.draw-pile, .deal-action, .hand-card, .playing-card, .folio-slot') || el.closest('.folio-pagination') ? 'cards' : null
        if (kind) { playArcaneSound(kind); return }
      }
      playSelect()
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
        playNav(el)
      }
    },
    { capture: true },
  )
}
