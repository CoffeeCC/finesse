// Time-of-day ambience: the app's background glows and greeting copy shift
// with the clock. Sets data-daypart on <html>; index.css re-tints the aurora
// per daypart. Costs nothing — it's just different gradient colors.

export type Daypart = 'morning' | 'day' | 'evening' | 'night'

export function currentDaypart(now = new Date()): Daypart {
  const h = now.getHours()
  if (h >= 5 && h < 11) return 'morning'
  if (h >= 11 && h < 17) return 'day'
  if (h >= 17 && h < 22) return 'evening'
  return 'night'
}

export const DAYPART_GREETING: Record<Daypart, string> = {
  morning: 'GOOD MORNING',
  day: 'SETTING THE SCENE',
  evening: "TONIGHT'S FEATURE",
  night: 'THE LATE SHOW',
}

export function applyTimeAmbience(): Daypart {
  const part = currentDaypart()
  document.documentElement.setAttribute('data-daypart', part)
  return part
}
