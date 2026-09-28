// Minimal, strict .tar(.gz) reader for release bundles. Regular files and
// directories only; anything else (links, devices) is refused, as is any path
// that could escape the destination. Supports ustar prefixes, GNU long names
// and pax path records, which is everything GNU tar emits for a web build.

import { gunzipSync } from 'node:zlib'

export interface TarFile {
  path: string
  data: Buffer
}

export class TarError extends Error {}

function field(block: Buffer, start: number, len: number): string {
  const raw = block.subarray(start, start + len)
  const nul = raw.indexOf(0)
  return raw.subarray(0, nul === -1 ? len : nul).toString('utf8')
}

function octal(block: Buffer, start: number, len: number): number {
  const s = field(block, start, len).trim()
  if (!s) return 0
  if (!/^[0-7]+$/.test(s)) throw new TarError('Corrupt size field')
  return parseInt(s, 8)
}

function checksumOk(block: Buffer): boolean {
  const expected = octal(block, 148, 8)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : block[i]!
  return sum === expected
}

/** Normalizes and validates an archive path; throws on anything unsafe. */
export function safeRelPath(name: string): string | null {
  let n = name
  while (n.startsWith('./')) n = n.slice(2)
  n = n.replace(/\/+$/, '')
  if (n === '' || n === '.') return null
  if (n.startsWith('/') || n.includes('\\') || n.split('/').some((p) => p === '..' || p === '')) {
    throw new TarError(`Refusing unsafe path in the release: ${name}`)
  }
  return n
}

export function readTar(input: Buffer, opts: { gzip?: boolean; maxUnpacked?: number } = {}): TarFile[] {
  let buf: Buffer
  try {
    buf = opts.gzip === false ? input : gunzipSync(input, { maxOutputLength: (opts.maxUnpacked ?? 1 << 30) + (1 << 20) })
  } catch {
    throw new TarError("The release's web build isn't a valid archive")
  }
  const files: TarFile[] = []
  let off = 0
  let longName: string | null = null
  let paxPath: string | null = null
  let total = 0
  while (off + 512 <= buf.length) {
    const block = buf.subarray(off, off + 512)
    if (block.every((b) => b === 0)) break
    if (!checksumOk(block)) throw new TarError("The release's web build isn't a valid archive")
    const size = octal(block, 124, 12)
    const type = String.fromCharCode(block[156]!) || '0'
    const dataStart = off + 512
    const data = buf.subarray(dataStart, dataStart + size)
    off = dataStart + Math.ceil(size / 512) * 512
    if (data.length < size) throw new TarError('Truncated archive')

    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0+$/, '')
      continue
    }
    if (type === 'x') {
      for (const rec of data.toString('utf8').split('\n')) {
        const m = /^\d+ path=(.*)$/.exec(rec)
        if (m) paxPath = m[1]!
      }
      continue
    }
    if (type === 'g') continue

    const prefix = field(block, 345, 155)
    const base = field(block, 0, 100)
    const name = paxPath ?? longName ?? (prefix ? `${prefix}/${base}` : base)
    longName = null
    paxPath = null

    const rel = safeRelPath(name)
    if (type === '5') continue
    if (type !== '0' && type !== '\0' && type !== '7') throw new TarError(`Refusing non-file entry in the release: ${name}`)
    if (rel === null) continue
    total += size
    if (total > (opts.maxUnpacked ?? 1 << 30)) throw new TarError("The release's web build is unexpectedly large")
    files.push({ path: rel, data: Buffer.from(data) })
  }
  return files
}

// ---------- writer (backups) ----------

function putField(block: Buffer, start: number, len: number, value: string) {
  block.write(value.slice(0, len), start, len, 'utf8')
}

function putOctal(block: Buffer, start: number, len: number, value: number) {
  putField(block, start, len, value.toString(8).padStart(len - 1, '0') + '\0')
}

/** Builds a ustar archive (regular files only), gzip it yourself if wanted. */
export function writeTar(files: { path: string; data: Buffer; mode?: number; mtime?: Date }[]): Buffer {
  const parts: Buffer[] = []
  for (const f of files) {
    let name = f.path
    let prefix = ''
    if (Buffer.byteLength(name) > 100) {
      const cut = name.lastIndexOf('/', 154)
      if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new TarError(`Path too long for the archive: ${f.path}`)
      prefix = name.slice(0, cut)
      name = name.slice(cut + 1)
    }
    const h = Buffer.alloc(512)
    putField(h, 0, 100, name)
    putOctal(h, 100, 8, f.mode ?? 0o600)
    putOctal(h, 108, 8, 0)
    putOctal(h, 116, 8, 0)
    putOctal(h, 124, 12, f.data.length)
    putOctal(h, 136, 12, Math.floor((f.mtime ?? new Date()).getTime() / 1000))
    h.fill(32, 148, 156)
    h[156] = 48 // '0' regular file
    putField(h, 257, 6, 'ustar\0')
    putField(h, 263, 2, '00')
    putField(h, 345, 155, prefix)
    let sum = 0
    for (let i = 0; i < 512; i++) sum += h[i]!
    putField(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ')
    parts.push(h, f.data)
    const pad = (512 - (f.data.length % 512)) % 512
    if (pad) parts.push(Buffer.alloc(pad))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}
