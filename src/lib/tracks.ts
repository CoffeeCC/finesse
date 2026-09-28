// Choosing a subtitle track the way a person would.
//
// Anime releases (and plenty of others) carry several subtitle tracks in one
// language: "Full" dialogue next to "Signs & Songs" or forced-only tracks that
// show a handful of lines per episode. Matching on language alone picks
// whichever comes first, which looks like subtitles that won't stay on.

import type { JfMediaStream } from '../api/types'

/** Tracks that only carry signs, song lyrics or forced lines, not the dialogue. */
const PARTIAL = /\b(signs?|songs?|forced|karaoke|lyrics|op\s*\/?\s*ed)\b/i

const sameText = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

/** Partial tracks (signs, songs, forced) rank last. */
export function isPartialSubtitle(s: JfMediaStream): boolean {
  return !!s.IsForced || PARTIAL.test(s.Title ?? '') || PARTIAL.test(s.DisplayTitle ?? '')
}

/**
 * The subtitle track to show.
 * - `lang`: the remembered language; tracks in it win. Leave it out for "any language".
 * - `title`: the remembered track's title ("Full"); an exact match wins within the language.
 * Otherwise full dialogue beats partial tracks, then the file's default track, then file order.
 */
export function pickSubtitle(subs: JfMediaStream[], lang?: string, title?: string): JfMediaStream | undefined {
  const pool = lang ? subs.filter((s) => sameText(s.Language, lang)) : subs
  if (!pool.length) return title ? subs.find((s) => sameText(s.Title, title)) : undefined
  const named = title ? pool.find((s) => sameText(s.Title, title)) : undefined
  if (named) return named
  const rank = (s: JfMediaStream) => (isPartialSubtitle(s) ? 2 : 0) + (s.IsDefault ? 0 : 1)
  return pool.reduce((best, s) => (rank(s) < rank(best) ? s : best))
}
