// The same fingerprint as server/src/fingerprint.ts (keep them in step): cyrb53 of a file's first
// and last megabyte, plus its size. Tells two files apart; not a security check.

const SAMPLE = 1 << 20

function cyrb53(bytes: Uint8Array, seed = 0): string {
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

export async function fingerprint(file: Blob): Promise<string> {
  const n = Math.min(SAMPLE, file.size)
  const [head, tail] = await Promise.all([file.slice(0, n).arrayBuffer(), file.slice(file.size - n).arrayBuffer()])
  const all = new Uint8Array(head.byteLength + tail.byteLength)
  all.set(new Uint8Array(head))
  all.set(new Uint8Array(tail), head.byteLength)
  return `${file.size.toString(36)}-${cyrb53(all)}`
}
