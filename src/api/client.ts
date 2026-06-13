import type { JfAuthResult, JfItem, JfItemsResult, JfPlaybackInfo } from './types'

const STORAGE_KEY = 'finesse.session'

export interface Session {
  server: string
  token: string
  userId: string
  userName: string
}

// Jellyfin revokes the previous access token when the same DeviceId
// re-authenticates, so the id must be unique per browser install.
// NOTE: crypto.randomUUID() only exists in secure contexts (HTTPS/localhost).
// Finesse is also served over plain HTTP on the LAN (http://192.168.1.121:30500),
// where it's undefined — calling it would throw at module load and blank the app.
// getRandomValues IS available in insecure contexts, so build the id from that.
function randomDeviceUUID(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  try {
    if (typeof c?.randomUUID === 'function') {
      return c.randomUUID()
    }
    if (c?.getRandomValues) {
      const b = c.getRandomValues(new Uint8Array(16))
      b[6] = (b[6] & 0x0f) | 0x40
      b[8] = (b[8] & 0x3f) | 0x80
      const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

export const DEVICE_ID = (() => {
  const KEY = 'finesse.deviceId'
  let id: string | null = null
  try {
    id = localStorage.getItem(KEY)
  } catch {
    /* localStorage may be unavailable; fall back to an ephemeral id */
  }
  if (!id) {
    id = `finesse-${randomDeviceUUID()}`
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* ignore */
    }
  }
  return id
})()
const CLIENT_VERSION = '0.1.0'

let session: Session | null = loadSession()

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function getSession(): Session | null {
  return session
}

export function setSession(s: Session | null) {
  session = s
  if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  else localStorage.removeItem(STORAGE_KEY)
}

function authHeader(token?: string): string {
  const parts = [
    `Client="Finesse"`,
    `Device="Web"`,
    `DeviceId="${DEVICE_ID}"`,
    `Version="${CLIENT_VERSION}"`,
  ]
  if (token) parts.push(`Token="${token}"`)
  return `MediaBrowser ${parts.join(', ')}`
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; server?: string; token?: string } = {},
): Promise<T> {
  const base = opts.server ?? session?.server
  if (!base) throw new ApiError(0, 'Not connected to a server')
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: authHeader(opts.token ?? session?.token),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 401 && session) {
    setSession(null)
    window.location.href = '/login'
    throw new ApiError(401, 'Session expired')
  }
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}

// ---------- Auth ----------

export interface JfPublicUser {
  Id: string
  Name: string
  PrimaryImageTag?: string
  HasPassword?: boolean
}

export function getPublicUsers(server: string) {
  return request<JfPublicUser[]>('/Users/Public', { server: server.replace(/\/+$/, '') })
}

export function publicUserImageUrl(server: string, userId: string, tag?: string): string {
  return `${server.replace(/\/+$/, '')}/Users/${userId}/Images/Primary` + qs({ tag, maxWidth: 200 })
}

export async function login(server: string, username: string, password: string): Promise<Session> {
  const result = await request<JfAuthResult>('/Users/AuthenticateByName', {
    method: 'POST',
    server,
    body: { Username: username, Pw: password },
  })
  const s: Session = {
    server,
    token: result.AccessToken,
    userId: result.User.Id,
    userName: result.User.Name,
  }
  setSession(s)
  return s
}

export function logout() {
  request('/Sessions/Logout', { method: 'POST' }).catch(() => {})
  setSession(null)
}

// ---------- Browse ----------

export function getViews() {
  return request<JfItemsResult>(`/Users/${session!.userId}/Views`)
}

export interface ItemsQuery {
  parentId?: string
  includeItemTypes?: string
  recursive?: boolean
  sortBy?: string
  sortOrder?: string
  startIndex?: number
  limit?: number
  searchTerm?: string
  fields?: string
  enableImages?: boolean
  enableUserData?: boolean
  filters?: string
  ids?: string
  personIds?: string
  genres?: string
  years?: string
}

