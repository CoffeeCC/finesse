// Music requests by album or EP (Lidarr). Requesting a whole artist only follows
// what Lidarr's metadata profile lets through (Standard: albums only), so an EP
// like Zombie EP never showed up. These two calls let someone see an artist's
// albums and EPs and ask for one:
//   GET  /api/requests/artist-albums?artist=<MusicBrainz id>&name=<name>
//   POST /api/requests/album { foreignAlbumId, artistName, qualityProfileId, rootFolderPath }
// The request runs here, with Lidarr's key, and only does what asking for that
// one album needs: add it (and its artist, following nothing else), or follow it
// and search if Lidarr already has it. An artist already in Lidarr whose metadata
// profile leaves that kind of release out gets a profile that includes it, but
// only for the artist being asked about, and only when someone asks; nobody
// else's artists are ever changed. Same rules as other requests: the quality
// profile and folder must be ones Lidarr has.

import type { Auth } from './auth.ts'
import type { Endpoint, SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { joinUrl } from './http/proxy.ts'

export interface LidarrAlbum {
  id?: number
  foreignAlbumId?: string
  title?: string
  albumType?: string
  releaseDate?: string
  monitored?: boolean
  artistId?: number
  foreignArtistId?: string
  artist?: { id?: number; foreignArtistId?: string; artistName?: string; metadataProfileId?: number; [k: string]: unknown }
  statistics?: { trackFileCount?: number }
  [k: string]: unknown
}
interface MetaProfile {
  id: number
  name: string
  primaryAlbumTypes?: { albumType?: { name?: string }; allowed?: boolean }[]
}
interface LidarrArtist {
  id: number
  foreignArtistId?: string
  artistName?: string
  metadataProfileId?: number
  [k: string]: unknown
}

export interface AlbumRow {
  foreignAlbumId: string
  title: string
  type: string
  year?: number
  /** Lidarr already has it (followed or not). */
  inLidarr: boolean
  monitored: boolean
  downloaded: boolean
}

/** A call to Lidarr with its key; JSON back, or an ApiError saying what to do. */
export type LidarrCall = <T>(method: string, path: string, body?: unknown) => Promise<T>

export function lidarrCaller(svc: Endpoint | undefined): LidarrCall {
  if (!svc?.url || !svc.apiKey) throw new ApiError(503, 'Music requests need Lidarr, and it isn’t set up on this server')
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    let r: Response
    try {
      const q = path.indexOf('?')
      const target = q === -1 ? joinUrl(svc.url!, `/api/v1${path}`) : joinUrl(svc.url!, `/api/v1${path.slice(0, q)}`, path.slice(q))
      r = await fetch(target, {
        method,
        headers: { 'x-api-key': svc.apiKey!, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })
    } catch {
      throw new ApiError(502, 'Lidarr isn’t answering. Check it’s running, then try again.')
    }
    const text = await r.text()
    if (!r.ok) {
      let msg = ''
      try {
        const j = JSON.parse(text) as { message?: string } | { errorMessage?: string }[]
        msg = Array.isArray(j) ? (j[0]?.errorMessage ?? '') : (j.message ?? '')
      } catch {
        /* not JSON */
      }
      throw new ApiError(502, `Lidarr said no${msg ? `: ${msg}` : ` (${r.status})`}.`)
    }
    return (text ? JSON.parse(text) : undefined) as T
  }
}

const allows = (p: MetaProfile | undefined, type: string) => Boolean(p?.primaryAlbumTypes?.some((t) => t.albumType?.name?.toLowerCase() === type.toLowerCase() && t.allowed))

/** The metadata profile for an artist asked for by one release of this type: "Albums & EPs" first, Standard if it covers it. */
export function profileFor(type: string, profiles: MetaProfile[]): MetaProfile | undefined {
  const ordered = [...profiles.filter((p) => p.name === 'Albums & EPs'), ...profiles.filter((p) => p.name === 'Standard'), ...profiles.filter((p) => p.name !== 'None')]
  return ordered.find((p) => allows(p, type))
}

const yearOf = (d?: string) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined)
const artistIdOf = (a: LidarrAlbum) => a.artist?.foreignArtistId ?? a.foreignArtistId

