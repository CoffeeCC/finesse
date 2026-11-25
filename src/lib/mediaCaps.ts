// What this device can actually play, asked of its own media engine once, and the Jellyfin
// DeviceProfile built from the answer. A profile written by hand either transcodes what the
// device plays fine (HEVC, MKV, surround sound on Safari, the TV, Android) or promises what it
// can't (AV1 or WebM to an LG TV on Chromium 68, or an older iPhone), and then the video fails.
//
// No imports and no DOM at load time: server/test/media-caps.test.ts runs it under Node with a
// pretend media engine (a probe) for each device.

export type VideoCodec = 'h264' | 'hevc' | 'hevc10' | 'vp8' | 'vp9' | 'av1'
export type AudioCodec = 'aac' | 'mp3' | 'flac' | 'opus' | 'vorbis' | 'ac3' | 'eac3'

export interface MediaCaps {
  video: Record<VideoCodec, boolean>
  audio: Record<AudioCodec, boolean>
  /** Matroska files play as they are (Chromium on Android, the TVs; never Safari). */
  mkv: boolean
  /** WebM plays, with at least one of its video codecs. */
  webm: boolean
  /** Media Source Extensions: transcodes play through hls.js, not the engine's own HLS. */
  mse: boolean
}

/** The two questions a media engine answers: <video>.canPlayType, and MediaSource.isTypeSupported. */
export interface MediaProbe {
  canPlayType(type: string): string
  isTypeSupported?(type: string): boolean
}

// One MIME type per way a codec turns up; any one the engine accepts counts.
const VIDEO_TYPES: Record<VideoCodec, string[]> = {
  h264: ['video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="avc1.640028"'],
  hevc: ['video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"'],
  hevc10: ['video/mp4; codecs="hvc1.2.4.L150.B0"', 'video/mp4; codecs="hev1.2.4.L150.B0"'],
  vp8: ['video/webm; codecs="vp8"'],
  vp9: ['video/webm; codecs="vp9"', 'video/mp4; codecs="vp09.00.10.08"'],
  av1: ['video/mp4; codecs="av01.0.08M.08"', 'video/webm; codecs="av01.0.08M.08"'],
}
const AUDIO_TYPES: Record<AudioCodec, string[]> = {
  aac: ['audio/mp4; codecs="mp4a.40.2"'],
  mp3: ['audio/mpeg', 'audio/mp4; codecs="mp4a.6B"', 'audio/mp4; codecs="mp3"'],
  flac: ['audio/mp4; codecs="flac"', 'audio/flac'],
  opus: ['audio/mp4; codecs="opus"', 'audio/webm; codecs="opus"'],
  vorbis: ['audio/webm; codecs="vorbis"', 'audio/ogg; codecs="vorbis"'],
  ac3: ['audio/mp4; codecs="ac-3"', 'audio/mp4; codecs="mp4a.a5"'],
  eac3: ['audio/mp4; codecs="ec-3"', 'audio/mp4; codecs="mp4a.a6"'],
}
const MKV_TYPES = ['video/x-matroska; codecs="avc1.42E01E"', 'video/x-matroska; codecs="avc1.640028"']
const WEBM_TYPES: Partial<Record<VideoCodec, string>> = { vp8: 'video/webm; codecs="vp8"', vp9: 'video/webm; codecs="vp9"', av1: 'video/webm; codecs="av01.0.08M.08"' }

/** Nothing at all (no DOM, or an engine that throws): H.264 + AAC in MP4, which everything plays. */
const BASELINE: MediaCaps = {
  video: { h264: true, hevc: false, hevc10: false, vp8: false, vp9: false, av1: false },
  audio: { aac: true, mp3: true, flac: false, opus: false, vorbis: false, ac3: false, eac3: false },
  mkv: false,
  webm: false,
  mse: false,
}

