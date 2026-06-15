import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Hls from 'hls.js'
import * as api from '../api/client'
import { useEpisodes, useItem } from '../api/queries'
import { getPrefs, setPrefs, BITRATE_OPTIONS } from '../lib/settings'
import { secondsToTicks, ticksToSeconds } from '../api/types'
import type { JfItem, JfMediaStream, JfTrickplayInfo } from '../api/types'

const PROGRESS_INTERVAL_MS = 10_000
const NEXT_CARD_FALLBACK_SECONDS = 25
const NEXT_COUNTDOWN = 10

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
  const subDefaultApplied = useRef(false)

  const durationSec = ticksToSeconds(item?.RunTimeTicks)

  // ---------- Next episode ----------
  const { data: seasonEps } = useEpisodes(
    item?.Type === 'Episode' ? item.SeriesId : undefined,
    item?.Type === 'Episode' ? item.SeasonId : undefined,
  )
  const nextEp = useMemo(() => {
    if (!item || item.Type !== 'Episode' || !seasonEps) return undefined
    const i = seasonEps.Items.findIndex((e) => e.Id === item.Id)
    return i >= 0 ? seasonEps.Items[i + 1] : undefined
  }, [item, seasonEps])

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
      setBuffering(true)
      teardownStream(true)
      try {
        const info = await api.getPlaybackInfo(itemId, atTicks, audio, sub === -1 ? undefined : sub)
        const source = info.MediaSources[0]
        if (!source) throw new Error('No playable media source')

        let url: string
        let transcoding = false
        if (source.SupportsDirectPlay) {
          url = api.directStreamUrl(itemId, source.Id, source.Container)
        } else if (source.TranscodingUrl) {
          url = api.transcodeUrl(source.TranscodingUrl)
          transcoding = true
        } else {
          throw new Error('Server offered no playback method')
        }

        streamRef.current = {
          playSessionId: info.PlaySessionId,
          mediaSourceId: source.Id,
          transcoding,
          offsetSec: transcoding ? ticksToSeconds(atTicks) : 0,
          mediaStreams: source.MediaStreams ?? [],
          container: source.Container,
          sourceBitrate: source.Bitrate,
          transcodeReasons: decodeURIComponent(
            source.TranscodingUrl?.match(/TranscodeReasons=([^&]+)/)?.[1] ?? '',
          ).replace(/,/g, ', '),
        }

        if (url.includes('.m3u8') && Hls.isSupported()) {
          const hls = new Hls({ maxBufferLength: 60, backBufferLength: 30 })
          hlsRef.current = hls
          hls.loadSource(url)
          hls.attachMedia(video)
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) setError(`Playback failed (${data.type})`)
          })
        } else {
          video.src = url
        }

        if (!transcoding && atTicks > 0) {
          const onMeta = () => {
            video.currentTime = ticksToSeconds(atTicks)
            video.removeEventListener('loadedmetadata', onMeta)
          }
          video.addEventListener('loadedmetadata', onMeta)
        }

        await video.play().catch(() => {})
        report(api.reportPlaybackStart)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start playback')
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
    subDefaultApplied.current = false
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
      setAbsTime(absSec) // optimistic: bar + clock jump immediately, video catches up
      if (!s.transcoding) {
        v.currentTime = absSec
        return
      }
      const rel = absSec - s.offsetSec
      let seekableEnd = 0
      try {
        seekableEnd = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0
      } catch {
        /* ignore */
      }
      if (rel >= 0 && rel <= seekableEnd) {
        v.currentTime = rel
      } else {
        // Outside what this transcode session covers: restart the stream there
        loadStream(secondsToTicks(absSec), audioIndex, subIndex)
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

  const changeAudio = (idx: number) => {
    setAudioIndex(idx)
    setMenu(null)
    loadStream(secondsToTicks(absTime), idx, subIndex)
  }
  const changeSub = (idx: number) => {
    setSubIndex(idx)
    setMenu(null)
    loadStream(secondsToTicks(absTime), audioIndex, idx)
  }
  const changeQuality = (bitrate: number) => {
    setPrefs({ maxBitrate: bitrate })
    setMaxBitrate(bitrate)
    setMenu(null)
    // Re-negotiate the stream at the new cap from the current position
    loadStream(secondsToTicks(absTime), audioIndex, subIndex)
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
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          seekTo(absTime - 10)
          break
        case 'ArrowRight':
          seekTo(absTime + 10)
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolume((v) => Math.min(1, v + 0.05))
          break
        case 'ArrowDown':
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
        case 'Escape':
          if (!document.fullscreenElement) navigate(-1)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [absTime, navigate, seekTo, togglePlay, toggleFullscreen])

  // ---------- Controls auto-hide ----------
  useEffect(() => {
    const show = () => {
      setControlsVisible(true)
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => {
        setControlsVisible(false)
        setMenu(null)
      }, 3200)
    }
    show()
    window.addEventListener('mousemove', show)
    window.addEventListener('touchstart', show)
    return () => {
      window.removeEventListener('mousemove', show)
      window.removeEventListener('touchstart', show)
      clearTimeout(hideTimer.current)
    }
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

  // Honor "subtitles on by default": once the first stream is playable, select
  // the first subtitle track (one reload, guarded so it can't loop).
  useEffect(() => {
    if (subDefaultApplied.current || buffering) return
    if (!getPrefs().subtitlesDefault || subIndex !== -1) return
    const subs = streamRef.current?.mediaStreams.filter((m) => m.Type === 'Subtitle') ?? []
    if (subs.length) {
      subDefaultApplied.current = true
      changeSub(subs[0].Index)
    }
  }, [buffering, subIndex])

  // ---------- Trickplay scrub preview ----------
  const trickplay: JfTrickplayInfo | undefined = useMemo(() => {
    const s = streamRef.current
    if (!item?.Trickplay) return undefined
    const byKey = (s && item.Trickplay[s.mediaSourceId]) || item.Trickplay[item.Id] ||
      Object.values(item.Trickplay)[0]
    if (!byKey) return undefined
    const widths = Object.keys(byKey).map(Number).sort((a, b) => a - b)
    return widths.length ? byKey[String(widths[0])] : undefined
  }, [item])

  const preview = useMemo(() => {
    if (!hover || !trickplay || !durationSec || !itemId || !streamRef.current) return null
    const t = hover.frac * durationSec
    const thumbIdx = Math.floor((t * 1000) / trickplay.Interval)
    const perTile = trickplay.TileWidth * trickplay.TileHeight
    const tileIdx = Math.floor(thumbIdx / perTile)
    const pos = thumbIdx % perTile
    const col = pos % trickplay.TileWidth
    const row = Math.floor(pos / trickplay.TileWidth)
    return {
      url: api.trickplayTileUrl(itemId, trickplay.Width, tileIdx, streamRef.current.mediaSourceId),
      x: -(col * trickplay.Width),
      y: -(row * trickplay.Height),
      w: trickplay.Width,
      h: trickplay.Height,
      time: t,
      left: hover.x,
    }
  }, [hover, trickplay, durationSec, itemId])

  // ---------- Seekbar interactions ----------
  const fracFromEvent = (e: React.PointerEvent) => {
    const bar = seekbarRef.current
    if (!bar) return 0
    const r = bar.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }

  // ---------- Track lists ----------
  const audioTracks = streamRef.current?.mediaStreams.filter((m) => m.Type === 'Audio') ?? []
  const subTracks = streamRef.current?.mediaStreams.filter((m) => m.Type === 'Subtitle') ?? []
  const externalSub = streamRef.current?.mediaStreams.find(
    (m) => m.Type === 'Subtitle' && m.Index === subIndex && m.DeliveryUrl,
  )

  const title =
    item?.Type === 'Episode'
      ? `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? '?'}:E${item.IndexNumber ?? '?'} · ${item.Name}`
      : item?.Name ?? ''

  const progressFrac = durationSec ? absTime / durationSec : 0
  const bufferedFrac = durationSec ? Math.min(1, bufferedAbs / durationSec) : 0

  return (
    <div className={`fixed inset-0 bg-black ${controlsVisible ? '' : 'cursor-none'}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        crossOrigin="anonymous"
        style={{ viewTransitionName: 'vt-hero' }}
        className="h-full w-full"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
      >
        {externalSub && (
          <track
            kind="subtitles"
            src={`${api.getSession()!.server}${externalSub.DeliveryUrl}`}
            srcLang={externalSub.Language ?? 'und'}
            label={externalSub.DisplayTitle ?? 'Subtitles'}
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

        {/* Seekbar */}
        <div
          ref={seekbarRef}
          className="group/seek relative h-6 flex items-center cursor-pointer mb-1"
          onPointerMove={(e) => setHover({ frac: fracFromEvent(e), x: e.clientX })}
          onPointerLeave={() => setHover(null)}
          onPointerDown={(e) => seekTo(fracFromEvent(e) * durationSec)}
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

        {/* Buttons row */}
        <div className="flex items-center gap-4 text-white">
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
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M11.5 3a9 9 0 1 1-8.49 12h2.13a7 7 0 1 0 1.27-7.86L10 11H3V4l2.6 2.6A8.97 8.97 0 0 1 11.5 3z"/><text x="12" y="16" font-size="7" font-weight="bold" text-anchor="middle" fill="currentColor">10</text></svg>
          </button>
          {nextEp && (
            <button onClick={() => navigate(`/play/${nextEp.Id}`, { replace: true })} className="h-9 w-9 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform" aria-label="Next episode" title="Next episode">
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6zM16 6v12h2V6z" /></svg>
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
