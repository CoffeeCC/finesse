// Assembles the Finesse server: settings, auth, routes, static web, proxies.
// `createApp()` returns an unstarted http.Server so tests can run it in-process.

import { createServer, type Server } from 'node:http'
import { Auth, ensureSetupCode, tokenFrom } from './auth.ts'
import { SettingsStore, type Paths, type Settings } from './config.ts'
import { ApiError, Router, sendError, sendJson } from './http/core.ts'
import { safeFile, sendFile, serveWeb, WebRoot } from './http/static.ts'
import { registerGroups } from './groups.ts'
import { registerMoments } from './moments.ts'
import { registerStreaming } from './streaming.ts'
import { playState, registerPlay } from './play.ts'
import { InviteStore, registerInvites } from './invites.ts'
import { registerUploads, Uploads } from './uploads.ts'
import { Deleter, registerDeletions } from './deletions.ts'
import { Jellyfin, VERSION } from './jellyfin.ts'
import { logger } from './log.ts'
import { handleUpgrade, registerServiceProxies } from './services.ts'
import { GitHubReleases, registerWebUpdate, WebUpdater } from './update.ts'

const log = logger('http')

export interface AppDeps {
  settings: SettingsStore
  jf: Jellyfin
  auth: Auth
  web: WebRoot
  router: Router
  releases: GitHubReleases
  invites: InviteStore
  updater?: WebUpdater
}

/** Hook for later phases (setup, stack, system) to add routes. */
export type Plugin = (deps: AppDeps) => void

// The games API lives under /games/api, /games/assets and /games/sgdb; other
// /games/… paths are app pages (a game, the player) that must reload fine.
const CORS_PREFIXES = ['/api/', '/arr/', '/invite-api/', '/games/api/', '/games/assets/', '/games/sgdb/']

function features(s: Settings) {
  const svc = s.services
  return {
    requests: Boolean(svc.radarr?.url || svc.sonarr?.url || svc.lidarr?.url),
    movies: Boolean(svc.radarr?.url),
    shows: Boolean(svc.sonarr?.url),
    music: Boolean(svc.lidarr?.url),
    usenet: Boolean(svc.sabnzbd?.url),
    torrents: Boolean(svc.qbittorrent?.url),
    games: Boolean(svc.romm?.url),
    /** SteamGridDB has a key (extra box art); without one the app doesn't ask it. */
    sgdb: Boolean(svc.steamgriddb?.apiKey),
    streaming: Boolean(s.streaming?.socket),
    /** Browser play (Selkies): emulators set up and Docker reachable. */
    play: playState.available,
    invites: true,
    email: Boolean(s.email?.host),
    webUpdates: true,
    system: s.mode === 'bundle',
    /** Drop files on the app and they land in the libraries (servers Finesse set up). */
    addMedia: s.mode === 'bundle' && Boolean(s.stack) && s.setup.state === 'ready',
    /** Flag a moment / recommend a title to people here and friends' servers. */
    moments: true,
  }
}

