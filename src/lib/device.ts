// Input/form-factor detection, evaluated once at load.

/** A TV: the packaged webOS app, or a TV browser (LG/Samsung/Fire TV/Android TV…).
 *  TVs get D-pad-first behavior: landing focus, remote seeking, no hover-only UI. */
export const IS_TV: boolean =
  __WEBOS__ ||
  (typeof navigator !== 'undefined' &&
    /Web0S|webOS|Tizen|SMART-TV|SmartTV|NetCast|HbbTV|BRAVIA|AFT[A-Z]|Android TV|GoogleTV|CrKey/i.test(
      navigator.userAgent,
    ))

/** Touch-first device (phone/tablet): no hover, coarse pointer. */
export const TOUCH_UI: boolean =
  !IS_TV &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: none) and (pointer: coarse)').matches

/** True once the user is steering with arrows/D-pad (set by spatialNav). */
export function inSpatialMode(): boolean {
  return IS_TV || document.documentElement.dataset.navMode === 'spatial'
}
