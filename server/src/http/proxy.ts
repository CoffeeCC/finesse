// Streaming reverse proxy (HTTP + WebSocket upgrades). Used for Jellyfin at
// /jellyfin and for the *arr / downloader APIs behind Finesse. Bodies stream in
// both directions (video, ROM downloads), hop-by-hop headers are dropped, and
// callers decide which credentials to inject or strip.

import { Agent as HttpAgent, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { connect as netConnect, type Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import type { Duplex } from 'node:stream'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { logger } from '../log.ts'

const log = logger('proxy')
const agentOptions = { keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 64, maxFreeSockets: 16 }
const httpAgent = new HttpAgent(agentOptions)
const httpsAgent = new HttpsAgent(agentOptions)

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
])

export interface ProxyOptions {
  /** Full upstream URL (base + path + query). */
  target: URL
  /** Headers to set on the upstream request (null = remove). */
  setHeaders?: Record<string, string | null>
  /** Drop the caller's credentials (Authorization, X-Emby-Token, Cookie). */
  stripAuth?: boolean
  /** Rewrite upstream Location headers that start with this prefix… */
  rewriteLocation?: { from: string; to: string }
  /** Connect / first-byte timeout (ms). Streaming itself has no limit. */
  timeoutMs?: number
  /** A request body already read (and checked) by the caller, sent instead of streaming req. */
  body?: Buffer
  /**
   * Rewrites JSON and HLS playlist replies (uncompressed, up to 32 MB) before
   * they're sent on. Ask upstream for `accept-encoding: identity` with it.
   */
  rewriteText?: (text: string) => string | Promise<string>
  /** What a refused reply says (it couldn't be read to rewrite). */
  rewriteRefusal?: string
}

const REWRITABLE = /^(application\/(json|vnd\.apple\.mpegurl|x-mpegurl)|audio\/(x-)?mpegurl)\b/i
const REWRITE_MAX = 32 << 20

function upstreamHeaders(req: IncomingMessage, opts: ProxyOptions): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  const connTokens = String(req.headers.connection ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    const key = k.toLowerCase()
    if (HOP.has(key) || connTokens.includes(key)) continue
    if (opts.stripAuth && (key === 'authorization' || key === 'x-emby-token' || key === 'x-mediabrowser-token' || key === 'cookie' || key === 'x-emby-authorization'))
      continue
    out[key] = v
  }
  out.host = opts.target.host
  const fwd = req.headers['x-forwarded-for']
  const ip = req.socket.remoteAddress ?? ''
  out['x-forwarded-for'] = fwd ? `${fwd}, ${ip}` : ip
  out['x-forwarded-proto'] = String(req.headers['x-forwarded-proto'] ?? ((req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'))
  out['x-forwarded-host'] = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
  for (const [k, v] of Object.entries(opts.setHeaders ?? {})) {
    if (v === null) delete out[k.toLowerCase()]
    else out[k.toLowerCase()] = v
  }
  if (opts.body) out['content-length'] = String(opts.body.length)
  return out
}

function downstreamHeaders(h: IncomingHttpHeaders, opts: ProxyOptions): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  const connTokens = String(h.connection ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined || HOP.has(k) || connTokens.includes(k)) continue
    if (opts.stripAuth && k === 'set-cookie') continue
    out[k] = v
  }
  const loc = out.location
  if (opts.rewriteLocation && typeof loc === 'string' && loc.startsWith(opts.rewriteLocation.from)) {
    out.location = opts.rewriteLocation.to + loc.slice(opts.rewriteLocation.from.length)
  }
  return out
}

function isTaggedJellyfinImage(req: IncomingMessage, target: URL): boolean {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !target.searchParams.get('tag')?.trim()) return false
  const url = URL.parse(req.url ?? '/', 'http://localhost')
  return Boolean(url && /^\/(?:finesse\/)?jellyfin\/items\/[^/]+\/images\/[^/]+(?:\/[^/]+)?\/?$/i.test(url.pathname))
}

