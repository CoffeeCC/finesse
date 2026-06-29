export interface JfUserData {
  Played?: boolean
  PlaybackPositionTicks?: number
  PlayedPercentage?: number
  UnplayedItemCount?: number
  IsFavorite?: boolean
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
  DisplayTitle?: string
  Index: number
  IsDefault?: boolean
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
  ImageTags?: Record<string, string>
  BackdropImageTags?: string[]
  UserData?: JfUserData
  People?: JfPerson[]
  MediaSources?: JfMediaSource[]
  Trickplay?: Record<string, Record<string, JfTrickplayInfo>>
  ImageBlurHashes?: Record<string, Record<string, string>>
  Path?: string
  RemoteTrailers?: { Url: string; Name?: string }[]
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
