import { mediaBrowserAuthHeader } from './client'
import { CONTENT_BASE } from '../lib/contentOrigin'

// SABnzbd remote control, through the same server proxy as the *arr apps
// (server/src/services.ts): /arr/sab?mode=… → SAB's /api with the apikey added
// server-side and the caller's Jellyfin token checked.
//
// SAB's API is a single endpoint driven by `mode` query params — see
// https://sabnzbd.org/wiki/advanced/api

// SAB not set up on this server (the proxy's 503): the status poll would ask every 10 s for the
// same answer. Ask again after a while instead.
const UNSET_RETRY_MS = 2 * 60_000
let unsetUntil = 0

export class SabError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function sabCall<T>(params: Record<string, string>): Promise<T> {
  if (unsetUntil > Date.now()) throw new SabError(503, 'SABnzbd isn’t set up on this server')
  const qs = new URLSearchParams({ ...params, output: 'json' })
  let res: Response
  try {
    res = await fetch(`${CONTENT_BASE}arr/sab?${qs}`, {
      headers: { Authorization: mediaBrowserAuthHeader() },
    })
  } catch {
    throw new SabError(0, 'Can’t reach Finesse. Check your connection and try again.')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* an HTML error page: the status says enough */
  }
  if (!res.ok) {
    const said = (data as { error?: string } | null)?.error
    if (res.status === 503 && said && /isn.t set up/i.test(said)) unsetUntil = Date.now() + UNSET_RETRY_MS
    throw new SabError(
      res.status,
      res.status === 401
        ? 'Your sign-in has expired. Sign out and back in, then try again.'
        : res.status === 403
          ? 'Only whoever runs the server can do that.'
          : said || 'SABnzbd isn’t answering. Try again in a moment.',
    )
  }
  unsetUntil = 0
  // SAB answers its own failures with 200 and { status: false, error }.
  const sab = data as { status?: boolean; error?: string } | null
  if (sab && sab.status === false) throw new SabError(res.status, sab.error ? `SABnzbd said: ${sab.error}` : 'SABnzbd turned that down.')
  if (data === null) throw new SabError(res.status, 'SABnzbd sent back something Finesse couldn’t read.')
  return data as T
}

export interface SabStatus {
  /** Whole-queue pause state. */
  paused: boolean
  /** Current download speed, bytes/sec. */
  speedBps: number
  /** Active speed limit in bytes/sec; 0 = unlimited. */
  limitBps: number
  /** Free space on the download disk, GB. */
  diskFreeGb: number
  /** Jobs in the queue. */
  jobs: number
  /** MB left across the queue. */
  mbLeft: number
  timeLeft: string
}

interface RawSabQueue {
  queue: {
    paused?: boolean
    kbpersec?: string
    speedlimit_abs?: string
    diskspace1?: string
    noofslots?: number
    mbleft?: string
    timeleft?: string
  }
}

/** SAB's numbers come as strings ("12.5"), sometimes empty: never NaN on screen. */
const num = (v: string | undefined) => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? n : 0
}

export async function sabStatus(): Promise<SabStatus> {
  const { queue = {} } = await sabCall<Partial<RawSabQueue>>({ mode: 'queue', limit: '0' })
  return {
    paused: Boolean(queue.paused),
    speedBps: Math.round(num(queue.kbpersec) * 1024),
    limitBps: Math.round(num(queue.speedlimit_abs)),
    diskFreeGb: num(queue.diskspace1),
    jobs: queue.noofslots ?? 0,
    mbLeft: num(queue.mbleft),
    timeLeft: queue.timeleft ?? '',
  }
}

export const sabPauseAll = () => sabCall({ mode: 'pause' })
export const sabResumeAll = () => sabCall({ mode: 'resume' })

/** Set a global speed cap in MB/s; 0 clears the limit. */
export const sabSetLimit = (mbps: number) =>
  sabCall({ mode: 'config', name: 'speedlimit', value: mbps > 0 ? `${mbps}M` : '0' })

/** Pause/resume a single SAB job (nzo id comes from the *arr queue's downloadId). */
export const sabItemPause = (nzoId: string) => sabCall({ mode: 'queue', name: 'pause', value: nzoId })
export const sabItemResume = (nzoId: string) => sabCall({ mode: 'queue', name: 'resume', value: nzoId })
