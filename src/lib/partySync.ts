// Watch parties: people on this server playing one title together. The server keeps one clock
// per party (playing or paused, at what position, as of when); every member's player reports
// in about once a second and steers itself to that clock. Pure (no imports): the server
// (server/src/parties.ts) runs the party with it, the player (lib/usePartySync) follows it,
// and server/test/party-sync.test.ts tests it.
//
// The rules:
//   - Anyone in the party can play, pause or seek; it applies to everyone.
//   - Someone in step whose player stalls (buffering) pauses everyone, "waiting for Kim";
//     once nobody's waiting it plays on by itself. Someone stuck for over 20 s is left to catch
//     up instead, so one slow connection can't hold the party for good.
//   - Late joiners start where the party is and don't hold anyone up until they're in step.
//   - Someone silent for 15 s has left. If that's the host, the longest-present member hosts;
//     when nobody's left, the party is over.

export const MAX_MEMBERS = 8
export const GONE_MS = 15_000
export const STUCK_MS = 20_000
/** Within this many seconds of the clock counts as in step. */
export const IN_STEP = 2
/** Further than this: seek, rather than nudge the speed. */
export const JUMP = 4

export interface Clock {
  playing: boolean
  /** Seconds into the title, as of `at`. */
  position: number
  /** Server time (ms) of `position`. */
  at: number
  /** Paused by the party itself while someone buffered (it resumes by itself). */
  waiting: boolean
  rev: number
}

export interface Member {
  id: string
  name: string
  joinedAt: number
  seen: number
  /** Reported in step with the clock at least once (only those hold the party when buffering). */
  synced: boolean
  /** Since when the player has been stalled (null: it isn't). */
  bufferingSince: number | null
  position: number
}

export interface Party {
  id: string
  item: string
  title: string
  host: string
  invited: string[]
  members: Member[]
  clock: Clock
  created: number
  ended: boolean
}

export function positionAt(c: Clock, now: number): number {
  return c.playing ? c.position + Math.max(0, now - c.at) / 1000 : c.position
}

function set(p: Party, now: number, playing: boolean, position: number, waiting = false) {
  p.clock = { playing, position: Math.max(0, position), at: now, waiting, rev: p.clock.rev + 1 }
}

export type Control = { action: 'play' } | { action: 'pause' } | { action: 'seek'; position: number }

/** Someone pressed play, pause, or moved to a time. */
export function control(p: Party, c: Control, now: number) {
  const here = positionAt(p.clock, now)
  if (c.action === 'play') set(p, now, true, here)
  else if (c.action === 'pause') set(p, now, false, here)
  // A seek keeps playing (or paused) as it was; everyone loads again, and those in step hold
  // the party (as buffering) until they've caught up.
  else set(p, now, p.clock.playing || p.clock.waiting, c.position)
}

export function join(p: Party, who: { id: string; name: string }, now: number): Member {
  let m = p.members.find((x) => x.id === who.id)
  if (!m) {
    m = { id: who.id, name: who.name, joinedAt: now, seen: now, synced: false, bufferingSince: null, position: positionAt(p.clock, now) }
    p.members.push(m)
  }
  m.seen = now
  return m
}

/** A member's player reports where it is and whether it's stalled. */
export function report(p: Party, id: string, r: { position: number; buffering: boolean }, now: number) {
  const m = p.members.find((x) => x.id === id)
  if (!m) return
  m.seen = now
  m.position = r.position
  m.bufferingSince = r.buffering ? (m.bufferingSince ?? now) : null
  if (!r.buffering && Math.abs(r.position - positionAt(p.clock, now)) <= IN_STEP) m.synced = true
}

export function leave(p: Party, id: string) {
  p.members = p.members.filter((m) => m.id !== id)
  handHost(p)
}

function handHost(p: Party) {
  if (p.members.some((m) => m.id === p.host)) return
  const next = [...p.members].sort((a, b) => a.joinedAt - b.joinedAt)[0]
  if (next) p.host = next.id
  else p.ended = true
}

/** Who the party is waiting for right now (in step, stalled, not stuck for long). */
export function waitingFor(p: Party, now: number): Member[] {
  return p.members.filter((m) => m.synced && m.bufferingSince !== null && now - m.bufferingSince < STUCK_MS)
}

/** Time passing: people who've gone quiet leave; buffering pauses and resumes the party. */
export function tick(p: Party, now: number) {
  const before = p.members.length
  p.members = p.members.filter((m) => now - m.seen < GONE_MS)
  if (p.members.length !== before) handHost(p)
  if (p.ended) return
  const waiting = waitingFor(p, now)
  if (p.clock.playing && waiting.length) set(p, now, false, positionAt(p.clock, now), true)
  else if (!p.clock.playing && p.clock.waiting && !waiting.length) set(p, now, true, p.clock.position)
}

/**
 * What a player should do to follow the clock: play or pause to match it, jump when it's far
 * off, or run slightly fast or slow to close a small gap without a visible jump.
 */
export function steer(local: { position: number; playing: boolean }, c: Clock, now: number): { seek: number | null; play: boolean | null; rate: number } {
  const want = positionAt(c, now)
  const drift = local.position - want
  const seek = Math.abs(drift) > JUMP ? want : null
  const play = c.playing !== local.playing ? c.playing : null
  const rate = !c.playing || seek !== null || Math.abs(drift) <= 0.4 ? 1 : drift > 0 ? 0.95 : 1.05
  return { seek, play, rate }
}

/** The server's clock in this device's time, from one exchange (sent at t0, answered at t1 with serverNow). */
export function clockOffset(t0: number, t1: number, serverNow: number): number {
  return serverNow - (t0 + t1) / 2
}
