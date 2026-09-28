import { imageUrl } from '../api/client'
import type { JfItem } from '../api/types'

/** A song's cover: its own image, else its album's. */
export function trackArt(t: JfItem, w = 800): string | null {
  if (t.ImageTags?.Primary) return imageUrl(t.Id, 'Primary', { maxWidth: w, tag: t.ImageTags.Primary })
  if (t.AlbumId && t.AlbumPrimaryImageTag) return imageUrl(t.AlbumId, 'Primary', { maxWidth: w, tag: t.AlbumPrimaryImageTag })
  return null
}

export const artistOf = (t: JfItem) => t.Artists?.join(', ') || t.AlbumArtist || ''

/** The blurhash of the artwork a song actually shows (its album's, when it
 *  has none of its own) — for palettes and glows. */
export function artBlurhash(t: JfItem): string | undefined {
  const byTag = t.ImageBlurHashes?.Primary
  if (!byTag) return undefined
  if (t.ImageTags?.Primary && byTag[t.ImageTags.Primary]) return byTag[t.ImageTags.Primary]
  if (t.AlbumPrimaryImageTag && byTag[t.AlbumPrimaryImageTag]) return byTag[t.AlbumPrimaryImageTag]
  return Object.values(byTag)[0]
}
