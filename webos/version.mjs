// webOS wants an app version of exactly three numbers ("3.2.6"); ares-package
// refuses anything else. Finesse releases can have a fourth ("3.2.6.1"), so the
// .ipk's appinfo gets the first three, while the OTA bundle and baked.js keep
// the whole version (boot.js and the app compare every part).

/** "3.2.6.1" → "3.2.6"; "3.2" → "3.2.0"; anything that isn't numbers → "0.0.0". */
export function appinfoVersion(version) {
  const parts = String(version).replace(/^v/, '').split('.').slice(0, 3).map((p) => (/^\d+$/.test(p) ? String(Number(p)) : null))
  if (parts.some((p) => p === null)) return '0.0.0'
  while (parts.length < 3) parts.push('0')
  return parts.join('.')
}
