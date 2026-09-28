// Minimal, strict .tar(.gz) reader for release bundles. Regular files and
// directories only; anything else (links, devices) is refused, as is any path
// that could escape the destination. Supports ustar prefixes, GNU long names
// and pax path records, which is everything GNU tar emits for a web build.

import { once } from 'node:events'
import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip, gunzipSync } from 'node:zlib'

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

/** A ustar header for a regular file (long paths split into prefix + name). */
export function tarHeader(path: string, size: number, mode = 0o600, mtime = new Date()): Buffer {
  let name = path
  let prefix = ''
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 154)
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new TarError(`Path too long for the archive: ${path}`)
    prefix = name.slice(0, cut)
    name = name.slice(cut + 1)
  }
  const h = Buffer.alloc(512)
  putField(h, 0, 100, name)
  putOctal(h, 100, 8, mode)
  putOctal(h, 108, 8, 0)
  putOctal(h, 116, 8, 0)
  putOctal(h, 124, 12, size)
  putOctal(h, 136, 12, Math.floor(mtime.getTime() / 1000))
  h.fill(32, 148, 156)
  h[156] = 48 // '0' regular file
  putField(h, 257, 6, 'ustar\0')
  putField(h, 263, 2, '00')
  putField(h, 345, 155, prefix)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += h[i]!
  putField(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ')
  return h
}

const padding = (size: number) => (512 - (size % 512)) % 512

/** Builds a ustar archive (regular files only), gzip it yourself if wanted. */
export function writeTar(files: { path: string; data: Buffer; mode?: number; mtime?: Date }[]): Buffer {
  const parts: Buffer[] = []
  for (const f of files) {
    parts.push(tarHeader(f.path, f.data.length, f.mode, f.mtime), f.data)
    const pad = padding(f.data.length)
    if (pad) parts.push(Buffer.alloc(pad))
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

// ---------- streaming (backups can be larger than memory) ----------

export type TarEntry = { path: string; data: Buffer } | { path: string; file: string }

/**
 * Writes a .tar.gz to `out`, reading files from disk as it goes. A file that
 * changes size while it's read is cut or padded to the size it had at the start,
 * so the archive stays valid.
 */
export async function writeTarGz(out: string, entries: TarEntry[]): Promise<void> {
  const gz = createGzip({ level: 6 })
  const sink = createWriteStream(out, { mode: 0o600 })
  const done = pipeline(gz, sink)
  const write = (b: Buffer) => (gz.write(b) ? Promise.resolve() : once(gz, 'drain').then(() => undefined))
  try {
    for (const e of entries) {
      if ('data' in e) {
        await write(tarHeader(e.path, e.data.length))
        await write(e.data)
        const pad = padding(e.data.length)
        if (pad) await write(Buffer.alloc(pad))
        continue
      }
      const st = statSync(e.file)
      await write(tarHeader(e.path, st.size, 0o600, st.mtime))
      let left = st.size
      for await (const chunk of createReadStream(e.file) as AsyncIterable<Buffer>) {
        if (left <= 0) break
        const part = chunk.length > left ? chunk.subarray(0, left) : chunk
        left -= part.length
        await write(part)
      }
      if (left > 0) await write(Buffer.alloc(left))
      const pad = padding(st.size)
      if (pad) await write(Buffer.alloc(pad))
    }
    await write(Buffer.alloc(1024))
    gz.end()
    await done
  } catch (e) {
    gz.destroy()
    await done.catch(() => {})
    throw e
  }
}

/**
 * Reads a .tar.gz from disk entry by entry: `onFile` gets each regular file's
 * safe relative path and a stream of its contents (read it to the end, or not at
 * all). Same rules as readTar: unsafe paths and non-file entries are refused.
 */
export async function readTarGz(file: string, onFile: (path: string, size: number, body: AsyncIterable<Buffer>) => Promise<void>): Promise<void> {
  const input = createReadStream(file).pipe(createGunzip())
  const it = (input as AsyncIterable<Buffer>)[Symbol.asyncIterator]()
  let buf = Buffer.alloc(0)
  const need = async (n: number): Promise<boolean> => {
    while (buf.length < n) {
      const r = await it.next()
      if (r.done) return false
      buf = buf.length ? Buffer.concat([buf, r.value]) : r.value
    }
    return true
  }
  // Yields exactly `size` bytes of the current entry, then skips its padding.
  async function* body(size: number): AsyncIterable<Buffer> {
    let left = size
    while (left > 0) {
      if (!buf.length && !(await need(1))) throw new TarError('Truncated archive')
      const take = Math.min(left, buf.length)
      const part = buf.subarray(0, take)
      buf = buf.subarray(take)
      left -= take
      yield part
    }
  }
  const skip = async (n: number) => {
    for await (const _ of body(n)) void _
  }
  let longName: string | null = null
  let paxPath: string | null = null
  try {
    for (;;) {
      if (!(await need(512))) throw new TarError('Truncated archive')
      const block = buf.subarray(0, 512)
      if (block.every((b) => b === 0)) return
      if (!checksumOk(block)) throw new TarError("That file isn't a valid backup")
      buf = buf.subarray(512)
      const size = octal(block, 124, 12)
      const type = String.fromCharCode(block[156]!) || '0'
      const pad = padding(size)
      if (type === 'L' || type === 'x') {
        const chunks: Buffer[] = []
        for await (const c of body(size)) chunks.push(Buffer.from(c))
        const text = Buffer.concat(chunks).toString('utf8')
        if (type === 'L') longName = text.replace(/\0+$/, '')
        else for (const rec of text.split('\n')) {
          const m = /^\d+ path=(.*)$/.exec(rec)
          if (m) paxPath = m[1]!
        }
        await skip(pad)
        continue
      }
      const prefix = field(block, 345, 155)
      const base = field(block, 0, 100)
      const name = paxPath ?? longName ?? (prefix ? `${prefix}/${base}` : base)
      longName = null
      paxPath = null
      const rel = safeRelPath(name)
      if (type === '5' || type === 'g' || rel === null) {
        await skip(size + pad)
        continue
      }
      if (type !== '0' && type !== '\0' && type !== '7') throw new TarError(`Refusing non-file entry: ${name}`)
      let read = false
      const stream = (async function* () {
        read = true
        yield* body(size)
      })()
      await onFile(rel, size, stream)
      if (!read) await skip(size)
      else for await (const _ of stream) void _ // whatever the reader left
      await skip(pad)
    }
  } finally {
    input.destroy()
  }
}
