// What each kind of device is told it can play (src/lib/mediaCaps.ts): the DeviceProfile sent
// to Jellyfin is built from what the device's own media engine says it plays, so an iPhone
// plays HEVC with Dolby sound as it is, Chrome plays MKV and AV1, Firefox gets WebM but never
// HEVC, and the LG TV's Chromium 68 is never promised AV1. Each device here is a pretend
// engine answering canPlayType / MediaSource.isTypeSupported the way the real one does.

import assert from 'node:assert/strict'
import { test } from 'node:test'

// A path in a variable: the app's module isn't part of the server's typecheck (it has no DOM types).
const MOD = '../../src/lib/mediaCaps.ts'

type Codecs = Record<string, boolean>
interface Caps {
  video: Codecs
  audio: Codecs
  mkv: boolean
  webm: boolean
  mse: boolean
}
interface Probe {
  canPlayType(type: string): string
  isTypeSupported?(type: string): boolean
}
interface Profile {
  MaxStreamingBitrate: number
  DirectPlayProfiles: { Container: string; Type: string; VideoCodec: string; AudioCodec: string }[]
  TranscodingProfiles: Record<string, unknown>[]
  CodecProfiles: { Type: string; Codec: string; Conditions: { Condition: string; Property: string; Value: string }[] }[]
  SubtitleProfiles: unknown[]
}
const load = async () => (await import(MOD)) as { detectMediaCaps(probe?: Probe): Caps; buildDeviceProfile(maxBitrate: number, caps?: Caps): Profile }

// The MIME types engines are asked about, by what they mean.
const T = {
  h264: ['video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="avc1.640028"'],
  hevc: ['video/mp4; codecs="hvc1.1.6.L120.90"'],
  hev1: ['video/mp4; codecs="hev1.1.6.L120.90"'],
  hevc10: ['video/mp4; codecs="hvc1.2.4.L150.B0"'],
  vp8: ['video/webm; codecs="vp8"'],
  vp9: ['video/webm; codecs="vp9"'],
  vp9mp4: ['video/mp4; codecs="vp09.00.10.08"'],
  av1: ['video/mp4; codecs="av01.0.08M.08"', 'video/webm; codecs="av01.0.08M.08"'],
  mkv: ['video/x-matroska; codecs="avc1.42E01E"', 'video/x-matroska; codecs="avc1.640028"'],
  aac: ['audio/mp4; codecs="mp4a.40.2"'],
  mp3: ['audio/mpeg'],
  flac: ['audio/flac', 'audio/mp4; codecs="flac"'],
  opus: ['audio/webm; codecs="opus"', 'audio/mp4; codecs="opus"'],
  vorbis: ['audio/webm; codecs="vorbis"'],
  ac3: ['audio/mp4; codecs="ac-3"'],
  eac3: ['audio/mp4; codecs="ec-3"'],
}
type Feature = keyof typeof T

/** An engine that plays exactly these; `mse` adds MediaSource.isTypeSupported answering for the same set (or another). */
function engine(plays: Feature[], mse?: Feature[] | true): Probe {
  const yes = new Set(plays.flatMap((f) => T[f]))
  const viaMse = mse === true ? yes : mse ? new Set(mse.flatMap((f) => T[f])) : null
  return {
    canPlayType: (t) => (yes.has(t) ? 'probably' : ''),
    ...(viaMse ? { isTypeSupported: (t: string) => viaMse.has(t) } : {}),
  }
}

const DEVICES = {
  // iOS: HEVC (8- and 10-bit), Dolby Digital and Dolby Digital Plus; no WebM, no MKV; HLS played natively.
  iphone: engine(['h264', 'hevc', 'hevc10', 'aac', 'mp3', 'flac', 'opus', 'ac3', 'eac3']),
  // macOS Safari: the same codecs, through Media Source Extensions.
  macSafari: engine(['h264', 'hevc', 'hevc10', 'aac', 'mp3', 'flac', 'ac3', 'eac3'], true),
  // Desktop Chrome with a hardware HEVC decoder: HEVC, AV1, VP9, MKV and WebM; no Dolby.
  chrome: engine(['h264', 'hevc', 'hevc10', 'vp8', 'vp9', 'vp9mp4', 'av1', 'mkv', 'aac', 'mp3', 'flac', 'opus', 'vorbis'], true),
  // Firefox: VP9, AV1 and WebM; no HEVC, no MKV.
  firefox: engine(['h264', 'vp8', 'vp9', 'av1', 'aac', 'mp3', 'flac', 'opus', 'vorbis'], true),
  // LG CX (webOS 5, Chromium 68): H.264, HEVC (Main only here) and MKV, VP9, Dolby; no AV1 at all.
  webos68: engine(['h264', 'hev1', 'vp9', 'mkv', 'aac', 'mp3', 'ac3', 'eac3'], ['h264', 'hev1', 'vp9', 'aac', 'mp3', 'ac3']),
}

