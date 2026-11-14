// Where a game request stands, in the words the app shows: on cards, the game's page and the
// requests list. Pure (type imports only) so a server test can check it like requestStatus.ts.

import type { GameRequest } from '../api/gameStore'

export interface GameRequestView {
  /** Short words for a badge: "Downloading 42%". */
  label: string
  /** A second line when there's more to say. */
  detail?: string
  /** 0–100 for the bar. */
  progress?: number
  /** ok = ready, busy = moving, wait = waiting, bad = didn't work, you = needs the person. */
  tone: 'ok' | 'busy' | 'wait' | 'bad' | 'you'
}

export function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return 'under a minute left'
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min left`
  const h = Math.floor(m / 60)
  return `${h} h ${m % 60} min left`
}

export function formatSpeed(bps: number | undefined): string {
  if (!bps || bps <= 0) return ''
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} MB/s`
  return `${Math.max(1, Math.round(bps / 1e3))} KB/s`
}

export function gameRequestView(r: GameRequest): GameRequestView {
  const pct = r.progress === undefined ? undefined : Math.max(0, Math.min(100, Math.round(r.progress)))
  switch (r.state) {
    case 'queued':
      return { label: 'Waiting to download', detail: r.detail, tone: 'wait' }
    case 'downloading': {
      const bits = [formatSpeed(r.bytesPerSecond), formatEta(r.etaSeconds)].filter(Boolean)
      return { label: pct === undefined ? 'Downloading' : `Downloading ${pct}%`, detail: bits.length ? bits.join(' · ') : r.detail, progress: pct, tone: 'busy' }
    }
    case 'paused':
      return { label: pct === undefined ? 'Paused' : `Paused at ${pct}%`, detail: r.detail, progress: pct, tone: 'wait' }
    case 'checking':
      return { label: 'Checking the download', detail: r.detail, tone: 'busy' }
    case 'installing':
      return { label: 'Installing', detail: r.detail, progress: pct, tone: 'busy' }
    case 'needs-you':
      return { label: 'Needs you', detail: r.detail ?? 'The installer is asking questions. Open its screen and click through it.', tone: 'you' }
    case 'finishing':
      return { label: 'Almost ready', detail: r.detail ?? 'Adding it to game streaming', tone: 'busy' }
    case 'ready':
      return { label: 'Ready to play', detail: r.detail, tone: 'ok' }
    case 'failed':
      return { label: 'Didn’t work', detail: r.detail ?? 'Something went wrong. Try again.', tone: 'bad' }
  }
}
