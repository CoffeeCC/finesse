// Serves the web app (and preview clips) the way deploy/nginx.conf did:
//   • hashed /assets/* cache forever; index.html / version.json never cache
//   • SPA fallback to index.html for app routes (but a missing /assets/ file
//     is a real 404 — never HTML served as JavaScript)
//   • gzip / brotli for text, cached in memory per file version
//   • byte ranges (Safari won't play <video> without them)
//   • conditional requests (ETag / If-Modified-Since → 304)
// Path traversal is impossible by construction: every request path is
// resolved and must stay inside its root.

import { createReadStream, existsSync, readFileSync, statSync, type Stats } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { brotliCompressSync, gzipSync, constants as zc } from 'node:zlib'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.map'])

export function contentType(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** Resolves `rel` under `root`, or null if it would escape or doesn't exist as a file. */
export function safeFile(root: string, rel: string): { file: string; stat: Stats } | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(rel)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const base = resolve(root)
  const file = resolve(base, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded))
  if (file !== base && !file.startsWith(base + sep)) return null
  // No dotfiles (".git", ".index.html.new" from an interrupted install…)
  if (file.slice(base.length).split(sep).some((p) => p.startsWith('.'))) return null
  try {
    const stat = statSync(file)
    return stat.isFile() ? { file, stat } : null
  } catch {
    return null
  }
}

const compressedCache = new Map<string, { br?: Buffer; gz?: Buffer }>()
let cacheBytes = 0
const CACHE_LIMIT = 64 << 20

function compressed(file: string, stat: Stats, enc: 'br' | 'gzip'): Buffer {
  const key = `${file}:${stat.size}:${stat.mtimeMs}`
  let entry = compressedCache.get(key)
  if (!entry) {
    entry = {}
    compressedCache.set(key, entry)
  }
  const slot = enc === 'br' ? 'br' : 'gz'
  if (!entry[slot]) {
    const raw = readFileSync(file)
    entry[slot] =
      enc === 'br'
        ? brotliCompressSync(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 9, [zc.BROTLI_PARAM_SIZE_HINT]: raw.length } })
        : gzipSync(raw, { level: 9 })
    cacheBytes += entry[slot]!.length
    if (cacheBytes > CACHE_LIMIT) {
      compressedCache.clear()
      cacheBytes = 0
    }
  }
  return entry[slot]!
}

function cacheControl(rel: string): string {
  const p = rel.toLowerCase()
  if (p === '/index.html' || p.endsWith('/version.json') || p.endsWith('manifest.json') || p.endsWith('manifest-hd.json'))
    return 'no-cache, no-store, must-revalidate'
  if (p.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  return 'public, max-age=3600'
}

/** Sends one file with ranges, compression and conditional-request support. */
export function sendFile(req: IncomingMessage, res: ServerResponse, file: string, stat: Stats, rel: string, extra?: Record<string, string>) {
  const type = contentType(file)
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Cache-Control': cacheControl(rel),
    'Last-Modified': stat.mtime.toUTCString(),
    ETag: etag,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  }
  // Pages can't be framed by another site (clickjacking the admin screens).
  if (type.startsWith('text/html')) {
    headers['X-Frame-Options'] = 'SAMEORIGIN'
    headers['Content-Security-Policy'] = "frame-ancestors 'self'"
  }
  if (req.headers['if-none-match'] === etag || (!req.headers['if-none-match'] && req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']).getTime() >= Math.floor(stat.mtimeMs / 1000) * 1000)) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  const head = req.method === 'HEAD'
  const range = req.headers.range
  if (range && /^bytes=/.test(range)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    let start = 0
    let end = stat.size - 1
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = parseInt(m[1], 10)
        if (m[2]) end = Math.min(parseInt(m[2], 10), stat.size - 1)
      } else {
        start = Math.max(0, stat.size - parseInt(m[2]!, 10))
      }
    }
    if (!m || start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
      res.end()
      return
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) })
    if (head) return void res.end()
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  const accept = String(req.headers['accept-encoding'] ?? '')
  if (COMPRESSIBLE.has(extname(file).toLowerCase()) && stat.size > 512) {
    const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null
    if (enc) {
      const body = compressed(file, stat, enc)
      res.writeHead(200, { ...headers, 'Content-Encoding': enc, 'Content-Length': String(body.length), Vary: 'Accept-Encoding' })
      res.end(head ? undefined : body)
      return
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': String(stat.size) })
  if (head) return void res.end()
  createReadStream(file).pipe(res)
}

function readVersion(dir: string): string | null {
  try {
    const v = JSON.parse(readFileSync(join(dir, 'version.json'), 'utf8')).version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

export function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/**
 * Which web build to serve: a legacy FINESSE_DIST if configured, otherwise the
 * newer of the image's baked build and one installed by the in-app updater.
 */
export class WebRoot {
  private chosen: { dir: string; version: string | null } | null = null
  private checkedAt = 0
  readonly baked: string
  readonly updated: string
  readonly legacy?: string

  constructor(opts: { baked: string; updated: string; legacy?: string }) {
    this.baked = opts.baked
    this.updated = opts.updated
    this.legacy = opts.legacy
  }

  /** The directory the updater installs into. */
  installDir(): string {
    return this.legacy ?? this.updated
  }

  current(): { dir: string; version: string | null } {
    const now = Date.now()
    if (this.chosen && now - this.checkedAt < 5000) return this.chosen
    this.checkedAt = now
    if (this.legacy) {
      this.chosen = { dir: this.legacy, version: readVersion(this.legacy) }
      return this.chosen
    }
    const bv = readVersion(this.baked)
    const uv = existsSync(join(this.updated, 'index.html')) ? readVersion(this.updated) : null
    this.chosen = uv && (!bv || cmpVersion(uv, bv) > 0) ? { dir: this.updated, version: uv } : { dir: this.baked, version: bv }
    return this.chosen
  }

  refresh() {
    this.checkedAt = 0
  }
}

/** Serves a web-app path; returns false if nothing should be served (caller 404s). */
export function serveWeb(req: IncomingMessage, res: ServerResponse, web: WebRoot, rel: string): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const { dir } = web.current()
  const path = rel === '/' || rel === '' ? '/index.html' : rel
  const hit = safeFile(dir, path)
  if (hit) {
    sendFile(req, res, hit.file, hit.stat, path)
    return true
  }
  // Missing hashed asset / file-looking path: a real 404, not the app shell.
  if (path.startsWith('/assets/') || /\.(js|mjs|css|map|png|jpe?g|webp|svg|woff2?|json|mp4|webm)$/i.test(path)) return false
  const index = safeFile(dir, '/index.html')
  if (!index) return false
  sendFile(req, res, index.file, index.stat, '/index.html', path.startsWith('/games/play/') ? ISOLATED : undefined)
  return true
}

// The game player page is cross-origin isolated, which unlocks threads
// (SharedArrayBuffer): the PSP and DOS emulators won't start without them.
// "credentialless" still lets the page load other sites' files, just without
// cookies; browsers that don't know it (Safari) simply stay un-isolated.
const ISOLATED = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }
