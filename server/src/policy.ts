// What a signed-in household member who isn't an administrator may do through
// the /arr, /games proxies: exactly what the app's own screens do (search,
// request, follow and steer downloads, play games). Everything else those APIs
// can do (settings, API keys, deleting files, scripts, users) needs an
// administrator, because the proxies call them with the admin key.

export type ArrApp = 'radarr' | 'sonarr' | 'lidarr'

/**
 * The proxied path, checked for tricks: decoded, without empty or "." segments.
 * Null when it tries to climb out of the API prefix ("..", encoded or not) or
 * carries a backslash or NUL. The original path is still what gets proxied.
 */
export function cleanPath(rest: string): string | null {
  let p: string
  try {
    p = decodeURIComponent(rest)
  } catch {
    return null
  }
  if (/[\\\0]/.test(p)) return null
  const parts = p.split('/').filter((s) => s && s !== '.')
  if (parts.includes('..')) return null
  return parts.join('/')
}

const ITEM = '(movie|series|artist)'
const SEARCHES = new Set(['MoviesSearch', 'SeriesSearch', 'ArtistSearch'])

export type ArrVerdict =
  | { ok: true; body?: 'command' | 'add' }
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
    const ok = [
      new RegExp(`^${ITEM}/lookup$`),
      new RegExp(`^${ITEM}(/\\d+)?$`),
      /^(qualityprofile|rootfolder|metadataprofile|queue|wanted\/missing|release|episodefile)$/,
      // Posters and artist pictures the app's lists show.
      /^mediacover\/((artist|album)\/)?\d+\/[\w-]+\.(jpg|jpeg|png|gif)$/,
    ].some((r) => r.test(path))
    return ok ? { ok: true } : { ok: false }
  }
  if (m === 'POST') {
    if (path === 'command') return { ok: true, body: 'command' }
    if (new RegExp(`^${ITEM}$`).test(path)) return { ok: true, body: 'add' }
    if (path === 'release') return { ok: true } // "Upgrade / quality": grab a listed release
    return { ok: false }
  }
  if (m === 'DELETE') {
    if (path === 'queue/bulk') return { ok: true } // cancel or retry a download
    const item = new RegExp(`^${ITEM}/(\\d+)$`).exec(path)
    if (!item) return { ok: false }
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
  return typeof body === 'object' && body !== null && SEARCHES.has(String((body as { name?: unknown }).name))
}

/** An add a non-admin may send: into one of the app's library folders, nowhere else. */
export function addAllowed(body: unknown, rootFolders: string[]): boolean {
  if (typeof body !== 'object' || body === null) return false
  const b = body as { rootFolderPath?: unknown; path?: unknown }
  const norm = (s: string) => s.replace(/\/+$/, '')
  const roots = rootFolders.map(norm)
  if (typeof b.rootFolderPath !== 'string' || !roots.includes(norm(b.rootFolderPath))) return false
  if (b.path === undefined || b.path === null || b.path === '') return true
  if (typeof b.path !== 'string' || cleanPath(b.path) === null) return false
  return roots.some((r) => b.path === r || (b.path as string).startsWith(`${r}/`))
}

/** Whether an item has anything on disk yet (then only an admin may remove it). */
export function hasFiles(item: Record<string, unknown>): boolean {
  if (item.hasFile === true) return true
  const st = (item.statistics ?? {}) as { episodeFileCount?: number; trackFileCount?: number; sizeOnDisk?: number }
  return (st.episodeFileCount ?? 0) > 0 || (st.trackFileCount ?? 0) > 0 || (st.sizeOnDisk ?? 0) > 0
}

/** SABnzbd (one endpoint, driven by ?mode=) for non-admins: the queue and its controls. */
export function sabAllowed(query: URLSearchParams): boolean {
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
