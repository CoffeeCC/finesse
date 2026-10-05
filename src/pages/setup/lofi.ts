// Lo-Finessa: optional lo-fi music while you set up (an original song, made
// for Finesse). Browser only, and never in the way:
//  - the song loads lazily, after the wizard is up; if it can't load, the
//    toggle simply never appears;
//  - browsers don't allow sound before a click, so it starts on the first one;
//  - the whole song plays and starts over. It streams from an <audio> element
//    (decoding three minutes up front would take ~70 MB), routed through Web
//    Audio for the fades;
//  - muting is remembered for later visits.

import { useEffect, useState } from 'react'
import { CONTENT_BASE } from '../../lib/contentOrigin'

const PREF = 'finesse.lofi'
const VOLUME = 0.3
const FADE_IN_S = 1.5
const SOURCES: [string, string][] = [
  ['setup/lo-finessa-song.opus', 'audio/ogg; codecs=opus'],
  ['setup/lo-finessa-song.mp3', 'audio/mpeg'],
]
export const LOFI_VIDEOS = ['setup/lo-finessa-loop.webm', 'setup/lo-finessa-loop.mp4'].map((f) => `${CONTENT_BASE}${f}`)
export const LOFI_STILL = `${CONTENT_BASE}setup/lo-finessa-still.jpg`

type Status = 'idle' | 'loading' | 'ready' | 'failed'
interface State {
  status: Status
  muted: boolean
  playing: boolean
}

let state: State = { status: 'idle', muted: readMuted(), playing: false }
const listeners = new Set<() => void>()
let ctx: AudioContext | null = null
let audio: HTMLAudioElement | null = null
let source: MediaElementAudioSourceNode | null = null
let gain: GainNode | null = null
let wantPlay = false // a click came while still loading
let finished = false // faded out for good (setup is over)

function readMuted(): boolean {
  try {
    return localStorage.getItem(PREF) === 'off'
  } catch {
    return false
  }
}

function update(p: Partial<State>) {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

function audioContext(): AudioContext | null {
  if (ctx) return ctx
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  return ctx
}

/** Find a format this browser plays (Opus first, it's smaller) and let it buffer (once). */
export function loadLofi() {
  if (state.status !== 'idle' || __WEBOS__) return
  update({ status: 'loading' })
  const el = new Audio()
  const pick = SOURCES.find(([, type]) => el.canPlayType(type) !== '')
  if (!pick) return update({ status: 'failed' })
  el.preload = 'auto'
  el.loop = true
  el.crossOrigin = 'anonymous'
  el.addEventListener(
    'canplay',
    () => {
      if (state.status !== 'loading') return
      audio = el
      update({ status: 'ready' })
      if (wantPlay && !state.muted) start()
    },
    { once: true },
  )
  // A missing file comes back as the app's own page, which fails to decode: same as a 404.
  el.addEventListener('error', () => update({ status: 'failed' }), { once: true })
  el.src = `${CONTENT_BASE}${pick[0]}`
  el.load()
}

function start() {
  if (finished || !audio || state.playing) return
  const ac = audioContext()
  if (!ac) return
  void ac.resume().catch(() => {})
  if (!gain) {
    gain = ac.createGain()
    gain.connect(ac.destination)
  }
  // An element can be wired to Web Audio only once; it stays wired for the visit.
  if (!source) {
    source = ac.createMediaElementSource(audio)
    source.connect(gain)
  }
  gain.gain.cancelScheduledValues(ac.currentTime)
  gain.gain.setValueAtTime(0, ac.currentTime)
  gain.gain.linearRampToValueAtTime(VOLUME, ac.currentTime + FADE_IN_S)
  void audio.play().catch(() => update({ playing: false }))
  update({ playing: true })
}

function stop(fadeS: number) {
  const ac = ctx
  const el = audio
  const g = gain
  update({ playing: false })
  if (!ac || !el || !g) return
  const now = ac.currentTime
  g.gain.cancelScheduledValues(now)
  g.gain.setValueAtTime(g.gain.value, now)
  g.gain.linearRampToValueAtTime(0, now + fadeS)
  window.setTimeout(() => {
    if (!state.playing) el.pause()
  }, fadeS * 1000 + 50)
}

/** The first click anywhere in the wizard: the moment sound is allowed. */
export function lofiUserGesture() {
  if (finished || state.muted) return
  wantPlay = true
  if (state.status === 'ready') start()
}

export function setLofiMuted(muted: boolean) {
  try {
    localStorage.setItem(PREF, muted ? 'off' : 'on')
  } catch {
    /* private window: just for this visit */
  }
  update({ muted })
  if (muted) stop(0.4)
  else {
    wantPlay = true
    start()
  }
}

/** Setup is over: fade out (default 2 s) and let go of the audio device. */
export function finishLofi(fadeS = 2) {
  if (finished) return
  finished = true
  stop(fadeS)
  window.setTimeout(() => {
    audio?.removeAttribute('src')
    audio?.load()
    void ctx?.close().catch(() => {})
    ctx = null
  }, fadeS * 1000 + 200)
}

export const lofiState = (): State => state

export function useLofi(): State {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return state
}
