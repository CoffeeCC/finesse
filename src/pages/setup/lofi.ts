// Lo-Finessa: an optional lo-fi loop while you set up (original music, made
// for Finesse). Browser only, and never in the way:
//  - the file loads lazily, after the wizard is up; if it can't load, the
//    toggle simply never appears;
//  - browsers don't allow sound before a click, so it starts on the first one;
//  - Web Audio loops the decoded buffer sample-exactly (<audio loop> leaves a
//    small gap at the seam in some browsers);
//  - muting is remembered for later visits.

import { useEffect, useState } from 'react'
import { CONTENT_BASE } from '../../lib/contentOrigin'

const PREF = 'finesse.lofi'
const VOLUME = 0.3
const FADE_IN_S = 1.5
const SOURCES = ['setup/lo-finessa-loop.opus', 'setup/lo-finessa-loop.mp3']
export const LOFI_VIDEOS = ['setup/lo-finessa-loop.webm', 'setup/lo-finessa-loop.mp4'].map((f) => `${CONTENT_BASE}${f}`)

type Status = 'idle' | 'loading' | 'ready' | 'failed'
interface State {
  status: Status
  muted: boolean
  playing: boolean
}

let state: State = { status: 'idle', muted: readMuted(), playing: false }
const listeners = new Set<() => void>()
let ctx: AudioContext | null = null
let buffer: AudioBuffer | null = null
let source: AudioBufferSourceNode | null = null
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

/** Fetch and decode the loop (once). Opus first (smaller), then mp3. */
export function loadLofi() {
  if (state.status !== 'idle' || __WEBOS__) return
  update({ status: 'loading' })
  void (async () => {
    const ac = audioContext()
    if (!ac) return update({ status: 'failed' })
    for (const file of SOURCES) {
      try {
        const res = await fetch(`${CONTENT_BASE}${file}`)
        // A missing file comes back as the app's own page (text/html), not a 404.
        if (!res.ok || /^text\//.test(res.headers.get('content-type') ?? '')) continue
        const data = await res.arrayBuffer()
        buffer = await new Promise<AudioBuffer>((resolve, reject) => ac.decodeAudioData(data, resolve, reject))
        update({ status: 'ready' })
        if (wantPlay && !state.muted) start()
        return
      } catch {
        /* try the next format */
      }
    }
    update({ status: 'failed' })
  })()
}

function start() {
  if (finished || !buffer || state.playing) return
  const ac = audioContext()
  if (!ac) return
  void ac.resume().catch(() => {})
  gain = ac.createGain()
  gain.gain.setValueAtTime(0, ac.currentTime)
  gain.gain.linearRampToValueAtTime(VOLUME, ac.currentTime + FADE_IN_S)
  gain.connect(ac.destination)
  source = ac.createBufferSource()
  source.buffer = buffer
  source.loop = true
  source.connect(gain)
  source.start()
  update({ playing: true })
}

function stop(fadeS: number) {
  const ac = ctx
  const s = source
  const g = gain
  source = null
  gain = null
  update({ playing: false })
  if (!ac || !s || !g) return
  const now = ac.currentTime
  g.gain.cancelScheduledValues(now)
  g.gain.setValueAtTime(g.gain.value, now)
  g.gain.linearRampToValueAtTime(0, now + fadeS)
  window.setTimeout(() => {
    try {
      s.stop()
      s.disconnect()
      g.disconnect()
    } catch {
      /* already stopped */
    }
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
    void ctx?.close().catch(() => {})
    ctx = null
  }, fadeS * 1000 + 200)
}

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
