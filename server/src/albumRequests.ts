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
import { addAllowed, positiveId } from './policy.ts'
import { requestAppJson, rootFolderPaths, upstreamRecords } from './requestDefaults.ts'

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

export interface SoundtrackRow extends AlbumRow {
  artistName: string
  foreignArtistId?: string
  cover?: string
}

export interface SoundtrackQuery {
  title: string
  year?: number
  kind?: 'movie' | 'series'
  composer?: string
}

export interface SoundtrackAsk {
  foreignAlbumId: string
  albumTitle: string
  artistName?: string
  qualityProfileId: number
  rootFolderPath: string
}

/** A call to Lidarr with its key; JSON back, or an ApiError saying what to do. */
export type LidarrCall = <T>(method: string, path: string, body?: unknown) => Promise<T>

export function lidarrCaller(svc: Endpoint | undefined): LidarrCall {
  if (!svc?.url || !svc.apiKey) throw new ApiError(503, 'Music requests need Lidarr, and it isn’t set up on this server')
  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const q = path.indexOf('?')
    return await requestAppJson(svc, 'Lidarr', '/api/v1', q < 0 ? path : path.slice(0, q), {
      method, body, search: q < 0 ? '' : path.slice(q), timeoutMs: 30000,
    }) as T
  }
}

const allows = (p: MetaProfile | undefined, type: string) => Array.isArray(p?.primaryAlbumTypes) &&
  p.primaryAlbumTypes.some((t) => typeof t?.albumType?.name === 'string' && t.albumType.name.toLowerCase() === type.toLowerCase() && t.allowed === true)

/** The metadata profile for an artist asked for by one release of this type: "Albums & EPs" first, Standard if it covers it. */
export function profileFor(type: string, profiles: MetaProfile[]): MetaProfile | undefined {
  const valid = profiles.filter((p) => positiveId(p?.id) && typeof p.name === 'string' && p.name !== 'None' && allows(p, type))
  return valid.find((p) => p.name === 'Albums & EPs') ?? valid.find((p) => p.name === 'Standard') ?? valid[0]
}

const yearOf = (d?: string) => (typeof d === 'string' && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined)
const str = (v: unknown) => typeof v === 'string' && v.trim() ? v : undefined
const mbid = (value: unknown) => typeof value === 'string' && MBID.test(value) ? value.toLowerCase() : undefined
const artistIdOf = (a: LidarrAlbum) => mbid(a.artist?.foreignArtistId) ?? mbid(a.foreignArtistId)
const downloaded = (a: LidarrAlbum | undefined) => positiveId(a?.statistics?.trackFileCount)

async function lidarrList<T>(call: LidarrCall, path: string): Promise<T[]> {
  return upstreamRecords(await call('GET', path), 'Lidarr') as T[]
}

