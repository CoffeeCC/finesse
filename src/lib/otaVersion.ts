// Version rules for the TV's over-the-air bundle (webosUpdate.ts), kept free of browser APIs so
// they're unit-tested (server/test/ota.test.ts). Versions may have three or four parts (3.2.6.1).

/** Compare dotted numeric versions. >0 if a is newer than b. */
export function cmpVersion(a: string, b: string): number {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/**
 * Whether to offer a release: newer than what runs, and newer than a bundle already downloaded
 * and waiting (or one that runs but reports an older version), so a TV never downloads the same
 * release again and again.
 */
export function offersRelease(latest: string, current: string, staged: string | null | undefined): boolean {
  if (cmpVersion(latest, current) <= 0) return false
  if (staged && cmpVersion(staged, latest) >= 0) return false
  return true
}
