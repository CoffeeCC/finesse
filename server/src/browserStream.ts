// Play a Wolf game inside Finesse: Moonlight-Web (a Moonlight client that runs
// in a browser tab) shown in a frame on Finesse's own page.
//
// Moonlight-Web needs a page of its own (its files live at the root of its
// address), so Finesse serves it on a second https port (FINESSE_STREAM_PORT)
// with Finesse's certificate. Nobody gets in there without Finesse:
//
// - The Finesse page asks for a ticket (POST /api/streaming/browser, signed in),
//   and the frame opens /__finesse/enter?t=<ticket> on the stream port. The
//   ticket is good once, for a minute, and turns into a cookie for that port.
// - Every other request on the port needs that cookie.
// - Moonlight-Web's own sign-in (its access PIN) is done for the visitor: the
//   page Finesse hands over gets a small script that asks Finesse for a fresh
//   PIN (`moonlightweb --new-pin` in its container), signs in, and starts the
//   app Finesse named. Moonlight-Web's own "only my page may show me" headers
//   are rewritten to allow exactly Finesse's https page.
//
// The video itself doesn't come through here: WebRTC goes straight from the
// browser to Moonlight-Web.

import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as netConnect } from 'node:net'
import type { Duplex } from 'node:stream'
import { connect as tlsConnect } from 'node:tls'
import type { Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { logger } from './log.ts'
import { Docker } from './stack/docker.ts'

const log = logger('browser-stream')

export const STREAM_PORT = Number(process.env.FINESSE_STREAM_PORT || 0) || null
const COOKIE = 'finesse_stream'
const TICKET_MS = 60_000
const VISIT_MS = 12 * 3600_000
const MW_IMAGE = /moonlight-web/i

export interface MoonlightWeb {
  /** Where Finesse reaches it (https). */
  url: URL
  /** Its container, for a new access PIN. */
  container: string
}

/** Can Finesse open a connection there (1.5 s)? */
const reachable = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const s = netConnect({ host, port })
    const done = (ok: boolean) => (s.destroy(), resolve(ok))
    s.setTimeout(1500, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })

/**
 * Moonlight-Web's container and an address Finesse reaches it at. FINESSE_MOONLIGHT_WEB (its https
 * URL) and FINESSE_MOONLIGHT_WEB_CONTAINER say so outright; otherwise the running container of
 * linckosz/moonlight-web, by its MW_HTTPS_PORT.
 */