/** An artist's albums and EPs, from Lidarr's search and (if it has the artist) its own list. */
export async function artistAlbums(call: LidarrCall, foreignArtistId: string, name: string): Promise<AlbumRow[]> {
  const [found, artists] = await Promise.all([
    lidarrList<LidarrAlbum>(call, `/album/lookup?term=${encodeURIComponent(name)}`),
    lidarrList<LidarrArtist>(call, '/artist'),
  ])
  const wanted = mbid(foreignArtistId)
  const artist = wanted && artists.find((a) => positiveId(a.id) && mbid(a.foreignArtistId) === wanted)
  const own = artist ? await lidarrList<LidarrAlbum>(call, `/album?artistId=${artist.id}`) : []
  const ownById = new Map(own.map((a) => [mbid(a.foreignAlbumId), a]))
  const rows = new Map<string, AlbumRow>()
  for (const a of [...found.filter((x) => wanted && artistIdOf(x) === wanted), ...own]) {
    const id = mbid(a.foreignAlbumId)
    if (!id) continue
    const mine = ownById.get(id)
    // Seen in both lists: keep what either one knows.
    const prev = rows.get(id)
    const year = yearOf(a.releaseDate) ?? prev?.year
    rows.set(id, {
      foreignAlbumId: id,
      title: str(a.title) ?? prev?.title ?? 'Untitled',
      type: str(a.albumType) ?? prev?.type ?? 'Album',
      ...(year !== undefined ? { year } : {}),
      inLidarr: Boolean(mine),
      monitored: mine?.monitored === true,
      downloaded: downloaded(mine),
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
    lidarrList<{ id: number }>(call, '/qualityprofile'),
    call('GET', '/rootfolder').then((value) => rootFolderPaths(value, 'Lidarr')),
    lidarrList<MetaProfile>(call, '/metadataprofile'),
    lidarrList<LidarrArtist>(call, '/artist'),
    lidarrList<LidarrAlbum>(call, `/album/lookup?term=${encodeURIComponent(ask.artistName)}`),
  ])
  if (!qps.some((q) => q.id === ask.qualityProfileId)) throw new ApiError(400, 'Lidarr doesn’t have that quality profile any more. Reload and try again.')
  const root = roots.find((path) => addAllowed({ rootFolderPath: ask.rootFolderPath }, [path]))
  if (!root) throw new ApiError(400, 'Lidarr doesn’t have that music folder any more. Reload and try again.')
  const wanted = mbid(ask.foreignAlbumId)
  const album = found.find((a) => wanted && mbid(a.foreignAlbumId) === wanted)
  if (!album) throw new ApiError(404, 'Lidarr couldn’t find that release any more. Search for the artist again.')
  const type = str(album.albumType) ?? 'Album'
  const title = str(album.title) ?? 'it'
  const foreignArtist = artistIdOf(album)
  if (!foreignArtist) throw new ApiError(502, 'Lidarr sent a release without an artist. Search for the artist again.')
  const artist = artists.find((a) => positiveId(a.id) && mbid(a.foreignArtistId) === foreignArtist)
  const own = artist ? await lidarrList<LidarrAlbum>(call, `/album?artistId=${artist.id}`) : []
  const have = own.find((o) => positiveId(o.id) && mbid(o.foreignAlbumId) === wanted)
  if (have?.monitored === true && downloaded(have)) return { state: 'have', message: `“${title}” is already in your music.`, profileChanged: false }
  const current = metas.find((m) => positiveId(m.id) && m.id === artist?.metadataProfileId)
  const meta = current?.name !== 'None' && allows(current, type) ? current : profileFor(type, metas)
  if (!meta) throw new ApiError(409, `Lidarr has no metadata profile that includes ${type}s. Add one in Lidarr (Settings → Profiles → Metadata), then try again.`)
  let profileChanged = false
  if (artist) {
    // Asked for an EP of an artist whose profile leaves EPs out: this artist (only) gets one that includes them.
    if (meta !== current) {
      await call('PUT', `/artist/${artist.id}`, { ...artist, metadataProfileId: meta.id })
      profileChanged = true
    }
    if (have?.id) {
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
          rootFolderPath: root,
          monitored: true,
          monitorNewItems: 'none',
          addOptions: { monitor: 'none', searchForMissingAlbums: false },
        },
  })
  return { state: 'added', message: `Requested “${title}”. Lidarr is looking for it now.`, profileChanged }
}

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'to', 'for', 'on', 'at', 'by', 'from'])
const normWords = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

const SOUNDTRACK_HINT = /\b(soundtrack|original motion picture|original television|original series|original score|motion picture|television series|ost|music from|film score)\b/i
const COVER_PENALTY = /\b(karaoke|tribute|lullaby|lullabies|8-bit|ringtone|piano cover|guitar cover)\b/i

function pickCover(a: LidarrAlbum): string | undefined {
  const images = Array.isArray(a.images) ? (a.images as { coverType?: string; remoteUrl?: string; url?: string }[]) : []
  const cover = images.find((i) => i.coverType === 'cover') ?? images[0]
  const url = [cover?.remoteUrl, cover?.url, typeof a.remoteCover === 'string' ? a.remoteCover : undefined].find(
    (u) => typeof u === 'string' && /^https?:\/\//i.test(u),
  )
  return url
}

function hasSoundtrackSecondary(a: LidarrAlbum): boolean {
  return Array.isArray(a.secondaryTypes) && (a.secondaryTypes as unknown[]).some((t) => typeof t === 'string' && /soundtrack/i.test(t))
}

