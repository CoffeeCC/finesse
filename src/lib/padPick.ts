// Which of the browser's "gamepads" is the controller in your hands.
//
// The Gamepad API lists any HID device that looks vaguely like one: a USB microphone
// (a Blue Yeti's mute button and gain dial), a headset's volume keys, a keyboard's media
// keys. Those used to drive Finesse (a stuck "axis" held Right forever) and became player 1
// in the retro player, so the real controller did nothing. Here: what counts as a
// controller and which one to use (lib/gamepad keeps the one this device chose).
// Pure, so server/test/pad-pick.test.ts can check it.

export interface PadLike {
  id: string
  index: number
  mapping: string
  buttons: ArrayLike<unknown>
  axes: ArrayLike<number>
}

// Microphones, headsets, keyboards, mice, cameras, stream decks, media remotes: by name or by
// maker (USB vendor ids: Blue b58e, Elgato 0fd9, RODE 19f7, Shure 14ed, Audio-Technica 0909,
// HyperX/Kingston 0951, SteelSeries Arctis… by name).
const NOT_A_PAD =
  /\b(yeti|snowball|microphone|mic|headset|headphones?|earbuds|speaker|audio|sound|webcam|camera|keyboard|mouse|trackpad|touchpad|stream ?deck|consumer control|system control|wacom|tablet pen|arctis|quadcast|wave:?\d|podmic|airpods)\b|vendor: ?(b58e|0fd9|19f7|14ed|0909)\b|^(b58e|0fd9|19f7|14ed|0909)-/i

/** A real game controller, not a microphone or keyboard that happens to show up as one. */
export function isRealPad(p: PadLike): boolean {
  if (NOT_A_PAD.test(p.id)) return false
  // The browser knows it (Xbox, PlayStation, Switch Pro, most Bluetooth pads): it maps it.
  if (p.mapping === 'standard') return p.buttons.length >= 4
  // Unmapped: a controller still has a D-pad or stick and a handful of buttons.
  return p.buttons.length >= 6 && p.axes.length >= 2
}

/** How sure we are it's a controller to play with: mapped, from a console maker, with sticks. */
function score(p: PadLike): number {
  let s = 0
  if (p.mapping === 'standard') s += 4
  if (/vendor: ?(045e|054c|057e|2dc8|0f0d|0e6f|24c6|1532|046d)\b|^(045e|054c|057e|2dc8|0f0d|0e6f|24c6|1532|046d)-|xbox|xinput|dualsense|dualshock|playstation|pro controller|8bitdo|gamepad|controller|joystick/i.test(p.id)) s += 2
  if (p.buttons.length >= 16) s += 1
  if (p.axes.length >= 4) s += 1
  return s
}

/** The real controllers, best first (ties: the one connected first). */
export function realPads<P extends PadLike>(pads: ArrayLike<P | null | undefined>): P[] {
  const out: P[] = []
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i]
    if (p && isRealPad(p)) out.push(p)
  }
  return out.sort((a, b) => score(b) - score(a) || a.index - b.index)
}

/** The controller to use: the one this device chose before if it's here, else the best one. */
export function choosePad<P extends PadLike>(pads: ArrayLike<P | null | undefined>, remembered: string | null): P | null {
  const real = realPads(pads)
  return (remembered ? real.find((p) => p.id === remembered) : undefined) ?? real[0] ?? null
}

/** Ask which one? Only with more than one real controller and none chosen before among them. */
export function needsPick(pads: ArrayLike<PadLike | null | undefined>, remembered: string | null): boolean {
  const real = realPads(pads)
  return real.length > 1 && !real.some((p) => p.id === remembered)
}

/** A name a person recognises: "Xbox Wireless Controller", not "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)". */
export function padName(id: string): string {
  const s = id
    .replace(/\((?:[^)]*\b(?:STANDARD GAMEPAD|Vendor:|Product:)[^)]*)\)/gi, '')
    .replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return s || 'Controller'
}
