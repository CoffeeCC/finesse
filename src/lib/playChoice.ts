// Play, Resume or Start over: the one place that decides which a title offers, so
// the item page, the Now stage, search and the TV all say the same thing.
// Pure (no imports), so server/test/play-choice.test.ts can test it.

const TICKS_PER_SECOND = 10_000_000

/** A position as a clock: 42:10, or 1:02:10 past the hour. */
export function clockTime(ticks: number): string {
  const total = Math.max(0, Math.floor(ticks / TICKS_PER_SECOND))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export interface PlayChoice {
  /** There's a saved position to go back to. */
  resuming: boolean
  /** Where it was left, as a clock ("42:10"); '' when not resuming. */
  at: string
  /** The main action: from the saved position when there is one, else from the start. */
  href: string
  /** The main action's words: "Resume from 42:10" or "Play". */
  label: string
  /** From the beginning, only offered when resuming (otherwise Play already does that). */
  startOver: string | null
}

/** Any Jellyfin item has these fields. */
export interface Playable {
  Id: string
  UserData?: { PlaybackPositionTicks?: number | null; Played?: boolean | null } | null
}

export function playChoice(item: Playable, playWord = 'Play'): PlayChoice {
  const pos = item.UserData?.PlaybackPositionTicks ?? 0
  // A finished title starts again from the top (Jellyfin keeps no position for it, but older data might).
  const resuming = pos > 0 && !item.UserData?.Played
  const start = `/play/${item.Id}`
  if (!resuming) return { resuming, at: '', href: start, label: playWord, startOver: null }
  const at = clockTime(pos)
  return { resuming, at, href: `${start}?t=${pos}`, label: `Resume from ${at}`, startOver: start }
}
