// Stream a downloaded or installed game directly to another PC, Steam Deck, or browser as an
// uncompressed POSIX tar archive (with PAX extended headers for long paths and >8 GB files).
// Zero temporary disk space on the server, zero buffering in RAM, and full LAN/Tailscale speed.

import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream, existsSync, lstatSync, readdirSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { join, isAbsolute, posix, relative, resolve } from 'node:path'
import { ApiError } from '../http/core.ts'
import type { StoredRequest } from './db.ts'

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours (reusable for retries during transfer)
const MAX_TOKENS = 64
const MAX_OCTAL_SIZE = 0o77777777777 // 8 GiB - 1

export interface TransferTicket {
  token: string
  url: string
  fileName: string
  folderName: string
  title: string
  bytes: number
  files: number
  kind: 'installed' | 'download'
  expiresAt: string
}

interface StoredTicket {
  token: string
  dir: string
  fileName: string
  folderName: string
  title: string
  bytes: number
  files: number
  kind: 'installed' | 'download'
  expiresAt: number
}

interface ScannedFile {
  /** POSIX relative path inside the tar archive (never starts with / or contains ..). */
  rel: string
  /** Absolute file path on disk. */
  abs: string
  size: number
  mode: number
  mtimeMs: number
}

/** Clean folder/archive base name safe on Windows, Linux, and macOS. */
export function safeTransferName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80)
  return cleaned || 'Game'
}

/** Recursively collects regular files inside `root`, skipping symlinks and special files. */
export function scanTransferDir(root: string): { files: ScannedFile[]; bytes: number } {
  const files: ScannedFile[] = []
  let bytes = 0
  const walk = (absDir: string, relDir: string) => {
    let entries: string[]
    try {
      entries = readdirSync(absDir).sort()
    } catch {
      return
    }
    for (const name of entries) {
      if (!name || name === '.' || name === '..') continue
      const abs = join(absDir, name)
      let st
      try {
        st = lstatSync(abs)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue
      const rel = relDir ? posix.join(relDir, name) : name
      if (st.isDirectory()) {
        walk(abs, rel)
      } else if (st.isFile()) {
        const exec = (st.mode & 0o111) !== 0
        files.push({ rel, abs, size: st.size, mode: exec ? 0o755 : 0o644, mtimeMs: st.mtimeMs })
        bytes += st.size
      }
    }
  }
  walk(root, '')
  return { files, bytes }
}

function isDir(p: string): boolean {
  if (!existsSync(p)) return false
  try {
    return lstatSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Resolves a stored installDir (either absolute or relative to `gamesRoot`, e.g. `<id>/game`). */
function resolveInstallDir(installDir: string, gamesRoot?: string | null): string | null {
  if (isAbsolute(installDir)) return isDir(installDir) ? installDir : null
  if (!gamesRoot) return null
  const base = resolve(gamesRoot)
  const full = resolve(base, installDir)
  const rel = relative(base, full)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return isDir(full) ? full : null
}

/** Picks the best directory on disk for a game request: installed folder first, else download folder. */
export function resolveTransferSource(
  r: StoredRequest,
  gamesRoot?: string | null,
): { dir: string; kind: 'installed' | 'download' } | null {
  if (r.installDir) {
    const dir = resolveInstallDir(r.installDir, gamesRoot)
    if (dir) return { dir, kind: 'installed' }
  }
  if (gamesRoot && r.state === 'ready' && /^[a-z0-9_-]{4,64}$/i.test(r.id)) {
    const fallback = resolveInstallDir(join(r.id, 'game'), gamesRoot)
    if (fallback) return { dir: fallback, kind: 'installed' }
  }
  if (r.folder && isDir(r.folder)) {
    return { dir: r.folder, kind: 'download' }
  }
  return null
}

// ---------- POSIX ustar + PAX tar header builder (handles long paths & >8 GB files) ----------

function putStr(block: Buffer, start: number, len: number, value: string) {
  block.write(value, start, len, 'utf8')
}

function putOct(block: Buffer, start: number, len: number, value: number) {
  const s = Math.max(0, Math.floor(value)).toString(8).padStart(len - 1, '0')
  putStr(block, start, len, `${s.slice(-(len - 1))}\0`)
}

function finalizeHeader(h: Buffer): Buffer {
  h.fill(32, 148, 156)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += h[i]!
  putStr(h, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `)
  return h
}

function paxRecord(key: string, value: string): Buffer {
  const payload = ` ${key}=${value}\n`
  const payloadBytes = Buffer.byteLength(payload, 'utf8')
  let total = payloadBytes + String(payloadBytes).length
  while (Buffer.byteLength(`${total}${payload}`, 'utf8') !== total) {
    total = Buffer.byteLength(`${total}${payload}`, 'utf8')
  }
  return Buffer.from(`${total}${payload}`, 'utf8')
}

const pad512 = (size: number) => (512 - (size % 512)) % 512

function buildHeaders(relPath: string, size: number, mode: number, mtimeSec: number): Buffer {
  const pathBytes = Buffer.byteLength(relPath, 'utf8')
  let name = relPath
  let prefix = ''
  let needPaxPath = false
  if (pathBytes > 100) {
    const cut = relPath.lastIndexOf('/')
    if (cut > 0 && Buffer.byteLength(relPath.slice(0, cut), 'utf8') <= 155 && Buffer.byteLength(relPath.slice(cut + 1), 'utf8') <= 100) {
      prefix = relPath.slice(0, cut)
      name = relPath.slice(cut + 1)
    } else {
      needPaxPath = true
      name = Buffer.from(relPath, 'utf8').subarray(0, 99).toString('utf8')
    }
  }
  const needPaxSize = size > MAX_OCTAL_SIZE
  const blocks: Buffer[] = []

  if (needPaxPath || needPaxSize) {
    const recs: Buffer[] = []
    if (needPaxPath) recs.push(paxRecord('path', relPath))
    if (needPaxSize) recs.push(paxRecord('size', String(size)))
    const paxData = Buffer.concat(recs)
    const ph = Buffer.alloc(512)
    putStr(ph, 0, 100, `PaxHeader/${name.slice(0, 80)}`)
    putOct(ph, 100, 8, 0o644)
    putOct(ph, 108, 8, 0)
    putOct(ph, 116, 8, 0)
    putOct(ph, 124, 12, paxData.length)
    putOct(ph, 136, 12, mtimeSec)
    ph[156] = 120 // 'x' PAX extended header
    putStr(ph, 257, 6, 'ustar\0')
    putStr(ph, 263, 2, '00')
    blocks.push(finalizeHeader(ph), paxData)
    const pPad = pad512(paxData.length)
    if (pPad) blocks.push(Buffer.alloc(pPad))
  }

  const h = Buffer.alloc(512)
  putStr(h, 0, 100, name)
  putOct(h, 100, 8, mode)
  putOct(h, 108, 8, 0)
  putOct(h, 116, 8, 0)
  putOct(h, 124, 12, needPaxSize ? 0 : size)
  putOct(h, 136, 12, mtimeSec)
  h[156] = 48 // '0' regular file
  putStr(h, 257, 6, 'ustar\0')
  putStr(h, 263, 2, '00')
  if (prefix) putStr(h, 345, 155, prefix)
  blocks.push(finalizeHeader(h))
  return Buffer.concat(blocks)
}

/** Streams all regular files in `dir` as an uncompressed tar directly into `res`. */
export async function streamDirAsTar(dir: string, fileName: string, res: ServerResponse): Promise<void> {
  const { files } = scanTransferDir(dir)
  res.writeHead(200, {
    'Content-Type': 'application/x-tar',
    'Content-Disposition': `attachment; filename="${fileName.replace(/["\\\r\n]/g, '')}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })

  let aborted = false
  const onClose = () => {
    aborted = true
  }
  res.once('close', onClose)

  const write = async (buf: Buffer) => {
    if (aborted || res.destroyed) return false
    if (!res.write(buf)) {
      await Promise.race([once(res, 'drain'), once(res, 'close')])
    }
    return !aborted && !res.destroyed
  }

  try {
    for (const f of files) {
      if (aborted || res.destroyed) return
      let st
      try {
        st = lstatSync(f.abs)
      } catch {
        continue
      }
      if (!st.isFile() || st.isSymbolicLink()) continue
      const size = st.size
      const mtimeSec = Math.floor(st.mtimeMs / 1000)
      if (!(await write(buildHeaders(f.rel, size, f.mode, mtimeSec)))) return

      let left = size
      const stream = createReadStream(f.abs, { highWaterMark: 256 * 1024 })
      try {
        for await (const chunk of stream as AsyncIterable<Buffer>) {
          if (aborted || res.destroyed || left <= 0) {
            stream.destroy()
            return
          }
          const part = chunk.length > left ? chunk.subarray(0, left) : chunk
          left -= part.length
          if (!(await write(part))) {
            stream.destroy()
            return
          }
        }
      } finally {
        if (!stream.destroyed) stream.destroy()
      }
      if (left > 0 && !(await write(Buffer.alloc(left)))) return
      const pad = pad512(size)
      if (pad && !(await write(Buffer.alloc(pad)))) return
    }
    if (!aborted && !res.destroyed) {
      await write(Buffer.alloc(1024))
      res.end()
    }
  } finally {
    res.off('close', onClose)
  }
}

