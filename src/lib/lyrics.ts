import { getLyrics } from '../api/client'
import { ticksToSeconds, type JfItem } from '../api/types'
import { getPrefs } from './settings'

// Lyrics for the music player: the library's own (Jellyfin reads .lrc/.txt
// files next to the audio, or a lyrics plugin fills them in) and, when it has
// none, LRCLIB — a free, open database of synced lyrics (lrclib.net; no key,
// CORS-open, so it works from the TV app too). Only the song, artist, album and
// length are sent, and only when "Find lyrics online" is on (Settings → Sound).

export interface LyricLine {
  /** Seconds from the start; absent for unsynced (plain) lyrics. */
  start?: number
  text: string
}

export interface TrackLyrics {
  lines: LyricLine[]
  synced: boolean
  source: 'library' | 'lrclib'
  instrumental?: boolean
}

const LRCLIB = 'https://lrclib.net/api'

/** "[01:02.34]Line" (several stamps per line allowed) → sorted timed lines. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    // exec loop, not matchAll — that's Chromium 73+, and the LG CX runs 68.
    const stamp = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g
    const starts: number[] = []
    for (let m = stamp.exec(raw); m; m = stamp.exec(raw)) starts.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')))
    if (starts.length === 0) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const start of starts) out.push({ start, text })
  }
  return out.sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
}

interface LrclibRecord {
  trackName: string
  artistName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

function fromLrclib(r: LrclibRecord): TrackLyrics | null {
  if (r.instrumental) return { lines: [], synced: false, source: 'lrclib', instrumental: true }
  if (r.syncedLyrics) {
    const lines = parseLrc(r.syncedLyrics)
    if (lines.length) return { lines, synced: true, source: 'lrclib' }
  }
  if (r.plainLyrics) {
    return { lines: r.plainLyrics.split(/\r?\n/).map((text) => ({ text })), synced: false, source: 'lrclib' }
  }
  return null
}

async function lrclib(track: JfItem): Promise<TrackLyrics | null> {
  const artist = track.Artists?.[0] ?? track.AlbumArtist
  if (!artist || !track.Name) return null
  const duration = Math.round(ticksToSeconds(track.RunTimeTicks))
  // Exact lookup first (LRCLIB matches on name + artist + album + length ±2 s)…
  const exact = new URLSearchParams({ track_name: track.Name, artist_name: artist })
  if (track.Album) exact.set('album_name', track.Album)
  if (duration) exact.set('duration', String(duration))
  const res = await fetch(`${LRCLIB}/get?${exact}`)
  if (res.ok) {
    const hit = fromLrclib((await res.json()) as LrclibRecord)
    if (hit) return hit
  } else if (res.status !== 404) {
    throw new Error(`LRCLIB responded ${res.status}`)
  }
  // …then a search, preferring synced lyrics of about the right length (album
  // names and remaster suffixes often differ between tags and LRCLIB).
  const search = await fetch(`${LRCLIB}/search?${new URLSearchParams({ track_name: track.Name, artist_name: artist })}`)
  if (!search.ok) throw new Error(`LRCLIB responded ${search.status}`)
  const results = (await search.json()) as LrclibRecord[]
  const close = (r: LrclibRecord) => !duration || Math.abs(r.duration - duration) <= 3
  const best =
    results.find((r) => close(r) && r.syncedLyrics) ?? results.find((r) => close(r) && (r.plainLyrics || r.instrumental))
  return best ? fromLrclib(best) : null
}

async function libraryLyrics(track: JfItem): Promise<TrackLyrics | null> {
  const lines = (await getLyrics(track.Id))?.Lyrics ?? []
  if (!lines.length) return null
  const synced = lines.every((l) => typeof l.Start === 'number')
  return {
    lines: lines.map((l) => ({ text: l.Text ?? '', start: synced ? ticksToSeconds(l.Start) : undefined })),
    synced,
    source: 'library',
  }
}

/** The library's synced lyrics, else LRCLIB's synced ones (if allowed), else
 *  whatever words either has. Plain lyrics embedded in the file are common,
 *  and they shouldn't hide timed ones LRCLIB has for the same song. Throws
 *  when LRCLIB can't be reached and there's nothing else, so the lookup is
 *  retried later instead of remembered as "no lyrics". */
export async function findLyrics(track: JfItem): Promise<TrackLyrics | null> {
  const own = await libraryLyrics(track)
  if (own?.synced || !getPrefs().onlineLyrics) return own
  let online: TrackLyrics | null
  try {
    online = await lrclib(track)
  } catch (e) {
    if (own) return own
    throw e
  }
  return online?.synced || !own ? online : own
}

/** Index of the line being sung at `position` (-1 before the first). */
export function activeLine(lines: LyricLine[], position: number): number {
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i].start ?? Infinity) <= position + 0.15) idx = i
    else break
  }
  return idx
}
