// Minimal HTTP plumbing: typed errors, JSON in/out, and a tiny router. No
// framework — the server's surface is small and every byte of it is ours.

import type { IncomingMessage, ServerResponse } from 'node:http'

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
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(data.length),
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(data)
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
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new ApiError(413, 'Request body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
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
