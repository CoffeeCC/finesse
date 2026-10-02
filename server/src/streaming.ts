// Game streaming: Finesse in front of Wolf (games-on-whales.github.io/wolf),
// which streams Steam and other apps from the NAS to Moonlight on TVs, phones
// and PCs.
//
// Wolf's API lives on a unix socket (WOLF_SOCKET, shared into this container)
// and has no login of its own. It can do much more than Finesse needs (run
// apps, pull images, change settings), so nothing is passed through: Finesse
// makes four calls of its own. Everyone at home sees the list of apps; only
// administrators see devices waiting to pair, pair them with the PIN Moonlight
// shows, and remove paired devices. Wolf's pairing secrets stay on the server:
// the browser gets a stand-in id.

import { createHash } from 'node:crypto'
import { request } from 'node:http'
import type { Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { logger } from './log.ts'

const log = logger('streaming')

export interface WolfReply {
  status: number
  type: string
  body: Buffer
}

/** One request to Wolf's API over its unix socket. */
export function wolfCall(socket: string, method: 'GET' | 'POST', path: string, body?: unknown, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<WolfReply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = request(
      {
        socketPath: socket,
        method,
        path,
        headers: { Host: 'wolf', Connection: 'close', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}) },
        timeout: opts.timeoutMs ?? 8000,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > (opts.maxBytes ?? 4_000_000)) req.destroy(new Error('Wolf sent more than expected'))
          else chunks.push(c)
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', reject)
    req.end(payload)
  })
}

/** What went wrong reaching Wolf, in words an administrator can act on. */
export function wolfProblem(e: unknown, socket: string): string {
  const code = (e as { code?: string }).code
  if (code === 'ENOENT') return `Can’t find Wolf’s socket at ${socket}. Check WOLF_SOCKET, and that Wolf’s socket folder is shared with Finesse.`
  if (code === 'EACCES' || code === 'EPERM') return `Finesse isn’t allowed to open Wolf’s socket at ${socket}.`
  if (code === 'ECONNREFUSED') return 'Wolf isn’t running: its socket is there, but nothing answers. Start Wolf and try again.'
  if (code === 'ETIMEDOUT') return 'Wolf didn’t answer in time. It may be busy starting up; try again in a minute.'
  return (e as Error)?.message || 'Couldn’t reach Wolf.'
}

class WolfError extends Error {}

async function wolfJson<T>(socket: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await wolfCall(socket, method, path, body)
  let data: { success?: boolean; error?: string } | null = null
  try {
    data = JSON.parse(r.body.toString('utf8'))
  } catch {
    /* not JSON */
  }
  if (r.status >= 400 || !data || data.success === false) throw new WolfError(data?.error || `Wolf answered ${r.status}`)
  return data as T
}

interface WolfAppRaw {
  id?: unknown
  title?: unknown
  support_hdr?: unknown
  icon_png_path?: unknown
}

export interface StreamApp {
  id: string
  title: string
  hdr: boolean
  icon: boolean
}

// Icons are fetched by app, never by a path from the browser; and only paths
// Wolf's own get-icon call can take as they are (it splits its query on "=").
const SAFE_ICON = /^[\w./:-]{1,300}$/

/** Only what the app shows: Wolf's app entries also carry pipelines and runner settings (Docker images, mounts, environment). */
export function publicApps(raw: WolfAppRaw[]): StreamApp[] {
  return raw
    .filter((a) => typeof a.id === 'string' && typeof a.title === 'string')
    .map((a) => ({
      id: a.id as string,
      title: a.title as string,
      hdr: a.support_hdr === true,
      icon: typeof a.icon_png_path === 'string' && SAFE_ICON.test(a.icon_png_path),
    }))
}

/** The browser's stand-in for a pending pair request (Wolf's pair secret never leaves the server). */
export const pendingId = (secret: string) => createHash('sha256').update(`finesse-pair:${secret}`).digest('hex').slice(0, 16)

