// The API proxies the app uses (what deploy/nginx.conf did with auth_request +
// injected keys): every call needs a valid Jellyfin sign-in, service keys are
// added server-side and never reach a browser, and the caller's own
// credentials are stripped before anything leaves for a third-party service.

import { capPlaybackInfo, deviceOf, TranscodeCounter } from './transcodeCap.ts'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, type Duplex } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Auth } from './auth.ts'
import type { Endpoint, SettingsStore } from './config.ts'
import { ApiError, readBody, sendJson, type Router } from './http/core.ts'
import { joinUrl, proxyHttp, proxyUpgrade } from './http/proxy.ts'
import type { JfUser } from './jellyfin.ts'
import type { Parental } from './parental.ts'
import { idsIn, refusedShape } from './parental.ts'
import { actionBody, addAllowed, arrVerdict, cleanPath, hasFiles, isMediaCover, isRead, rommAllowed, sabAllowed } from './policy.ts'
import { requestAppJson, rootFolderPaths, upstreamRecords } from './requestDefaults.ts'

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

/** Discard caller-supplied service keys and any query-form Jellyfin sign-in. */
function withoutKeys(query: URLSearchParams): URLSearchParams {
  return new URLSearchParams([...query].filter(([key]) => !/^(api_?key)$/i.test(key)))
}

function requestTarget(svc: Endpoint, name: string, path: string, search: string): URL {
  const url = URL.parse(svc.url ?? '')
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) throw new ApiError(502, `${name} has an invalid server address`)
  return joinUrl(url.href, path, search)
}

/** Stream cover bytes while only exposing headers appropriate for same-origin thumbnails. */
async function mediaCover(req: IncomingMessage, res: ServerResponse, target: URL, svc: Endpoint, name: string) {
  const cancel = new AbortController()
  const onClose = () => cancel.abort()
  res.once('close', onClose)
  try {
    const headers: Record<string, string> = { 'x-api-key': svc.apiKey!, 'accept-encoding': 'identity' }
    for (const field of ['if-none-match', 'if-modified-since']) {
      const value = req.headers[field]
      if (typeof value === 'string') headers[field] = value
    }
    const upstream = await fetch(target, {
      method: req.method, headers, redirect: 'error',
      signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(15000)]),
    })
    const type = upstream.headers.get('content-type') ?? ''
    const image = /^image\/(?:jpeg|png|gif|webp|avif)(?:\s*;|$)/i.test(type)
    const out: Record<string, string> = {
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Authorization, X-Emby-Token, X-MediaBrowser-Token, X-Emby-Authorization',
    }
    if (upstream.status !== 304) {
      out['Cache-Control'] = upstream.status === 200 && image ? 'private, max-age=86400' : 'no-store'
      out['Content-Type'] = image || /^application\/json(?:\s*;|$)/i.test(type) ? type : 'application/octet-stream'
    }
    for (const field of ['etag', 'last-modified']) {
      const value = upstream.headers.get(field)
      if (value) out[field] = value
    }
    const length = upstream.headers.get('content-length')
    if (length && !upstream.headers.has('content-encoding')) out['Content-Length'] = length
    res.writeHead(upstream.status, out)
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res)
    else res.end()
  } catch {
    if (res.headersSent || res.destroyed) res.destroy()
    else throw new ApiError(502, `Couldn’t reach ${name} for that picture. Check it’s running, then try again.`)
  } finally {
    res.off('close', onClose)
  }
}

