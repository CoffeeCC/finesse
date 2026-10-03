// Game controllers (Xbox, PlayStation, Switch Pro…) drive the whole app. They
// press the same keys the TV remote does, so every page, menu and the player
// work without knowing controllers exist:
//   stick / D-pad → arrows (held: repeats)   A → OK   B → Back   Y → Search
//   Menu → Quick menu   LB/RB → previous/next tab   LT/RT → rewind/forward
//   X → audio and subtitles (player)         right stick → scroll
// The retro-games player reads controllers itself, so it's left alone there.

import { useSyncExternalStore } from 'react'
import { toggleQuickMenu } from './quickMenu'

export type PadKind = 'xbox' | 'playstation' | 'nintendo' | 'generic'

// Standard mapping (https://w3c.github.io/gamepad/#remapping).
const A = 0
const B = 1
const X = 2
const Y = 3
const LB = 4
const RB = 5
const LT = 6
const RT = 7
const MENU = 9
const UP = 12
const DOWN = 13
const LEFT = 14
const RIGHT = 15

const REPEAT_DELAY = 380
const REPEAT_EVERY = 110
const STICK = 0.55

export function padKind(id: string): PadKind {
  const s = id.toLowerCase()
  // The maker's USB id first (Microsoft, Sony, Nintendo): names overlap — Xbox
  // and PlayStation pads both call themselves "Wireless Controller".
  if (/vendor: ?045e|^045e-/.test(s)) return 'xbox'
  if (/vendor: ?054c|^054c-/.test(s)) return 'playstation'
  if (/vendor: ?057e|^057e-/.test(s)) return 'nintendo'
  if (/xbox|xinput/.test(s)) return 'xbox'
  if (/dualsense|dualshock|playstation|^wireless controller/.test(s)) return 'playstation'
  if (/pro controller|joy-con|nintendo/.test(s)) return 'nintendo'
  return 'generic'
}

// ---- Which controller is in hand (for hints) ----
let current: { kind: PadKind; at: number } | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((fn) => fn())
export function useController(): { kind: PadKind; at: number } | null {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    () => current,
  )
}

const inEmulator = () => /\/games\/play\//.test(window.location.pathname + window.location.hash)
const inPlayer = () => /\/play\//.test(window.location.pathname + window.location.hash) && !inEmulator()

function key(k: string, keyCode = 0): boolean {
  const target = (document.activeElement as HTMLElement | null) ?? document.body
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  if (keyCode) Object.defineProperty(ev, 'keyCode', { get: () => keyCode })
  target.dispatchEvent(ev)
  return ev.defaultPrevented
}

function activate() {
  const el = document.activeElement as HTMLElement | null
  // Handlers that treat Enter as OK (the player, menus) take it first.
  if (key('Enter', 13)) return
  if (!el || el === document.body) return
  if (el.matches('a, button, summary, [role="button"], [role="menuitem"], [role="tab"], [role="option"], input[type="checkbox"], input[type="radio"], label')) el.click()
}

function clickFirst(selectors: string[]): boolean {
  for (const s of selectors) {
    const el = document.querySelector<HTMLElement>(s)
    if (el && el.offsetParent !== null) {
      el.click()
      return true
    }
  }
  return false
}

/** LB/RB: the previous or next tab of the top bar (Home, Movies, Shows…). */
function stepTab(dir: 1 | -1) {
  const tabs = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main"] a')]
  if (!tabs.length) return
  const here = tabs.findIndex((a) => a.getAttribute('aria-current') === 'page')
  const next = tabs[(here + dir + tabs.length) % tabs.length]
  next.click()
  next.focus()
}

function press(button: number) {
  switch (button) {
    case A:
      return activate()
    case B:
      // The app ignores Escape in full screen (that's the browser leaving it).
      return void (document.fullscreenElement ? key('GoBack') : key('Escape', 27))
    case Y:
      return void clickFirst(['button[aria-label^="Search"]', 'a[aria-label="Search"]'])
    case MENU:
      if (inPlayer()) return void key(' ')
      return toggleQuickMenu()
    case LB:
      return inPlayer() ? undefined : stepTab(-1)
    case RB:
      return inPlayer() ? undefined : stepTab(1)
    case LT:
      return void key('MediaRewind')
    case RT:
      return void key('MediaFastForward')
    case X:
      if (inPlayer()) clickFirst(['[aria-label*="ubtitle"]', '[aria-label*="udio"]'])
      return
  }
}

const ARROWS: Record<string, [string, number]> = { up: ['ArrowUp', 38], down: ['ArrowDown', 40], left: ['ArrowLeft', 37], right: ['ArrowRight', 39] }

let started = false
// A steady timer, not animation frames: frames slow down while the page is busy
// drawing (and on a TV's CPU), and a quick tap would slip between two of them.
let timer = 0
const POLL_MS = 16
const held = new Map<string, { since: number; last: number }>()

function poll() {
  const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p): p is Gamepad => Boolean(p && p.connected)) : []
  if (!pads.length) {
    held.clear()
    window.clearInterval(timer)
    timer = 0
    return
  }
  if (inEmulator() || document.hidden) {
    held.clear()
    return
  }
  const now = performance.now()
  const down = new Set<string>()
  for (const p of pads) {
    const b = (i: number) => Boolean(p.buttons[i]?.pressed)
    const ax = p.axes[0] ?? 0
    const ay = p.axes[1] ?? 0
    if (b(UP) || ay < -STICK) down.add('up')
    if (b(DOWN) || ay > STICK) down.add('down')
    if (b(LEFT) || ax < -STICK) down.add('left')
    if (b(RIGHT) || ax > STICK) down.add('right')
    for (const i of [A, B, X, Y, LB, RB, LT, RT, MENU]) if (b(i)) down.add(`b${i}`)
    const ry = p.axes[3] ?? 0
    if (Math.abs(ry) > 0.25) window.scrollBy(0, ry * 18)
    if (down.size && (!current || current.kind !== padKind(p.id))) {
      current = { kind: padKind(p.id), at: Date.now() }
      emit()
    }
  }
  for (const k of [...held.keys()]) if (!down.has(k)) held.delete(k)
  for (const k of down) {
    const h = held.get(k)
    const isDir = k in ARROWS
    if (!h) {
      held.set(k, { since: now, last: now })
      if (isDir) key(...ARROWS[k])
      else press(Number(k.slice(1)))
    } else if (isDir && now - h.since > REPEAT_DELAY && now - h.last > REPEAT_EVERY) {
      h.last = now
      key(...ARROWS[k])
    }
  }
}

/** Start listening for controllers (once). */
export function initGamepad(): void {
  if (started || typeof window === 'undefined' || !('getGamepads' in navigator)) return
  started = true
  const run = () => {
    if (!timer) timer = window.setInterval(poll, POLL_MS)
  }
  window.addEventListener('gamepadconnected', ((e: GamepadEvent) => {
    current = { kind: padKind(e.gamepad.id), at: Date.now() }
    emit()
    run()
  }) as EventListener)
  // A controller that was already connected shows up on its first press.
  window.addEventListener('focus', run)
  run()
}
