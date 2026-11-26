// What a signed-in household member who isn't an administrator may do through
// the /arr, /games proxies: exactly what the app's own screens do (search,
// request, follow and steer downloads, play games). Everything else those APIs
// can do (settings, API keys, deleting files, scripts, users) needs an
// administrator, because the proxies call them with the admin key.

import { posix, win32 } from 'node:path'

export type ArrApp = 'radarr' | 'sonarr' | 'lidarr'

/**
 * The proxied path, checked for tricks: decoded, without empty or "." segments.
 * Null when it tries to climb out of the API prefix ("..", encoded or not) or
 * carries a backslash or control character.
 */
export function cleanPath(rest: string): string | null {
  let p: string
  try {
    p = decodeURIComponent(rest)
  } catch {
    return null
  }
  if (/[\\\x00-\x1f\x7f]/.test(p)) return null
  const parts = p.split('/').filter((s) => s && s !== '.')
  if (parts.includes('..')) return null
  return parts.join('/')
}

const ITEM = '(movie|series|artist)'
const SEARCHES = new Set(['MoviesSearch', 'SeriesSearch', 'ArtistSearch'])
const ITEM_ROUTE = new RegExp(`^${ITEM}(/\\d+|/lookup)?$`)
const ITEM_ID_ROUTE = new RegExp(`^${ITEM}/(\\d+)$`)
export const isMediaCover = (path: string) => /^mediacover\/(?:(artist|album)\/)?\d+\/[\w-]+\.(jpg|jpeg|png|gif|webp|avif)$/i.test(path)
export const positiveId = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0

export type ArrVerdict =
  | { ok: true; body?: 'command' | 'add' | 'queue' | 'release'; query?: string }
  | { ok: true; needsNoFiles: { kind: 'movie' | 'series' | 'artist'; id: number }; /** Sent instead of what the browser asked: never deletes files. */ query: string }
  | { ok: false }

/**
 * Radarr/Sonarr/Lidarr for non-admins. `path` is cleanPath() of what follows
 * the API prefix. Some answers need a second look by the caller: the JSON body
 * (a command must be a search; an add must use a library folder), or the item
 * (a request can only be taken back while nothing of it is on disk).
 */
export function arrVerdict(method: string, path: string, query: URLSearchParams): ArrVerdict {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD') {
    // The Discover titles are safe to show. The import-list configuration is admin-only.
    const ok = ITEM_ROUTE.test(path) || isMediaCover(path) ||
      /^(qualityprofile|rootfolder|metadataprofile|queue|wanted\/missing|release|importlist\/movie|movie\/lookup\/tmdb)$/.test(path) ||
      /^(episode|episodefile|album)(\/\d+)?$/.test(path) || path === 'album/lookup'
    if (ok) return { ok: true }
    // Failed downloads only (eventType 4 in Radarr, Sonarr and Lidarr), for a request's status
    // ("the last download failed, searching again"). Not the rest of the history.
    if (path === 'history/since') {
      const types = query.getAll('eventType')
      return types.length === 1 && types[0]?.trim() === '4' && !hasAliases(query.keys(), ['eventType']) ? { ok: true } : { ok: false }
    }
    return { ok: false }
  }
  if (m === 'POST') {
    if (path === 'command') return { ok: true, body: 'command' }
    if (path === 'movie' || path === 'series' || path === 'artist') return { ok: true, body: 'add' }
    if (path === 'release') return { ok: true, body: 'release' }
    return { ok: false }
  }
  if (m === 'DELETE') {
    if (path === 'queue/bulk' || /^queue\/\d+$/.test(path)) {
      const safe = new URLSearchParams()
      for (const key of ['removeFromClient', 'blocklist', 'skipRedownload']) {
        const values = query.getAll(key)
        if (values.length > 1 || (values.length && !/^(true|false)$/.test(values[0]!))) return { ok: false }
        if (values.length) safe.set(key, values[0]!)
      }
      return { ok: true, ...(path === 'queue/bulk' ? { body: 'queue' } : {}), query: safe.toString() ? `?${safe}` : '' }
    }
    const item = ITEM_ID_ROUTE.exec(path)
    if (!item || !positiveId(Number(item[2]))) return { ok: false }
    // Taking back a request never deletes files: any "delete files" flag, in any spelling, that isn't
    // plainly false is refused, and what's sent on is a query Finesse writes itself.
    for (const [k, v] of query) if (/^delete.?files$/i.test(k.trim()) && v.trim().toLowerCase() !== 'false') return { ok: false }
    const kind = item[1] as 'movie' | 'series' | 'artist'
    return { ok: true, needsNoFiles: { kind, id: Number(item[2]) }, query: kind === 'movie' ? '?deleteFiles=false&addImportExclusion=false' : '?deleteFiles=false' }
  }
  return { ok: false }
}