/** history/since records cut down to which title failed, when, and the app's own reason. */
export function failedDownloads(records: unknown): { movieId?: number; seriesId?: number; artistId?: number; date?: string; message?: string }[] {
  if (!Array.isArray(records)) return []
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  return records.flatMap((r) => {
    if (typeof r !== 'object' || r === null) return []
    const x = r as Record<string, unknown>
    const ev = x.eventType
    if (ev !== 'downloadFailed' && ev !== 4) return []
    const data = (typeof x.data === 'object' && x.data !== null ? x.data : {}) as Record<string, unknown>
    const out: { movieId?: number; seriesId?: number; artistId?: number; date?: string; message?: string } = {}
    if (num(x.movieId)) out.movieId = num(x.movieId)
    if (num(x.seriesId)) out.seriesId = num(x.seriesId)
    if (num(x.artistId)) out.artistId = num(x.artistId)
    if (typeof x.date === 'string') out.date = x.date
    if (typeof data.message === 'string' && data.message.trim()) out.message = data.message.trim().slice(0, 300)
    return [out]
  })
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

export function registerServiceProxies(router: Router, deps: { settings: SettingsStore; auth: Auth; parental: Parental }) {
  const { settings, auth, parental } = deps
  /** Limited profiles (parental.ts) don't request, unless allowed: the profile is the one the sign-in was checked as. */
  const requestsOff = (user: JfUser) => {
    const l = parental.limitOf(user.Id)
    if (l && !l.requests) throw new ApiError(403, 'Requests are off for this profile. Ask whoever runs the server.')
  }

  for (const [slug, def] of Object.entries(ARR)) {
    let roots: { url: string | undefined; apiKey: string | undefined; until: number; paths: Promise<string[]> } | undefined
    // A release's upstream GUID can itself be an indexer URL. Keep it and the grab arguments server-side.
    const releases = new Map<string, { user: string; url: string; apiKey: string | undefined; until: number; grab: Record<string, unknown> }>()
    const rootsFor = (svc: Endpoint) => {
      if (roots && roots.url === svc.url && roots.apiKey === svc.apiKey && roots.until > Date.now()) return roots.paths
      const entry = { url: svc.url, apiKey: svc.apiKey, until: Infinity, paths: requestAppJson(svc, def.name, def.api, 'rootfolder')
        .then((value) => {
          const paths = rootFolderPaths(value, def.name)
          entry.until = Date.now() + 60000
          return paths
        })
        .catch((e) => {
          if (roots === entry) roots = undefined
          throw e
        }) }
      roots = entry
      return entry.paths
    }
    router.any(`/arr/${slug}/*`, async ({ req, res, params, url }) => {
      const path = safeRest(params.rest)
      // An <img> can't send headers: a picture may carry the sign-in in its
      // address instead, which goes no further than here.
      const picture = !def.admin && isMediaCover(path) && isRead(req.method ?? '')
      const user = def.admin ? await auth.requireAdmin(req) : await auth.requireUser(req, picture ? { query: url.searchParams } : {})
      requestsOff(user)
      const query = withoutKeys(url.searchParams)
      let search = query.size ? `?${query}` : ''
      const svc = need(settings.get().services[def.id], def.name)
      let body: Buffer | undefined
      // Household members get what the app's screens do; the rest is admin-only.
      if (!isAdmin(user)) {
        const v = arrVerdict(req.method ?? 'GET', path, query)
        if (!v.ok) throw adminOnly()
        if ('body' in v && v.body) {
          if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new ApiError(415, 'Send the request as plain JSON')
          const json = parseJson(await readBody(req))
          let checked = json
          if (v.body === 'add') {
            if (!addAllowed(json, await rootsFor(svc))) throw adminOnly()
          } else {
            const allowed = actionBody(v.body, json)
            if (!allowed) throw adminOnly()
            if (v.body === 'release') {
              const release = releases.get(String(allowed.guid))
              if (!release || release.user !== user.Id || release.url !== svc.url || release.apiKey !== svc.apiKey || release.until <= Date.now()) {
                throw new ApiError(400, 'Search for releases again, then pick one from the new list.')
              }
              await requestAppJson(svc, def.name, def.api, path, { method: 'POST', body: release.grab, timeoutMs: 30000, preserveNotFound: true })
              return sendJson(res, 200, { ok: true })
            }
            checked = allowed
          }
          body = Buffer.from(JSON.stringify(checked))
        }
        if ('needsNoFiles' in v) {
          const { kind, id } = v.needsNoFiles
          const data = await requestAppJson(svc, def.name, def.api, `${kind}/${id}`, { preserveNotFound: true })
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(502, `${def.name} sent an unexpected reply`)
          const item = data as Record<string, unknown>
          if (hasFiles(item)) throw new ApiError(403, 'It’s already downloaded, so only an administrator can remove it')
          if (item.id !== id || (typeof item.hasFile !== 'boolean' && typeof item.sizeOnDisk !== 'number' &&
            !['episodeFileCount', 'trackFileCount', 'sizeOnDisk'].some((key) => typeof (item.statistics as Record<string, unknown> | null)?.[key] === 'number'))) {
            throw new ApiError(502, `${def.name} couldn’t confirm whether that request has files`)
          }
        }
        search = v.query ?? search
      }
      if (path === 'release' && !isAdmin(user) && isRead(req.method ?? '')) {
        const items = upstreamRecords(await requestAppJson(svc, def.name, def.api, path, { search, timeoutMs: 30000 }), def.name)
        const until = Date.now() + 30 * 60000
        const releasesForViewer = items.flatMap((item) => {
          const grab = actionBody('release', item)
          if (!grab) return []
          const guid = randomUUID()
          if (releases.size >= 5000) {
            const oldest = releases.keys().next()
            if (!oldest.done) releases.delete(oldest.value)
          }
          releases.set(guid, { user: user.Id, url: svc.url, apiKey: svc.apiKey, until, grab })
          const { title, size, quality, seeders, ageHours, age, rejections, rejected, customFormatScore, isUpgrade } = item
          return [{ guid, indexerId: grab.indexerId, title, size, quality, seeders, ageHours, age, rejections, rejected, customFormatScore, isUpgrade }]
        })
        return sendJson(res, 200, releasesForViewer)
      }
      // Failed downloads (a request's status): Finesse answers with only what that needs, so
      // nothing else a history record carries (release names, download clients) leaves.
      if (path === 'history/since' && !def.admin) {
        if (!/^(GET|HEAD)$/i.test(req.method ?? '')) throw adminOnly()
        const records = upstreamRecords(await requestAppJson(svc, def.name, def.api, path, { search }), def.name)
        return sendJson(res, 200, failedDownloads(records))
      }
      const target = requestTarget(svc, def.name, `${def.api}/${path.split('/').map(encodeURIComponent).join('/')}`, search)
      if (picture) return mediaCover(req, res, target, svc, def.name)
      const rootMutation = isAdmin(user) && !isRead(req.method ?? '') && /^rootfolder(?:\/|$)/i.test(path)
      if (rootMutation) roots = undefined
      try {
        await proxyHttp(req, res, {
          target,
          stripAuth: true,
          setHeaders: { 'x-api-key': svc.apiKey!, ...(body ? { 'content-type': 'application/json', 'content-encoding': null } : {}) },
          body,
        })
      } finally {
        if (rootMutation) roots = undefined
      }
    })
  }

  // SABnzbd takes its key as a query parameter: /arr/sab?mode=… → /api?mode=…&apikey=…
  router.any('/arr/sab', async ({ req, res, url }) => {
    const user = await auth.requireUser(req)
    requestsOff(user)
    const sab = need(settings.get().services.sabnzbd, 'SABnzbd')
    let q = withoutKeys(url.searchParams)
    // Its settings hold your Usenet password: household members get the queue and its controls.
    const household = !isAdmin(user)
    if (household) {
      if (!isRead(req.method ?? '') || !sabAllowed(q)) throw adminOnly()
      const mode = q.get('mode')!
      const name = q.get('name')
      const useful = mode === 'queue' && name === null ? ['limit', 'start', 'search'] : ['name', 'value']
      q = new URLSearchParams([...q].filter(([key]) => key === 'mode' || useful.includes(key)))
      q.set('output', 'json')
    }
    q.set('apikey', sab.apiKey!)
    await proxyHttp(req, res, {
      target: requestTarget(sab, 'SABnzbd', '/api', `?${q}`), stripAuth: true, timeoutMs: 15000,
      setHeaders: { 'x-api-key': null, 'x-nzb-key': null },
      ...(household ? { body: Buffer.alloc(0) } : {}),
    })
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
  const conversions = new TranscodeCounter(settings)
  router.any('/jellyfin', async ({ req, res, url }) => {
    await proxyJellyfin(settings, req, res, '/', url.search, parental, conversions)
  })
  router.any('/jellyfin/*', async ({ req, res, params, url }) => {
    await proxyJellyfin(settings, req, res, `/${params.rest ?? ''}`, url.search, parental, conversions)
  })
}

function jellyfinTarget(settings: SettingsStore, rest: string, search: string) {
  const j = settings.get().jellyfin
  if (!j.url) throw new ApiError(503, "Jellyfin isn't set up yet")
  const base = j.basePath || ''
  return { target: joinUrl(j.url, `${base}${rest}`, search), base }
}

async function proxyJellyfin(settings: SettingsStore, req: IncomingMessage, res: import('node:http').ServerResponse, rest: string, search: string, parental: Parental, conversions?: TranscodeCounter) {
  // When any profile is limited (parental.ts), the request goes on with only the one token
  // Jellyfin would have used, and that token's profile is the one checked.
  const caller = await parental.jellyfinCaller(req, search)
  const kid = caller?.kid ?? null
  const q = caller ? caller.upstream.search : search
  const { target, base } = jellyfinTarget(settings, rest, q)
  // A limited profile: nothing that names a title it can't open gets to Jellyfin, and replies
  // coming back are checked title by title.
  if (kid) {
    const query = new URLSearchParams(search)
    const shape = refusedShape(rest, query)
    if (shape) throw new ApiError(403, shape)
    const ids = idsIn(rest, query, { skipPeople: true })
    const ok = await parental.allowsAll(kid.limit, ids).catch(() => {
      throw new ApiError(503, 'Couldn’t check this title against the profile’s limits. Try again in a moment.')
    })
    if (!ok) throw new ApiError(403, 'This profile can’t open that title')
  }
  const accept = String(req.headers.accept ?? '')
  // The graphics plan's cap on conversions at once (transcodeCap.ts): checked only when it's reached.
  const cap = conversions?.cap()
  let capText: ((t: string) => string) | null = null
  if (cap && req.method === 'POST' && /^\/Items\/[^/]+\/PlaybackInfo$/i.test(rest)) {
    const busy = await conversions!.busy(deviceOf(String(req.headers['x-emby-authorization'] ?? req.headers.authorization ?? ''))).catch(() => 0)
    if (busy >= cap) capText = (t) => capPlaybackInfo(t, busy, cap)
  }
  const kidText = kid ? (t: string) => (t.trimStart().startsWith('#EXTM3U') ? t : parental.filterJson(t, kid.limit)) : null
  await proxyHttp(req, res, {
    target,
    // A plain Jellyfin redirects to "/web/…"; keep the browser under /jellyfin.
    rewriteLocation: base === '' ? { from: '/', to: '/jellyfin/' } : undefined,
    timeoutMs: 60000,
    ...(caller ? { setHeaders: caller.upstream.headers } : {}),
    ...(capText && !kid ? { rewriteText: capText, rewriteRefusal: 'Couldn’t check how busy the server is' } : {}),
    ...(kid
      ? {
          setHeaders: {
            ...caller!.upstream.headers,
            'accept-encoding': 'identity',
            // Plain JSON only: no "profile=CamelCase" replies with keys the filter doesn't expect.
            ...(/json|profile/i.test(accept) ? { accept: 'application/json' } : {}),
          },
          rewriteText: async (t: string) => {
            const checked = await kidText!(t)
            return capText ? capText(checked) : checked
          },
          rewriteRefusal: 'Couldn’t check this against the profile’s limits',
        }
      : {}),
  })
}

/**
 * WebSocket upgrades (Jellyfin's /socket). Returns false if not ours. When profiles are limited,
 * the upgrade carries only the one token Jellyfin would use, and a limited profile doesn't get a
 * socket at all: Jellyfin pushes session and library news down it that Finesse can't check title
 * by title. The app doesn't need it to browse or play (it's what makes a device a "Play on…"
 * target and refreshes lists live), and it retries quietly with a back-off.
 */
export function handleUpgrade(settings: SettingsStore, req: IncomingMessage, socket: Duplex, head: Buffer, parental?: Parental): boolean {
  const url = new URL(req.url ?? '/', 'http://x')
  let p = url.pathname
  if (p.startsWith('/finesse/')) p = p.slice('/finesse'.length)
  if (!(p === '/jellyfin' || p.startsWith('/jellyfin/'))) return false
  const refuse = (status: string) => {
    try {
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    } catch {
      /* gone */
    }
    socket.destroy()
  }
  socket.on('error', () => socket.destroy())
  void (async () => {
    const caller = parental ? await parental.jellyfinCaller(req, url.search) : null
    if (caller?.kid) return refuse('403 Forbidden')
    const { target } = jellyfinTarget(settings, p.slice('/jellyfin'.length) || '/', caller ? caller.upstream.search : url.search)
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
    proxyUpgrade(req, socket, head, { target, ...(caller ? { setHeaders: caller.upstream.headers } : {}) })
  })().catch((e) => refuse(e instanceof ApiError && e.status === 400 ? '400 Bad Request' : '502 Bad Gateway'))
  return true
}
