// Small shared bits for Moments in the app.

/** The longest note (the server's limit too). */
export const NOTE_MAX = 200

/** "15 seconds", "1 min 5 s". */
export function spanLabel(start: number, end: number): string {
  const d = Math.max(0, Math.round(end - start))
  if (d < 60) return `${d} second${d === 1 ? '' : 's'}`
  const m = Math.floor(d / 60)
  const s = d % 60
  return s ? `${m} min ${s} s` : `${m} min`
}

/** Pop-ups this session: one per moment, at most one every 30 seconds, and quiet mode. */
export const popupSession = { shown: new Set<string>(), last: 0, quiet: false }