export function getItems(q: ItemsQuery) {
  return request<JfItemsResult>(
    `/Users/${session!.userId}/Items` +
      qs({
        ParentId: q.parentId,
        IncludeItemTypes: q.includeItemTypes,
        Recursive: q.recursive,
        SortBy: q.sortBy,
        SortOrder: q.sortOrder,
        StartIndex: q.startIndex,
        Limit: q.limit,
        SearchTerm: q.searchTerm,
        Fields: q.fields,
        EnableImages: q.enableImages,
        EnableUserData: q.enableUserData,
        Filters: q.filters,
        Ids: q.ids,
        PersonIds: q.personIds,
        Genres: q.genres,
        Years: q.years,
        EnableTotalRecordCount: true,
        ImageTypeLimit: 1,
      }),
  )
}

export function getItem(itemId: string) {
  return request<JfItem>(
    `/Users/${session!.userId}/Items/${itemId}` + qs({ Fields: 'Trickplay,Path' }),
  )
}

// ---------- Metadata management ----------

export interface JfRemoteSearchResult {
  Name: string
  ProductionYear?: number
  ImageUrl?: string
  Overview?: string
  SearchProviderName?: string
  ProviderIds?: Record<string, string>
  PremiereDate?: string
}

/** Search metadata providers for candidate matches (movies and series). */
export function remoteSearch(item: { Id: string; Type: string }, name: string, year?: number) {
  const kind = item.Type === 'Series' ? 'Series' : 'Movie'
  return request<JfRemoteSearchResult[]>(`/Items/RemoteSearch/${kind}`, {
    method: 'POST',
    body: {
      ItemId: item.Id,
      SearchInfo: { Name: name, Year: year },
    },
  })
}

/** Re-identify the item as the chosen search result, replacing images. */
export function applyRemoteResult(itemId: string, result: JfRemoteSearchResult) {
  return request(`/Items/RemoteSearch/Apply/${itemId}` + qs({ ReplaceAllImages: true }), {
    method: 'POST',
    body: result,
  })
}

/** Full metadata + image refresh from providers. */
export function refreshItemMetadata(itemId: string) {
  return request(
    `/Items/${itemId}/Refresh` +
      qs({
        metadataRefreshMode: 'FullRefresh',
        imageRefreshMode: 'FullRefresh',
        replaceAllMetadata: true,
        replaceAllImages: true,
      }),
    { method: 'POST' },
  )
}

export function trickplayTileUrl(itemId: string, width: number, tileIndex: number, mediaSourceId: string): string {
  return (
    `${session!.server}/Videos/${itemId}/Trickplay/${width}/${tileIndex}.jpg` +
    qs({ MediaSourceId: mediaSourceId, api_key: session!.token })
  )
}

export function getResume() {
  return request<JfItemsResult>(
    `/Users/${session!.userId}/Items/Resume` +
      qs({ Limit: 20, MediaTypes: 'Video', Fields: 'PrimaryImageAspectRatio,ProductionYear' }),
  )
}

export function getNextUp() {
  return request<JfItemsResult>(
    '/Shows/NextUp' +
      qs({
        UserId: session!.userId,
        Limit: 20,
        Fields: 'PrimaryImageAspectRatio,SeriesPrimaryImageTag',
        ImageTypeLimit: 1,
      }),
  )
}

export function getLatest(parentId: string, limit = 20) {
  return request<JfItem[]>(
    `/Users/${session!.userId}/Items/Latest` +
      qs({ ParentId: parentId, Limit: limit, Fields: 'PrimaryImageAspectRatio,ProductionYear' }),
  )
}

export function getGenres(parentId: string) {
  return request<JfItemsResult>(
    '/Genres' +
      qs({
        ParentId: parentId,
        UserId: session!.userId,
        Recursive: true,
        SortBy: 'SortName',
        EnableTotalRecordCount: false,
        EnableImages: false,
      }),
  )
}

export function getSimilar(itemId: string, limit = 20) {
  return request<JfItemsResult>(
    `/Items/${itemId}/Similar` +
      qs({
        UserId: session!.userId,
        Limit: limit,
        Fields: 'PrimaryImageAspectRatio,ProductionYear',
      }),
  )
}

