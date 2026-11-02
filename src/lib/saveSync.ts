// Which copy of an in-game save to keep when the retro player starts: the one in this
// browser or the one on the Finesse server. Pure, so server/test/save-sync.test.ts can check it.

/** A save as one side has it: its fingerprint and when it was written (ms). */
export interface SaveCopy {
  hash: string
  at: number
}

/**
 * - 'server': load the server's copy into the game (another device played on, or this browser's was cleared)
 * - 'local':  upload this browser's copy (the server has none, or only this device moved on)
 * - 'same' / 'none': nothing to do
 *
 * `synced` is the fingerprint both sides had when this device last synced. A side that still
 * has it hasn't moved; the other one is newer. Both moved (played offline here and elsewhere):
 * the one written last wins.
 */
export function pickSave(local: SaveCopy | null, server: SaveCopy | null, synced: string | null): 'server' | 'local' | 'same' | 'none' {
  if (!local && !server) return 'none'
  if (!server) return 'local'
  if (!local) return 'server'
  if (local.hash === server.hash) return 'same'
  if (synced && local.hash === synced) return 'server'
  if (synced && server.hash === synced) return 'local'
  return server.at >= local.at ? 'server' : 'local'
}

/** A save's fingerprint (FNV-1a over the bytes, with the length). Not for security: plain-HTTP
 *  pages have no crypto.subtle, and this only tells one save from another. */
export function saveFingerprint(b: Uint8Array): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ b.length
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i]!, 0x01000193)
    h2 = Math.imul(h2 ^ b[i]!, 0x5bd1e995) ^ (h2 >>> 15)
  }
  return `${b.length.toString(16)}-${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}`
}