/** The browser's own engine, through a <video> that's never attached to the page. */
function browserProbe(): MediaProbe | null {
  if (typeof document === 'undefined') return null
  const v = document.createElement('video')
  if (typeof v.canPlayType !== 'function') return null
  const MS = typeof window !== 'undefined' ? ((window as unknown as { MediaSource?: { isTypeSupported?(t: string): boolean }; ManagedMediaSource?: { isTypeSupported?(t: string): boolean } }).MediaSource ?? (window as unknown as { ManagedMediaSource?: { isTypeSupported?(t: string): boolean } }).ManagedMediaSource) : undefined
  return {
    canPlayType: (t) => v.canPlayType(t),
    ...(MS && typeof MS.isTypeSupported === 'function' ? { isTypeSupported: (t: string) => MS.isTypeSupported!(t) } : {}),
  }
}

function plays(probe: MediaProbe, type: string): boolean {
  try {
    const answer = probe.canPlayType(type)
    if (answer === 'probably' || answer === 'maybe') return true
  } catch {
    /* an engine that throws on a type it doesn't know */
  }
  try {
    return probe.isTypeSupported?.(type) === true
  } catch {
    return false
  }
}

let cached: MediaCaps | null = null

/**
 * What this device plays. With no probe, the browser's own engine is asked once and the answer
 * kept (it can't change while the app is open). A probe passed in is asked every time (tests).
 */
export function detectMediaCaps(probe?: MediaProbe): MediaCaps {
  if (!probe && cached) return cached
  const p = probe ?? browserProbe()
  if (!p) return probe ? BASELINE : (cached = BASELINE)
  const any = (types: string[]) => types.some((t) => plays(p, t))
  const video = Object.fromEntries((Object.keys(VIDEO_TYPES) as VideoCodec[]).map((c) => [c, any(VIDEO_TYPES[c])])) as Record<VideoCodec, boolean>
  const audio = Object.fromEntries((Object.keys(AUDIO_TYPES) as AudioCodec[]).map((c) => [c, any(AUDIO_TYPES[c])])) as Record<AudioCodec, boolean>
  // 10-bit HEVC without HEVC is a confused engine: trust neither.
  if (!video.hevc) video.hevc10 = false
  // Every engine that plays video plays H.264; one that says otherwise is answering badly.
  if (!video.h264 && !video.hevc && !video.vp9 && !video.av1 && !video.vp8) video.h264 = true
  if (!audio.aac && !audio.mp3) audio.aac = true
  const caps: MediaCaps = {
    video,
    audio,
    mkv: video.h264 && any(MKV_TYPES),
    webm: (Object.keys(WEBM_TYPES) as VideoCodec[]).some((c) => video[c] && plays(p, WEBM_TYPES[c]!)),
    mse: typeof p.isTypeSupported === 'function',
  }
  if (!probe) cached = caps
  return caps
}

const list = <T extends string>(all: T[], ok: Record<T, boolean>) => all.filter((c) => ok[c])

/**
 * The DeviceProfile sent with PlaybackInfo: direct play for what the device plays (per
 * container), HLS H.264 for everything else, and the guards that keep Jellyfin from passing
 * through what would fail (10-bit H.264; 10-bit HEVC where only 8-bit decodes).
 * A new object each call: callers adjust it (burn-in caps the transcode at 1080p).
 */