function scoreSoundtrack(a: LidarrAlbum, q: SoundtrackQuery): number {
  const albumTitle = str(a.title) ?? ''
  if (!albumTitle) return -1
  const artistName = str(a.artist?.artistName) ?? ''
  const rawTitleWords = normWords(q.title)
  const keyWords = rawTitleWords.filter((w) => w.length > 1 && !STOP_WORDS.has(w))
  const required = keyWords.length ? keyWords : rawTitleWords
  if (!required.length) return -1
  const hay = ` ${normWords(albumTitle).join(' ')} `
  const hayWithArtist = `${hay}${normWords(artistName).join(' ')} `
  const titleHits = required.filter((w) => hay.includes(` ${w} `)).length
  const anyHits = required.filter((w) => hayWithArtist.includes(` ${w} `)).length
  const fullPhrase = rawTitleWords.join(' ')
  const hasPhrase = fullPhrase.length >= 2 && hay.includes(` ${fullPhrase} `)
  if (!hasPhrase && titleHits / required.length < 0.6 && anyHits / required.length < 0.8) return -1

  let pts = hasPhrase ? 50 : Math.round((titleHits / required.length) * 40)
  if (hasSoundtrackSecondary(a)) pts += 45
  if (SOUNDTRACK_HINT.test(albumTitle)) pts += 40
  if (q.composer) {
    const cWords = normWords(q.composer).filter((w) => w.length > 2)
    const aNorm = ` ${normWords(artistName).join(' ')} `
    if (cWords.length && cWords.every((w) => aNorm.includes(` ${w} `))) pts += 30
  }
  const y = yearOf(a.releaseDate)
  if (q.year && y) {
    const diff = Math.abs(y - q.year)
    if (diff <= 1) pts += 18
    else if (diff <= 3) pts += 10
    else if (diff > 10) pts -= 8
  }
  if (str(a.albumType)?.toLowerCase() === 'album') pts += 6
  if (COVER_PENALTY.test(albumTitle) || COVER_PENALTY.test(artistName)) pts -= 40
  return pts
}