export function setFavorite(itemId: string, favorite: boolean) {
  return request<unknown>(`/Users/${session!.userId}/FavoriteItems/${itemId}`, {
    method: favorite ? 'POST' : 'DELETE',
  })
}

export interface JfMediaSegment {
  Id: string
  ItemId: string
  Type: string // 'Intro' | 'Outro' | ...
  StartTicks: number
  EndTicks: number
}

export function getMediaSegments(itemId: string) {
  return request<{ Items: JfMediaSegment[] }>(
    `/MediaSegments/${itemId}` +
      qs({ includeSegmentTypes: 'Intro' }) +
      '&includeSegmentTypes=Outro',
  )
}

export function getSeasons(seriesId: string) {
  return request<JfItemsResult>(
    `/Shows/${seriesId}/Seasons` + qs({ UserId: session!.userId, Fields: 'ItemCounts' }),
  )
}

export function getEpisodes(seriesId: string, seasonId: string) {
  return request<JfItemsResult>(
    `/Shows/${seriesId}/Episodes` +
      qs({ UserId: session!.userId, SeasonId: seasonId, Fields: 'Overview' }),
  )
}

// ---------- Playback ----------

const DEVICE_PROFILE = {
  MaxStreamingBitrate: 120_000_000,
  DirectPlayProfiles: [
    { Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3,flac,opus' },
    { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'vorbis,opus' },
  ],
  TranscodingProfiles: [
    {
      Container: 'ts',
      Type: 'Video',
      VideoCodec: 'h264',
      AudioCodec: 'aac,mp3',
      Protocol: 'hls',
      Context: 'Streaming',
      MaxAudioChannels: '2',
      MinSegments: 1,
      BreakOnNonKeyFrames: true,
    },
    { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Protocol: 'http', Context: 'Streaming' },
  ],
  SubtitleProfiles: [
    { Format: 'vtt', Method: 'External' },
    { Format: 'subrip', Method: 'External' },
  ],
  CodecProfiles: [],
  ResponseProfiles: [],
}

export function getPlaybackInfo(
  itemId: string,
  startTimeTicks = 0,
  audioStreamIndex?: number,
  subtitleStreamIndex?: number,
) {
  return request<JfPlaybackInfo>(
    `/Items/${itemId}/PlaybackInfo` + qs({ UserId: session!.userId }),
    {
      method: 'POST',
      body: {
        UserId: session!.userId,
        StartTimeTicks: startTimeTicks,
        DeviceProfile: DEVICE_PROFILE,
        AutoOpenLiveStream: true,
        EnableDirectPlay: true,
        EnableDirectStream: true,
        EnableTranscoding: true,
        ...(audioStreamIndex !== undefined ? { AudioStreamIndex: audioStreamIndex } : {}),
        ...(subtitleStreamIndex !== undefined ? { SubtitleStreamIndex: subtitleStreamIndex } : {}),
      },
    },
  )
}

export function directStreamUrl(itemId: string, mediaSourceId: string, container?: string): string {
  const ext = container?.split(',')[0] || 'mp4'
  return (
    `${session!.server}/Videos/${itemId}/stream.${ext}` +
    qs({ static: true, mediaSourceId, api_key: session!.token, deviceId: DEVICE_ID })
  )
}

export function transcodeUrl(transcodingUrl: string): string {
  const url = `${session!.server}${transcodingUrl}`
  return url.includes('api_key') ? url : `${url}&api_key=${session!.token}`
}

interface PlaybackReport {
  itemId: string
  mediaSourceId: string
  playSessionId: string
  positionTicks: number
  isPaused?: boolean
}

export function reportPlaybackStart(r: PlaybackReport) {
  return request('/Sessions/Playing', {
    method: 'POST',
    body: {
      ItemId: r.itemId,
      MediaSourceId: r.mediaSourceId,
      PlaySessionId: r.playSessionId,
      PositionTicks: r.positionTicks,
      CanSeek: true,
      PlayMethod: 'DirectPlay',
    },
  }).catch(() => {})
}

export function reportPlaybackProgress(r: PlaybackReport) {
  return request('/Sessions/Playing/Progress', {
    method: 'POST',
    body: {
      ItemId: r.itemId,
      MediaSourceId: r.mediaSourceId,
      PlaySessionId: r.playSessionId,
      PositionTicks: r.positionTicks,
      IsPaused: r.isPaused ?? false,
      CanSeek: true,
    },
  }).catch(() => {})
}

export function reportPlaybackStopped(r: PlaybackReport) {
  return request('/Sessions/Playing/Stopped', {
    method: 'POST',
    body: {
      ItemId: r.itemId,
      MediaSourceId: r.mediaSourceId,
      PlaySessionId: r.playSessionId,
      PositionTicks: r.positionTicks,
    },
  }).catch(() => {})
}

export function stopActiveEncoding(playSessionId: string) {
  return request(
    '/Videos/ActiveEncodings' + qs({ deviceId: DEVICE_ID, playSessionId }),
    { method: 'DELETE' },
  ).catch(() => {})
}

// ---------- Images ----------

export interface ImageOpts {
  maxWidth?: number
  maxHeight?: number
  tag?: string
  quality?: number
}

export function imageUrl(itemId: string, type: string, opts: ImageOpts = {}): string {
  if (!session) return ''
  return (
    `${session.server}/Items/${itemId}/Images/${type}` +
    qs({
      maxWidth: opts.maxWidth,
      maxHeight: opts.maxHeight,
      tag: opts.tag,
      quality: opts.quality ?? 90,
      api_key: session.token,
    })
  )
}

export function splashscreenUrl(server: string): string {
  return `${server}/Branding/Splashscreen?format=jpg&quality=90`
}

/** Best primary (poster) image for an item, falling back to series art for episodes. */
export function posterUrl(item: {
  Id: string
  ImageTags?: Record<string, string>
  SeriesId?: string
  SeriesPrimaryImageTag?: string
}, maxWidth = 360): string | null {
  if (item.ImageTags?.Primary) {
    return imageUrl(item.Id, 'Primary', { maxWidth, tag: item.ImageTags.Primary })
  }
  if (item.SeriesId && item.SeriesPrimaryImageTag) {
    return imageUrl(item.SeriesId, 'Primary', { maxWidth, tag: item.SeriesPrimaryImageTag })
  }
  return null
}

/** Best wide/backdrop image: own backdrop, parent backdrop, or own thumb. */
export function backdropUrl(item: {
  Id: string
  BackdropImageTags?: string[]
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  ImageTags?: Record<string, string>
}, maxWidth = 1920): string | null {
  if (item.BackdropImageTags?.length) {
    return imageUrl(item.Id, 'Backdrop', { maxWidth, tag: item.BackdropImageTags[0] })
  }
  if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
    return imageUrl(item.ParentBackdropItemId, 'Backdrop', {
      maxWidth,
      tag: item.ParentBackdropImageTags[0],
    })
  }
  if (item.ImageTags?.Thumb) {
    return imageUrl(item.Id, 'Thumb', { maxWidth, tag: item.ImageTags.Thumb })
  }
  return null
}

/** Episode thumbnail: own primary (16:9 for episodes), else series backdrop. */
export function episodeThumbUrl(item: {
  Id: string
  ImageTags?: Record<string, string>
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
}, maxWidth = 480): string | null {
  if (item.ImageTags?.Primary) {
    return imageUrl(item.Id, 'Primary', { maxWidth, tag: item.ImageTags.Primary })
  }
  return backdropUrl(item, maxWidth)
}

export function logoUrl(item: { Id: string; ImageTags?: Record<string, string> }, maxWidth = 500): string | null {
  if (item.ImageTags?.Logo) {
    return imageUrl(item.Id, 'Logo', { maxWidth, tag: item.ImageTags.Logo })
  }
  return null
}
