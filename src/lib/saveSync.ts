// What the retro player does with an in-game save when a game starts: this browser's copy
// against the Finesse server's. Pure, so server/test/save-sync.test.ts can check it.
//
// No clocks: the browser's and the server's can't be compared. Only fingerprints are: what
// each side has now, and what both had when this person last synced from this browser.

/**
 * - 'server':   load the server's copy (another device played on, or this browser has none)
 * - 'upload':   send this browser's copy (the server has none, or only this browser moved on)
 * - 'conflict': both moved since the last sync: ask which to keep, and lose neither
 * - 'same' / 'none': nothing to do
 *
 * `local` is the copy in this person's place in the browser (lib/saveSlots puts it there: it
 * is theirs, or a save from before Finesse kept saves per person). `synced` is the fingerprint
 * both sides had when this person last synced here (null: never).
 */
export function planSync(local: string | null, server: string | null, synced: string | null): 'server' | 'upload' | 'conflict' | 'same' | 'none' {
  if (!local && !server) return 'none'
  if (!local) return 'server'
  if (local === server) return 'same'
  // Nothing on the server: this browser's copy goes up, but only into an empty slot (the
  // upload says so, and the server refuses it if another device got there first).
  if (!server) return 'upload'
  if (synced === local) return 'server'
  if (synced === server) return 'upload'
  // Never synced here, or both sides moved (played offline here and elsewhere).
  return 'conflict'
}

/** How an upload says which server copy it replaces: the server answers 409 if that's not what it has. */
export function precondition(base: string | null): Record<string, string> {
  return base ? { 'If-Match': `"${base}"` } : { 'If-None-Match': '*' }
}

/** A save's fingerprint (FNV-1a over the bytes, with the length). Not for security: plain-HTTP
 *  pages have no crypto.subtle, and this only tells one save from another. The server computes
 *  the same one (server/src/gameSaves.ts) and uses it as the ETag. */
export function saveFingerprint(b: Uint8Array): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ b.length
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i]!, 0x01000193)
    h2 = Math.imul(h2 ^ b[i]!, 0x5bd1e995) ^ (h2 >>> 15)
  }
  return `${b.length.toString(16)}-${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}`
}

/** What went wrong when the server refused a save (a 4xx: retrying won't help), in plain words. */
export function refusal(status: number, error: string | undefined): string {
  if (status === 401 || status === 403) return 'Finesse didn’t accept your sign-in, so this save stays on this device. Sign in again to keep saving there.'
  const why = (error ?? '').trim().replace(/\.+$/, '')
  return `${why || 'Finesse wouldn’t take this save'}. It stays on this device.`
}
