// Which controller plays in the retro player (EmulatorJS).
//
// EmulatorJS makes player 1 whatever "gamepad" the browser lists first. A USB microphone
// (a Blue Yeti) is listed too, often first: it became player 1 and the Xbox pad player 2,
// which the game ignores. Here player 1 is the controller this device chose before, else the
// best real one (lib/padPick); microphones and keyboards are never players. With two real
// controllers and no choice yet, the page asks which (press a button on it, or tap its name).
// The pick holds for this session by name and slot (two identical controllers stay apart); the
// device remembers only the name.

import { choosePad, needsPick, padKey, padNames, realPads, type PadChoice } from './padPick'
import { rememberedPad, rememberPad } from './gamepad'

/** What we use of EmulatorJS's controller handling (4.x). Checked: other versions play as they always did. */
interface EjsPads {
  gamepadSelection?: string[]
  updateGamepadLabels?: () => void
  gamepad?: { listeners?: Record<string, ((e: unknown) => void) | undefined> }
}

export interface PadState {
  /** The real controllers connected, best first. `key` is unique; `name` too ("… (1)", "… (2)"). */
  pads: { key: string; id: string; name: string }[]
  /** Player 1's controller (its key). */
  chosen: string | null
  /** More than one and none chosen before: ask. */
  ask: boolean
}

const connected = (): (Gamepad | null)[] => (navigator.getGamepads ? Array.from(navigator.getGamepads()) : [])

// Picked on this page: by name and slot. Not kept: slots change between sessions.
let session: PadChoice | null = null

function state(): PadState {
  const pads = connected()
  const remembered = rememberedPad()
  const real = realPads(pads)
  const names = padNames(real)
  const chosen = choosePad(pads, remembered, session)
  return {
    pads: real.map((p, i) => ({ key: padKey(p), id: p.id, name: names[i]! })),
    chosen: chosen ? padKey(chosen) : null,
    ask: needsPick(pads, remembered, session),
  }
}

/** Give EmulatorJS's players the right controllers, now and whenever one connects or goes. */
export function bindPads(emu: EjsPads, onChange: (s: PadState) => void): { choose: (key: string) => void } {
  const assign = () => {
    const sel = emu.gamepadSelection
    if (Array.isArray(sel)) {
      const pads = connected()
      const first = choosePad(pads, rememberedPad(), session)
      const order = first ? [first, ...realPads(pads).filter((p) => p !== first)] : []
      // EmulatorJS names a controller "<id>_<index>".
      for (let i = 0; i < sel.length; i++) sel[i] = order[i] ? `${order[i]!.id}_${order[i]!.index}` : ''
      try {
        emu.updateGamepadLabels?.()
      } catch {
        /* its menu isn't built yet */
      }
    }
    onChange(state())
  }
  const listeners = emu.gamepad?.listeners
  if (listeners) {
    const onConnect = listeners.connected
    const onGone = listeners.disconnected
    listeners.connected = (e) => {
      onConnect?.(e)
      assign()
    }
    listeners.disconnected = (e) => {
      onGone?.(e)
      // EmulatorJS forgets the controller a moment later.
      window.setTimeout(assign, 30)
    }
  }
  assign()
  return {
    choose: (key: string) => {
      const p = realPads(connected()).find((x) => padKey(x) === key)
      if (!p) return
      session = { id: p.id, index: p.index }
      rememberPad(p.id)
      assign()
    },
  }
}

/** While the picker is open: the real controller someone pressed a button on (its key), if any. */
export function pressedPad(): string | null {
  for (const p of realPads(connected())) if (p.buttons.some((b) => b.pressed)) return padKey(p)
  return null
}