/** An artist's albums and EPs, from Lidarr's search and (if it has the artist) its own list. */
export async function artistAlbums(call: LidarrCall, foreignArtistId: string, name: string): Promise<AlbumRow[]> {
  const [found, artists] = await Promise.all([
    call<LidarrAlbum[]>('GET', `/album/lookup?term=${encodeURIComponent(name)}`).catch(() => [] as LidarrAlbum[]),
    call<LidarrArtist[]>('GET', '/artist'),
  ])
  const artist = artists.find((a) => a.foreignArtistId === foreignArtistId)
  const own = artist ? await call<LidarrAlbum[]>('GET', `/album?artistId=${artist.id}`) : []
  const rows = new Map<string, AlbumRow>()
  for (const a of [...found.filter((x) => artistIdOf(x) === foreignArtistId), ...own]) {
    if (!a.foreignAlbumId) continue
    const mine = own.find((o) => o.foreignAlbumId === a.foreignAlbumId)
    // Seen in both lists: keep what either one knows.
    const prev = rows.get(a.foreignAlbumId)
    const year = yearOf(a.releaseDate) ?? prev?.year
    rows.set(a.foreignAlbumId, {
      foreignAlbumId: a.foreignAlbumId,
      title: a.title ?? prev?.title ?? 'Untitled',
      type: a.albumType ?? prev?.type ?? 'Album',
      ...(year !== undefined ? { year } : {}),
      inLidarr: Boolean(mine),
      monitored: Boolean(mine?.monitored),
      downloaded: (mine?.statistics?.trackFileCount ?? 0) > 0,
    })
  }
  // Albums and EPs first (what people mean), newest first.
  const rank = (t: string) => (t === 'Album' ? 0 : t === 'EP' ? 1 : 2)
  return [...rows.values()].sort((x, y) => rank(x.type) - rank(y.type) || (y.year ?? 0) - (x.year ?? 0))
}

export interface AlbumAsk {
  foreignAlbumId: string
  artistName: string
  qualityProfileId: number
  rootFolderPath: string
}

