// Friends' servers (Groups) in the app. A title on a friend's server carries
// an id like "f-1a2b3c4d-<its Jellyfin id>": the Jellyfin client sees the tag,
// sends that call to the friend (through our own server, which adds the pairing
// secret), and tags every id in the answer the same way. So the detail page,
// episodes, the player, subtitles and images all work unchanged, and nothing of
// a friend's can be mixed up with ours.

import { finesseApi } from './finesseServer'

const TAGGED = /\bf-([a-z0-9]{8})-([0-9a-f]{32})\b/gi
const RAW_ID = /^[0-9a-f]{32}$/i

/** Answer keys holding item ids (Jellyfin's). */
const ID_KEYS = new Set([
  'Id',
  'ItemId',
  'SeriesId',
  'SeasonId',
  'ParentId',
  'AlbumId',
  'TopParentId',
  'MediaSourceId',
  'ParentBackdropItemId',
  'ParentThumbItemId',
  'ParentLogoItemId',
  'ParentPrimaryImageItemId',
  'ParentArtItemId',
  'SeriesPrimaryImageItemId',
])
/** Answer keys holding server paths the app loads directly (made absolute). */
const URL_KEYS = new Set(['TranscodingUrl', 'DeliveryUrl'])

export function tagId(peer: string, raw: string): string {
  return `f-${peer}-${raw}`
}

/** The friend a tagged id belongs to, or null for our own items. */
export function peerOf(id: string | null | undefined): string | null {
  if (!id) return null
  const m = /^f-([a-z0-9]{8})-[0-9a-f]{32}$/i.exec(id)
  return m ? m[1]! : null
}

export const isPeerId = (id: string | null | undefined) => peerOf(id) !== null

/** Where a friend's Jellyfin is reached (always absolute, so player URLs work as they are). */
export function peerBase(peer: string): string {
  return new URL(finesseApi(`/api/groups/friends/${peer}/jellyfin`), window.location.href).href
}

/**
 * Untags every id in a path, query or JSON body. Returns the friend they belong
 * to (null for ours). Ids of two different servers in one call is a bug.
 */
export function untag(text: string): { peer: string | null; text: string } {
  let peer: string | null = null
  const out = text.replace(TAGGED, (_, p: string, raw: string) => {
    if (peer && peer !== p) throw new Error('One call can’t mix titles from two servers')
    peer = p
    return raw
  })
  return { peer, text: out }
}

/** Tags every item id in a friend's answer, and makes its media paths absolute. */
export function tagAnswer<T>(value: T, peer: string): T {
  const base = peerBase(peer)
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (!v || typeof v !== 'object') return v
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (ID_KEYS.has(k) && typeof x === 'string' && RAW_ID.test(x)) out[k] = tagId(peer, x)
      else if (URL_KEYS.has(k) && typeof x === 'string' && x.startsWith('/')) out[k] = base + x
      else out[k] = walk(x)
    }
    return out
  }
  return walk(value) as T
}