/** Proxies one HTTP request. Resolves when the response has been fully sent. */
export function proxyHttp(req: IncomingMessage, res: ServerResponse, opts: ProxyOptions): Promise<void> {
  return new Promise((resolve) => {
    const t = opts.target
    const secure = t.protocol === 'https:'
    const send = secure ? httpsRequest : httpRequest
    const upstream = send(
      {
        protocol: t.protocol,
        hostname: t.hostname,
        port: t.port || (t.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: t.pathname + t.search,
        headers: upstreamHeaders(req, opts),
        agent: secure ? httpsAgent : httpAgent,
        timeout: opts.timeoutMs ?? 30000,
      },
      (up) => {
        const headers = downstreamHeaders(up.headers, opts)
        if (up.statusCode === 200 && isTaggedJellyfinImage(req, t) && !/(?:^|,)\s*immutable\s*(?:,|$)/i.test(String(headers['cache-control'] ?? ''))) {
          headers['cache-control'] = 'private, max-age=604800, immutable'
        }
        const len = Number(up.headers['content-length'] ?? 0)
        // Text that must be rewritten (a token swapped out) is never passed on as it came: compressed
        // replies are unpacked first, and anything that can't be read or is too big is refused.
        if (opts.rewriteText && REWRITABLE.test(String(up.headers['content-type'] ?? ''))) {
          const refuse = () => {
            if (!res.destroyed && !res.writableEnded) {
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: opts.rewriteRefusal ?? 'The friend’s server sent a reply Finesse can’t check' }))
            }
            resolve()
          }
          const encoding = String(up.headers['content-encoding'] ?? 'identity').toLowerCase().trim()
          const cap = { maxOutputLength: REWRITE_MAX }
          const unpack: ((b: Buffer) => Buffer) | null =
            encoding === 'identity' || encoding === '' ? (b) => b : encoding === 'gzip' || encoding === 'x-gzip' ? (b) => gunzipSync(b, cap) : encoding === 'deflate' ? (b) => inflateSync(b, cap) : encoding === 'br' ? (b) => brotliDecompressSync(b, cap) : null
          if (!unpack || len > REWRITE_MAX) {
            up.destroy()
            return refuse()
          }
          const deadline = setTimeout(() => {
            up.destroy()
            refuse()
          }, opts.timeoutMs ?? 30000)
          deadline.unref()
          up.once('close', () => clearTimeout(deadline))
          const chunks: Buffer[] = []
          let size = 0
          up.on('data', (c: Buffer) => {
            size += c.length
            if (size > REWRITE_MAX) {
              up.destroy()
              refuse()
              return
            }
            chunks.push(c)
          })
          up.on('end', () => {
            let text: string
            try {
              const plain = unpack(Buffer.concat(chunks))
              text = plain.toString('utf8')
            } catch {
              return refuse()
            }
            Promise.resolve()
              .then(() => opts.rewriteText!(text))
              .then(
                (rewritten) => {
                  const out = Buffer.from(rewritten, 'utf8')
                  delete headers['transfer-encoding']
                  delete headers['content-encoding']
                  headers['content-length'] = String(out.length)
                  res.writeHead(up.statusCode ?? 502, up.statusMessage, headers)
                  res.end(out)
                },
                refuse,
              )
              .finally(resolve)
          })
          up.on('error', refuse)
          return
        }
        // Streaming may legitimately take hours (a movie) — drop the timeout.
        up.socket.setTimeout(0)
        res.writeHead(up.statusCode ?? 502, up.statusMessage, headers)
        up.pipe(res)
        up.on('end', resolve)
        up.on('error', () => {
          res.destroy()
          resolve()
        })
      },
    )
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')))
    upstream.on('error', (e) => {
      if (res.destroyed || res.writableEnded) return resolve()
      log.warn(`${req.method} ${t.host}${t.pathname} failed: ${e.message}`)
      if (!res.headersSent) {
        const body = JSON.stringify({ error: `Couldn't reach ${t.host}`, reason: (e as NodeJS.ErrnoException).code ?? e.message })
        res.writeHead(502, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), 'Cache-Control': 'no-store' })
        res.end(body)
      } else {
        res.destroy()
      }
      resolve()
    })
    // Client went away: stop the upstream transfer too.
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy()
    })
    if (opts.body) upstream.end(opts.body)
    else req.pipe(upstream)
  })
}

/** Proxies a WebSocket (or any HTTP/1.1 Upgrade) connection. */
export function proxyUpgrade(req: IncomingMessage, client: Duplex, head: Buffer, opts: ProxyOptions) {
  const t = opts.target
  const port = Number(t.port || (t.protocol === 'https:' || t.protocol === 'wss:' ? 443 : 80))
  const secure = t.protocol === 'https:' || t.protocol === 'wss:'
  const upstream: Socket = secure ? tlsConnect({ host: t.hostname, port, servername: t.hostname }) : netConnect({ host: t.hostname, port })
  const fail = () => {
    try {
      client.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
    } catch {
      /* ignore */
    }
    client.destroy()
    upstream.destroy()
  }
  upstream.setTimeout(opts.timeoutMs ?? 15000, fail)
  upstream.once(secure ? 'secureConnect' : 'connect', () => {
    upstream.setTimeout(0)
    const headers = upstreamHeaders(req, opts)
    // Keep the upgrade handshake headers the generic filter removed.
    headers.connection = 'Upgrade'
    headers.upgrade = String(req.headers.upgrade ?? 'websocket')
    let raw = `${req.method} ${t.pathname}${t.search} HTTP/1.1\r\n`
    for (const [k, v] of Object.entries(headers)) {
      for (const one of Array.isArray(v) ? v : [v]) raw += `${k}: ${one}\r\n`
    }
    upstream.write(raw + '\r\n')
    if (head.length) upstream.write(head)
    upstream.pipe(client)
    client.pipe(upstream)
  })
  upstream.on('error', fail)
  client.on('error', () => upstream.destroy())
  client.on('close', () => upstream.destroy())
  upstream.on('close', () => client.destroy())
}

/** Joins a base URL (which may carry a path) with a request path + query. */
export function joinUrl(base: string, path: string, search = ''): URL {
  const b = new URL(base)
  const basePath = b.pathname.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  b.pathname = basePath + p
  b.search = search
  return b
}