const direct = (p: Profile, container: string) => p.DirectPlayProfiles.find((d) => d.Container === container)
const codecs = (s: string | undefined) => (s ? s.split(',') : [])
const h264Guard = (p: Profile) => p.CodecProfiles.find((c) => c.Codec === 'h264')
const hevcDepth = (p: Profile) => p.CodecProfiles.find((c) => c.Codec === 'hevc')?.Conditions.find((c) => c.Property === 'VideoBitDepth')?.Value
const hls = (p: Profile) => p.TranscodingProfiles[0]!

test('iPhone: HEVC up to 10-bit and Dolby sound play as they are; no WebM or MKV; E-AC-3 kept in HLS (played natively)', async () => {
  const { detectMediaCaps, buildDeviceProfile } = await load()
  const caps = detectMediaCaps(DEVICES.iphone)
  assert.deepEqual([caps.mkv, caps.webm, caps.mse, caps.video.av1], [false, false, false, false])
  const p = buildDeviceProfile(0, caps)
  assert.deepEqual(p.DirectPlayProfiles.map((d) => d.Container), ['mp4,m4v'])
  assert.deepEqual(codecs(direct(p, 'mp4,m4v')?.VideoCodec), ['h264', 'hevc'])
  assert.deepEqual(codecs(direct(p, 'mp4,m4v')?.AudioCodec), ['aac', 'mp3', 'flac', 'opus', 'ac3', 'eac3'])
  assert.equal(hevcDepth(p), '10')
  assert.deepEqual([hls(p).AudioCodec, hls(p).MaxAudioChannels], ['aac,mp3,ac3,eac3', '6'])
})

test('macOS Safari: the same, but its HLS goes through hls.js, which can’t read E-AC-3 in MPEG-TS', async () => {
  const { detectMediaCaps, buildDeviceProfile } = await load()
  const p = buildDeviceProfile(0, detectMediaCaps(DEVICES.macSafari))
  assert.deepEqual(p.DirectPlayProfiles.map((d) => d.Container), ['mp4,m4v'])
  assert.deepEqual(codecs(direct(p, 'mp4,m4v')?.AudioCodec), ['aac', 'mp3', 'flac', 'ac3', 'eac3'], 'direct play keeps both')
  assert.deepEqual([hls(p).AudioCodec, hls(p).MaxAudioChannels], ['aac,mp3,ac3', '6'])
})

test('desktop Chrome: HEVC, AV1 and VP9 in MP4; MKV and WebM direct; no Dolby, so stereo transcodes', async () => {
  const { detectMediaCaps, buildDeviceProfile } = await load()
  const caps = detectMediaCaps(DEVICES.chrome)
  assert.deepEqual([caps.mkv, caps.webm], [true, true])
  const p = buildDeviceProfile(0, caps)
  assert.deepEqual(p.DirectPlayProfiles.map((d) => d.Container), ['mp4,m4v', 'mkv', 'webm'])
  assert.deepEqual(codecs(direct(p, 'mp4,m4v')?.VideoCodec), ['h264', 'hevc', 'vp9', 'av1'])
  assert.deepEqual(codecs(direct(p, 'mkv')?.VideoCodec), ['h264', 'hevc', 'vp8', 'vp9', 'av1'])
  assert.deepEqual(codecs(direct(p, 'webm')?.VideoCodec), ['vp8', 'vp9', 'av1'])
  assert.deepEqual(codecs(direct(p, 'webm')?.AudioCodec), ['vorbis', 'opus'])
  for (const d of p.DirectPlayProfiles) assert.equal(/ac3/.test(d.AudioCodec), false, `${d.Container}: no Dolby`)
  assert.deepEqual([hls(p).AudioCodec, hls(p).MaxAudioChannels], ['aac,mp3', '2'])
  assert.equal(hevcDepth(p), '10')
})

test('Firefox: WebM with VP8, VP9 and AV1; never HEVC or MKV', async () => {
  const { detectMediaCaps, buildDeviceProfile } = await load()
  const p = buildDeviceProfile(0, detectMediaCaps(DEVICES.firefox))
  assert.deepEqual(p.DirectPlayProfiles.map((d) => d.Container), ['mp4,m4v', 'webm'])
  assert.deepEqual(codecs(direct(p, 'mp4,m4v')?.VideoCodec), ['h264', 'vp9', 'av1'], 'VP9 in MP4 counts when WebM VP9 plays')
  assert.deepEqual(codecs(direct(p, 'webm')?.VideoCodec), ['vp8', 'vp9', 'av1'])
  assert.equal(JSON.stringify(p.DirectPlayProfiles).includes('hevc'), false)
  assert.equal(hevcDepth(p), undefined, 'no HEVC guard where there’s no HEVC')
})