export function buildDeviceProfile(maxBitrate: number, caps: MediaCaps = detectMediaCaps()) {
  const { video: v, audio: a } = caps
  // HEVC is one codec to Jellyfin; its bit depth is a condition below.
  const vc = (codecs: VideoCodec[]) => list(codecs, v).filter((c) => c !== 'hevc10')

  const mp4Video = vc(['h264', 'hevc', 'vp9', 'av1'])
  const mp4Audio = list<AudioCodec>(['aac', 'mp3', 'flac', 'opus', 'ac3', 'eac3'], a)
  const direct: Record<string, unknown>[] = []
  if (mp4Video.length) direct.push({ Container: 'mp4,m4v', Type: 'Video', VideoCodec: mp4Video.join(','), AudioCodec: mp4Audio.join(',') })
  if (caps.mkv) {
    const mkvVideo = vc(['h264', 'hevc', 'vp8', 'vp9', 'av1'])
    const mkvAudio = list<AudioCodec>(['aac', 'mp3', 'flac', 'opus', 'vorbis', 'ac3', 'eac3'], a)
    direct.push({ Container: 'mkv', Type: 'Video', VideoCodec: mkvVideo.join(','), AudioCodec: mkvAudio.join(',') })
  }
  const webmVideo = caps.webm ? vc(['vp8', 'vp9', 'av1']) : []
  const webmAudio = list<AudioCodec>(['vorbis', 'opus'], a)
  if (webmVideo.length && webmAudio.length) direct.push({ Container: 'webm', Type: 'Video', VideoCodec: webmVideo.join(','), AudioCodec: webmAudio.join(',') })

  // The transcode: HLS, MPEG-TS, H.264 (what seeks and plays everywhere). Surround is kept when
  // the device decodes it. AAC stays first: it's what Jellyfin encodes to when it has to.
  // E-AC-3 only where the engine plays the HLS itself (Safari): hls.js doesn't read E-AC-3 in TS.
  const hlsAudio = ['aac', 'mp3', ...(a.ac3 ? ['ac3'] : []), ...(a.eac3 && !caps.mse ? ['eac3'] : [])]
  const surround = hlsAudio.includes('ac3') || hlsAudio.includes('eac3')
  const videoTranscode: Record<string, unknown> = {
    Container: 'ts',
    Type: 'Video',
    VideoCodec: 'h264',
    AudioCodec: hlsAudio.join(','),
    Protocol: 'hls',
    Context: 'Streaming',
    MaxAudioChannels: surround ? '6' : '2',
    MinSegments: 1,
    BreakOnNonKeyFrames: true,
  }

  // 10-bit H.264 ("High 10", common in anime encodes) decodes almost nowhere: not in
  // browsers, phones or the LG TV. Without this, Jellyfin passes it through untouched
  // and the player can't show it, so it converts those to 8-bit instead.
  const codecProfiles: Record<string, unknown>[] = [
    {
      Type: 'Video',
      Codec: 'h264',
      Conditions: [
        { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false },
        { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'high|main|baseline|constrained baseline|progressive high|constrained high', IsRequired: false },
      ],
    },
  ]
  // HEVC Main 10 needs its own decoder support; where only Main decodes, 10-bit is converted.
  if (v.hevc) {
    codecProfiles.push({
      Type: 'Video',
      Codec: 'hevc',
      Conditions: [{ Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: v.hevc10 ? '10' : '8', IsRequired: false }],
    })
  }

  return {
    MaxStreamingBitrate: maxBitrate > 0 ? maxBitrate : 120_000_000,
    MusicStreamingTranscodingBitrate: 320_000,
    DirectPlayProfiles: direct,
    TranscodingProfiles: [
      videoTranscode,
      { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Protocol: 'http', Context: 'Streaming' },
    ] as Record<string, unknown>[],
    SubtitleProfiles: [
      // Encode first so PlaybackInfo can burn-in when SubtitleMethod=Encode.
      { Format: 'vtt', Method: 'Encode' },
      { Format: 'subrip', Method: 'Encode' },
      { Format: 'srt', Method: 'Encode' },
      { Format: 'ass', Method: 'Encode' },
      { Format: 'ssa', Method: 'Encode' },
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
      // External for direct-play + blob <track> path.
      { Format: 'vtt', Method: 'External' },
      { Format: 'subrip', Method: 'External' },
      { Format: 'srt', Method: 'External' },
      { Format: 'ass', Method: 'External' },
      { Format: 'ssa', Method: 'External' },
    ],
    CodecProfiles: codecProfiles,
    ResponseProfiles: [] as unknown[],
  }
}
