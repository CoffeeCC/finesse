// A file's fingerprint for Add media: a 53-bit hash (cyrb53) of its first and last megabyte and
// its size. Not cryptographic (browsers only offer that on https pages, and Finesse is usually
// http at home): it tells two different files apart, which is all it's for. src/lib/fingerprint.ts
// computes the same in the browser.

import { closeSync, openSync, readSync, statSync } from 'node:fs'

export const SAMPLE = 1 << 20

export function cyrb53(bytes: Uint8Array, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]!
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The bytes fingerprinted: the first megabyte, then the last (they overlap for small files). */
export function fingerprintOf(head: Uint8Array, tail: Uint8Array, size: number): string {
  const all = new Uint8Array(head.length + tail.length)
  all.set(head)
  all.set(tail, head.length)
  return `${size.toString(36)}-${cyrb53(all)}`
}

export function fingerprintFile(file: string): string {
  const size = statSync(file).size
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(Math.min(SAMPLE, size))
    readSync(fd, head, 0, head.length, 0)
    const tail = Buffer.alloc(Math.min(SAMPLE, size))
    readSync(fd, tail, 0, tail.length, Math.max(0, size - tail.length))
    return fingerprintOf(head, tail, size)
  } finally {
    closeSync(fd)
  }
}
