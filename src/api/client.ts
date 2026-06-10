import type { JfAuthResult, JfItem, JfItemsResult, JfPlaybackInfo } from './types'

const STORAGE_KEY = 'finesse.session'

export interface Session {
  server: string
  token: string
  userId: string
  userName: string
}

export const DEVICE_ID = 'finesse-web'
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
        EnableTotalRecordCount: true,
        ImageTypeLimit: 1,
      }),
  )
}

export function getItem(itemId: string) {
  return request<JfItem>(`/Users/${session!.userId}/Items/${itemId}`)
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

export function getPlaybackInfo(itemId: string, startTimeTicks = 0) {
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