export async function findMoonlightWeb(docker: Docker): Promise<MoonlightWeb | null> {
  const fixedUrl = process.env.FINESSE_MOONLIGHT_WEB?.trim()
  const fixedName = process.env.FINESSE_MOONLIGHT_WEB_CONTAINER?.trim()
  const list = await docker.list({}, false).catch(() => [])
  const c = fixedName ? list.find((x) => x.Names.some((n) => n.replace(/^\//, '') === fixedName)) : list.find((x) => MW_IMAGE.test(x.Image))
  if (fixedUrl) return { url: new URL(fixedUrl), container: fixedName ?? c?.Names[0]?.replace(/^\//, '') ?? 'moonlightweb' }
  if (!c) return null
  const info = await docker.inspect(c.Id).catch(() => null)
  if (!info) return null
  const name = c.Names[0]!.replace(/^\//, '')
  const env = Object.fromEntries((info.Config.Env ?? []).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]))
  const inside = Number(env.MW_HTTPS_PORT || 0)
  if (!inside) return null
  const tries: [string, number][] = []
  if (info.HostConfig.NetworkMode === 'host') for (const h of ['host.docker.internal', '172.17.0.1', '127.0.0.1']) tries.push([h, inside])
  else {
    const pub = Number(info.NetworkSettings.Ports?.[`${inside}/tcp`]?.[0]?.HostPort || 0)
    for (const n of Object.values(info.NetworkSettings.Networks)) if (n.IPAddress) tries.push([n.IPAddress, inside])
    if (pub) for (const h of ['host.docker.internal', '172.17.0.1', '127.0.0.1']) tries.push([h, pub])
  }
  for (const [h, p] of tries) if (await reachable(h, p)) return { url: new URL(`https://${h}:${p}`), container: name }
  return null
}

/** The script put into Moonlight-Web's page: sign in with a PIN from Finesse, start one app, tell the Finesse page how it went. */
export const BOOT_JS = `// Finesse: sign in to Moonlight-Web and start one app, then tell the Finesse page.
const tell = (msg) => window.parent !== window && window.parent.postMessage({ source: 'finesse-stream', ...msg }, '*')
const want = new URLSearchParams(location.search).get('app') || ''
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  const src = document.querySelector('script[type="module"][src^="/js/app.js"]')?.getAttribute('src') ?? '/js/app.js'
  const { MoonlightApp } = await import(src)
  const { BackendClient } = await import('/js/api/BackendClient.js')
  async function signIn() {
    tell({ state: 'signing-in' })
    const r = await fetch('/__finesse/pin', { method: 'POST', cache: 'no-store' })
    if (!r.ok) throw new Error((await r.text()) || 'Finesse couldn’t sign in to Moonlight-Web')
    await BackendClient.validatePin((await r.text()).trim(), 'Finesse', true)
    location.reload()
  }
  const status = await BackendClient.getAuthStatus().catch(() => ({}))
  if (!status.authenticated && !status.is_localhost) return signIn()
  tell({ state: 'starting' })
  const hosts = await BackendClient.getHosts()
  for (const host of Array.isArray(hosts) ? hosts : hosts.hosts ?? []) {
    const r = await BackendClient.getAppList(host.uuid).catch(() => null)
    const app = (Array.isArray(r) ? r : r?.apps ?? []).find((a) => a.name === want || a.title === want)
    if (!app) continue
    for (let i = 0; i < 100 && MoonlightApp.state === 'loading'; i++) await wait(100)
    await MoonlightApp.launchApp(host, app, undefined, undefined, { skipSelfStreamWarn: true })
    for (let i = 0; i < 300; i++) {
      if (MoonlightApp.state === 'streaming') {
        sessionStorage.removeItem('finesse-signed-in-again')
        tell({ state: 'streaming' })
        // Afterwards: say when the stream ends.
        for (;;) {
          await wait(1000)
          if (MoonlightApp.state !== 'streaming' && MoonlightApp.state !== 'launching') return tell({ state: 'ended' })
        }
      }
      await wait(200)
    }
    // A sign-in from another page isn't bound to this page's key: sign in again here, once.
    if (!sessionStorage.getItem('finesse-signed-in-again')) {
      sessionStorage.setItem('finesse-signed-in-again', '1')
      return signIn()
    }
    return tell({ state: 'error', error: 'The stream didn’t start. Is the graphics card busy?' })
  }
  tell({ state: 'error', error: 'Moonlight-Web has no server with "' + want + '". Is it paired with Wolf?' })
}
main().catch((e) => tell({ state: 'error', error: String(e?.message ?? e) }))
`

const cookieOf = (req: IncomingMessage, name: string) => {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

/** The request's cookies without Finesse's own (Moonlight-Web gets only its own). */
const foreignCookies = (req: IncomingMessage) =>
  String(req.headers.cookie ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('finesse_'))
    .join('; ')

/** Moonlight-Web's frame rules, opened for Finesse's https page (on the same host name) and nothing else. */
export function frameHeaders(h: Record<string, string | string[] | undefined>, host: string, finessePort: number | null) {
  const out = { ...h }
  delete out['x-frame-options']
  const allow = finessePort ? `https://${host}:${finessePort}` : `'none'`
  const csp = out['content-security-policy']
  if (typeof csp === 'string') out['content-security-policy'] = /frame-ancestors/.test(csp) ? csp.replace(/frame-ancestors [^;]*/, `frame-ancestors ${allow}`) : `${csp}; frame-ancestors ${allow}`
  else out['content-security-policy'] = `frame-ancestors ${allow}`
  return out
}

/** A Wolf session open now: its client, and what changes when that client starts a new stream (a hash of its keys). */
export interface OpenSession {
  client: string
  stream: string
}

export interface BrowserStream {
  /** Finesse's routes for it (ticket). */
  register(router: Router): void
  /** The stream port's requests. */
  handle(req: IncomingMessage, res: ServerResponse): void
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  /** The Wolf session (client id) the browser play `play` streams in, from the session ids open now. */
  sessionFor(play: string, user: string, open: OpenSession[]): string | null
}

export function createBrowserStream(deps: { auth: Auth; settings: SettingsStore; docker?: Docker; sessions: () => Promise<OpenSession[]>; streamFor: (app: string) => Promise<{ title: string; join: boolean } | null> }): BrowserStream {
  const docker = deps.docker ?? new Docker()
  const finessePort = Number(process.env.FINESSE_HTTPS_PORT || 0) || null
  const tickets = new Map<string, { user: string; app: string; until: number }>()
  const visits = new Map<string, { user: string; until: number }>()
  // A play: the sessions that were open before it started, and the one it turned out to be.
  const plays = new Map<string, { user: string; before: string[]; client?: string; until: number }>()
  /** The Wolf client id Moonlight-Web streams as (it's one paired client), once seen. Kept across restarts. */
  const knownClient = () => deps.settings.get().streaming?.browserClient ?? null
  const remember = (id: string) => {
    if (knownClient() !== id) deps.settings.update((s) => void (s.streaming = { ...s.streaming, browserClient: id }))
    return id
  }
  let mw: { at: number; v: MoonlightWeb | null } | null = null
  const target = async () => {
    if (!mw || Date.now() - mw.at > (mw.v ? 5 * 60_000 : 15_000)) mw = { at: Date.now(), v: await findMoonlightWeb(docker) }
    return mw.v
  }
  const prune = () => {
    const now = Date.now()
    for (const m of [tickets, visits, plays] as Map<string, { until: number }>[]) for (const [k, v] of m) if (v.until < now) m.delete(k)
  }

  const visitor = (req: IncomingMessage) => {
    const id = cookieOf(req, COOKIE)
    const v = id ? visits.get(id) : undefined
    return v && v.until > Date.now() ? v : null
  }

  function register(router: Router) {
    // Signed in at home: a ticket into the stream port, and what to start there.
    router.post('/api/streaming/browser', async ({ req, res }) => {
      const user = await deps.auth.requireUser(req)
      if (!STREAM_PORT || !finessePort) throw new ApiError(404, 'Playing in Finesse needs FINESSE_HTTPS_PORT and FINESSE_STREAM_PORT')
      if (!(await target())) throw new ApiError(404, 'Playing in Finesse needs Moonlight-Web, paired with Wolf')
      prune()
      const body = await readJson<{ app?: unknown }>(req)
      const what = await deps.streamFor(typeof body.app === 'string' ? body.app : '')
      if (!what) throw new ApiError(404, 'That app isn’t in Wolf anymore')
      const ticket = randomBytes(24).toString('hex')
      const play = randomBytes(12).toString('hex')
      tickets.set(ticket, { user: user.Id, app: what.title, until: Date.now() + TICKET_MS })
      plays.set(play, { user: user.Id, before: (await deps.sessions().catch(() => [])).map((x) => x.stream), until: Date.now() + VISIT_MS })
      sendJson(res, 200, { port: STREAM_PORT, ticket, play, join: what.join })
    })
  }

  function sessionFor(play: string, user: string, open: OpenSession[]) {
    const p = plays.get(play)
    if (!p || p.user !== user) return null
    const clients = open.map((x) => x.client)
    if (p.client && clients.includes(p.client)) return p.client
    // The stream this page started: new since the ticket (a client starting a stream again gets new keys).
    const fresh = [...new Set(open.filter((x) => !p.before.includes(x.stream)).map((x) => x.client))]
    if (fresh.length === 1) return (p.client = remember(fresh[0]!))
    const known = knownClient()
    if (known && clients.includes(known) && (!fresh.length || fresh.includes(known))) return (p.client = known)
    return null
  }

  const page = (res: ServerResponse, code: number, text: string) => {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(`<!doctype html><meta charset="utf-8"><body style="background:#000;color:#ccc;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>${text}</p>`)
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
    void (async () => {
      const url = new URL(req.url ?? '/', 'https://x')
      const host = String(req.headers.host ?? '').replace(/:\d+$/, '')
      if (url.pathname === '/__finesse/enter') {
        prune()
        const t = tickets.get(url.searchParams.get('t') ?? '')
        tickets.delete(url.searchParams.get('t') ?? '')
        if (!t || t.until < Date.now()) return page(res, 403, 'This link has expired. Start the game again from Finesse.')
        const id = randomBytes(24).toString('hex')
        visits.set(id, { user: t.user, until: Date.now() + VISIT_MS })
        res.writeHead(302, {
          'Set-Cookie': `${COOKIE}=${id}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${VISIT_MS / 1000}`,
          Location: `/?app=${encodeURIComponent(t.app)}`,
          'Cache-Control': 'no-store',
        })
        return res.end()
      }
      if (!visitor(req)) return page(res, 403, 'Open games from Finesse.')
      const mwNow = await target()
      if (!mwNow) return page(res, 502, 'Moonlight-Web isn’t running.')
      if (url.pathname === '/__finesse/boot.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
        return res.end(BOOT_JS)
      }
      if (url.pathname === '/__finesse/pin') {
        if (req.method !== 'POST') return page(res, 405, 'POST')
        const r = await docker.exec(mwNow.container, ['moonlightweb', '--new-pin']).catch(() => null)
        const pin = /Access PIN\s+(\d{4,12})/.exec(r?.output ?? '')?.[1]
        if (!pin) log.warn(`no access PIN from ${mwNow.container}: ${(r?.output ?? 'exec failed').trim().slice(-200)}`)
        res.writeHead(pin ? 200 : 502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
        return res.end(pin ?? 'Finesse couldn’t get an access PIN from Moonlight-Web')
      }
      const up = mwNow.url
      const headers: Record<string, string | string[]> = {}
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !/^(host|cookie|x-forwarded-.*|forwarded|x-real-ip|connection|keep-alive|upgrade)$/i.test(k)) headers[k] = v
      headers.host = up.host
      const jar = foreignCookies(req)
      if (jar) headers.cookie = jar
      if (typeof req.headers.origin === 'string') headers.origin = up.origin
      if (typeof req.headers.referer === 'string') headers.referer = req.headers.referer.replace(/^https?:\/\/[^/]+/, up.origin)
      const isPage = req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')
      if (isPage) headers['accept-encoding'] = 'identity'
      const out = httpsRequest({ host: up.hostname, port: up.port, method: req.method, path: req.url, headers, rejectUnauthorized: false }, (u) => {
        const h = frameHeaders(u.headers as Record<string, string | string[] | undefined>, host, finessePort)
        if (isPage && String(u.headers['content-type'] ?? '').includes('text/html')) {
          const chunks: Buffer[] = []
          u.on('data', (d: Buffer) => chunks.push(d))
          u.on('end', () => {
            const html = Buffer.concat(chunks).toString('utf8').replace('</body>', '<script type="module" src="/__finesse/boot.js"></script></body>')
            delete h['content-length']
            delete h['transfer-encoding']
            res.writeHead(u.statusCode ?? 502, h as Record<string, string | string[]>)
            res.end(html)
          })
          return
        }
        res.writeHead(u.statusCode ?? 502, h as Record<string, string | string[]>)
        u.pipe(res)
      })
      out.on('error', (e) => {
        if (!res.headersSent) page(res, 502, 'Moonlight-Web didn’t answer.')
        else res.destroy()
        log.debug(`proxy: ${e.message}`)
      })
      req.pipe(out)
    })().catch((e) => {
      log.warn(`stream port: ${(e as Error).message}`)
      if (!res.headersSent) page(res, 500, 'Something went wrong.')
    })
  }

  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (!visitor(req)) return void socket.destroy()
    void target().then((mwNow) => {
      if (!mwNow) return void socket.destroy()
      const up = tlsConnect({ host: mwNow.url.hostname, port: Number(mwNow.url.port || 443), rejectUnauthorized: false, servername: undefined })
      up.once('secureConnect', () => {
        let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
        for (const [k, v] of Object.entries(req.headers)) {
          if (v === undefined || /^(cookie|x-forwarded-.*|forwarded|x-real-ip)$/i.test(k)) continue
          const val = k === 'host' ? mwNow.url.host : k === 'origin' ? mwNow.url.origin : v
          for (const one of Array.isArray(val) ? val : [val]) raw += `${k}: ${one}\r\n`
        }
        const jar = foreignCookies(req)
        if (jar) raw += `cookie: ${jar}\r\n`
        up.write(raw + '\r\n')
        if (head.length) up.write(head)
        up.pipe(socket)
        socket.pipe(up)
      })
      up.on('error', () => socket.destroy())
      socket.on('error', () => up.destroy())
    })
  }

  return { register, handle, upgrade, sessionFor }
}
