// Moving what's playing between this account's devices (Jellyfin sessions):
//   Play on… (push): the other device is told to play from here; this one pauses, and only
//     steps back once that device reports it's playing the title. If it doesn't within a
//     while, this one carries on: nothing is lost.
//   Continue here (pull): this device starts from where the other one is now, and only stops
//     the other once this one is actually playing.
// Pure (no imports), so server/test/transfer.test.ts can test it.

export interface SessionLike {
  Id: string
  DeviceId?: string
  UserId?: string
  NowPlayingItem?: { Id: string; Type?: string; RunTimeTicks?: number } | null
  PlayState?: { PositionTicks?: number; IsPaused?: boolean } | null
  LastActivityDate?: string
  LastPlaybackCheckIn?: string
}

/** How far a playing session has got by now: its last report, plus the time since (at most 30 s, never past the end). */
export function positionNow(s: SessionLike, now = Date.now()): number {
  const pos = Math.max(0, s.PlayState?.PositionTicks ?? 0)
  if (!s.PlayState || s.PlayState.IsPaused || !s.NowPlayingItem) return pos
  const at = Date.parse(s.LastPlaybackCheckIn ?? '')
  // Jellyfin sends 0001-01-01 for "never": no adjustment then.
  if (!Number.isFinite(at) || at < Date.parse('2000-01-01')) return pos
  const ahead = Math.min(30_000, Math.max(0, now - at)) * 1e4
  const end = s.NowPlayingItem.RunTimeTicks
  return end ? Math.min(pos + ahead, Math.max(0, end - 1e7)) : pos + ahead
}

/** Another of this account's devices playing a video, most recently active first (music isn't moved). */
export function otherPlaying<S extends SessionLike>(sessions: S[], me: { userId: string; deviceId: string }): S | null {
  return (
    sessions
      .filter((s) => s.UserId === me.userId && s.DeviceId !== me.deviceId && s.NowPlayingItem && s.NowPlayingItem.Type !== 'Audio')
      .sort((a, b) => (b.LastActivityDate ?? '').localeCompare(a.LastActivityDate ?? ''))[0] ?? null
  )
}

export type StartResult = 'started' | 'timeout' | 'gone'

/**
 * Asks for the sessions every `intervalMs` until `sessionId` reports playing `itemId`. "gone":
 * the device disappeared from the list (closed, or not ours to see); "timeout": it's there but
 * never started. A failed ask counts as "not yet".
 */
export async function waitForStart(o: {
  poll: () => Promise<SessionLike[]>
  sessionId: string
  itemId: string
  timeoutMs?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}): Promise<StartResult> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = o.now ?? Date.now
  const until = now() + (o.timeoutMs ?? 20_000)
  let seen = false
  let missing = 0
  for (;;) {
    const list = await o.poll().catch(() => null)
    if (list) {
      const s = list.find((x) => x.Id === o.sessionId)
      if (s) {
        seen = true
        missing = 0
        if (s.NowPlayingItem?.Id === o.itemId) return 'started'
      } else if (++missing >= 3) return 'gone' // not in the list three times running
    }
    if (now() >= until) return seen ? 'timeout' : 'gone'
    await sleep(o.intervalMs ?? 1500)
  }
}

/** Where "Continue here" goes: the player at the other device's position, saying which session to stop once this one plays. */
export function continueHereHref(itemId: string, positionTicks: number, from: { sessionId: string; name: string }): string {
  const q = new URLSearchParams()
  if (positionTicks > 0) q.set('t', String(Math.round(positionTicks)))
  q.set('from', from.sessionId)
  q.set('fromName', from.name.slice(0, 60))
  return `/play/${itemId}?${q}`
}