export function createApp(opts: { paths?: Paths; plugins?: Plugin[] } = {}): { server: Server; deps: AppDeps } {
  const settings = new SettingsStore(opts.paths)
  settings.ensureSaved()
  const jf = new Jellyfin(settings)
  const auth = new Auth(settings, jf)
  const p = settings.paths
  const web = new WebRoot({ baked: p.bakedWeb, updated: p.updatedWeb, legacy: p.legacyDist })
  const releases = new GitHubReleases(settings)
  const invites = new InviteStore(p.invitesDb)
  const router = new Router()
  const deps: AppDeps = { settings, jf, auth, web, router, releases, invites }

  // Discovery: lets the app (and the TV) learn what it's talking to.
  router.get('/api/finesse', ({ res }) => {
    const s = settings.get()
    sendJson(res, 200, {
      name: 'finesse',
      version: VERSION,
      web: web.current().version,
      mode: s.mode,
      instanceId: s.instanceId,
      jellyfin: s.jellyfin.url ? { path: '/jellyfin' } : null,
      setup: { state: s.setup.state, needsCode: s.mode === 'bundle' && s.setup.state !== 'ready' },
      features: features(s),
      publicUrl: s.publicUrl ?? null,
      /** Finesse's own HTTPS port (FINESSE_HTTPS_PORT), for features that need a secure page. */
      httpsPort: Number(process.env.FINESSE_HTTPS_PORT || 0) || null,
      requests: s.requests ? { profiles: s.requests.profiles } : undefined,
    })
  })
  router.get('/api/health', ({ res }) => sendJson(res, 200, { status: 'ok', version: VERSION }))

  registerInvites(router, { store: invites, jf, auth, settings })
  const groups = registerGroups(router, { settings, jf, auth })
  registerMoments(router, { settings, jf, auth, groups })
  registerStreaming(router, { settings, auth })
  const uploads = new Uploads(settings)
  registerUploads(router, { uploads, auth })
  registerDeletions(router, { deleter: new Deleter(settings), auth })
  setInterval(() => uploads.sweep(), 3600e3).unref()
  const play = registerPlay(router, { settings, auth })
  const updater = new WebUpdater(web, releases, VERSION)
  deps.updater = updater
  registerWebUpdate(router, { auth, updater })
  for (const plugin of opts.plugins ?? []) plugin(deps)
  registerServiceProxies(router, { settings, auth })

  // Whether a viewer may see an item, asked of Jellyfin with their own sign-in (its library rules apply).
  const seen = new Map<string, { ok: boolean; at: number }>()
  const canSee = async (token: string, userId: string, itemId: string) => {
    const key = `${userId}:${itemId}`
    const hit = seen.get(key)
    if (hit && Date.now() - hit.at < 10 * 60000) return hit.ok
    const ok = await jf.request(`/Items/${itemId}?userId=${userId}`, { token }).then(() => true, () => false)
    if (seen.size > 20000) seen.clear()
    seen.set(key, { ok, at: Date.now() })
    return ok
  }

  const server = createServer(async (req, res) => {
    const started = Date.now()
    const url = new URL(req.url ?? '/', 'http://localhost')
    const raw = url.pathname
    // The app lives under /finesse/ (its build base). Bare "/" goes there.
    if (raw === '/' || raw === '') {
      res.writeHead(302, { Location: '/finesse/' })
      return void res.end()
    }
    let path = raw === '/finesse' ? '/' : raw.startsWith('/finesse/') ? raw.slice('/finesse'.length) : raw
    const isApi = CORS_PREFIXES.some((pre) => path.startsWith(pre)) || path === '/invite-api'
    const isPreview = path.startsWith('/previews/')
    if (isApi || isPreview) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Emby-Token, X-Emby-Authorization, X-Finesse-Setup-Code')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        return void res.end()
      }
    }
    if (isApi && path.length > 1 && path.endsWith('/') && !path.startsWith('/arr/') && !path.startsWith('/games/')) path = path.replace(/\/+$/, '')
    try {
      const handled = await router.dispatch({ req, res, path, url })
      if (!handled) {
        // Preview clips: the config dir first, then whatever the web root carries.
        // They're clips of your library, so for signed-in viewers only.
        if (isPreview) {
          // A <video> can't send a header: the app's cookie (same origin) or, from another origin, ApiKey.
          const who = await auth.requireUser(req, { cookie: 'finesse_media_token', query: url.searchParams })
          const clip = /^\/previews\/([0-9a-f]{32})(?:\.(?:720|1080))?\.mp4$/.exec(path)
          // A clip is of one item: someone who can't see that item (a library they're not in) can't see its clip.
          if (clip && !who.Policy?.IsAdministrator && !(await canSee(tokenFrom(req, { cookie: 'finesse_media_token', query: url.searchParams })!, who.Id, clip[1]!))) {
            throw new ApiError(404, 'Not found')
          }
          const hit = safeFile(p.previews, path.slice('/previews'.length))
          // Signed-in only: no shared cache (a proxy or CDN) may keep it and hand it to someone else.
          if (hit) return void sendFile(req, res, hit.file, hit.stat, path, { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' })
          // No clips made yet (a fresh server): an empty list, not an error.
          if (path === '/previews/manifest.json') return void sendJson(res, 200, [])
          if (path === '/previews/manifest-hd.json') return void sendJson(res, 200, {})
        }
        if (isApi || path.startsWith('/jellyfin')) throw new ApiError(404, 'Not found')
        if (!serveWeb(req, res, web, path)) sendJson(res, 404, { error: 'Not found' })
      }
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500) log.warn(`${req.method} ${raw} → ${e instanceof ApiError ? e.status : 500}`, e instanceof ApiError ? e.message : e)
      sendError(res, e)
    } finally {
      const ms = Date.now() - started
      if (ms > 5000 && !path.startsWith('/jellyfin')) log.debug(`${req.method} ${raw} took ${ms}ms`)
    }
  })

  server.on('upgrade', (req, socket, head) => {
    if (!play.upgrade(req, socket, head) && !handleUpgrade(settings, req, socket, head)) socket.destroy()
  })

  // Keep-alive sockets shouldn't hold shutdown open for long.
  server.keepAliveTimeout = 65000
  server.headersTimeout = 66000
  // Receiving a request (not answering it: a film can stream for hours) has a limit, so a client
  // that dribbles bytes can't hold a connection forever. Generous: a 16 MB upload chunk on a slow line.
  server.requestTimeout = 15 * 60000

  return { server, deps }
}

export { ensureSetupCode }
