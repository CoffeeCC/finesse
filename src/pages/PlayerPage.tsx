import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Hls from 'hls.js'
import * as api from '../api/client'
import { useItem, useSeriesEpisodes } from '../api/queries'
import { getPrefs, setPrefs, BITRATE_OPTIONS } from '../lib/settings'
import { secondsToTicks, ticksToSeconds } from '../api/types'
import type { JfItem, JfMediaStream, JfTrickplayInfo } from '../api/types'

const PROGRESS_INTERVAL_MS = 10_000
const NEXT_CARD_FALLBACK_SECONDS = 25
const NEXT_COUNTDOWN = 10

/** Image-based subs need burn-in (stream renegotiate). Text can use <track>. */
function isImageSubtitle(m?: JfMediaStream): boolean {
  if (!m) return false
  const codec = (m.Codec ?? '').toLowerCase()
  if (/pgs|hdmv|dvd|vobsub|xsub|rle|dvb/.test(codec)) return true
  if (m.IsTextSubtitleStream || m.IsExternal || m.DeliveryUrl) return false
  if (/srt|subrip|vtt|webvtt|ass|ssa|mov_text|tx3g|text/.test(codec)) return false
  return true
}

function isTextSubtitle(m?: JfMediaStream): boolean {
  return !!m && !isImageSubtitle(m)
}

/** Absolute VTT URL for a subtitle stream (uses Jellyfin DeliveryUrl when present). */
function subtitleVttUrl(
  itemId: string,
  mediaSourceId: string,
  stream: JfMediaStream,
): string {
  const session = api.getSession()!
  let path =
    stream.DeliveryUrl ||
    `/Videos/${itemId}/${mediaSourceId}/Subtitles/${stream.Index}/Stream.vtt`
  // Force the .vtt extraction endpoint. When the device profile advertises
  // ass/ssa/srt External delivery, Jellyfin hands back a DeliveryUrl in the
  // subtitle's ORIGINAL format (e.g. .../Stream.ass) — the <track> element can
  // only parse WebVTT, so raw ASS loads with zero cues (no subtitles). JF will
  // transcode srt/ass/ssa → WebVTT on the fly when we ask for Stream.vtt.
  path = path.replace(/Stream\.[A-Za-z0-9]+(?=$|\?)/, 'Stream.vtt')
  // Prefer server-provided DeliveryUrl (correct hyphenated IDs). Always ensure api_key.
  if (!path.startsWith('http')) path = `${session.server}${path}`
  if (!/[?&]api_?key=/i.test(path)) {
    path += (path.includes('?') ? '&' : '?') + `api_key=${encodeURIComponent(session.token)}`
  }
  return path
}

/** Fetch VTT with the session token so Funnel/CORS can't kill the <track>. */
async function fetchVttText(vttUrl: string): Promise<string> {
  const session = api.getSession()!
  const res = await fetch(vttUrl, {
    headers: {
      Authorization: api.mediaBrowserAuthHeader(),
      'X-Emby-Token': session.token,
    },
  })
  if (!res.ok) throw new Error(`Subtitle fetch ${res.status}`)
  const text = await res.text()
  const trimmed = text.trimStart()
  // Already WebVTT (the normal case now we force the Stream.vtt endpoint).
  if (trimmed.startsWith('WEBVTT')) return text
  // SRT-ish (has cue arrows but no header) — browsers want the WEBVTT header.
  if (trimmed.includes('-->')) return `WEBVTT\n\n${text}`
  // Anything else (e.g. raw ASS "[Script Info]") can't drive a <track>; wrapping
  // it in a header just yields zero cues. Fail so the caller falls back to burn-in.
  throw new Error('Subtitle payload is not WebVTT/SRT')
}

function parseVttTime(h: string | undefined, m: string, s: string, ms: string): number {
  const hours = h ? Number(h.replace(':', '')) : 0
  return hours * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
}

function formatVttTime(sec: number): string {
  if (sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const ms = Math.round((sec - Math.floor(sec)) * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return h > 0
    ? `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`
    : `${pad(m)}:${pad(s)}.${pad(ms, 3)}`
}

/** Shift all cue timestamps in a VTT by delaySec (positive = subs later). */
function shiftVtt(vtt: string, delaySec: number): string {
  if (!delaySec) return vtt
  return vtt.replace(
    /(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})/g,
    (_m, h1, m1, s1, ms1, h2, m2, s2, ms2) => {
      const t1 = Math.max(0, parseVttTime(h1, m1, s1, ms1) + delaySec)
      const t2 = Math.max(0, parseVttTime(h2, m2, s2, ms2) + delaySec)
      return `${formatVttTime(t1)} --> ${formatVttTime(t2)}`
    },
  )
}

function vttToBlobUrl(vtt: string): string {
  return URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
}

const SUB_DELAY_KEY = 'finesse.subDelayMs'
const SUB_DELAY_STEP_MS = 100
const SUB_DELAY_STEP_LARGE_MS = 500

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

interface StreamInfo {
  playSessionId: string
  mediaSourceId: string
  transcoding: boolean
  offsetSec: number
  mediaStreams: JfMediaStream[]
  container?: string
  sourceBitrate?: number
  transcodeReasons?: string
}

function mbps(bps?: number): string {
  return bps ? `${(bps / 1_000_000).toFixed(1)} Mbps` : '—'
}

function StatsOverlay({
  tick,
  stream,
  video,
  hls,
  absTime,
  bufferedAbs,
  item,
  onClose,
}: {
  tick: number
  stream: StreamInfo | null
  video: HTMLVideoElement | null
  hls: Hls | null
  absTime: number
  bufferedAbs: number
  item: JfItem | undefined
  onClose: () => void
}) {
  const vStream = stream?.mediaStreams.find((m) => m.Type === 'Video')
  const aStream = stream?.mediaStreams.find((m) => m.Type === 'Audio')
  const q = video?.getVideoPlaybackQuality?.()
  const level = hls && hls.currentLevel >= 0 ? hls.levels?.[hls.currentLevel] : undefined
  const rows: [string, string][] = [
    ['Title', item?.Name ?? '—'],
    ['Play method', stream ? (stream.transcoding ? 'Transcode' : 'Direct Play') : '—'],
    ...(stream?.transcoding && stream.transcodeReasons
      ? ([['Transcode reason', stream.transcodeReasons]] as [string, string][])
      : []),
    [
      'Source',
      vStream
        ? `${(stream?.container ?? '').toUpperCase()} · ${vStream.Codec?.toUpperCase()} ${vStream.Width}×${vStream.Height}`
        : '—',
    ],
    ['Source bitrate', mbps(stream?.sourceBitrate)],
    ['Audio', aStream ? `${aStream.Codec?.toUpperCase()} ${aStream.DisplayTitle ?? ''}` : '—'],
    ['Playing res', video?.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '—'],
    ['Buffered ahead', `${Math.max(0, bufferedAbs - absTime).toFixed(1)} s`],
    [
      'Dropped frames',
      q ? `${q.droppedVideoFrames} / ${q.totalVideoFrames}` : 'n/a',
    ],
    ...(hls
      ? ([
          ['Connection est.', mbps(hls.bandwidthEstimate)],
          ['Stream level', level ? mbps(level.bitrate) : 'auto'],
        ] as [string, string][])
      : []),
    ['Position', `${absTime.toFixed(0)} s`],
    ['Session', stream?.playSessionId?.slice(0, 12) ?? '—'],
  ]
  return (
    <div
      data-tick={tick}
      className="absolute top-16 left-4 z-30 w-[22rem] max-w-[90vw] rounded-xl bg-black/80 backdrop-blur-md border border-white/10 p-3 font-mono text-[11px] leading-relaxed text-ink-200 shadow-2xl"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-white">Stats for nerds</span>
        <button onClick={onClose} className="text-ink-400 hover:text-white" aria-label="Close stats">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3">
          <span className="text-ink-400 w-32 shrink-0">{k}</span>
          <span className="text-white break-all">{v}</span>
        </div>
      ))}
    </div>
  )
}