/** Searches Lidarr for the soundtrack / score of a movie or show, ranked by relevance. */
export async function findSoundtracks(call: LidarrCall, q: SoundtrackQuery): Promise<SoundtrackRow[]> {
  const title = q.title.trim()
  if (!title) return []
  const queries = [
    `${title} soundtrack`,
    `${title} ${q.kind === 'series' ? 'original television soundtrack' : 'original motion picture soundtrack'}`,
    ...(q.composer?.trim() ? [`${title} ${q.composer.trim()}`] : []),
  ]
  const [lookups, artists] = await Promise.all([
    Promise.all(queries.map((term) => lidarrList<LidarrAlbum>(call, `/album/lookup?term=${encodeURIComponent(term)}`).catch(() => [] as LidarrAlbum[]))),
    lidarrList<LidarrArtist>(call, '/artist'),
  ])
  const unique = new Map<string, LidarrAlbum>()
  for (const list of lookups) {
    for (const a of list) {
      const id = mbid(a.foreignAlbumId)
      if (!id || unique.has(id)) continue
      unique.set(id, a)
    }
  }
  const scored = [...unique.entries()]
    .map(([id, album]) => ({ id, album, score: scoreSoundtrack(album, q) }))
    .filter((x) => x.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  // Only ask Lidarr for the albums of artists that matched and are already in Lidarr.
  const artistByMbid = new Map(artists.filter((a) => positiveId(a.id) && mbid(a.foreignArtistId)).map((a) => [mbid(a.foreignArtistId)!, a]))
  const matchedArtistIds = [...new Set(scored.map((x) => artistIdOf(x.album)).filter((id): id is string => Boolean(id && artistByMbid.has(id))).map((id) => artistByMbid.get(id)!.id))]
  const ownLists = await Promise.all(matchedArtistIds.map((aid) => lidarrList<LidarrAlbum>(call, `/album?artistId=${aid}`).catch(() => [] as LidarrAlbum[])))
  const ownById = new Map(ownLists.flat().map((a) => [mbid(a.foreignAlbumId), a]))

  return scored.map(({ id, album }) => {
    const mine = ownById.get(id)
    const year = yearOf(album.releaseDate)
    const cover = pickCover(album)
    const foreignArtistId = artistIdOf(album)
    return {
      foreignAlbumId: id,
      title: str(album.title) ?? 'Soundtrack',
      artistName: str(album.artist?.artistName) ?? 'Various Artists',
      ...(foreignArtistId ? { foreignArtistId } : {}),
      type: str(album.albumType) ?? 'Album',
      ...(year !== undefined ? { year } : {}),
      ...(cover ? { cover } : {}),
      inLidarr: Boolean(mine),
      monitored: mine?.monitored === true,
      downloaded: downloaded(mine),
    }
  })
}

/** Requests one soundtrack album in Lidarr without subscribing to the composer's whole discography. */
export async function requestSoundtrack(call: LidarrCall, ask: SoundtrackAsk): Promise<{ state: 'searching' | 'added' | 'have'; message: string; profileChanged?: boolean }> {
  const wanted = mbid(ask.foreignAlbumId)
  if (!wanted) throw new ApiError(400, 'Which soundtrack?')
  const searchTerms = [`lidarr:${wanted}`, ask.albumTitle, ...(ask.artistName ? [ask.artistName] : [])].filter(Boolean)
  const [qps, roots, metas, artists] = await Promise.all([
    lidarrList<{ id: number }>(call, '/qualityprofile'),
    call('GET', '/rootfolder').then((value) => rootFolderPaths(value, 'Lidarr')),
    lidarrList<MetaProfile>(call, '/metadataprofile'),
    lidarrList<LidarrArtist>(call, '/artist'),
  ])
  if (!qps.some((q) => q.id === ask.qualityProfileId)) throw new ApiError(400, 'Lidarr doesn’t have that quality profile any more. Reload and try again.')
  const root = roots.find((path) => addAllowed({ rootFolderPath: ask.rootFolderPath }, [path]))
  if (!root) throw new ApiError(400, 'Lidarr doesn’t have that music folder any more. Reload and try again.')

  let album: LidarrAlbum | undefined
  for (const term of searchTerms) {
    const found = await lidarrList<LidarrAlbum>(call, `/album/lookup?term=${encodeURIComponent(term)}`).catch(() => [] as LidarrAlbum[])
    album = found.find((a) => mbid(a.foreignAlbumId) === wanted)
    if (album) break
  }
  if (!album) throw new ApiError(404, 'Lidarr couldn’t find that soundtrack any more. Search again.')
  const type = str(album.albumType) ?? 'Album'
  const title = str(album.title) ?? ask.albumTitle ?? 'Soundtrack'
  const foreignArtist = artistIdOf(album)
  if (!foreignArtist) throw new ApiError(502, 'Lidarr sent a soundtrack without an artist. Search again.')
  const artist = artists.find((a) => positiveId(a.id) && mbid(a.foreignArtistId) === foreignArtist)
  const own = artist ? await lidarrList<LidarrAlbum>(call, `/album?artistId=${artist.id}`) : []
  const have = own.find((o) => positiveId(o.id) && mbid(o.foreignAlbumId) === wanted)
  if (have?.monitored === true && downloaded(have)) return { state: 'have', message: `“${title}” is already in your music library.`, profileChanged: false }
  const current = metas.find((m) => positiveId(m.id) && m.id === artist?.metadataProfileId)
  const meta = current?.name !== 'None' && allows(current, type) ? current : profileFor(type, metas)
  if (!meta) throw new ApiError(409, `Lidarr has no metadata profile that includes ${type}s. Add one in Lidarr (Settings → Profiles → Metadata), then try again.`)
  let profileChanged = false
  if (artist) {
    if (meta !== current) {
      await call('PUT', `/artist/${artist.id}`, { ...artist, metadataProfileId: meta.id })
      profileChanged = true
    }
    if (have?.id) {
      await call('PUT', '/album/monitor', { albumIds: [have.id], monitored: true })
      await call('POST', '/command', { name: 'AlbumSearch', albumIds: [have.id] })
      return { state: 'searching', message: `Requested “${title}”. Lidarr is downloading it for your music library.`, profileChanged }
    }
  }
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
          rootFolderPath: root,
          monitored: true,
          monitorNewItems: 'none',
          addOptions: { monitor: 'none', searchForMissingAlbums: false },
        },
  })
  return { state: 'added', message: `Requested “${title}”. Lidarr is downloading it for your music library.`, profileChanged }
}