/** Asks Lidarr for one album or EP. Says what happened, plainly. */
export async function requestAlbum(call: LidarrCall, ask: AlbumAsk): Promise<{ state: 'searching' | 'added' | 'have'; message: string; profileChanged?: boolean }> {
  const [qps, roots, metas, artists, found] = await Promise.all([
    call<{ id: number }[]>('GET', '/qualityprofile'),
    call<{ path: string }[]>('GET', '/rootfolder'),
    call<MetaProfile[]>('GET', '/metadataprofile'),
    call<LidarrArtist[]>('GET', '/artist'),
    call<LidarrAlbum[]>('GET', `/album/lookup?term=${encodeURIComponent(ask.artistName)}`),
  ])
  if (!qps.some((q) => q.id === ask.qualityProfileId)) throw new ApiError(400, 'Lidarr doesn’t have that quality profile any more. Reload and try again.')
  const trim = (s: string) => s.replace(/[\\/]+$/, '')
  if (!roots.some((r) => trim(r.path) === trim(ask.rootFolderPath))) throw new ApiError(400, 'Lidarr doesn’t have that music folder any more. Reload and try again.')
  const album = found.find((a) => a.foreignAlbumId === ask.foreignAlbumId)
  if (!album) throw new ApiError(404, 'Lidarr couldn’t find that release any more. Search for the artist again.')
  const type = album.albumType ?? 'Album'
  const title = album.title ?? 'it'
  const meta = profileFor(type, metas)
  if (!meta) throw new ApiError(409, `Lidarr has no metadata profile that includes ${type}s. Add one in Lidarr (Settings → Profiles → Metadata), then try again.`)

  const artist = artists.find((a) => a.foreignArtistId === artistIdOf(album))
  let profileChanged = false
  if (artist) {
    // Asked for an EP of an artist whose profile leaves EPs out: this artist (only) gets one that includes them.
    const current = metas.find((m) => m.id === artist.metadataProfileId)
    if (!allows(current, type)) {
      await call('PUT', `/artist/${artist.id}`, { ...artist, metadataProfileId: meta.id })
      profileChanged = true
    }
    const own = await call<LidarrAlbum[]>('GET', `/album?artistId=${artist.id}`)
    const have = own.find((o) => o.foreignAlbumId === ask.foreignAlbumId)
    if (have?.id) {
      if ((have.statistics?.trackFileCount ?? 0) > 0 && have.monitored) return { state: 'have', message: `“${title}” is already in your music.`, profileChanged }
      await call('PUT', '/album/monitor', { albumIds: [have.id], monitored: true })
      await call('POST', '/command', { name: 'AlbumSearch', albumIds: [have.id] })
      return { state: 'searching', message: `Requested “${title}”. Lidarr is looking for it now.`, profileChanged }
    }
  }
  // Not in Lidarr yet: add this release (and its artist if new, following nothing else of theirs).
  await call('POST', '/album', {
    ...album,
    monitored: true,
    addOptions: { searchForNewAlbum: true },
    artist: artist
      ? { ...artist, metadataProfileId: profileChanged ? meta.id : artist.metadataProfileId }
      : {
          ...(album.artist ?? {}),
          qualityProfileId: ask.qualityProfileId,
          metadataProfileId: meta.id,
          rootFolderPath: ask.rootFolderPath,
          monitored: true,
          monitorNewItems: 'none',
          addOptions: { monitor: 'none', searchForMissingAlbums: false },
        },
  })
  return { state: 'added', message: `Requested “${title}”. Lidarr is looking for it now.`, profileChanged }
}

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerAlbumRequests(router: Router, deps: { settings: SettingsStore; auth: Auth; parental?: import('./parental.ts').Parental }) {
  const { settings, auth } = deps
  const requestsOff = async (req: import('node:http').IncomingMessage) => {
    const kid = await deps.parental?.limitedIn(req)
    if (kid && !kid.limit.requests) throw new ApiError(403, 'Requests are off for this profile. Ask whoever runs the server.')
  }
  router.get('/api/requests/artist-albums', async ({ req, res, url }) => {
    await auth.requireUser(req)
    await requestsOff(req)
    const id = url.searchParams.get('artist') ?? ''
    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 200)
    if (!MBID.test(id) || !name) throw new ApiError(400, 'Which artist?')
    sendJson(res, 200, { albums: await artistAlbums(lidarrCaller(settings.get().services.lidarr), id, name) })
  })
  router.post('/api/requests/album', async ({ req, res }) => {
    await auth.requireUser(req)
    await requestsOff(req)
    const b = await readJson<Partial<AlbumAsk>>(req)
    if (typeof b.foreignAlbumId !== 'string' || !MBID.test(b.foreignAlbumId)) throw new ApiError(400, 'Which album?')
    if (typeof b.artistName !== 'string' || !b.artistName.trim()) throw new ApiError(400, 'Which artist?')
    if (typeof b.qualityProfileId !== 'number' || typeof b.rootFolderPath !== 'string') throw new ApiError(400, 'Missing the quality or folder')
    const ask: AlbumAsk = { foreignAlbumId: b.foreignAlbumId, artistName: b.artistName.trim().slice(0, 200), qualityProfileId: b.qualityProfileId, rootFolderPath: b.rootFolderPath }
    sendJson(res, 200, await requestAlbum(lidarrCaller(settings.get().services.lidarr), ask))
  })
}
