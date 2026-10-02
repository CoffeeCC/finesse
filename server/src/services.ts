// The API proxies the app uses (what deploy/nginx.conf did with auth_request +
// injected keys): every call needs a valid Jellyfin sign-in, service keys are
// added server-side and never reach a browser, and the caller's own
// credentials are stripped before anything leaves for a third-party service.

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Auth } from './auth.ts'
import type { Endpoint, SettingsStore } from './config.ts'
import { ApiError, readBody, type Router } from './http/core.ts'
import { joinUrl, proxyHttp, proxyUpgrade } from './http/proxy.ts'
import type { JfUser } from './jellyfin.ts'
import { addAllowed, arrVerdict, cleanPath, commandAllowed, hasFiles, isRead, rommAllowed, sabAllowed } from './policy.ts'

const isAdmin = (u: JfUser) => u.Policy?.IsAdministrator === true
const adminOnly = () => new ApiError(403, 'Only an administrator can do that')

/** The path after a proxy's prefix, refused if it tries to climb out of it. */
function safeRest(rest: string | undefined): string {
  const clean = cleanPath(rest ?? '')
  if (clean === null) throw new ApiError(400, 'That address isn’t allowed')
  return clean
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8') || 'null')
  } catch {
    throw new ApiError(400, 'Invalid JSON')
  }
}

