// How many videos Jellyfin converts at once, on servers Finesse set up: the
// graphics plan's cap (graphics.ts). One at a time on a processor, two while
// a card is shared with game streaming, and a GeForce's own 8. Jellyfin has
// no such setting, so Finesse's Jellyfin proxy keeps it: when the cap is
// reached, a new play that needs a conversion is answered with Jellyfin's
// own "RateLimitExceeded" and a plain message, while anything that plays as
// it is (direct play or direct stream) still plays, and so does a play that
// only converts the sound or the container (the picture is copied: light, and
// not counted either). Someone already watching (the same device) is never
// stopped by their own conversion.

import type { SettingsStore } from './config.ts'
import { builtOf, jellyfinApi } from './stack/graphicsManager.ts'

interface Source {
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  TranscodingUrl?: string
}

/** Why Jellyfin converts that don't touch the picture: the sound, or the container. */
const LIGHT_REASONS = new Set([
  'ContainerNotSupported',
  'ContainerBitrateExceedsLimit',
  'AudioCodecNotSupported',
  'AudioChannelsNotSupported',
  'AudioBitrateNotSupported',
  'AudioSampleRateNotSupported',
  'AudioBitDepthNotSupported',
  'AudioProfileNotSupported',
  'SecondaryAudioNotSupported',
  'UnknownAudioStreamInfo',
  'AudioIsExternal',
])

/**
 * Whether a TranscodingUrl converts the picture (pure). Only Jellyfin's own reasons say it doesn't:
 * every reason is about the sound or the container, and copying the picture is allowed. Unsure: it does.
 */
export function convertsVideo(url: string): boolean {
  let q: URLSearchParams
  try {
    q = new URL(url, 'http://x').searchParams
  } catch {
    return true
  }
  const reasons = (q.get('TranscodeReasons') ?? '').split(',').map((r) => r.trim()).filter(Boolean)
  if (!reasons.length) return true
  if (q.get('allowVideoStreamCopy')?.toLowerCase() === 'false') return true
  return !reasons.every((r) => LIGHT_REASONS.has(r))
}

/** The PlaybackInfo reply when `busy` conversions already run and the cap is `cap` (pure). */
export function capPlaybackInfo(text: string, busy: number, cap: number): string {
  if (busy < cap) return text
  let info: { MediaSources?: Source[]; ErrorCode?: string; FinesseMessage?: string }
  try {
    info = JSON.parse(text)
  } catch {
    return text
  }
  const sources = info.MediaSources ?? []
  // Counted the same way as TranscodeCounter: only a conversion of the picture.
  const needs = (m: Source) => Boolean(m.TranscodingUrl) && !m.SupportsDirectPlay && !m.SupportsDirectStream && convertsVideo(m.TranscodingUrl!)
  if (!sources.length || !sources.every(needs)) return text
  for (const m of sources) delete m.TranscodingUrl
  info.ErrorCode = 'RateLimitExceeded'
  info.FinesseMessage = `This server is already converting ${busy === 1 ? 'a video' : `${busy} videos`} for other people, which is all it can do at once. Try again in a little while: titles that play without converting still play now.`
  return JSON.stringify(info)
}

/** Conversions running now (other devices only), from Jellyfin's sessions; asked at most every 10 s. */
export class TranscodeCounter {
  private last: { at: number; sessions: { device: string; converting: boolean }[] } | null = null
  readonly settings: SettingsStore

  constructor(settings: SettingsStore) {
    this.settings = settings
  }

  async busy(exceptDevice: string | null): Promise<number> {
    if (!this.last || Date.now() - this.last.at > 10000) {
      const r = await jellyfinApi(this.settings.get())('/Sessions?ActiveWithinSeconds=120').catch(() => null)
      const list = Array.isArray(r?.json) ? (r!.json as { DeviceId?: string; TranscodingInfo?: { IsVideoDirect?: boolean } }[]) : []
      this.last = { at: Date.now(), sessions: list.map((x) => ({ device: x.DeviceId ?? '', converting: Boolean(x.TranscodingInfo && x.TranscodingInfo.IsVideoDirect === false) })) }
    }
    return this.last.sessions.filter((x) => x.converting && x.device !== exceptDevice).length
  }

  /** The cap now, or null when there's none (servers Finesse didn't set up, or no plan yet). */
  cap(): number | null {
    const s = this.settings.get()
    return s.mode === 'bundle' ? (builtOf(s.stack?.graphics).jellyfin?.maxTranscodes ?? null) : null
  }
}

/** The device a Jellyfin request comes from (its DeviceId in the auth header). */
export function deviceOf(auth: string): string | null {
  return /DeviceId="([^"]*)"/i.exec(auth)?.[1] ?? null
}
