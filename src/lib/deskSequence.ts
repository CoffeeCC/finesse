export const DESK_SEQUENCE_MS = 1800
export const DRAWER_SEQUENCE_MS = 1200
/** A renderer may announce readiness again after resize/context recovery. Never replay a finished scene. */
export function resumePreparedMechanism(animation: Pick<Animation,'playState'|'updatePlaybackRate'|'play'>) {
  if(animation.playState!=='paused')return false
  animation.updatePlaybackRate(1);animation.play();return true
}
const bounded = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0
const ease = (n: number) => { const x = bounded(n); return x * x * (3 - 2 * x) }
const segment = (p: number, a: number, b: number) => ease((p - a) / (b - a))
export function deskPose(progress: number) {
  const p = bounded(progress)
  return { progress: p, keyTravel: segment(p, 0, .23), keyTurn: segment(p, .23, .41),
    bolt: segment(p, .34, .44), lid: segment(p, .44, .94), camera: segment(p, .15, .94), keyFocus: segment(p,0,.15)*(1-segment(p,.4,.75)),
    contents: segment(p, .66, .96), phase: p < .23 ? 'Inserting key' : p < .44 ? 'Unlocking desk' : p < .94 ? 'Opening desk' : 'Desk open' }
}
export function drawerPose(progress: number) {
  const p = bounded(progress)
  return { progress: p, travel: segment(p, .04, .88), camera: segment(p, 0, .93), contents: segment(p, .5, .95), phase: p < .25 ? 'Releasing drawer' : p < .94 ? 'Opening lighting drawer' : 'Drawer open' }
}
export function drawerSoundCrossings(from: number, to: number): DeskSound[] {
  const a=bounded(from),b=bounded(to)
  return b>a && a<.04 && b>=.04 ? ['drawer-open'] : b<a && a>.94 && b<=.94 ? ['drawer-close'] : []
}
export type DeskSound = 'key-lift' | 'key-insert' | 'key-turn' | 'lock-release' | 'desk-open' | 'desk-close' | 'lock-latch' | 'drawer-open' | 'drawer-close'
export function partialCloseCue(progress: number, mode: 'desk'|'lighting'): DeskSound | null {
  const p=bounded(progress)
  if(mode==='lighting') return p>.04&&p<=.94 ? 'drawer-close' : null
  return p>.44&&p<=.92 ? 'desk-close' : p>.23&&p<=.4 ? 'key-turn' : null
}
export function partialOpenCue(progress:number,mode:'desk'|'lighting'):DeskSound|null{
  const p=bounded(progress)
  if(mode==='lighting')return p>.04&&p<1?'drawer-open':null
  return p>.46&&p<1?'desk-open':p>.24&&p<=.41?'key-turn':p>.22&&p<.23?'key-insert':null
}
/** Crossing events, not timers: Back/reversal cannot leave delayed sounds behind. */
export function deskSoundCrossings(from: number, to: number): DeskSound[] {
  const a = bounded(from), b = bounded(to)
  const opening: [number, DeskSound][] = [[.22, 'key-insert'], [.24, 'key-turn'], [.37, 'lock-release'], [.46, 'desk-open']]
  const closing: [number, DeskSound][] = [[.92, 'desk-close'], [.40, 'key-turn'], [.345, 'lock-latch']]
  return b > a ? opening.filter(([t]) => a < t && b >= t).map(([, s]) => s)
    : closing.filter(([t]) => a > t && b <= t).map(([, s]) => s)
}
