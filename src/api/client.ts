import type { JfAuthResult, JfItem, JfItemsResult, JfPlaybackInfo } from './types'
import { getPrefs } from '../lib/settings'

const STORAGE_KEY = 'finesse.session'

export interface Session {
  server: string
  token: string
  userId: string
  userName: string
  isAdmin: boolean
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

/** The MediaBrowser auth header for the current session — reused by the Radarr/
 *  Sonarr request proxy so its nginx auth_request can validate the same token. */
export function mediaBrowserAuthHeader(): string {
  return authHeader(session?.token)
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
    if (__WEBOS__) {
      // file:// + HashRouter on webOS — path navigation would leave the app.
      window.location.hash = '#/login'
      window.location.reload()
    } else {
      window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/login`
    }
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
    isAdmin: result.User.Policy?.IsAdministrator ?? false,
  }
  setSession(s)
  return s
}

/** Admin-only: create a new Jellyfin user. Password is optional — an account
 *  with no password shows up as a one-click profile, same as the others on
 *  the login screen. Throws ApiError(400) if the username is taken. */
export async function createUser(input: { name: string; password?: string }) {
  const user = await request<{ Id: string; Name: string; Policy: Record<string, unknown> }>(
    '/Users/New',
    { method: 'POST', body: { Name: input.name, Password: input.password || undefined } },
  )
  // Jellyfin creates new users hidden from the login picker by default.
  // Unhide so the account actually appears, matching the form's promise.
  // The Policy endpoint replaces the whole object, so round-trip it rather
  // than sending a partial body (a partial would reset unrelated fields).
  await request(`/Users/${user.Id}/Policy`, {
    method: 'POST',
    body: { ...user.Policy, IsHidden: false },
  })
  return user
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
  tags?: string
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
        Tags: q.tags,
        EnableTotalRecordCount: true,
        ImageTypeLimit: 1,
      }),
  )
}

export function getItem(itemId: string) {
  return request<JfItem>(
    `/Users/${session!.userId}/Items/${itemId}` + qs({ Fields: 'Trickplay,Path,RemoteTrailers' }),
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

/**
 * Re-identify and metadata refresh are async on the server. Poll the item
 * until its primary image tag changes from the baseline (meaning new art
 * landed), so callers know when it's safe to repaint. Bounded; resolves with
 * the fresh item or null on timeout.
 */
export async function waitForImageChange(
  itemId: string,
  previousPrimaryTag: string | undefined,
  { tries = 15, intervalMs = 2000 }: { tries?: number; intervalMs?: number } = {},
): Promise<JfItem | null> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, intervalMs))
    try {
      const item = await getItem(itemId)
      const tag = item.ImageTags?.Primary
      if (tag && tag !== previousPrimaryTag) return item
    } catch {
      /* keep polling */
    }
  }
  return null
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

export interface JfSession {
  Id: string
  DeviceId?: string
  DeviceName?: string
  Client?: string
  UserId?: string
  NowPlayingItem?: JfItem
  PlayState?: { PositionTicks?: number; IsPaused?: boolean }
  LastActivityDate?: string
  SupportsRemoteControl?: boolean
  PlayableMediaTypes?: string[]
}

/** All sessions; used to detect playback on the user's other devices (handoff). */
export function getSessions() {
  return request<JfSession[]>('/Sessions')
}

/** Other devices this user can drive from here ("Play on TV"). Server-filtered to
 *  controllable sessions; we still drop this device and ones that can't play video. */
export async function getCastTargets(): Promise<JfSession[]> {
  const sessions = await request<JfSession[]>(
    '/Sessions' + qs({ ControllableByUserId: session!.userId, ActiveWithinSeconds: 600 }),
  )
  return sessions.filter(
    (s) =>
      s.DeviceId !== DEVICE_ID &&
      s.SupportsRemoteControl &&
      (s.PlayableMediaTypes?.some((m) => m.toLowerCase() === 'video') ?? true),
  )
}

/** Push playback to another device: tell it to play the item now, at an optional resume point. */
export function playOnSession(sessionId: string, itemId: string, startPositionTicks = 0) {
  return request(
    `/Sessions/${sessionId}/Playing` +
      qs({ playCommand: 'PlayNow', itemIds: itemId, startPositionTicks }),
    { method: 'POST' },
  )
}

/** Tell another device to stop (used when handing playback off to this one). */
export function sendStopToSession(sessionId: string) {
  return request(`/Sessions/${sessionId}/Playing/Stop`, { method: 'POST' }).catch(() => {})
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

/** The next episode to watch for one series (resume point or first unwatched). */
export function getSeriesNextUp(seriesId: string) {
  return request<JfItemsResult>(
    '/Shows/NextUp' +
      qs({
        UserId: session!.userId,
        SeriesId: seriesId,
        Limit: 1,
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

// ---------- Watchlist ----------
// Jellyfin has no native watchlist (Favorites is separate, and Playlists explode a
// Series into its episodes). We keep a per-user list of item IDs in DisplayPreferences
// CustomPrefs — server-side, so it syncs across the user's devices. Newest first.

const WATCHLIST_DP = 'finesse-watchlist'

interface JfDisplayPreferences {
  CustomPrefs?: Record<string, string>
  [k: string]: unknown
}

function watchlistDpPath(): string {
  return `/DisplayPreferences/${WATCHLIST_DP}` + qs({ userId: session!.userId, client: 'finesse' })
}

export async function getWatchlistIds(): Promise<string[]> {
  try {
    const dp = await request<JfDisplayPreferences>(watchlistDpPath())
    const raw = dp?.CustomPrefs?.watchlist
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}

/** Add/remove an item, returning the new id list. Read-modify-write on the stored prefs. */
export async function setInWatchlist(itemId: string, add: boolean): Promise<string[]> {
  const dp = (await request<JfDisplayPreferences>(watchlistDpPath()).catch(() => ({}))) as JfDisplayPreferences
  const raw = dp.CustomPrefs?.watchlist
  const current: string[] = raw ? (JSON.parse(raw) as string[]) : []
  const next = add
    ? [itemId, ...current.filter((id) => id !== itemId)]
    : current.filter((id) => id !== itemId)
  dp.CustomPrefs = { ...(dp.CustomPrefs ?? {}), watchlist: JSON.stringify(next) }
  await request(watchlistDpPath(), { method: 'POST', body: dp })
  return next
}

// ---------- Per-series track memory (audio/subtitle preference) ----------
// Remember the audio + subtitle language a user picks for a series, so every
// episode defaults to it. Stored per-user in DisplayPreferences (syncs devices).
// subLang === 'off' means the user explicitly turned subtitles off for the series.

const TRACKPREFS_DP = 'finesse-trackprefs'

export interface TrackPref {
  audioLang?: string
  subLang?: string // language code, or 'off'
}

function trackPrefsDpPath(): string {
  return `/DisplayPreferences/${TRACKPREFS_DP}` + qs({ userId: session!.userId, client: 'finesse' })
}

export async function getTrackPrefs(): Promise<Record<string, TrackPref>> {
  try {
    const dp = await request<JfDisplayPreferences>(trackPrefsDpPath())
    const raw = dp?.CustomPrefs?.tracks
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? (obj as Record<string, TrackPref>) : {}
  } catch {
    return {}
  }
}

export async function saveTrackPref(seriesId: string, pref: TrackPref): Promise<void> {
  const dp = (await request<JfDisplayPreferences>(trackPrefsDpPath()).catch(() => ({}))) as JfDisplayPreferences
  const raw = dp.CustomPrefs?.tracks
  const all: Record<string, TrackPref> = raw ? JSON.parse(raw) : {}
  all[seriesId] = pref
  dp.CustomPrefs = { ...(dp.CustomPrefs ?? {}), tracks: JSON.stringify(all) }
  await request(trackPrefsDpPath(), { method: 'POST', body: dp })
}

// ---------- UI prefs (accent color) ----------
// Per-user UI settings stored in DisplayPreferences so they sync across devices.

const UI_DP = 'finesse-ui'

function uiDpPath(): string {
  return `/DisplayPreferences/${UI_DP}` + qs({ userId: session!.userId, client: 'finesse' })
}

export async function getAccentPref(): Promise<string | null> {
  try {
    const dp = await request<JfDisplayPreferences>(uiDpPath())
    return dp?.CustomPrefs?.accent ?? null
  } catch {
    return null
  }
}

export async function setAccentPref(name: string): Promise<void> {
  const dp = (await request<JfDisplayPreferences>(uiDpPath()).catch(() => ({}))) as JfDisplayPreferences
  dp.CustomPrefs = { ...(dp.CustomPrefs ?? {}), accent: name }
  await request(uiDpPath(), { method: 'POST', body: dp })
}

export async function getPreviewQualityPref(): Promise<string | null> {
  try {
    const dp = await request<JfDisplayPreferences>(uiDpPath())
    return dp?.CustomPrefs?.previewQuality ?? null
  } catch {
    return null
  }
}

export async function setPreviewQualityPref(quality: string): Promise<void> {
  const dp = (await request<JfDisplayPreferences>(uiDpPath()).catch(() => ({}))) as JfDisplayPreferences
  dp.CustomPrefs = { ...(dp.CustomPrefs ?? {}), previewQuality: quality }
  await request(uiDpPath(), { method: 'POST', body: dp })
}

// ---------- Home layout (per-account customization) ----------
// Which home rows are hidden/collapsed and their order. Stored per-user in
// DisplayPreferences so each profile gets its own home screen, synced across devices.

const HOME_DP = 'finesse-home'

export interface HomeLayout {
  hidden: string[]
  collapsed: string[]
  order: string[]
  /** Extra genre rows the user added beyond the defaults. */
  added: string[]
}

const EMPTY_LAYOUT: HomeLayout = { hidden: [], collapsed: [], order: [], added: [] }

function homeDpPath(): string {
  return `/DisplayPreferences/${HOME_DP}` + qs({ userId: session!.userId, client: 'finesse' })
}

export async function getHomeLayout(): Promise<HomeLayout> {
  try {
    const dp = await request<JfDisplayPreferences>(homeDpPath())
    const raw = dp?.CustomPrefs?.layout
    const obj = raw ? JSON.parse(raw) : {}
    return { ...EMPTY_LAYOUT, ...obj }
  } catch {
    return { ...EMPTY_LAYOUT }
  }
}

export async function saveHomeLayout(layout: HomeLayout): Promise<void> {
  const dp = (await request<JfDisplayPreferences>(homeDpPath()).catch(() => ({}))) as JfDisplayPreferences
  dp.CustomPrefs = { ...(dp.CustomPrefs ?? {}), layout: JSON.stringify(layout) }
  await request(homeDpPath(), { method: 'POST', body: dp })
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

// Built per-request so the user's bitrate cap (from settings) is applied.
// A cap forces the server to transcode down to fit; 0 = unlimited/direct.
function buildDeviceProfile() {
  const cap = getPrefs().maxBitrate
  const videoTranscode: Record<string, unknown> = {
    Container: 'ts',
    Type: 'Video',
    VideoCodec: 'h264',
    AudioCodec: 'aac,mp3',
    Protocol: 'hls',
    Context: 'Streaming',
    MaxAudioChannels: '2',
    MinSegments: 1,
    BreakOnNonKeyFrames: true,
  }
  return {
    MaxStreamingBitrate: cap > 0 ? cap : 120_000_000,
    MusicStreamingTranscodingBitrate: 320_000,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3,flac,opus' },
      { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'vorbis,opus' },
    ],
    TranscodingProfiles: [
      videoTranscode,
      { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Protocol: 'http', Context: 'Streaming' },
    ],
    SubtitleProfiles: [
      // Encode first so PlaybackInfo can burn-in when SubtitleMethod=Encode.
      { Format: 'vtt', Method: 'Encode' },
      { Format: 'subrip', Method: 'Encode' },
      { Format: 'srt', Method: 'Encode' },
      { Format: 'ass', Method: 'Encode' },
      { Format: 'ssa', Method: 'Encode' },
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
      // External for direct-play + blob <track> path.
      { Format: 'vtt', Method: 'External' },
      { Format: 'subrip', Method: 'External' },
      { Format: 'srt', Method: 'External' },
      { Format: 'ass', Method: 'External' },
      { Format: 'ssa', Method: 'External' },
    ],
    CodecProfiles: [],
    ResponseProfiles: [],
  }
}

export function getPlaybackInfo(
  itemId: string,
  startTimeTicks = 0,
  audioStreamIndex?: number,
  subtitleStreamIndex?: number,
  mediaSourceId?: string,
) {
  const cap = getPrefs().maxBitrate
  // Burn-in subtitles require a transcode path; direct play can't paint them.
  // Jellyfin only honors SubtitleStreamIndex when MediaSourceId is set and
  // SubtitleMethod=Encode is sent (otherwise it silently drops both).
  const burningSubs = subtitleStreamIndex !== undefined
  // Cap burn-in encodes — full 4K HEVC→H264 with burn-in is huge/slow and
  // often fails over Funnel. Prefer ~1080p ladder.
  const maxBr = burningSubs
    ? Math.min(cap > 0 ? cap : 12_000_000, 16_000_000)
    : cap > 0
      ? cap
      : 40_000_000
  const profile = buildDeviceProfile()
  if (burningSubs) {
    const tp = (profile.TranscodingProfiles as Record<string, unknown>[])?.[0]
    if (tp) {
      tp.MaxWidth = 1920
      tp.MaxHeight = 1080
    }
  }
  return request<JfPlaybackInfo>(
    `/Items/${itemId}/PlaybackInfo` + qs({ UserId: session!.userId }),
    {
      method: 'POST',
      body: {
        UserId: session!.userId,
        // Still sent for JF bookkeeping; do not put on HLS URL (causes segment 400s).
        StartTimeTicks: startTimeTicks,
        // Required for JF to attach subtitle/audio choices to the transcode URL
        MediaSourceId: mediaSourceId || itemId,
        DeviceProfile: profile,
        MaxStreamingBitrate: maxBr,
        AutoOpenLiveStream: true,
        EnableDirectPlay: cap === 0 && !burningSubs,
        EnableDirectStream: !burningSubs,
        EnableTranscoding: true,
        AllowVideoStreamCopy: !burningSubs,
        AllowAudioStreamCopy: true,
        ...(audioStreamIndex !== undefined ? { AudioStreamIndex: audioStreamIndex } : {}),
        ...(burningSubs
          ? {
              SubtitleStreamIndex: subtitleStreamIndex,
              SubtitleMethod: 'Encode',
            }
          : {}),
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

export interface JfLyricLine {
  Text: string
  Start?: number // ticks (present for synced lyrics)
}
export interface JfLyrics {
  Lyrics: JfLyricLine[]
}

/** Lyrics for a track, or null if none. Synced when lines carry Start ticks. */
export async function getLyrics(itemId: string): Promise<JfLyrics | null> {
  try {
    return await request<JfLyrics>(`/Audio/${itemId}/Lyrics`)
  } catch {
    return null
  }
}

/** Playable audio URL for an <audio> element: direct file when the browser
 *  supports the container, else an http mp3 transcode. */
export function audioStreamUrl(itemId: string): string {
  return (
    `${session!.server}/Audio/${itemId}/universal` +
    qs({
      UserId: session!.userId,
      DeviceId: DEVICE_ID,
      api_key: session!.token,
      Container: 'opus,mp3,aac,m4a,flac,webma,webm,wav,ogg',
      AudioCodec: 'aac',
      TranscodingContainer: 'mp3',
      TranscodingProtocol: 'http',
      MaxStreamingBitrate: getPrefs().maxBitrate > 0 ? getPrefs().maxBitrate : 320_000,
    })
  )
}

/** Build a playable HLS/transcode URL.
 *  IMPORTANT: do NOT append StartTimeTicks — on current Jellyfin this makes
 *  segment requests return HTTP 400 (hls.js networkError). Resume by seeking
 *  inside the full VOD playlist after MANIFEST_PARSED instead. */
export function transcodeUrl(transcodingUrl: string, _startTimeTicks = 0): string {
  let url = `${session!.server}${transcodingUrl}`
  if (!/[?&](api_key|ApiKey)=/i.test(url)) {
    url += (url.includes('?') ? '&' : '?') + `api_key=${session!.token}`
  }
  // Strip StartTimeTicks if JF or a caller already put it on the URL.
  url = url.replace(/([?&])StartTimeTicks=\d+&?/gi, '$1').replace(/[?&]$/, '')
  return url
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
  let maxWidth = opts.maxWidth
  let quality = opts.quality ?? 90
  if (__WEBOS__) {
    // TV SoCs choke on decoding hundreds of large JPEGs — the #1 scroll-lag
    // cost. Cards render ~180px wide at 1080p, so cap what we ask Jellyfin
    // for (it resizes server-side and caches the result).
    const cap = type === 'Primary' ? 240 : type === 'Backdrop' || type === 'Thumb' ? 1280 : 480
    maxWidth = Math.min(maxWidth ?? cap, cap)
    quality = Math.min(quality, 80)
  }
  return (
    `${session.server}/Items/${itemId}/Images/${type}` +
    qs({
      maxWidth,
      maxHeight: opts.maxHeight,
      tag: opts.tag,
      quality,
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
}, maxWidth = 480): string | null {
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
