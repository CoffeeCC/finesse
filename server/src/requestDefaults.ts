// Where new requests go in Radarr, Sonarr and Lidarr: the quality profile and
// root folder, per app. Setup saves a profile *name* per app from its quality
// preset (settings.requests.profiles); Settings → Downloads can then pick a
// profile and folder from what the app really has, saved by the app's own id
// (settings.requests.defaults), along with which app it belongs to (its address),
// so a choice made for one Radarr is never applied to another. Requests read
// both through GET /api/requests/defaults (src/lib/arrProfiles.ts decides).
// Changes are checked against the live app before they're saved.

import type { Auth } from './auth.ts'
import type { Endpoint, Settings, SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { joinUrl } from './http/proxy.ts'
import { addAllowed, positiveId } from './policy.ts'

export type RequestApp = 'radarr' | 'sonarr' | 'lidarr'
export const REQUEST_APPS: RequestApp[] = ['radarr', 'sonarr', 'lidarr']
const API: Record<RequestApp, string> = { radarr: '/api/v3', sonarr: '/api/v3', lidarr: '/api/v1' }
const NAME: Record<RequestApp, string> = { radarr: 'Radarr', sonarr: 'Sonarr', lidarr: 'Lidarr' }

/** A choice made in Settings → Downloads. */
export interface RequestDefault {
  profileId: number
  /** The profile's name when it was chosen (for messages if it disappears). */
  profileName: string
  rootFolder?: string
  /** The app's address when it was chosen: a different app (moved, replaced) means choose again. */
  serviceUrl: string
}

/** What the app gets for one app: setup's name, and any Settings choice (still for this app?). */
export interface RequestConfigOut {
  app: RequestApp
  profileName?: string
  profileId?: number
  rootFolder?: string
  /** Where the choice came from. */
  source: 'settings' | 'setup' | 'none'
  /** A Settings choice made for a different app at this address: it no longer applies. */
  stale?: boolean
}

const norm = (u: string | undefined) => {
  const value = (u ?? '').trim()
  return (URL.parse(value)?.href ?? value).replace(/\/+$/, '')
}

/** What requests should use for each configured app. */
export function requestConfig(s: Settings): RequestConfigOut[] {
  const out: RequestConfigOut[] = []
  for (const app of REQUEST_APPS) {
    const svc = s.services[app]
    if (!svc?.url) continue
    const chosen = s.requests?.defaults?.[app]
    const setupName = s.requests?.profiles?.[app]?.trim() || undefined
    if (chosen && norm(chosen.serviceUrl) === norm(svc.url)) {
      out.push({ app, profileId: chosen.profileId, profileName: chosen.profileName, ...(chosen.rootFolder ? { rootFolder: chosen.rootFolder } : {}), source: 'settings' })
    } else if (chosen) {
      out.push({ app, ...(setupName ? { profileName: setupName } : {}), source: setupName ? 'setup' : 'none', stale: true })
    } else {
      out.push({ app, ...(setupName ? { profileName: setupName } : {}), source: setupName ? 'setup' : 'none' })
    }
  }
  return out
}

/** Setup saved new profile names: Settings choices stay only for apps whose name didn't change. */
export function keepDefaultsAfterSetup(before: Settings['requests'], profiles: Record<string, string>): NonNullable<Settings['requests']> {
  const kept: Partial<Record<RequestApp, RequestDefault>> = {}
  for (const app of REQUEST_APPS) {
    const d = before?.defaults?.[app]
    if (d && before?.profiles?.[app] === profiles[app]) kept[app] = d
  }
  return Object.keys(kept).length ? { profiles, defaults: kept } : { profiles }
}

type Fetcher = (svc: Endpoint, api: string, path: string) => Promise<unknown>

/** Credentialed requests made by Finesse itself, with a deadline through the response body. */
export async function requestAppJson(svc: Endpoint, name: string, api: string, path: string, opts: {
  method?: string; body?: unknown; search?: string; timeoutMs?: number; preserveNotFound?: boolean
} = {}): Promise<unknown> {
  try {
    const target = joinUrl(svc.url!, `${api}/${path.replace(/^\//, '')}`, opts.search)
    const response = await fetch(target, {
      method: opts.method,
      headers: { 'x-api-key': svc.apiKey ?? '', ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
      redirect: 'error',
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 404 && opts.preserveNotFound) throw new ApiError(404, 'Not found')
      throw new ApiError(502, `${name} answered ${response.status}. Check it’s running, then try again.`)
    }
    const text = await response.text()
    if (!text.trim() && opts.method && opts.method !== 'GET') return undefined
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new ApiError(502, `${name} sent an unreadable reply. Try again.`)
    }
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(502, `Couldn’t reach ${name}. Check it’s running, then try again.`)
  }
}

export function upstreamRecords(value: unknown, name: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new ApiError(502, `${name} sent an unexpected reply. Try again.`)
  return value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
}

export function rootFolderPaths(value: unknown, name: string): string[] {
  const rows = upstreamRecords(value, name)
  return rows.flatMap(({ path }) => typeof path === 'string' && path.trim() && !path.includes('\0') ? [path] : [])
}

const liveGet: Fetcher = (svc, api, path) => requestAppJson(svc, 'The app', api, path)

/** Checks a choice against the live app; the saved form, or a message saying what's wrong. */
export async function validateDefault(
  app: RequestApp,
  svc: Endpoint | undefined,
  body: { profileId?: unknown; rootFolder?: unknown },
  get: Fetcher = liveGet,
): Promise<RequestDefault> {
  const name = NAME[app]
  if (!svc?.url) throw new ApiError(400, `${name} isn’t set up on this server`)
  const id = body.profileId
  if (!positiveId(id)) throw new ApiError(400, 'Pick a quality profile')
  const root = body.rootFolder
  if (root !== undefined && root !== null && (typeof root !== 'string' || !root.trim() || root.length > 1000 || root.includes('\0'))) throw new ApiError(400, 'Pick a folder')
  let profiles: unknown
  let roots: unknown
  try {
    ;[profiles, roots] = await Promise.all([get(svc, API[app], 'qualityprofile'), typeof root === 'string' ? get(svc, API[app], 'rootfolder') : []])
  } catch {
    throw new ApiError(502, `Couldn’t reach ${name} to check that choice. Make sure it’s running, then try again.`)
  }
  const profile = upstreamRecords(profiles, name).find((p) => p.id === id)
  if (!profile) throw new ApiError(400, `${name} doesn’t have that quality profile any more. Reload the list and pick again.`)
  const profileName = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : `Profile ${id}`
  const out: RequestDefault = { profileId: id, profileName: profileName.slice(0, 100), serviceUrl: svc.url }
  if (typeof root === 'string') {
    const known = rootFolderPaths(roots, name)
    const match = known.find((p) => addAllowed({ rootFolderPath: root }, [p]))
    if (!match) throw new ApiError(400, `${name} doesn’t have the folder “${root}” any more. Reload the list and pick again.`)
    out.rootFolder = match
  }
  return out
}

export function registerRequestDefaults(router: Router, deps: { settings: SettingsStore; auth: Auth; get?: Fetcher }) {
  const { settings, auth } = deps
  // Everyone who can request reads it (requests use it); names, ids and folder paths only, never keys.
  router.get('/api/requests/defaults', async ({ req, res }) => {
    await auth.requireUser(req)
    sendJson(res, 200, { apps: requestConfig(settings.get()) })
  })
  // Administrators choose. { app, profileId, rootFolder? } saves; { app, profileId: null } goes back to setup's choice.
  router.put('/api/requests/defaults', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ app?: unknown; profileId?: unknown; rootFolder?: unknown } | null>(req)
    const app = body?.app
    if (!body || typeof app !== 'string' || !REQUEST_APPS.includes(app as RequestApp)) throw new ApiError(400, 'Which app? Radarr, Sonarr or Lidarr')
    const a = app as RequestApp
    if (body.profileId === null) {
      settings.update((s) => {
        if (s.requests?.defaults) delete s.requests.defaults[a]
      })
    } else {
      const service = settings.get().services[a]
      const chosen = await validateDefault(a, service, body, deps.get)
      settings.update((s) => {
        if (norm(s.services[a]?.url) !== norm(service?.url) || s.services[a]?.apiKey !== service?.apiKey) {
          throw new ApiError(409, 'The app changed while Finesse checked it. Reload and pick again.')
        }
        s.requests = { profiles: s.requests?.profiles ?? {}, defaults: { ...(s.requests?.defaults ?? {}), [a]: chosen } }
      })
    }
    sendJson(res, 200, { apps: requestConfig(settings.get()) })
  })
}