/** A read with the service's own key (to check a non-admin's request against the app's state). */
async function arrGet<T>(svc: Endpoint, api: string, path: string): Promise<T> {
  const r = await fetch(joinUrl(svc.url!, `${api}/${path}`), { headers: { 'x-api-key': svc.apiKey! }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new ApiError(r.status === 404 ? 404 : 502, r.status === 404 ? 'Not found' : `The app answered ${r.status}`)
  return (await r.json()) as T
}

const ARR: Record<string, { id: 'radarr' | 'sonarr' | 'lidarr' | 'prowlarr'; api: string; name: string; admin?: boolean }> = {
  radarr: { id: 'radarr', api: '/api/v3', name: 'Radarr' },
  sonarr: { id: 'sonarr', api: '/api/v3', name: 'Sonarr' },
  lidarr: { id: 'lidarr', api: '/api/v1', name: 'Lidarr' },
  prowlarr: { id: 'prowlarr', api: '/api/v1', name: 'Prowlarr', admin: true },
}

function need(e: Endpoint | undefined, name: string, key: 'apiKey' | 'password' | 'none' = 'apiKey'): Required<Pick<Endpoint, 'url'>> & Endpoint {
  if (!e?.url || (key !== 'none' && !e[key] && !(key === 'password' && e.apiKey))) throw new ApiError(503, `${name} isn't set up`)
  return e as Required<Pick<Endpoint, 'url'>> & Endpoint
}

export function registerServiceProxies(router: Router, deps: { settings: SettingsStore; auth: Auth }) {
  const { settings, auth } = deps

  for (const [slug, def] of Object.entries(ARR)) {
    router.any(`/arr/${slug}/*`, async ({ req, res, params, url }) => {
      const path = safeRest(params.rest)
      // An <img> can't send headers: a picture may carry the sign-in in its
      // address instead, which goes no further than here.
      const picture = !def.admin && /^mediacover\//.test(path) && /^(GET|HEAD)$/i.test(req.method ?? '')
      const user = def.admin ? await auth.requireAdmin(req) : await auth.requireUser(req, picture ? { query: url.searchParams } : {})
      let search = url.search
      if (picture) {
        const q = new URLSearchParams(url.searchParams)
        q.delete('ApiKey')
        q.delete('api_key')
        search = q.toString() ? `?${q}` : ''
      }
      const svc = need(settings.get().services[def.id], def.name)
      let body: Buffer | undefined
      // Household members get what the app's screens do; the rest is admin-only.
      if (!isAdmin(user)) {
        const v = arrVerdict(req.method ?? 'GET', path, url.searchParams)
        if (!v.ok) throw adminOnly()
        if ('body' in v && v.body) {
          body = await readBody(req)
          const json = parseJson(body)
          if (v.body === 'command' && !commandAllowed(json)) throw adminOnly()
          if (v.body === 'add') {
            const roots = await arrGet<{ path: string }[]>(svc, def.api, 'rootfolder')
            if (!addAllowed(json, roots.map((r) => r.path))) throw adminOnly()
          }
        }
        if ('needsNoFiles' in v) {
          const item = await arrGet<Record<string, unknown>>(svc, def.api, `${v.needsNoFiles.kind}/${v.needsNoFiles.id}`)
          if (hasFiles(item)) throw new ApiError(403, 'It’s already downloaded, so only an administrator can remove it')
        }
      }
      await proxyHttp(req, res, {
        target: joinUrl(svc.url, `${def.api}/${params.rest ?? ''}`, search),
        stripAuth: true,
        setHeaders: { 'x-api-key': svc.apiKey! },
        body,
      })
    })
  }

  // SABnzbd takes its key as a query parameter: /arr/sab?mode=… → /api?mode=…&apikey=…
  router.any('/arr/sab', async ({ req, res, url }) => {
    const user = await auth.requireUser(req)
    const sab = need(settings.get().services.sabnzbd, 'SABnzbd')
    const q = new URLSearchParams(url.search)
    // Its settings hold your Usenet password: household members get the queue and its controls.
    if (!isAdmin(user) && !sabAllowed(q)) throw adminOnly()
    q.delete('apikey')
    q.set('apikey', sab.apiKey!)
    await proxyHttp(req, res, { target: joinUrl(sab.url, '/api', `?${q}`), stripAuth: true })
  })

  // RomM (Games): Basic auth injected; the ROM download from EmulatorJS carries
  // no headers, so the Jellyfin token may also come as a cookie.
  const romm = (path: string) => async ({ req, res, params, url }: { req: IncomingMessage; res: import('node:http').ServerResponse; params: Record<string, string>; url: URL }) => {
    const user = await auth.requireUser(req, { cookie: 'finesse_games_token' })
    const rest = safeRest(params.rest)
    // Household members browse and play; changing the library is admin-only.
    if (!isAdmin(user) && !(path === '/api' ? rommAllowed(req.method ?? 'GET', rest) : isRead(req.method ?? 'GET'))) throw adminOnly()
    const r = need(settings.get().services.romm, 'RomM', 'password')
    const basic = r.apiKey && !r.username ? r.apiKey : Buffer.from(`${r.username ?? ''}:${r.password ?? ''}`).toString('base64')
    await proxyHttp(req, res, {
      target: joinUrl(r.url, `${path}/${params.rest ?? ''}`, url.search),
      stripAuth: true,
      setHeaders: { authorization: `Basic ${basic}` },
      timeoutMs: 60000,
    })
  }
  router.any('/games/api/*', romm('/api'))
  router.any('/games/assets/*', romm('/assets'))
  router.any('/games/sgdb/*', async ({ req, res, params, url }) => {
    await auth.requireUser(req, { cookie: 'finesse_games_token' })
    safeRest(params.rest)
    if (!isRead(req.method ?? 'GET')) throw new ApiError(405, 'Cover art is read-only')
    const key = settings.get().services.steamgriddb?.apiKey
    if (!key) throw new ApiError(503, "SteamGridDB isn't set up")
    await proxyHttp(req, res, {
      target: joinUrl('https://www.steamgriddb.com/api/v2', `/${params.rest ?? ''}`, url.search),
      stripAuth: true,
      setHeaders: { authorization: `Bearer ${key}` },
    })
  })

  // Jellyfin itself, same-origin at /jellyfin. The caller's own Jellyfin auth
  // passes straight through (Jellyfin checks it). In bundle mode Jellyfin's
  // BaseUrl is /jellyfin, so paths map 1:1; a plain Jellyfin (basePath "")
  // gets the prefix stripped and its redirects re-prefixed.
  router.any('/jellyfin', async ({ req, res, url }) => {
    await proxyJellyfin(settings, req, res, '/', url.search)
  })
  router.any('/jellyfin/*', async ({ req, res, params, url }) => {
    await proxyJellyfin(settings, req, res, `/${params.rest ?? ''}`, url.search)
  })
}

function jellyfinTarget(settings: SettingsStore, rest: string, search: string) {
  const j = settings.get().jellyfin
  if (!j.url) throw new ApiError(503, "Jellyfin isn't set up yet")
  const base = j.basePath || ''
  return { target: joinUrl(j.url, `${base}${rest}`, search), base }
}

async function proxyJellyfin(settings: SettingsStore, req: IncomingMessage, res: import('node:http').ServerResponse, rest: string, search: string) {
  const { target, base } = jellyfinTarget(settings, rest, search)
  await proxyHttp(req, res, {
    target,
    // A plain Jellyfin redirects to "/web/…"; keep the browser under /jellyfin.
    rewriteLocation: base === '' ? { from: '/', to: '/jellyfin/' } : undefined,
    timeoutMs: 60000,
  })
}

/** WebSocket upgrades (Jellyfin's /socket). Returns false if not ours. */
export function handleUpgrade(settings: SettingsStore, req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const url = new URL(req.url ?? '/', 'http://x')
  let p = url.pathname
  if (p.startsWith('/finesse/')) p = p.slice('/finesse'.length)
  if (!(p === '/jellyfin' || p.startsWith('/jellyfin/'))) return false
  try {
    const { target } = jellyfinTarget(settings, p.slice('/jellyfin'.length) || '/', url.search)
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
    proxyUpgrade(req, socket, head, { target })
  } catch {
    socket.destroy()
  }
  return true
}