export function registerAlbumRequests(router: Router, deps: { settings: SettingsStore; auth: Auth; parental?: import('./parental.ts').Parental }) {
  const { settings, auth } = deps
  /** The profile is the one the sign-in was checked as. */
  const requestsOff = (user: { Id: string }) => {
    const kid = deps.parental?.limitOf(user.Id)
    if (kid && !kid.requests) throw new ApiError(403, 'Requests are off for this profile. Ask whoever runs the server.')
  }
  router.get('/api/requests/artist-albums', async ({ req, res, url }) => {
    requestsOff(await auth.requireUser(req))
    const id = url.searchParams.get('artist') ?? ''
    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 200)
    if (!MBID.test(id) || !name) throw new ApiError(400, 'Which artist?')
    sendJson(res, 200, { albums: await artistAlbums(lidarrCaller(settings.get().services.lidarr), id, name) })
  })
  router.post('/api/requests/album', async ({ req, res }) => {
    requestsOff(await auth.requireUser(req))
    const b = await readJson<Partial<AlbumAsk> | null>(req)
    if (typeof b?.foreignAlbumId !== 'string' || !MBID.test(b.foreignAlbumId)) throw new ApiError(400, 'Which album?')
    if (typeof b.artistName !== 'string' || !b.artistName.trim()) throw new ApiError(400, 'Which artist?')
    if (!positiveId(b.qualityProfileId) || typeof b.rootFolderPath !== 'string' || !b.rootFolderPath.trim() || b.rootFolderPath.length > 1000 || b.rootFolderPath.includes('\0')) {
      throw new ApiError(400, 'Missing the quality or folder')
    }
    const ask: AlbumAsk = { foreignAlbumId: b.foreignAlbumId, artistName: b.artistName.trim().slice(0, 200), qualityProfileId: b.qualityProfileId, rootFolderPath: b.rootFolderPath }
    sendJson(res, 200, await requestAlbum(lidarrCaller(settings.get().services.lidarr), ask))
  })
  router.get('/api/requests/soundtrack', async ({ req, res, url }) => {
    requestsOff(await auth.requireUser(req))
    const title = (url.searchParams.get('title') ?? '').trim().slice(0, 200)
    if (!title) throw new ApiError(400, 'Which title?')
    const rawYear = Number(url.searchParams.get('year'))
    const year = Number.isInteger(rawYear) && rawYear >= 1880 && rawYear <= 2100 ? rawYear : undefined
    const rawKind = url.searchParams.get('kind')
    const kind = rawKind === 'movie' || rawKind === 'series' ? rawKind : undefined
    const composer = (url.searchParams.get('composer') ?? '').trim().slice(0, 120) || undefined
    sendJson(res, 200, { albums: await findSoundtracks(lidarrCaller(settings.get().services.lidarr), { title, year, kind, composer }) })
  })
  router.post('/api/requests/soundtrack', async ({ req, res }) => {
    requestsOff(await auth.requireUser(req))
    const b = await readJson<Partial<SoundtrackAsk> | null>(req)
    if (typeof b?.foreignAlbumId !== 'string' || !MBID.test(b.foreignAlbumId)) throw new ApiError(400, 'Which soundtrack?')
    if (typeof b.albumTitle !== 'string' || !b.albumTitle.trim()) throw new ApiError(400, 'Which soundtrack?')
    if (!positiveId(b.qualityProfileId) || typeof b.rootFolderPath !== 'string' || !b.rootFolderPath.trim() || b.rootFolderPath.length > 1000 || b.rootFolderPath.includes('\0')) {
      throw new ApiError(400, 'Missing the quality or folder')
    }
    const ask: SoundtrackAsk = {
      foreignAlbumId: b.foreignAlbumId,
      albumTitle: b.albumTitle.trim().slice(0, 200),
      artistName: typeof b.artistName === 'string' && b.artistName.trim() ? b.artistName.trim().slice(0, 200) : undefined,
      qualityProfileId: b.qualityProfileId,
      rootFolderPath: b.rootFolderPath,
    }
    sendJson(res, 200, await requestSoundtrack(lidarrCaller(settings.get().services.lidarr), ask))
  })
}
