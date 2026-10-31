// Episodes as people think of them: "season 1, episode 2", whatever files are behind it.
// A library can hold two copies of one episode (a second rip, a release pack beside single
// files) that Jellyfin hasn't merged into versions of one item. Prev/next steps by episode,
// never onto another copy of the one you're watching; which copy plays is chosen separately.
// Labels never show placeholders ("S?:E?") when the numbers are missing.
// Pure (no imports), so server/test/episodes.test.ts can test it.

/** An episode's numbers (any Jellyfin item has these fields). */
export interface EpisodeNumbers {
  ParentIndexNumber?: number | null
  IndexNumber?: number | null
  IndexNumberEnd?: number | null
}

/** The few fields sequencing needs (a JfItem has them all). */
export interface EpisodeLike extends EpisodeNumbers {
  Id: string
  LocationType?: string
}

const isNum = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

/** "S1:E2", "S1:E2–3", "Special 3", "Episode 4" (no season), or "" when there are no numbers. */
export function episodeCode(ep: EpisodeNumbers): string {
  const s = ep.ParentIndexNumber
  const e = ep.IndexNumber
  if (!isNum(e)) return ''
  const end = isNum(ep.IndexNumberEnd) && ep.IndexNumberEnd > e ? `–${ep.IndexNumberEnd}` : ''
  if (!isNum(s)) return `Episode ${e}${end}`
  return s === 0 ? `Special ${e}${end}` : `S${s}:E${e}${end}`
}

/** Same as episodeCode, spaced for chips and headings: "S1 · E2". */
export function episodeChip(ep: EpisodeNumbers): string {
  return episodeCode(ep).replace(/^S(\d+):E/, 'S$1 · E')
}

/** One logical episode: copies share it. Without numbers, every item stands alone. */
function episodeKey(ep: EpisodeLike): string {
  return isNum(ep.ParentIndexNumber) && isNum(ep.IndexNumber) ? `${ep.ParentIndexNumber}:${ep.IndexNumber}` : `id:${ep.Id}`
}

/**
 * The episodes either side of `currentId`, from a series' episodes in play order (Jellyfin's
 * ParentIndexNumber,IndexNumber sort). Missing (virtual) episodes can't play; Specials (season 0)
 * aren't part of the main run, and only chain among themselves when you're in them. Copies of the
 * same episode count once: the first copy in the list stands for the others.
 */
export function adjacentEpisodes<T extends EpisodeLike>(episodes: readonly T[], currentId: string): { prev?: T; next?: T } {
  const current = episodes.find((e) => e.Id === currentId)
  if (!current) return {}
  const inSpecials = (current.ParentIndexNumber ?? 0) === 0
  const groups: { key: string; items: T[] }[] = []
  const byKey = new Map<string, { key: string; items: T[] }>()
  for (const e of episodes) {
    if (e.Id !== currentId && (e.LocationType === 'Virtual' || ((e.ParentIndexNumber ?? 0) === 0) !== inSpecials)) continue
    const key = episodeKey(e)
    let g = byKey.get(key)
    if (!g) {
      g = { key, items: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.items.push(e)
  }
  const i = groups.findIndex((g) => g.items.some((e) => e.Id === currentId))
  if (i < 0) return {}
  const pick = (g?: { items: T[] }) => g?.items[0]
  return { prev: pick(groups[i - 1]), next: pick(groups[i + 1]) }
}

/** One episode in a list, with every copy of it (two or more when the library holds duplicates). */
export interface EpisodeGroup<T> {
  /** The copy the row plays: one you've started, else the first that has a file. */
  main: T
  /** All copies, in list order (main included). */
  versions: T[]
}

/**
 * A season's episodes as one row per episode: copies of the same season/episode become
 * versions of one row (picked from separately), instead of repeated rows. Items without
 * numbers stay rows of their own.
 */
export function groupEpisodeVersions<T extends EpisodeLike & { UserData?: { PlaybackPositionTicks?: number } | null }>(episodes: readonly T[]): EpisodeGroup<T>[] {
  const groups: T[][] = []
  const byKey = new Map<string, T[]>()
  for (const e of episodes) {
    const key = episodeKey(e)
    let g = byKey.get(key)
    if (!g) {
      g = []
      byKey.set(key, g)
      groups.push(g)
    }
    g.push(e)
  }
  return groups.map((versions) => {
    const real = versions.filter((v) => v.LocationType !== 'Virtual')
    const main = real.find((v) => (v.UserData?.PlaybackPositionTicks ?? 0) > 0) ?? real[0] ?? versions[0]!
    return { main, versions: real.length ? real : versions }
  })
}