export class GameTransferStore {
  private readonly tickets = new Map<string, StoredTicket>()
  private readonly now: () => number
  private readonly gamesRoot: () => string | null

  constructor(now: () => number = Date.now, gamesRoot: () => string | null = () => null) {
    this.now = now
    this.gamesRoot = gamesRoot
  }

  private prune() {
    const t = this.now()
    for (const [k, v] of this.tickets) if (v.expiresAt <= t) this.tickets.delete(k)
  }

  create(r: StoredRequest): TransferTicket {
    this.prune()
    const src = resolveTransferSource(r, this.gamesRoot())
    if (!src) throw new ApiError(409, 'This game doesn’t have files on the server yet. Wait until the download finishes.')
    const { files, bytes } = scanTransferDir(src.dir)
    if (!files.length) throw new ApiError(409, 'The game’s folder is empty right now, so there’s nothing to transfer.')

    const folderName = safeTransferName(r.title)
    const fileName = `${folderName.replace(/\s+/g, '-')}.tar`
    const token = randomBytes(24).toString('base64url')
    const expiresAt = this.now() + TOKEN_TTL_MS
    if (this.tickets.size >= MAX_TOKENS) {
      const oldest = this.tickets.keys().next().value
      if (oldest) this.tickets.delete(oldest)
    }
    const stored: StoredTicket = {
      token,
      dir: src.dir,
      fileName,
      folderName,
      title: r.title,
      bytes,
      files: files.length,
      kind: src.kind,
      expiresAt,
    }
    this.tickets.set(token, stored)
    return {
      token,
      url: `/api/games/store/transfer/${token}`,
      fileName,
      folderName,
      title: r.title,
      bytes,
      files: files.length,
      kind: src.kind,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  get(token: string | undefined): StoredTicket | null {
    if (!token || !/^[A-Za-z0-9_-]{16,80}$/.test(token)) return null
    this.prune()
    const t = this.tickets.get(token)
    if (!t || t.expiresAt <= this.now()) return null
    return t
  }
}
