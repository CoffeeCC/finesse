// Is this screen keeping up? Browsers count the video frames they had to drop. A steady share of
// dropped frames while playing means the device can't keep up with everything on screen; the
// player then turns its optional effects off (the ambient glow) to keep the picture smooth.

export interface FrameSample {
  /** ms (performance.now()) */
  at: number
  dropped: number
  total: number
}

/** Look at the last this-many ms of playback. */
export const WINDOW_MS = 6000
/** At least this many frames in the window (about 2 seconds of video), so a short blip isn't judged. */
const MIN_FRAMES = 48
/** More than this share dropped is struggling: smooth playback drops none or nearly none. */
const MAX_SHARE = 0.15
/** And at least this many dropped, so one or two at a scene change don't count. */
const MIN_DROPPED = 20

/** Adds a sample (keeping only the last WINDOW_MS) and says whether playback is struggling. */
export function struggling(samples: FrameSample[], next: FrameSample): boolean {
  // The counters start over with a new stream (an episode switch, a quality change).
  const last = samples.at(-1)
  if (last && (next.total < last.total || next.dropped < last.dropped)) samples.length = 0
  samples.push(next)
  while (samples.length > 2 && next.at - samples[0]!.at > WINDOW_MS) samples.shift()
  const first = samples[0]!
  const total = next.total - first.total
  const dropped = next.dropped - first.dropped
  return total >= MIN_FRAMES && dropped >= MIN_DROPPED && dropped / total > MAX_SHARE
}