export function registerStreaming(router: Router, deps: { settings: SettingsStore; auth: Auth }) {
  const { settings, auth } = deps
  const socketOf = () => settings.get().streaming?.socket
  const need = () => {
    const socket = socketOf()
    if (!socket) throw new ApiError(404, 'Game streaming isn’t set up on this server')
    return socket
  }

  let appsCache: { at: number; raw: WolfAppRaw[] } | null = null
  async function appsRaw(socket: string): Promise<WolfAppRaw[]> {
    if (appsCache && Date.now() - appsCache.at < 30_000) return appsCache.raw
    const r = await wolfJson<{ apps?: WolfAppRaw[] }>(socket, 'GET', '/api/v1/apps')
    appsCache = { at: Date.now(), raw: Array.isArray(r.apps) ? r.apps : [] }
    return appsCache.raw
  }

  const clientIds = async (socket: string) =>
    (await wolfJson<{ clients?: { client_id?: unknown }[] }>(socket, 'GET', '/api/v1/clients')).clients?.map((c) => String(c.client_id ?? '')).filter(Boolean) ?? []

  const pending = async (socket: string) =>
    ((await wolfJson<{ requests?: { pair_secret?: unknown; client_ip?: unknown }[] }>(socket, 'GET', '/api/v1/pair/pending')).requests ?? [])
      .filter((p) => typeof p.pair_secret === 'string' && p.pair_secret)
      .map((p) => ({ secret: p.pair_secret as string, ip: String(p.client_ip ?? '') }))

  // Everyone at home: what can be streamed.
  router.get('/api/streaming', async ({ req, res }) => {
    await auth.requireUser(req)
    const socket = need()
    try {
      sendJson(res, 200, { ok: true, apps: publicApps(await appsRaw(socket)) })
    } catch (e) {
      log.warn(`apps: ${wolfProblem(e, socket)}`)
      sendJson(res, 200, { ok: false, apps: [], error: 'Game streaming isn’t answering right now. Try again in a minute.' })
    }
  })

  router.get('/api/streaming/apps/:id/icon', async ({ req, res, params, url }) => {
    await auth.requireUser(req, { query: url.searchParams })
    const socket = need()
    const app = (await appsRaw(socket).catch(() => [])).find((a) => a.id === params.id)
    const path = typeof app?.icon_png_path === 'string' && SAFE_ICON.test(app.icon_png_path) ? app.icon_png_path : null
    if (!path) throw new ApiError(404, 'No icon')
    const r = await wolfCall(socket, 'GET', `/api/v1/utils/get-icon?icon_path=${path}`, undefined, { timeoutMs: 15000, maxBytes: 3_000_000 }).catch(() => null)
    if (!r || r.status !== 200 || !r.type.startsWith('image/png')) throw new ApiError(404, 'No icon')
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(r.body.length), 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
    res.end(r.body)
  })

  // Administrators: pairing and paired devices.
  router.get('/api/streaming/admin', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    try {
      const [waiting, ids] = await Promise.all([pending(socket), clientIds(socket)])
      const names = settings.get().streaming?.devices ?? {}
      sendJson(res, 200, {
        ok: true,
        pending: waiting.map((p) => ({ id: pendingId(p.secret), ip: p.ip })),
        devices: ids.map((id) => ({ id, name: names[id]?.name ?? null, pairedAt: names[id]?.pairedAt ?? null })),
      })
    } catch (e) {
      sendJson(res, 200, { ok: false, error: wolfProblem(e, socket), pending: [], devices: [] })
    }
  })

  router.post('/api/streaming/pair', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const socket = need()
    const body = await readJson<{ request?: unknown; pin?: unknown; name?: unknown }>(req)
    const pin = String(body.pin ?? '').trim()
    if (!/^\d{4}$/.test(pin)) throw new ApiError(400, 'The PIN is the 4 digits Moonlight shows')
    const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Moonlight device'
    let waiting: { secret: string; ip: string }[]
    let before: string[]
    try {
      ;[waiting, before] = await Promise.all([pending(socket), clientIds(socket)])
    } catch (e) {
      throw new ApiError(502, wolfProblem(e, socket))
    }
    const match = waiting.find((p) => pendingId(p.secret) === String(body.request ?? ''))
    if (!match) throw new ApiError(404, 'That device stopped waiting. In Moonlight, start pairing again.')
    try {
      await wolfJson(socket, 'POST', '/api/v1/pair/client', { pair_secret: match.secret, pin })
    } catch (e) {
      throw new ApiError(502, e instanceof WolfError ? `Wolf didn’t take the PIN (${e.message}). In Moonlight, start pairing again.` : wolfProblem(e, socket))
    }
    // Wolf hands the PIN to Moonlight's handshake; the device shows up once that succeeds.
    let added: string | undefined
    for (let i = 0; i < 16 && !added; i++) {
      await new Promise((r) => setTimeout(r, 500))
      added = (await clientIds(socket).catch(() => before)).find((id) => !before.includes(id))
    }
    if (!added) {
      sendJson(res, 200, { ok: false, error: 'Moonlight didn’t finish pairing. If it says the PIN was wrong, start pairing again in Moonlight.' })
      return
    }
    const id = added
    settings.update((s) => {
      s.streaming = { ...s.streaming, devices: { ...s.streaming?.devices, [id]: { name, pairedAt: new Date().toISOString() } } }
    })
    log.info(`paired ${name}`)
    sendJson(res, 201, { ok: true, device: { id, name } })
  })

  router.delete('/api/streaming/devices/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const socket = need()
    let ids: string[]
    try {
      ids = await clientIds(socket)
    } catch (e) {
      throw new ApiError(502, wolfProblem(e, socket))
    }
    const id = params.id ?? ''
    if (!ids.includes(id)) throw new ApiError(404, 'No such device')
    try {
      await wolfJson(socket, 'POST', '/api/v1/unpair/client', { client_id: id })
    } catch (e) {
      throw new ApiError(502, e instanceof WolfError ? `Wolf couldn’t remove it (${e.message})` : wolfProblem(e, socket))
    }
    const name = settings.get().streaming?.devices?.[id]?.name
    settings.update((s) => {
      if (s.streaming?.devices) delete s.streaming.devices[id]
    })
    log.info(`removed ${name ?? 'a device'}`)
    sendJson(res, 200, { ok: true })
  })
}
