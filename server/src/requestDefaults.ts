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

const norm = (u: string | undefined) => (u ?? '').trim().replace(/\/+$/, '').toLowerCase()

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

const liveGet: Fetcher = async (svc, api, path) => {
  const r = await fetch(joinUrl(svc.url!, `${api}/${path}`), { headers: { 'x-api-key': svc.apiKey ?? '' }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new ApiError(502, `answered ${r.status}`)
  return r.json()
}

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
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) throw new ApiError(400, 'Pick a quality profile')
  const root = body.rootFolder
  if (root !== undefined && root !== null && (typeof root !== 'string' || !root.trim() || root.length > 1000)) throw new ApiError(400, 'Pick a folder')
  let profiles: unknown
  let roots: unknown
  try {
    ;[profiles, roots] = await Promise.all([get(svc, API[app], 'qualityprofile'), get(svc, API[app], 'rootfolder')])
  } catch {
    throw new ApiError(502, `Couldn’t reach ${name} to check that choice. Make sure it’s running, then try again.`)
  }
  const profile = (Array.isArray(profiles) ? profiles : []).find((p): p is { id: number; name: string } => Boolean(p) && (p as { id?: unknown }).id === id)
  if (!profile) throw new ApiError(400, `${name} doesn’t have that quality profile any more. Reload the list and pick again.`)
  const out: RequestDefault = { profileId: id, profileName: String(profile.name ?? `Profile ${id}`).slice(0, 100), serviceUrl: svc.url }
  if (typeof root === 'string') {
    const trim = (s: string) => s.replace(/[\\/]+$/, '')
    const known = (Array.isArray(roots) ? roots : []).map((r) => (r as { path?: unknown }).path).filter((p): p is string => typeof p === 'string')
    const match = known.find((p) => trim(p) === trim(root))
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
    const body = await readJson<{ app?: unknown; profileId?: unknown; rootFolder?: unknown }>(req)
    const app = body.app
    if (typeof app !== 'string' || !REQUEST_APPS.includes(app as RequestApp)) throw new ApiError(400, 'Which app? Radarr, Sonarr or Lidarr')
    const a = app as RequestApp
    if (body.profileId === null) {
      settings.update((s) => {
        if (s.requests?.defaults) delete s.requests.defaults[a]
      })
    } else {
      const chosen = await validateDefault(a, settings.get().services[a], body, deps.get)
      settings.update((s) => {
        s.requests = { profiles: s.requests?.profiles ?? {}, defaults: { ...(s.requests?.defaults ?? {}), [a]: chosen } }
      })
    }
    sendJson(res, 200, { apps: requestConfig(settings.get()) })
  })
}
