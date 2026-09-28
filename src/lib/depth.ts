// Physical depth: layered parallax for heroes, driven by the phone's tilt
// (opt-in, Settings → Tilt parallax). The backdrop layer (.depth-back) drifts
// against the tilt while the title layer (.depth-front) drifts with it. Writes
// --px/--py (-1…1) on the hero; CSS does the rest with smoothed transforms.
// Never follows the mouse (that read as the page chasing the cursor). Off on
// TV and for reduced motion.

import { useCallback, type RefCallback } from 'react'
import { IS_TV } from './device'
import { getPrefs } from './settings'

const clamp = (n: number) => Math.max(-1, Math.min(1, n))

/** Returns a ref callback for the hero element. A callback (not a RefObject +
 *  effect) so it attaches whenever the hero actually mounts — detail pages
 *  render a loading placeholder first. */
export function useDepthParallax<T extends HTMLElement>(): RefCallback<T> {
  return useCallback((el: T | null) => {
    if (!el || IS_TV || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let tx = 0
    let ty = 0
    const apply = () => {
      raf = 0
      el.style.setProperty('--px', tx.toFixed(3))
      el.style.setProperty('--py', ty.toFixed(3))
    }
    const set = (x: number, y: number) => {
      tx = clamp(x)
      ty = clamp(y)
      if (!raf) raf = requestAnimationFrame(apply)
    }

    // Phone tilt: relative to how you're holding it, re-centring slowly so
    // shifting on the couch doesn't leave the scene stuck off to one side.
    let base: { b: number; g: number } | null = null
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return
      if (!base) base = { b: e.beta, g: e.gamma }
      base.b += (e.beta - base.b) * 0.02
      base.g += (e.gamma - base.g) * 0.02
      set((e.gamma - base.g) / 12, (e.beta - base.b) / 12)
    }
    const tilt = getPrefs().tiltParallax && typeof DeviceOrientationEvent !== 'undefined'
    if (tilt) window.addEventListener('deviceorientation', onTilt)

    return () => {
      if (tilt) window.removeEventListener('deviceorientation', onTilt)
      cancelAnimationFrame(raf)
    }
  }, [])
}

/** iOS only hands out motion data after an explicit permission prompt, which
 *  must come from a tap — Settings calls this when the toggle is switched on. */
export async function requestTiltPermission(): Promise<boolean> {
  const DOE = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : undefined) as
    | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> })
    | undefined
  if (!DOE) return false
  if (typeof DOE.requestPermission !== 'function') return true
  try {
    return (await DOE.requestPermission()) === 'granted'
  } catch {
    return false
  }
}
