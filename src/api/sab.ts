import { mediaBrowserAuthHeader } from './client'
import { CONTENT_BASE } from '../lib/contentOrigin'

// SABnzbd remote control, through the same nginx proxy pattern as the *arr apps
// (see nginx.conf): /arr/sab?mode=… → SAB's /api with the apikey appended
// server-side and the caller's Jellyfin token validated by auth_request.
//
// SAB's API is a single endpoint driven by `mode` query params — see
// https://sabnzbd.org/wiki/advanced/api

async function sabCall<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, output: 'json' })
  const res = await fetch(`${CONTENT_BASE}arr/sab?${qs}`, {
    headers: { Authorization: mediaBrowserAuthHeader() },
  })
  if (!res.ok) throw new Error(`SABnzbd: ${res.status} ${res.statusText}`)
  return (await res.json()) as T
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

export async function sabStatus(): Promise<SabStatus> {
  const { queue } = await sabCall<RawSabQueue>({ mode: 'queue', limit: '0' })
  return {
    paused: Boolean(queue.paused),
    speedBps: Math.round(parseFloat(queue.kbpersec ?? '0') * 1024),
    limitBps: Math.round(parseFloat(queue.speedlimit_abs ?? '0') || 0),
    diskFreeGb: parseFloat(queue.diskspace1 ?? '0'),
    jobs: queue.noofslots ?? 0,
    mbLeft: parseFloat(queue.mbleft ?? '0'),
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