export default function PlayerPage() {
  const { itemId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const startTicks = Number(searchParams.get('t') ?? 0)

  const { data: item } = useItem(itemId)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const streamRef = useRef<StreamInfo | null>(null)

  const [error, setError] = useState('')
  const [buffering, setBuffering] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [absTime, setAbsTime] = useState(ticksToSeconds(startTicks))
  const [bufferedAbs, setBufferedAbs] = useState(0)
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('finesse.volume') ?? 1))
  const [muted, setMuted] = useState(() => localStorage.getItem('finesse.muted') === '1')
  const [fullscreen, setFullscreen] = useState(false)
  const [menu, setMenu] = useState<'audio' | 'subs' | 'quality' | null>(null)
  const [maxBitrate, setMaxBitrate] = useState<number>(() => getPrefs().maxBitrate)
  const [audioIndex, setAudioIndex] = useState<number | undefined>(undefined)
  const [subIndex, setSubIndex] = useState<number>(-1)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [showStats, setShowStats] = useState(false)
  const [statsTick, setStatsTick] = useState(0)
  const [hover, setHover] = useState<{ frac: number; x: number } | null>(null)
  const [segments, setSegments] = useState<api.JfMediaSegment[]>([])
  const [nextCancelled, setNextCancelled] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)

  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const seekbarRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  // Per-series remembered audio/sub languages, and a once-per-item apply guard.
  const trackPrefsRef = useRef<Record<string, api.TrackPref>>({})
  const tracksApplied = useRef(false)
  /** True while the user is dragging the scrubber (visual-only until pointer up). */
  const scrubbingRef = useRef(false)
  /** Bumps so React re-renders when stream mediaSourceId becomes available (trickplay). */
  const [streamGen, setStreamGen] = useState(0)
  /** Object-URL for authenticated VTT (revoked on change). */
  const [subBlobUrl, setSubBlobUrl] = useState<string | null>(null)
  const subBlobUrlRef = useRef<string | null>(null)
  /** Raw VTT text (unshifted) so delay can be re-applied without re-fetch. */
  const subVttRawRef = useRef<string | null>(null)
  /** True when overlay text track is active (shows delay controls). */
  const [hasOverlaySubs, setHasOverlaySubs] = useState(false)
  /** True when current stream was negotiated with SubtitleStreamIndex burn-in. */
  const burnedInSubRef = useRef(false)
  /** Subtitle timing offset in ms (positive = show later). */
  const [subDelayMs, setSubDelayMs] = useState(() => {
    try {
      const n = Number(localStorage.getItem(SUB_DELAY_KEY))
      return Number.isFinite(n) ? Math.round(n) : 0
    } catch {
      return 0
    }
  })

  const revokeSubBlob = useCallback(() => {
    if (subBlobUrlRef.current) {
      URL.revokeObjectURL(subBlobUrlRef.current)
      subBlobUrlRef.current = null
    }
    setSubBlobUrl(null)
    setHasOverlaySubs(false)
  }, [])

  const applySubBlobFromRaw = useCallback(
    (raw: string, delayMs: number) => {
      const shifted = shiftVtt(raw, delayMs / 1000)
      const blobUrl = vttToBlobUrl(shifted)
      if (subBlobUrlRef.current) URL.revokeObjectURL(subBlobUrlRef.current)
      subBlobUrlRef.current = blobUrl
      setSubBlobUrl(blobUrl)
      setHasOverlaySubs(true)
      requestAnimationFrame(() => {
        const v = videoRef.current
        if (!v) return
        for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = 'showing'
      })
    },
    [],
  )

  const nudgeSubDelay = useCallback(
    (deltaMs: number) => {
      setSubDelayMs((prev) => {
        const next = Math.max(-30_000, Math.min(30_000, prev + deltaMs))
        try {
          localStorage.setItem(SUB_DELAY_KEY, String(next))
        } catch {
          /* ignore */
        }
        if (subVttRawRef.current) {
          applySubBlobFromRaw(subVttRawRef.current, next)
        }
        return next
      })
    },
    [applySubBlobFromRaw],
  )

  // Load the user's saved per-series track preferences once.
  useEffect(() => {
    api.getTrackPrefs().then((p) => (trackPrefsRef.current = p)).catch(() => {})
  }, [])

  const durationSec = ticksToSeconds(item?.RunTimeTicks)

  // ---------- Prev / next episode (whole series, crosses seasons) ----------
  const { data: seriesEps } = useSeriesEpisodes(
    item?.Type === 'Episode' ? item.SeriesId : undefined,
  )
  const { prevEp, nextEp } = useMemo(() => {
    if (!item || item.Type !== 'Episode' || !seriesEps?.Items?.length) {
      return { prevEp: undefined as JfItem | undefined, nextEp: undefined as JfItem | undefined }
    }
    const i = seriesEps.Items.findIndex((e) => e.Id === item.Id)
    if (i < 0) return { prevEp: undefined, nextEp: undefined }
    return {
      prevEp: i > 0 ? seriesEps.Items[i - 1] : undefined,
      nextEp: i < seriesEps.Items.length - 1 ? seriesEps.Items[i + 1] : undefined,
    }
  }, [item, seriesEps])

  // ---------- Stream lifecycle ----------
  const positionTicks = useCallback(() => {
    const v = videoRef.current
    const s = streamRef.current
    if (!v || !s) return 0
    return secondsToTicks(s.offsetSec + v.currentTime)
  }, [])

  const report = useCallback(
    (
      fn: (r: {
        itemId: string
        mediaSourceId: string
        playSessionId: string
        positionTicks: number
        isPaused?: boolean
      }) => unknown,
      isPaused?: boolean,
    ) => {
      const s = streamRef.current
      if (s && itemId) {
        fn({
          itemId,
          mediaSourceId: s.mediaSourceId,
          playSessionId: s.playSessionId,
          positionTicks: positionTicks(),
          isPaused,
        })
      }
    },
    [itemId, positionTicks],
  )

  const teardownStream = useCallback((stopEncoding: boolean) => {
    const s = streamRef.current
    hlsRef.current?.destroy()
    hlsRef.current = null
    if (stopEncoding && s?.transcoding && s.playSessionId) {
      api.stopActiveEncoding(s.playSessionId)
    }
  }, [])

  const loadStream = useCallback(
    async (atTicks: number, audio?: number, sub?: number) => {
      const video = videoRef.current
      if (!video || !itemId) return
      // Capture resume BEFORE teardown so subtitle toggles don't lose place.
      const resumeSec = Math.max(0, ticksToSeconds(atTicks))
      const prevMediaSourceId = streamRef.current?.mediaSourceId || itemId
      setAbsTime(resumeSec)
      setBuffering(true)
      setError('')
      teardownStream(true)
      try {
        const subIdx = sub === undefined || sub === -1 ? undefined : sub
        burnedInSubRef.current = subIdx !== undefined
        const info = await api.getPlaybackInfo(
          itemId,
          atTicks,
          audio,
          subIdx,
          prevMediaSourceId,
        )
        const source = info.MediaSources[0]
        if (!source) throw new Error('No playable media source')

        let url: string
        let transcoding = false
        // Prefer HLS when burning subs or when direct play isn't offered.
        if (source.TranscodingUrl && (subIdx !== undefined || !source.SupportsDirectPlay)) {
          url = api.transcodeUrl(source.TranscodingUrl)
          transcoding = true
        } else if (source.SupportsDirectPlay) {
          url = api.directStreamUrl(itemId, source.Id, source.Container)
        } else if (source.TranscodingUrl) {
          url = api.transcodeUrl(source.TranscodingUrl)
          transcoding = true
        } else {
          throw new Error('Server offered no playback method')
        }

        // Confirm burn-in actually landed on the URL (JF silently drops it without MediaSourceId).
        if (subIdx !== undefined && transcoding && !/[?&]SubtitleStreamIndex=/.test(url)) {
          url += `&SubtitleStreamIndex=${subIdx}&SubtitleMethod=Encode&allowVideoStreamCopy=false`
        }

        // Full VOD HLS timeline: offsetSec stays 0; we seek to resumeSec after parse.
        // (Do NOT put StartTimeTicks on the URL — JF returns 400 on segments.)
        streamRef.current = {
          playSessionId: info.PlaySessionId,
          mediaSourceId: source.Id,
          transcoding,
          offsetSec: 0,
          mediaStreams: source.MediaStreams ?? [],
          container: source.Container,
          sourceBitrate: source.Bitrate,
          transcodeReasons: decodeURIComponent(
            source.TranscodingUrl?.match(/TranscodeReasons=([^&]+)/)?.[1] ?? '',
          ).replace(/,/g, ', '),
        }
        setStreamGen((n) => n + 1)

        const applyResumeSeek = () => {
          if (resumeSec <= 0) {
            setAbsTime(0)
            return
          }
          try {
            const dur = video.duration
            if (Number.isFinite(dur) && dur > 0) {
              video.currentTime = Math.min(resumeSec, Math.max(0, dur - 0.5))
            } else {
              video.currentTime = resumeSec
            }
          } catch {
            /* ignore */
          }
          setAbsTime(resumeSec)
        }

        if (url.includes('.m3u8') && Hls.isSupported()) {
          const hls = new Hls({
            maxBufferLength: 60,
            backBufferLength: 30,
            // Seek into the VOD playlist at the resume point (works for JF full VOD HLS)
            startPosition: resumeSec > 1 ? resumeSec : -1,
          })
          hlsRef.current = hls
          hls.loadSource(url)
          hls.attachMedia(video)
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) {
              setError(
                data.details
                  ? `Playback failed (${data.type}: ${data.details})`
                  : `Playback failed (${data.type})`,
              )
              setBuffering(false)
            }
          })
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            applyResumeSeek()
            setBuffering(false)
            video.play().catch(() => {})
          })
          hls.on(Hls.Events.FRAG_BUFFERED, () => {
            const s = streamRef.current
            if (s && video) setAbsTime(s.offsetSec + video.currentTime)
          })
        } else {
          video.src = url
          if (resumeSec > 0) {
            video.addEventListener('loadedmetadata', applyResumeSeek)
            video.addEventListener('loadeddata', applyResumeSeek)
            video.addEventListener('canplay', applyResumeSeek, { once: true })
          }
          await video.play().catch(() => {})
          setBuffering(false)
        }

        report(api.reportPlaybackStart)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start playback')
        setBuffering(false)
      }
    },
    [itemId, report, teardownStream],
  )

  // Initial load + cleanup
  useEffect(() => {
    setError('')
    setNextCancelled(false)
    setCountdown(null)
    setSubIndex(-1)
    setAudioIndex(undefined)
    tracksApplied.current = false
    burnedInSubRef.current = false
    subVttRawRef.current = null
    revokeSubBlob()
    loadStream(startTicks)

    const progressTimer = setInterval(
      () => report(api.reportPlaybackProgress, videoRef.current?.paused),
      PROGRESS_INTERVAL_MS,
    )
    api.getMediaSegments(itemId!).then(
      (r) => setSegments(r.Items ?? []),
      () => setSegments([]),
    )

    return () => {
      clearInterval(progressTimer)
      report(api.reportPlaybackStopped)
      teardownStream(true)
      revokeSubBlob()
      const v = videoRef.current
      if (v) {
        v.removeAttribute('src')
        v.load()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, startTicks])

  // ---------- Video element events ----------
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => {
      const s = streamRef.current
      if (!s) return
      setAbsTime(s.offsetSec + v.currentTime)
      // A firing 'timeupdate' means the media time actually advanced, i.e. we're
      // playing — the reliable "not buffering" signal. webOS Chromium 68 doesn't
      // fire 'playing'/'canplay' dependably after a mid-stream stall, so the
      // spinner would otherwise hang forever.
      if (!v.paused) setBuffering(false)
      try {
        const b = v.buffered
        if (b.length) setBufferedAbs(s.offsetSec + b.end(b.length - 1))
      } catch {
        /* buffered can throw during teardown */
      }
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => {
      setPlaying(false)
      report(api.reportPlaybackProgress, true)
    }
    const onSeeked = () => report(api.reportPlaybackProgress, v.paused)
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('playing', onPlaying)
    v.addEventListener('canplay', onPlaying)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('playing', onPlaying)
      v.removeEventListener('canplay', onPlaying)
    }
  }, [report])

  // Volume
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = volume
    v.muted = muted
    localStorage.setItem('finesse.volume', String(volume))
    localStorage.setItem('finesse.muted', muted ? '1' : '0')
  }, [volume, muted])

  // ---------- Actions ----------
  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [])

  const seekTo = useCallback(
    (absSec: number) => {
      const v = videoRef.current
      const s = streamRef.current
      if (!v || !s) return
      absSec = Math.max(0, Math.min(absSec, durationSec || absSec))
      setAbsTime(absSec)

      const subArg = subIndex === -1 ? undefined : subIndex
      const renegotiate = () => {
        setBuffering(true)
        loadStream(secondsToTicks(absSec), audioIndex, subArg)
      }

      // ----- Direct play: full media timeline -----
      if (!s.transcoding) {
        try {
          v.currentTime = absSec
        } catch {
          renegotiate()
          return
        }
        if (absSec > 5) {
          window.setTimeout(() => {
            const vv = videoRef.current
            const ss = streamRef.current
            if (!vv || !ss || ss.transcoding) return
            // Seek was ignored (common on some mkv remuxes) → new stream at target.
            if (Math.abs(vv.currentTime - absSec) > 5) {
              loadStream(secondsToTicks(absSec), audioIndex, subArg)
            }
          }, 400)
        }
        return
      }

      // ----- Transcode / HLS: full VOD timeline (offsetSec is 0) -----
      // Prefer in-playlist seek. Only renegotiate when the engine ignores it.
      const rel = absSec - s.offsetSec
      try {
        v.currentTime = Math.max(0, rel)
      } catch {
        renegotiate()
        return
      }
      if (absSec > 5) {
        window.setTimeout(() => {
          const vv = videoRef.current
          const ss = streamRef.current
          if (!vv || !ss) return
          const now = ss.offsetSec + vv.currentTime
          if (Math.abs(now - absSec) > 10) {
            loadStream(secondsToTicks(absSec), audioIndex, subArg)
          }
        }, 500)
      }
    },
    [durationSec, loadStream, audioIndex, subIndex],
  )

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }, [])
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const langOfStream = (idx: number) =>
    streamRef.current?.mediaStreams.find((m) => m.Index === idx)?.Language ?? undefined

  /** Absolute playback position right now (prefer live video clock over React state). */
  const liveAbsSec = () => {
    const v = videoRef.current
    const s = streamRef.current
    if (v && s) return s.offsetSec + v.currentTime
    return absTime
  }

  /** Fetch a text subtitle and paint it as an overlay <track> (no stream
   *  restart, and the delay slider works). Falls back to a burn-in transcode
   *  if the VTT can't be fetched/parsed. */
  const loadTextSubOverlay = (chosen: JfMediaStream, atSec: number) => {
    const s = streamRef.current
    if (!s || !itemId) return
    burnedInSubRef.current = false
    const vttUrl = subtitleVttUrl(itemId, s.mediaSourceId, chosen)
    fetchVttText(vttUrl)
      .then((raw) => {
        subVttRawRef.current = raw
        applySubBlobFromRaw(raw, subDelayMs)
      })
      .catch(() => {
        // Fallback: burn-in (no client-side delay on that path).
        burnedInSubRef.current = true
        loadStream(secondsToTicks(atSec), audioIndex, chosen.Index)
      })
  }

  const changeAudio = (idx: number) => {
    const at = liveAbsSec()
    setAudioIndex(idx)
    setMenu(null)
    setAbsTime(at)
    loadStream(secondsToTicks(at), idx, subIndex === -1 ? undefined : subIndex)
    rememberTrack({ audioLang: langOfStream(idx) })
  }
  const changeSub = (idx: number) => {
    const at = liveAbsSec()
    const streams = streamRef.current?.mediaStreams ?? []
    const chosen =
      idx === -1 ? undefined : streams.find((m) => m.Type === 'Subtitle' && m.Index === idx)
    const lang = chosen?.Language
    setMenu(null)
    rememberTrack({ subLang: idx === -1 ? 'off' : lang })
    setSubIndex(idx)
    setAbsTime(at)
    revokeSubBlob()
    subVttRawRef.current = null

    const s = streamRef.current
    const wasBurnedIn = burnedInSubRef.current

    // Off: drop burn-in stream if we had one, otherwise just hide tracks.
    if (idx === -1) {
      if (wasBurnedIn) {
        burnedInSubRef.current = false
        loadStream(secondsToTicks(at), audioIndex, undefined)
      } else {
        requestAnimationFrame(() => {
          const v = videoRef.current
          if (!v) return
          for (let i = 0; i < v.textTracks.length; i++) v.textTracks[i].mode = 'disabled'
        })
      }
      return
    }

    // Image-based (PGS etc.) must burn-in. Text (srt/vtt) prefer overlay track
    // even during HLS transcode — no restart, and delay slider works.
    if (isImageSubtitle(chosen) || !s || !itemId || !chosen) {
      burnedInSubRef.current = true
      loadStream(secondsToTicks(at), audioIndex, idx)
      return
    }

    loadTextSubOverlay(chosen, at)
  }
  const changeQuality = (bitrate: number) => {
    const at = liveAbsSec()
    setPrefs({ maxBitrate: bitrate })
    setMaxBitrate(bitrate)
    setMenu(null)
    setAbsTime(at)
    // Re-negotiate the stream at the new cap from the current position
    loadStream(secondsToTicks(at), audioIndex, subIndex === -1 ? undefined : subIndex)
  }

  // Live-refresh the stats panel while it's open
  useEffect(() => {
    if (!showStats) return
    const t = setInterval(() => setStatsTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [showStats])

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      // Let Enter activate a focused control (Skip Intro, Next episode) rather
      // than toggling play out from under it.
      const onControl = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'Enter': // TV remote OK button
          if (onControl) return
          e.preventDefault()
          togglePlay()
          break
        // On TV the arrows drive focus between the on-screen controls (see the
        // player-focus effect); only a mouse/keyboard build seeks/adjusts here.
        case 'ArrowLeft':
          if (__WEBOS__) break
          seekTo(absTime - 10)
          break
        case 'ArrowRight':
          if (__WEBOS__) break
          seekTo(absTime + 10)
          break
        case 'ArrowUp':
          if (__WEBOS__) break
          e.preventDefault()
          setVolume((v) => Math.min(1, v + 0.05))
          break
        case 'ArrowDown':
          if (__WEBOS__) break
          e.preventDefault()
          setVolume((v) => Math.max(0, v - 0.05))
          break
        case 'm':
          setMuted((m) => !m)
          break
        case 'f':
          toggleFullscreen()
          break
        case 's':
          setShowStats((v) => !v)
          break
        case 'n':
        case 'N':
          if (nextEp) {
            e.preventDefault()
            navigate(`/play/${nextEp.Id}`, { replace: true })
          }
          break
        case 'p':
        case 'P':
          if (prevEp) {
            e.preventDefault()
            navigate(`/play/${prevEp.Id}`, { replace: true })
          }
          break
        case 'Escape':
          if (!document.fullscreenElement) navigate(-1)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [absTime, navigate, seekTo, togglePlay, toggleFullscreen, nextEp, prevEp])

  // ---------- Controls auto-hide ----------
  useEffect(() => {
    const show = () => {
      setControlsVisible(true)
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => {
        setControlsVisible(false)
        setMenu(null)
        // A TV needs a focus target that persists once the bar hides, or the
        // remote's next press has nothing to act on; blur any hidden control.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      }, __WEBOS__ ? 5000 : 3200)
    }
    show()
    window.addEventListener('mousemove', show)
    window.addEventListener('touchstart', show)
    // TV remotes emit no pointer events — a D-pad/OK keypress must reveal the
    // controls, otherwise the chrome vanishes after the first timeout for good.
    window.addEventListener('keydown', show)
    return () => {
      window.removeEventListener('mousemove', show)
      window.removeEventListener('touchstart', show)
      window.removeEventListener('keydown', show)
      clearTimeout(hideTimer.current)
    }
  }, [])

  // ---------- TV: D-pad focus between the on-screen player controls ----------
  useEffect(() => {
    if (!__WEBOS__) return
    const controls = () =>
      [...(playerRef.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])].filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0
      })

    const onNav = (e: KeyboardEvent) => {
      const dir = e.key
      if (dir !== 'ArrowLeft' && dir !== 'ArrowRight' && dir !== 'ArrowUp' && dir !== 'ArrowDown') return
      const els = controls()
      if (els.length === 0) return
      e.preventDefault()
      const active = document.activeElement as HTMLElement | null
      // First press (nothing here focused, e.g. controls just revealed) → play/pause.
      if (!active || !els.includes(active)) {
        ;(els.find((el) => el.getAttribute('aria-label') === 'Play/Pause') ?? els[0]).focus()
        return
      }
      const c = active.getBoundingClientRect()
      const cx = c.left + c.width / 2
      const cy = c.top + c.height / 2
      let best: HTMLElement | null = null
      let bestScore = Infinity
      for (const el of els) {
        if (el === active) continue
        const r = el.getBoundingClientRect()
        const dx = r.left + r.width / 2 - cx
        const dy = r.top + r.height / 2 - cy
        let inDir = false
        let primary = 0
        let cross = 0
        if (dir === 'ArrowRight') { inDir = dx > 4; primary = dx; cross = Math.abs(dy) }
        else if (dir === 'ArrowLeft') { inDir = dx < -4; primary = -dx; cross = Math.abs(dy) }
        else if (dir === 'ArrowDown') { inDir = dy > 4; primary = dy; cross = Math.abs(dx) }
        else { inDir = dy < -4; primary = -dy; cross = Math.abs(dx) }
        if (!inDir) continue
        const score = primary + cross * 2
        if (score < bestScore) { bestScore = score; best = el }
      }
      if (best) best.focus()
    }
    window.addEventListener('keydown', onNav)
    return () => window.removeEventListener('keydown', onNav)
  }, [])

  // ---------- Segments: Skip Intro + Next episode ----------
  const activeIntro = useMemo(
    () =>
      segments.find(
        (s) =>
          s.Type === 'Intro' &&
          absTime >= ticksToSeconds(s.StartTicks) &&
          absTime < ticksToSeconds(s.EndTicks) - 1,
      ),
    [segments, absTime],
  )

  const outroStartSec = useMemo(() => {
    const outro = segments.find((s) => s.Type === 'Outro')
    if (outro) return ticksToSeconds(outro.StartTicks)
    if (durationSec && item?.Type === 'Episode') return durationSec - NEXT_CARD_FALLBACK_SECONDS
    return Infinity
  }, [segments, durationSec, item])

  const showNextCard = !!nextEp && !nextCancelled && absTime >= outroStartSec && absTime < (durationSec || Infinity)

  // Start/maintain countdown while the card is visible (only auto-advances if
  // the user hasn't disabled it in settings; otherwise the card is manual-only).
  useEffect(() => {
    if (!showNextCard || !getPrefs().autoPlayNext) {
      setCountdown(null)
      return
    }
    setCountdown(NEXT_COUNTDOWN)
    const t = setInterval(() => setCountdown((c) => (c == null ? null : c - 1)), 1000)
    return () => clearInterval(t)
  }, [showNextCard])

  useEffect(() => {
    if (countdown === 0 && nextEp) {
      navigate(`/play/${nextEp.Id}`, { replace: true })
    }
  }, [countdown, nextEp, navigate])

  // Once the first stream is playable, apply the remembered tracks for this
  // series (audio + subtitle language), falling back to the "subtitles on by
  // default" pref. One reload, guarded so it applies once per item and can't loop.
  useEffect(() => {
    if (tracksApplied.current || buffering) return
    const streams = streamRef.current?.mediaStreams
    if (!streams || streams.length === 0) return
    tracksApplied.current = true

    const seriesId = item?.Type === 'Episode' ? item.SeriesId : undefined
    const pref = seriesId ? trackPrefsRef.current[seriesId] : undefined
    const audios = streams.filter((m) => m.Type === 'Audio')
    const subs = streams.filter((m) => m.Type === 'Subtitle')
    const sameLang = (a?: string, b?: string) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase()

    let desiredAudio = audioIndex
    if (pref?.audioLang) {
      const m = audios.find((a) => sameLang(a.Language, pref.audioLang))
      if (m) desiredAudio = m.Index
    }

    let desiredSub = subIndex
    if (pref?.subLang) {
      desiredSub =
        pref.subLang === 'off' ? -1 : subs.find((s) => sameLang(s.Language, pref.subLang))?.Index ?? subIndex
    } else if (getPrefs().subtitlesDefault && subs.length) {
      desiredSub = subs[0].Index
    }

    if (desiredAudio !== audioIndex || desiredSub !== subIndex) {
      const at = liveAbsSec()
      setAbsTime(at)
      const chosen = desiredSub === -1 ? undefined : subs.find((s) => s.Index === desiredSub)
      const needsBurnIn = desiredSub !== -1 && isImageSubtitle(chosen)
      setAudioIndex(desiredAudio)
      setSubIndex(desiredSub)
      // Renegotiate the stream only when audio changes or subs need burn-in.
      // A pure text-sub default needs its VTT fetched into an overlay <track>
      // (setSubIndex alone paints nothing — the track is driven by subBlobUrl).
      if (desiredAudio !== audioIndex || needsBurnIn) {
        loadStream(
          secondsToTicks(at),
          desiredAudio,
          needsBurnIn ? desiredSub : undefined,
        )
      } else if (chosen) {
        loadTextSubOverlay(chosen, at)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffering, item])

  // Remember the chosen track's language for this series, so other episodes follow.
  const rememberTrack = useCallback(
    (patch: api.TrackPref) => {
      const seriesId = item?.Type === 'Episode' ? item.SeriesId : undefined
      if (!seriesId) return
      const next = { ...(trackPrefsRef.current[seriesId] ?? {}), ...patch }
      trackPrefsRef.current = { ...trackPrefsRef.current, [seriesId]: next }
      api.saveTrackPref(seriesId, next).catch(() => {})
    },
    [item],
  )

  // ---------- Trickplay scrub preview ----------
  const trickplay: JfTrickplayInfo | undefined = useMemo(() => {
    if (!item?.Trickplay) return undefined
    const s = streamRef.current
    const byKey =
      (s && item.Trickplay[s.mediaSourceId]) ||
      item.Trickplay[item.Id] ||
      Object.values(item.Trickplay)[0]
    if (!byKey) return undefined
    const widths = Object.keys(byKey).map(Number).sort((a, b) => a - b)
    return widths.length ? byKey[String(widths[0])] : undefined
    // streamGen re-runs once PlaybackInfo lands so mediaSourceId matches.
  }, [item, streamGen])

  const preview = useMemo(() => {
    if (!hover || !trickplay || !durationSec || !itemId) return null
    const mediaSourceId = streamRef.current?.mediaSourceId || itemId
    const t = hover.frac * durationSec
    const thumbIdx = Math.max(0, Math.floor((t * 1000) / trickplay.Interval))
    const perTile = Math.max(1, trickplay.TileWidth * trickplay.TileHeight)
    const tileIdx = Math.floor(thumbIdx / perTile)
    const pos = thumbIdx % perTile
    const col = pos % trickplay.TileWidth
    const row = Math.floor(pos / trickplay.TileWidth)
    return {
      url: api.trickplayTileUrl(itemId, trickplay.Width, tileIdx, mediaSourceId),
      x: -(col * trickplay.Width),
      y: -(row * trickplay.Height),
      w: trickplay.Width,
      h: trickplay.Height,
      time: t,
      // hover.x is already relative to the seekbar
      left: hover.x,
    }
  }, [hover, trickplay, durationSec, itemId, streamGen])

  // ---------- Seekbar interactions ----------
  const fracFromEvent = (e: React.PointerEvent) => {
    const bar = seekbarRef.current
    if (!bar) return 0
    const r = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  const relXFromEvent = (e: React.PointerEvent) => {
    const bar = seekbarRef.current
    if (!bar) return e.clientX
    return e.clientX - bar.getBoundingClientRect().left
  }

  // ---------- Track lists ----------
  const audioTracks = streamRef.current?.mediaStreams.filter((m) => m.Type === 'Audio') ?? []
  const subTracks = streamRef.current?.mediaStreams.filter((m) => m.Type === 'Subtitle') ?? []
  // Blob VTT overlay (supports delay). Burn-in has no separate track.
  const showTextTrack = !!subBlobUrl && subIndex >= 0

  const title =
    item?.Type === 'Episode'
      ? `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? '?'}:E${item.IndexNumber ?? '?'} · ${item.Name}`
      : item?.Name ?? ''

  const progressFrac = durationSec ? absTime / durationSec : 0
  const bufferedFrac = durationSec ? Math.min(1, bufferedAbs / durationSec) : 0

  return (
    <div ref={playerRef} className={`fixed inset-0 bg-black ${controlsVisible ? '' : 'cursor-none'}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // No crossOrigin — it forces CORS on <track> VTT and silently kills subs
        // when Jellyfin is reached via Funnel/LAN with mismatched origins.
        style={{ viewTransitionName: 'vt-hero' }}
        className="h-full w-full"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      >
        {showTextTrack && subBlobUrl && (
          <track
            key={subBlobUrl}
            kind="subtitles"
            src={subBlobUrl}
            srcLang="en"
            label="Subtitles"
            default
          />
        )}
      </video>

      {showStats && (
        <StatsOverlay
          tick={statsTick}
          stream={streamRef.current}
          video={videoRef.current}
          hls={hlsRef.current}
          absTime={absTime}
          bufferedAbs={bufferedAbs}
          item={item}
          onClose={() => setShowStats(false)}
        />
      )}

      {buffering && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="spinner" />
        </div>
      )}

      {/* Skip Intro — z-30 so it sits above the control-bar overlay and stays clickable */}
      {activeIntro && (
        <button
          onClick={() => seekTo(ticksToSeconds(activeIntro.EndTicks))}
          className="absolute bottom-32 right-8 z-30 rounded-lg bg-white/90 hover:bg-white text-ink-950 px-5 py-2.5 text-sm font-semibold shadow-2xl active:scale-95 transition-all backdrop-blur"
        >
          Skip Intro
        </button>
      )}

      {/* Next episode countdown */}
      {showNextCard && nextEp && (
        <div className="absolute bottom-32 right-8 z-30 w-80 rounded-xl bg-ink-900/90 backdrop-blur-xl border border-white/10 p-4 shadow-2xl">
          <p className="text-xs text-ink-400 mb-1">Up next{countdown != null ? ` in ${Math.max(0, countdown)}` : ''}</p>
          <p className="text-sm font-semibold text-white truncate mb-3">
            {nextEp.IndexNumber != null ? `${nextEp.IndexNumber}. ` : ''}
            {nextEp.Name}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/play/${nextEp.Id}`, { replace: true })}
              className="flex-1 rounded-lg bg-white text-ink-950 py-2 text-sm font-semibold hover:bg-ink-200 active:scale-95 transition-all"
            >
              Play now
            </button>
            <button
              onClick={() => setNextCancelled(true)}
              className="flex-1 rounded-lg bg-white/10 text-white py-2 text-sm font-semibold hover:bg-white/20 active:scale-95 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div
        className={`absolute top-0 inset-x-0 bg-gradient-to-b from-black/80 to-transparent px-4 py-3 flex items-center gap-3 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <button
          onClick={() => navigate(-1)}
          className="h-10 w-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white transition-colors"
          aria-label="Back"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <p className="text-sm font-medium text-white truncate">{title}</p>
      </div>

      {/* Bottom control bar */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-6 pb-4 pt-16 transition-opacity duration-300 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Trickplay preview */}
        {preview && (
          <div
            className="absolute bottom-20 -translate-x-1/2 rounded-lg overflow-hidden ring-1 ring-white/20 shadow-2xl pointer-events-none"
            style={{ left: preview.left, width: preview.w, height: preview.h }}
          >
            <div
              style={{
                width: preview.w,
                height: preview.h,
                backgroundImage: `url(${preview.url})`,
                backgroundPosition: `${preview.x}px ${preview.y}px`,
              }}
            />
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] font-semibold text-white bg-black/70 rounded px-1.5 py-0.5">
              {fmt(preview.time)}
            </span>
          </div>
        )}

        {/* Seekbar: hover = trickplay preview only; seek commits on pointer up/click.
            (Seeking on every move was renegotiating streams and killing previews.) */}
        <div
          ref={seekbarRef}
          className="group/seek relative h-6 flex items-center cursor-pointer mb-1 touch-none"
          onPointerMove={(e) => {
            if (durationSec <= 0) return
            const frac = fracFromEvent(e)
            setHover({ frac, x: relXFromEvent(e) })
            // Visual-only while dragging — don't hit the player until release.
            if (scrubbingRef.current) {
              setAbsTime(frac * durationSec)
            }
          }}
          onPointerLeave={() => {
            if (!scrubbingRef.current) setHover(null)
          }}
          onPointerDown={(e) => {
            if (durationSec <= 0) return
            scrubbingRef.current = true
            ;(e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId)
            const frac = fracFromEvent(e)
            setHover({ frac, x: relXFromEvent(e) })
            setAbsTime(frac * durationSec)
          }}
          onPointerUp={(e) => {
            if (!scrubbingRef.current) return
            scrubbingRef.current = false
            if (durationSec > 0) {
              seekTo(fracFromEvent(e) * durationSec)
            }
            try {
              ;(e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId)
            } catch {
              /* ignore */
            }
          }}
          onPointerCancel={() => {
            scrubbingRef.current = false
          }}
        >
          <div className="relative w-full h-1 group-hover/seek:h-1.5 rounded-full bg-white/20 transition-all">
            <div className="absolute h-full rounded-full bg-white/30" style={{ width: `${bufferedFrac * 100}%` }} />
            <div className="absolute h-full rounded-full bg-accent-400" style={{ width: `${progressFrac * 100}%` }} />
            <div
              className="absolute h-3.5 w-3.5 rounded-full bg-accent-300 shadow-md -translate-y-1/2 top-1/2 -translate-x-1/2 opacity-0 group-hover/seek:opacity-100 transition-opacity"
              style={{ left: `${progressFrac * 100}%` }}
            />
          </div>
        </div>

        {/* Buttons row: Prev ep · -10s · Play · +10s · Next ep */}
        <div className="flex items-center gap-3 sm:gap-4 text-white">
          {item?.Type === 'Episode' && (
            <button
              onClick={() => prevEp && navigate(`/play/${prevEp.Id}`, { replace: true })}
              disabled={!prevEp}
              className="h-9 w-9 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform disabled:opacity-30 disabled:hover:scale-100 disabled:cursor-default"
              aria-label="Previous episode"
              title={prevEp ? `Previous: ${prevEp.Name ?? 'episode'}` : 'No previous episode'}
            >
              {/* skip-previous: bar + triangle left */}
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z" />
              </svg>
            </button>
          )}
          <button onClick={() => seekTo(absTime - 10)} className="h-9 w-9 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform" aria-label="Back 10 seconds" title="Back 10s">
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12.5 3a9 9 0 1 0 8.49 12h-2.13a7 7 0 1 1-1.27-7.86L14 11h7V4l-2.6 2.6A8.97 8.97 0 0 0 12.5 3z"/><text x="12" y="16" fontSize="7" fontWeight="bold" textAnchor="middle" fill="currentColor">10</text></svg>
          </button>
          <button onClick={togglePlay} className="h-10 w-10 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform" aria-label="Play/Pause">
            {playing ? (
              <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            ) : (
              <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <button onClick={() => seekTo(absTime + 10)} className="h-9 w-9 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform" aria-label="Forward 10 seconds" title="Forward 10s">
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M11.5 3a9 9 0 1 1-8.49 12h2.13a7 7 0 1 0 1.27-7.86L10 11H3V4l2.6 2.6A8.97 8.97 0 0 1 11.5 3z"/><text x="12" y="16" fontSize="7" fontWeight="bold" textAnchor="middle" fill="currentColor">10</text></svg>
          </button>
          {item?.Type === 'Episode' && (
            <button
              onClick={() => nextEp && navigate(`/play/${nextEp.Id}`, { replace: true })}
              disabled={!nextEp}
              className="h-9 w-9 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform disabled:opacity-30 disabled:hover:scale-100 disabled:cursor-default"
              aria-label="Next episode"
              title={nextEp ? `Next: ${nextEp.Name ?? 'episode'}` : 'No next episode'}
            >
              {/* skip-next: triangle + bar */}
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>
          )}

          <div className="flex items-center gap-2 group/vol">
            <button onClick={() => setMuted((m) => !m)} className="h-9 w-9 flex items-center justify-center hover:scale-110 transition-transform" aria-label="Mute">
              {muted || volume === 0 ? (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" /></svg>
              ) : (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value))
                setMuted(false)
              }}
              className="w-0 group-hover/vol:w-24 transition-all accent-[#7589d8]"
              aria-label="Volume"
            />
          </div>

          <span className="text-xs tabular-nums text-ink-200">
            {fmt(absTime)} <span className="text-ink-400">/ {fmt(durationSec)}</span>
          </span>

          <div className="flex-1" />

          {audioTracks.length > 1 && (
            <div className="relative">
              <button onClick={() => setMenu(menu === 'audio' ? null : 'audio')} className="text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                Audio
              </button>
              {menu === 'audio' && (
                <div className="absolute bottom-10 right-0 w-64 max-h-64 overflow-y-auto rounded-xl bg-ink-900/95 backdrop-blur-xl border border-white/10 py-1.5 shadow-2xl">
                  {audioTracks.map((t) => (
                    <button
                      key={t.Index}
                      onClick={() => changeAudio(t.Index)}
                      className={`w-full text-left px-4 py-2 text-xs hover:bg-white/5 transition-colors ${t.Index === audioIndex || (audioIndex === undefined && t.IsDefault) ? 'text-accent-300' : 'text-ink-200'}`}
                    >
                      {t.DisplayTitle ?? `Track ${t.Index}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {subTracks.length > 0 && (
            <div className="relative">
              {/* Subtitle timing: only affects overlay (text) tracks */}
              {hasOverlaySubs && (
                <div className="flex items-center gap-0.5 rounded-lg bg-white/5 border border-white/10 px-1">
                  <button
                    type="button"
                    onClick={() => nudgeSubDelay(-SUB_DELAY_STEP_LARGE_MS)}
                    className="h-7 w-7 text-xs font-bold hover:bg-white/10 rounded"
                    title="Subs earlier by 0.5s"
                    aria-label="Subtitles earlier 500ms"
                  >
                    −−
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeSubDelay(-SUB_DELAY_STEP_MS)}
                    className="h-7 w-7 text-sm font-bold hover:bg-white/10 rounded"
                    title="Subs earlier by 0.1s"
                    aria-label="Subtitles earlier 100ms"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSubDelayMs(0)
                      try {
                        localStorage.setItem(SUB_DELAY_KEY, '0')
                      } catch {
                        /* ignore */
                      }
                      if (subVttRawRef.current) applySubBlobFromRaw(subVttRawRef.current, 0)
                    }}
                    className="min-w-[3.25rem] px-1 h-7 text-[11px] tabular-nums font-semibold text-ink-200 hover:text-white"
                    title="Reset subtitle delay"
                  >
                    {subDelayMs === 0
                      ? '0ms'
                      : `${subDelayMs > 0 ? '+' : ''}${subDelayMs}ms`}
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeSubDelay(SUB_DELAY_STEP_MS)}
                    className="h-7 w-7 text-sm font-bold hover:bg-white/10 rounded"
                    title="Subs later by 0.1s"
                    aria-label="Subtitles later 100ms"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => nudgeSubDelay(SUB_DELAY_STEP_LARGE_MS)}
                    className="h-7 w-7 text-xs font-bold hover:bg-white/10 rounded"
                    title="Subs later by 0.5s"
                    aria-label="Subtitles later 500ms"
                  >
                    ++
                  </button>
                </div>
              )}
              <button onClick={() => setMenu(menu === 'subs' ? null : 'subs')} className="text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors">
                Subtitles
              </button>
              {menu === 'subs' && (
                <div className="absolute bottom-10 right-0 w-64 max-h-64 overflow-y-auto rounded-xl bg-ink-900/95 backdrop-blur-xl border border-white/10 py-1.5 shadow-2xl">
                  <button
                    onClick={() => changeSub(-1)}
                    className={`w-full text-left px-4 py-2 text-xs hover:bg-white/5 transition-colors ${subIndex === -1 ? 'text-accent-300' : 'text-ink-200'}`}
                  >
                    Off
                  </button>
                  {subTracks.map((t) => (
                    <button
                      key={t.Index}
                      onClick={() => changeSub(t.Index)}
                      className={`w-full text-left px-4 py-2 text-xs hover:bg-white/5 transition-colors ${t.Index === subIndex ? 'text-accent-300' : 'text-ink-200'}`}
                    >
                      {t.DisplayTitle ?? `Track ${t.Index}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => setShowStats((v) => !v)}
            className={`h-9 w-9 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform ${showStats ? 'text-accent-300' : ''}`}
            aria-label="Stats for nerds"
            title="Stats for nerds (s)"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
          </button>

          <div className="relative">
            <button
              onClick={() => setMenu(menu === 'quality' ? null : 'quality')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Quality"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
              </svg>
              {maxBitrate === 0 ? 'Auto' : `${Math.round(maxBitrate / 1_000_000)}M`}
            </button>
            {menu === 'quality' && (
              <div className="absolute bottom-10 right-0 w-72 max-h-64 overflow-y-auto rounded-xl bg-ink-900/95 backdrop-blur-xl border border-white/10 py-1.5 shadow-2xl">
                {BITRATE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => changeQuality(o.value)}
                    className={`w-full text-left px-4 py-2 text-xs hover:bg-white/5 transition-colors ${o.value === maxBitrate ? 'text-accent-300' : 'text-ink-200'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={toggleFullscreen} className="h-9 w-9 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform" aria-label="Fullscreen">
            {fullscreen ? (
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
            ) : (
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85">
          <p className="text-white">{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="rounded-lg bg-white/10 px-5 py-2 text-sm text-white hover:bg-white/20 transition-colors"
          >
            Go back
          </button>
        </div>
      )}
    </div>
  )
}
