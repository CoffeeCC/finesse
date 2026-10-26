import { streamingApi, type StreamApp } from '../api/setup'

/** Where a tile's picture comes from, best first: Steam's cover, SteamGridDB or Lutris art, Wolf's icon. */
export function tileImages(app: StreamApp): string[] {
  return [
    ...(app.steam ? [streamingApi.steamArtUrl(app.steam)] : []),
    ...(app.art ? [streamingApi.artUrl(app.id)] : []),
    ...(app.icon ? [streamingApi.iconUrl(app.id)] : []),
  ]
}

/** "12 h played", "40 min played". */
export function playedLabel(seconds: number | undefined): string | null {
  if (!seconds || seconds < 60) return null
  const h = seconds / 3600
  return h >= 1 ? `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} h played` : `${Math.round(seconds / 60)} min played`
}