/** A command body a non-admin may send: a search, nothing else. */
export function commandAllowed(body: unknown): boolean {
  const value = record(body)
  return typeof value?.name === 'string' && SEARCHES.has(value.name)
}

const record = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const idList = (v: unknown): v is number[] => Array.isArray(v) && v.length > 0 && v.every(positiveId)
const hasAliases = (keys: Iterable<string>, names: string[]) =>
  [...keys].some((key) => names.some((name) => key !== name && key.toLowerCase() === name.toLowerCase()))

/** Only the fields each allowed action needs are written to the upstream API. */
export function actionBody(action: 'command' | 'queue' | 'release', value: unknown): Record<string, unknown> | null {
  const b = record(value)
  if (!b) return null
  if (action === 'command') {
    if (!commandAllowed(b)) return null
    if (b.name === 'MoviesSearch' && idList(b.movieIds)) return { name: b.name, movieIds: b.movieIds }
    if (b.name === 'SeriesSearch' && positiveId(b.seriesId)) return { name: b.name, seriesId: b.seriesId }
    if (b.name === 'ArtistSearch' && positiveId(b.artistId)) return { name: b.name, artistId: b.artistId }
    return null
  }
  if (action === 'queue') return idList(b.ids) ? { ids: b.ids } : null
  if (typeof b.guid !== 'string' || !b.guid.trim() || !positiveId(b.indexerId)) return null
  const release: Record<string, unknown> = { guid: b.guid, indexerId: b.indexerId }
  for (const key of ['movieId', 'seriesId', 'episodeId', 'artistId', 'albumId']) {
    if (positiveId(b[key])) release[key] = b[key]
  }
  return release
}

/** An add a non-admin may send: into one of the app's library folders, nowhere else. */
export function addAllowed(body: unknown, rootFolders: string[]): boolean {
  const b = record(body)
  if (!b || hasAliases(Object.keys(b), ['rootFolderPath', 'path']) || typeof b.rootFolderPath !== 'string') return false
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(b.rootFolderPath)
  const flavor = windows ? win32 : posix
  const norm = (s: string) => {
    if (!flavor.isAbsolute(s) || /[\x00-\x1f\x7f]/.test(s) || (!windows && s.includes('\\'))) return null
    const parts = s.split(windows ? /[\\/]/ : '/')
    if (parts.some((part) => part === '..' || (windows && /[. ]$/.test(part)))) return null
    const path = flavor.normalize(s).replace(/[\\/]+$/, '') || flavor.sep
    return windows ? path.toLowerCase() : path
  }
  const root = norm(b.rootFolderPath)
  if (!root || !rootFolders.some((path) => norm(path) === root)) return false
  if (b.path === undefined || b.path === null || b.path === '') return true
  const path = typeof b.path === 'string' ? norm(b.path) : null
  return path !== null && (path === root || path.startsWith(root.endsWith(flavor.sep) ? root : root + flavor.sep))
}

/** Whether an item has anything on disk yet (then only an admin may remove it). */
export function hasFiles(item: Record<string, unknown>): boolean {
  if (item.hasFile === true) return true
  const st = record(item.statistics)
  return [item.sizeOnDisk, st?.episodeFileCount, st?.trackFileCount, st?.albumFileCount, st?.sizeOnDisk].some((n) => typeof n === 'number' && n > 0)
}

/** SABnzbd (one endpoint, driven by ?mode=) for non-admins: the queue and its controls. */
export function sabAllowed(query: URLSearchParams): boolean {
  if (hasAliases(query.keys(), ['mode', 'name']) || ['mode', 'name', 'value'].some((key) => query.getAll(key).length > 1)) return false
  const mode = query.get('mode') ?? ''
  const name = query.get('name')
  if (mode === 'queue') return name === null || name === 'pause' || name === 'resume'
  if (mode === 'pause' || mode === 'resume' || mode === 'version') return true
  if (mode === 'config') return name === 'speedlimit'
  return false
}

export const isRead = (method: string) => method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD'

/** RomM's API for non-admins: reading the library and downloading a game to play it. */
export function rommAllowed(method: string, path: string): boolean {
  // Firmware content too: the emulator needs a console's BIOS to start its games.
  return isRead(method) && (/^(platforms|roms)(\/\d+)?$/.test(path) || /^(roms|firmware)\/\d+\/content\/.+/.test(path))
}
