// Minimal HTTP plumbing: typed errors, JSON in/out, and a tiny router. No
// framework — the server's surface is small and every byte of it is ours.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  /** Path after the optional /finesse prefix, without query string. */
  path: string
  url: URL
  params: Record<string, string>
}

export type Handler = (ctx: Ctx) => Promise<void> | void

interface Route {
  method: string
  pattern: RegExp
  keys: string[]
  handler: Handler
}

export class Router {
  private routes: Route[] = []

  /** Patterns use `:name` segments and a trailing `*` for "rest of path". */
  on(method: string, path: string, handler: Handler) {
    const keys: string[] = []
    const src = path
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([a-zA-Z_]+)/g, (_, k) => {
        keys.push(k)
        return '([^/]+)'
      })
      .replace(/\*$/, () => {
        keys.push('rest')
        return '(.*)'
      })
    this.routes.push({ method, pattern: new RegExp(`^${src}$`), keys, handler })
    return this
  }

  get(p: string, h: Handler) {
    return this.on('GET', p, h)
  }
  post(p: string, h: Handler) {
    return this.on('POST', p, h)
  }
  put(p: string, h: Handler) {
    return this.on('PUT', p, h)
  }
  delete(p: string, h: Handler) {
    return this.on('DELETE', p, h)
  }
  any(p: string, h: Handler) {
    return this.on('*', p, h)
  }

  /** Finds a handler; returns false when nothing matched the path at all. */
  async dispatch(ctx: Omit<Ctx, 'params'>): Promise<boolean> {
    let pathMatched = false
    for (const r of this.routes) {
      const m = r.pattern.exec(ctx.path)
      if (!m) continue
      pathMatched = true
      if (r.method !== '*' && r.method !== ctx.req.method && !(r.method === 'GET' && ctx.req.method === 'HEAD')) continue
      const params: Record<string, string> = {}
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')))
      await r.handler({ ...ctx, params })
      return true
    }
    if (pathMatched) throw new ApiError(405, 'Method not allowed')
    return false
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  if (res.headersSent) return
  let data = Buffer.from(JSON.stringify(body))
  const extra = { ...headers }
  const headerKey = (name: string) => Object.keys(extra).find((key) => key.toLowerCase() === name)

  if (data.length >= 1024 && !headerKey('content-encoding') && !res.hasHeader('content-encoding')) {
    const varyKey = headerKey('vary') ?? 'Vary'
    const vary = new Map<string, string>()
    for (const field of [res.getHeader('vary'), extra[varyKey], 'Accept-Encoding']) {
      for (const part of String(field ?? '').split(',')) {
        const value = part.trim()
        if (value && !vary.has(value.toLowerCase())) vary.set(value.toLowerCase(), value)
      }
    }
    extra[varyKey] = vary.has('*') ? '*' : [...vary.values()].join(', ')

    const accepted = String(res.req?.headers['accept-encoding'] ?? '').toLowerCase().split(',').map((entry) => {
      const [encoding, ...params] = entry.split(';').map((part) => part.trim())
      const quality = params.find((part) => /^q\s*=/.test(part))
      return quality === undefined || Number(quality.slice(quality.indexOf('=') + 1)) > 0 ? encoding : undefined
    })
    const encoding = accepted.includes('br') ? 'br' : accepted.includes('gzip') ? 'gzip' : null
    if (encoding) {
      const compressed = encoding === 'br'
        ? brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
        : gzipSync(data, { level: 4 })
      if (compressed.length < data.length) {
        data = compressed
        extra['Content-Encoding'] = encoding
      }
    }
  }

  const lengthKey = headerKey('content-length') ?? 'Content-Length'
  extra[lengthKey] = String(data.length)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra,
  })
  res.end(res.req?.method === 'HEAD' ? undefined : data)
}

export function sendError(res: ServerResponse, e: unknown) {
  if (e instanceof ApiError) {
    sendJson(res, e.status, e.details === undefined ? { error: e.message } : { error: e.message, details: e.details })
  } else {
    sendJson(res, 500, { error: 'Internal server error' })
  }
}

/** Reads a request body (bounded in size, and in time: 30 s) as a Buffer. */
export function readBody(req: IncomingMessage, limit = 1 << 20, timeoutMs = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => {
      reject(new ApiError(408, 'The request took too long to arrive'))
      req.destroy()
    }, timeoutMs)
    timer.unref?.()
    req.on('close', () => clearTimeout(timer))
    // Too big: answer 413 instead of cutting the connection (the sender sees why). The rest of
    // the body is read and thrown away so the answer can get through, but only for a while.
    const tooBig = () => {
      clearTimeout(timer)
      const mb = limit >= 1 << 20 ? `${Math.floor(limit / (1 << 20))} MB` : `${Math.ceil(limit / 1024)} KB`
      reject(new ApiError(413, `That’s too big to send here (the most is ${mb})`))
      chunks.length = 0
      req.removeListener('data', onData)
      req.resume()
      const cut = setTimeout(() => req.destroy(), 10000)
      cut.unref?.()
      req.on('end', () => clearTimeout(cut))
    }
    const onData = (c: Buffer) => {
      size += c.length
      if (size > limit) return tooBig()
      chunks.push(c)
    }
    if (Number(req.headers['content-length']) > limit) return tooBig()
    req.on('data', onData)
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export async function readJson<T = Record<string, unknown>>(req: IncomingMessage, limit?: number): Promise<T> {
  const raw = await readBody(req, limit)
  if (raw.length === 0) return {} as T
  try {
    return JSON.parse(raw.toString('utf8')) as T
  } catch {
    throw new ApiError(400, 'Invalid JSON')
  }
}

/** Client IP (first hop), for logs and rate limits. */
export function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown'
}
