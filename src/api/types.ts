export interface JfUserData {
  Played?: boolean
  PlaybackPositionTicks?: number
  PlayedPercentage?: number
  UnplayedItemCount?: number
  IsFavorite?: boolean
  /** Completed plays (Jellyfin counts one when you reach the credits). */
  PlayCount?: number
}

export interface JfPerson {
  Id: string
  Name: string
  Role?: string
  Type: string
  PrimaryImageTag?: string
}

export interface JfMediaStream {
  Type: string
  Codec?: string
  Language?: string
  /** The track's own name from the file, e.g. "Full" or "Signs & Songs". */
  Title?: string
  DisplayTitle?: string
  Index: number
  IsDefault?: boolean
  IsForced?: boolean
  IsExternal?: boolean
  DeliveryMethod?: string
  DeliveryUrl?: string
  IsTextSubtitleStream?: boolean
  Width?: number
  Height?: number
}

export interface JfTrickplayInfo {
  Width: number
  Height: number
  TileWidth: number
  TileHeight: number
  ThumbnailCount: number
  Interval: number
}

export interface JfMediaSource {
  Id: string
  Container?: string
  Bitrate?: number
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  SupportsTranscoding?: boolean
  TranscodingUrl?: string
  TranscodingSubProtocol?: string
  RunTimeTicks?: number
  MediaStreams?: JfMediaStream[]
}

export interface JfItem {
  Id: string
  Name: string
  Type: string
  SortName?: string
  ProductionYear?: number
  PremiereDate?: string
  EndDate?: string
  Status?: string
  RunTimeTicks?: number
  Overview?: string
  Taglines?: string[]
  Genres?: string[]
  CommunityRating?: number
  OfficialRating?: string
  CollectionType?: string
  ChildCount?: number
  RecursiveItemCount?: number
  IndexNumber?: number
  ParentIndexNumber?: number
  SeriesId?: string
  SeriesName?: string
  SeasonId?: string
  SeasonName?: string
  SeriesPrimaryImageTag?: string
  AlbumArtist?: string
  Artists?: string[]
  Album?: string
  AlbumId?: string
  AlbumPrimaryImageTag?: string
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  ParentThumbItemId?: string
  ParentThumbImageTag?: string
  /** Episodes: the series' title logo. */
  ParentLogoItemId?: string
  ParentLogoImageTag?: string
  ImageTags?: Record<string, string>
  BackdropImageTags?: string[]
  UserData?: JfUserData
  People?: JfPerson[]
  /** Chapter markers (Fields=Chapters) — ticks on the player's scrubber. */
  Chapters?: { StartPositionTicks: number; Name?: string }[]
  MediaSources?: JfMediaSource[]
  Trickplay?: Record<string, Record<string, JfTrickplayInfo>>
  ImageBlurHashes?: Record<string, Record<string, string>>
  Path?: string
  /** When it was added to the library (Fields=DateCreated). */
  DateCreated?: string
  RemoteTrailers?: { Url: string; Name?: string }[]
  /** 'Virtual' = a missing episode Jellyfin knows about but has no file for. */
  LocationType?: string
}

export interface JfItemsResult {
  Items: JfItem[]
  TotalRecordCount: number
  StartIndex: number
}

export interface JfAuthResult {
  User: { Id: string; Name: string; Policy?: { IsAdministrator?: boolean } }
  AccessToken: string
  ServerId: string
}

export interface JfPlaybackInfo {
  MediaSources: JfMediaSource[]
  PlaySessionId: string
}

export const TICKS_PER_SECOND = 10_000_000

export function ticksToSeconds(ticks?: number): number {
  return ticks ? ticks / TICKS_PER_SECOND : 0
}

export function secondsToTicks(seconds: number): number {
  return Math.floor(seconds * TICKS_PER_SECOND)
}

export function formatRuntime(ticks?: number): string {
  if (!ticks) return ''
  const totalMin = Math.round(ticks / TICKS_PER_SECOND / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