test('LG CX (Chromium 68): H.264, 8-bit HEVC and MKV direct, with Dolby; AV1 never offered', async () => {
  const { detectMediaCaps, buildDeviceProfile } = await load()
  const caps = detectMediaCaps(DEVICES.webos68)
  assert.deepEqual([caps.video.av1, caps.video.hevc, caps.video.hevc10, caps.mkv, caps.webm], [false, true, false, true, true])
  const p = buildDeviceProfile(0, caps)
  assert.equal(JSON.stringify(p.DirectPlayProfiles).includes('av1'), false)
  // WebM's VP9 decodes, but neither Vorbis nor Opus: a WebM file would play silent, so it's converted.
  assert.deepEqual(p.DirectPlayProfiles.map((d) => d.Container), ['mp4,m4v', 'mkv'])
  assert.deepEqual(codecs(direct(p, 'mkv')?.VideoCodec), ['h264', 'hevc', 'vp9'])
  assert.deepEqual(codecs(direct(p, 'mkv')?.AudioCodec), ['aac', 'mp3', 'ac3', 'eac3'])
  assert.equal(hevcDepth(p), '8', 'only Main decodes: 10-bit HEVC is converted')
  assert.deepEqual([hls(p).AudioCodec, hls(p).MaxAudioChannels], ['aac,mp3,ac3', '6'])
})

test('WebM is only offered with a codec and a sound it plays', async () => {
  const { detectMediaCaps, buildDeviceProfile } = await load()
  // The TV case above: VP9 in WebM but neither Vorbis nor Opus. A WebM file there has one of those.
  const tv = buildDeviceProfile(0, detectMediaCaps(engine(['h264', 'vp9', 'aac'])))
  assert.equal(direct(tv, 'webm'), undefined)
  // An engine that knows WebM but none of its video codecs.
  const none = detectMediaCaps(engine(['h264', 'aac', 'opus']))
  assert.equal(none.webm, false)
})

test('the bitrate cap, and a fresh profile each time (burn-in narrows its own copy)', async () => {
  const { detectMediaCaps, buildDeviceProfile } = await load()
  const caps = detectMediaCaps(DEVICES.chrome)
  assert.equal(buildDeviceProfile(8_000_000, caps).MaxStreamingBitrate, 8_000_000)
  assert.equal(buildDeviceProfile(0, caps).MaxStreamingBitrate, 120_000_000, 'no cap: the most Jellyfin will send')
  assert.equal(buildDeviceProfile(-1, caps).MaxStreamingBitrate, 120_000_000)
  const a = buildDeviceProfile(0, caps)
  a.TranscodingProfiles[0]!.MaxWidth = 1920
  assert.equal(buildDeviceProfile(0, caps).TranscodingProfiles[0]!.MaxWidth, undefined)
  // The rest of the transcode is the rock-solid path, on every device.
  for (const probe of Object.values(DEVICES)) {
    const t = hls(buildDeviceProfile(0, detectMediaCaps(probe)))
    assert.deepEqual([t.Container, t.VideoCodec, t.Protocol, t.Context, t.BreakOnNonKeyFrames], ['ts', 'h264', 'hls', 'Streaming', true])
    assert.match(String(t.AudioCodec), /^aac,mp3/)
  }
})

test('10-bit H.264 is never passed through, on any device', async () => {
  const { detectMediaCaps, buildDeviceProfile } = await load()
  for (const [name, probe] of Object.entries(DEVICES)) {
    const g = h264Guard(buildDeviceProfile(0, detectMediaCaps(probe)))
    assert.ok(g, name)
    assert.deepEqual(g.Conditions[0], { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false }, name)
    assert.match(g.Conditions[1]!.Value, /^high\|main\|baseline/, name)
  }
})

test('asked once and kept; with no media engine at all, H.264 and AAC in MP4', async () => {
  const { detectMediaCaps, buildDeviceProfile } = await load()
  // Under Node there's no <video>: the safe baseline, kept.
  const first = detectMediaCaps()
  assert.equal(detectMediaCaps(), first, 'the same answer object: not asked again')
  const p = buildDeviceProfile(0, first)
  assert.deepEqual(p.DirectPlayProfiles, [{ Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3' }])
  assert.equal(buildDeviceProfile(0).DirectPlayProfiles.length, 1, 'the default caps are those')
  // A probe passed in is always asked (and never replaces what was kept).
  let asked = 0
  const counting: Probe = { canPlayType: (t) => (asked++, T.h264.includes(t) ? 'probably' : '') }
  detectMediaCaps(counting)
  const once = asked
  detectMediaCaps(counting)
  assert.equal(asked, once * 2)
  assert.equal(detectMediaCaps(), first)
})

test('an engine that throws or answers nothing still gets something that plays', async () => {
  const { detectMediaCaps, buildDeviceProfile } = await load()
  const throws: Probe = {
    canPlayType: () => {
      throw new Error('not here')
    },
    isTypeSupported: () => {
      throw new Error('nor here')
    },
  }
  const p = buildDeviceProfile(0, detectMediaCaps(throws))
  assert.deepEqual(p.DirectPlayProfiles, [{ Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac' }])
  // "maybe" counts (older engines answer that for most codecs).
  const maybe = detectMediaCaps({ canPlayType: (t) => (t.includes('hvc1.1') || T.h264.includes(t) ? 'maybe' : '') })
  assert.equal(maybe.video.hevc, true)
})
