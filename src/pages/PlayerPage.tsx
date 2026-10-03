import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Hls from 'hls.js'
import * as api from '../api/client'
import { useClipManifest, useItem, useSeriesEpisodes } from '../api/queries'
import { EMPTY_MANIFEST, prefetchClip, previewClipUrl } from '../lib/preview'
import { pickSubtitle } from '../lib/tracks'
import { getPrefs, setPrefs, BITRATE_OPTIONS } from '../lib/settings'
import { IS_TV, TOUCH_UI, inSpatialMode } from '../lib/device'
import CastMenu from '../components/CastMenu'

import { goBack, isBackKey, isTypingTarget, pushBackHandler } from '../lib/back'
import { onRemoteCommand } from '../lib/remoteControl'
import { setReturnMorph } from '../lib/motion'
import { formatRuntime, secondsToTicks, ticksToSeconds } from '../api/types'
import type { JfItem, JfMediaStream, JfTrickplayInfo } from '../api/types'

const IS_FIREFOX = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)

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
  // Prefer server-provided DeliveryUrl (correct hyphenated IDs). Always carry the token.
  if (!path.startsWith('http')) path = `${session.server}${path}`
  return api.withToken(path, session.token)
}

/** Fetch VTT with the session token so Funnel/CORS can't kill the <track>. */
async function fetchVttText(vttUrl: string): Promise<string> {
  const res = await fetch(vttUrl, {
    // The modern header form: Jellyfin 12 turns the legacy X-Emby-Token off.
    headers: { Authorization: api.mediaBrowserAuthHeader() },
  })
  if (!res.ok) throw new Error(`Subtitle fetch ${res.status}`)
  const text = await res.text()
  const trimmed = text.trimStart()
  // Already WebVTT (the normal case now we force the Stream.vtt endpoint).
  if (trimmed.startsWith('WEBVTT')) return plainCues(text)
  // SRT-ish (has cue arrows but no header) — browsers want the WEBVTT header.
  if (trimmed.includes('-->')) return plainCues(`WEBVTT\n\n${text}`)
  // Anything else (e.g. raw ASS "[Script Info]") can't drive a <track>; wrapping
  // it in a header just yields zero cues. Fail so the caller falls back to burn-in.
  throw new Error('Subtitle payload is not WebVTT/SRT')
}

/** Drops each cue's own placement ("line:90%", "position:…", regions) so every
 *  line sits at the bottom and grows upward; the player lifts the whole layer
 *  clear of its controls (see video::-webkit-media-text-track-container). Some
 *  Jellyfin versions stamp "line:90%" on every cue, which put two-line
 *  subtitles half off the screen. */
function plainCues(vtt: string): string {
  // size:80% keeps long lines off the screen edges (they wrap instead).
  return vtt.replace(/^(\s*(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})[^\n]*$/gm, '$1 size:80%')
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
  /** The item this stream was negotiated for (guards against a stale stream
   *  surviving an in-place episode switch). */
  itemId: string
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
  // The total counts from when this stream started (seeks and menus included); the
  // last 10 seconds say whether frames are being dropped now.
  const samples = useRef<{ at: number; dropped: number; total: number }[]>([])
  if (q) {
    const now = performance.now()
    const list = samples.current
    if (list.length && q.totalVideoFrames < list[list.length - 1]!.total) list.length = 0
    list.push({ at: now, dropped: q.droppedVideoFrames, total: q.totalVideoFrames })
    while (list.length > 2 && now - list[0]!.at > 10_000) list.shift()
  }
  const first = samples.current[0]
  const recent = q && first && q.totalVideoFrames > first.total ? { dropped: q.droppedVideoFrames - first.dropped, total: q.totalVideoFrames - first.total } : null
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
      q ? `${q.droppedVideoFrames} / ${q.totalVideoFrames}${recent ? ` · last 10 s: ${recent.dropped} / ${recent.total}` : ''}` : 'n/a',
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
      className="absolute top-16 left-4 z-30 w-[22rem] max-w-[calc(var(--vw)*90)] rounded-xl bg-black/90 border border-white/10 p-3 font-mono text-[11px] leading-relaxed text-ink-200 shadow-2xl"
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


type Menu = 'tracks' | 'settings' | null
type Dir = 'up' | 'down' | 'left' | 'right'

const SEEK_STEP = 10
/** Remote/keyboard/double-tap seeks accumulate, then commit once — so holding a
 *  key or tapping +10 four times is one seek (one HLS renegotiation at most). */
const SEEK_COMMIT_MS = 450
/** Query keys that depend on watch progress — refreshed when playback stops so
 *  Continue Watching / Next Up / detail pages don't show stale positions. */
const WATCH_STATE_KEYS = ['resume', 'nextUp', 'item', 'episodes', 'seriesNextUp', 'seriesEpisodes', 'lastPlayed']

function arrowDir(e: KeyboardEvent): Dir | null {
  switch (e.key) {
    case 'ArrowUp': return 'up'
    case 'ArrowDown': return 'down'
    case 'ArrowLeft': return 'left'
    case 'ArrowRight': return 'right'
  }
  switch (e.keyCode) {
    case 38: return 'up'
    case 40: return 'down'
    case 37: return 'left'
    case 39: return 'right'
  }
  return null
}

/** Move focus to the nearest visible control in `dir` inside `root` (TV remote). */
function moveFocus(root: HTMLElement | null, dir: Dir): boolean {
  if (!root) return false
  const els = [
    ...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]'),
  ].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && !el.closest('[data-hidden="true"]')
  })
  if (els.length === 0) return false
  const active = document.activeElement as HTMLElement | null
  if (!active || !els.includes(active)) {
    ;(els.find((el) => el.getAttribute('aria-checked') === 'true') ?? els[0]).focus()
    return true
  }
  const c = active.getBoundingClientRect()
  const cx = c.left + c.width / 2
  const cy = c.top + c.height / 2
  // Same-row/column targets (cross-axis overlap) win over anything diagonal —
  // → along the button bar must not jump up into the Up Next card.
  let best: HTMLElement | null = null
  let bestScore = Infinity
  let fallback: HTMLElement | null = null
  let fallbackScore = Infinity
  for (const el of els) {
    if (el === active) continue
    const r = el.getBoundingClientRect()
    const dx = r.left + r.width / 2 - cx
    const dy = r.top + r.height / 2 - cy
    const horizontal = dir === 'left' || dir === 'right'
    const primary = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
    if (primary <= 4) continue
    const cross = horizontal ? Math.abs(dy) : Math.abs(dx)
    const overlap = horizontal
      ? Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top)
      : Math.min(r.right, c.right) - Math.max(r.left, c.left)
    if (overlap > 2) {
      const score = primary + cross
      if (score < bestScore) { bestScore = score; best = el }
    } else {
      const score = primary + cross * 2
      if (score < fallbackScore) { fallbackScore = score; fallback = el }
    }
  }
  best = best ?? fallback
  if (best) best.focus()
  return !!best
}

function episodeLabel(ep: JfItem): string {
  const s = ep.ParentIndexNumber
  const e = ep.IndexNumber
  const code = s != null && e != null ? (s === 0 ? `Special ${e}` : `S${s}:E${e}`) : ''
  return [code, ep.Name].filter(Boolean).join(' · ')
}

export default function PlayerPage() {
  const { itemId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const startTicks = Number(searchParams.get('t') ?? 0)

  const { data: fetchedItem } = useItem(itemId)
  // Keep the series list alive across an episode switch (the next episode's own
  // item isn't fetched yet) so prev/next + the title don't blink out.
  const lastSeriesId = useRef<string | undefined>(undefined)
  if (fetchedItem) lastSeriesId.current = fetchedItem.Type === 'Episode' ? fetchedItem.SeriesId : undefined
  const { data: seriesEps } = useSeriesEpisodes(lastSeriesId.current)
  const item: JfItem | undefined = fetchedItem ?? seriesEps?.Items.find((e) => e.Id === itemId)

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const streamRef = useRef<StreamInfo | null>(null)
  /** Bumped per loadStream — a superseded PlaybackInfo reply must not attach. */
  const loadGenRef = useRef(0)

  const [error, setError] = useState('')
  const [buffering, setBuffering] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [absTime, setAbsTime] = useState(ticksToSeconds(startTicks))
  const [bufferedAbs, setBufferedAbs] = useState(0)
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('finesse.volume') ?? 1))
  const [muted, setMuted] = useState(() => localStorage.getItem('finesse.muted') === '1')
  const [fullscreen, setFullscreen] = useState(false)
  const [menu, setMenu] = useState<Menu>(null)
  const [maxBitrate, setMaxBitrate] = useState<number>(() => getPrefs().maxBitrate)
  const [autoNext, setAutoNext] = useState(() => getPrefs().autoPlayNext)
  const [ambient, setAmbient] = useState(() => getPrefs().ambient)
  const [audioIndex, setAudioIndex] = useState<number | undefined>(undefined)
  const [subIndex, setSubIndex] = useState<number>(-1)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [showStats, setShowStats] = useState(false)
  const [statsTick, setStatsTick] = useState(0)
  const [hover, setHover] = useState<{ frac: number; x: number } | null>(null)
  const [segments, setSegments] = useState<api.JfMediaSegment[]>([])
  const [nextCancelled, setNextCancelled] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  /** Target of an in-progress remote/keyboard/double-tap seek (not yet committed). */
  const [pendingSeek, setPendingSeek] = useState<number | null>(null)
  const [seekFocused, setSeekFocused] = useState(false)
  const [tapFx, setTapFx] = useState<{ side: 'left' | 'right'; secs: number; at: number } | null>(null)
  /** Per-series track memory has loaded (or given up) — tracks wait for it. */
  const [prefsReady, setPrefsReady] = useState(false)

  const hideTimer = useRef<number>(0)
  const seekbarRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const topBarRef = useRef<HTMLDivElement>(null)
  const bottomBarRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLElement | null>(null)
  const nextBtnRef = useRef<HTMLButtonElement>(null)
  const skipBtnRef = useRef<HTMLButtonElement>(null)
  const controlsVisibleRef = useRef(true)
  const menuRef = useRef<Menu>(null)
  menuRef.current = menu
  const pendingSeekRef = useRef<number | null>(null)
  const seekCommitTimer = useRef<number>(0)
  const holdRef = useRef({ key: '', n: 0 })
  const lastTapRef = useRef<{ at: number; side: string } | null>(null)
  const singleTapTimer = useRef<number>(0)
  const lastPointerType = useRef('mouse')
  const endHandled = useRef(false)
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
  /** The subtitle an overlay is being fetched for; a late fetch for another is dropped. */
  const overlayForRef = useRef(-1)
  /** Subtitle timing offset in ms (positive = show later). */
  const [subDelayMs, setSubDelayMs] = useState(() => {
    try {
      const n = Number(localStorage.getItem(SUB_DELAY_KEY))
      return Number.isFinite(n) ? Math.round(n) : 0
    } catch {
      return 0
    }
  })

  const subDelayRef = useRef(subDelayMs)
  subDelayRef.current = subDelayMs

  const revokeSubBlob = useCallback(() => {
    if (subBlobUrlRef.current) {
      URL.revokeObjectURL(subBlobUrlRef.current)
      subBlobUrlRef.current = null
    }
    setSubBlobUrl(null)
    setHasOverlaySubs(false)
  }, [])

  const applySubBlobFromRaw = useCallback((raw: string, delayMs: number) => {
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
  }, [])

  const setSubDelay = useCallback(
    (next: number) => {
      next = Math.max(-30_000, Math.min(30_000, next))
      setSubDelayMs(next)
      try {
        localStorage.setItem(SUB_DELAY_KEY, String(next))
      } catch {
        /* ignore */
      }
      if (subVttRawRef.current) applySubBlobFromRaw(subVttRawRef.current, next)
    },
    [applySubBlobFromRaw],
  )

  // Load the user's saved per-series track preferences once. Tracks are applied
  // only after this settles, so the first episode can't race past its prefs.
  useEffect(() => {
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        setPrefsReady(true)
      }
    }
    api
      .getTrackPrefs()
      .then((p) => (trackPrefsRef.current = p))
      .catch(() => {})
      .finally(finish)
    const t = window.setTimeout(finish, 2500) // a slow prefs call must not hold playback hostage
    return () => window.clearTimeout(t)
  }, [])

  const durationSec = ticksToSeconds(item?.RunTimeTicks)

  // ---------- Prev / next episode (whole series, crosses seasons) ----------
  // Missing (virtual) episodes can't play, and Specials (season 0) aren't part
  // of the main run — they only chain among themselves when you're in them.
  const { prevEp, nextEp } = useMemo(() => {
    const none = { prevEp: undefined as JfItem | undefined, nextEp: undefined as JfItem | undefined }
    if (!item || item.Type !== 'Episode' || !seriesEps?.Items?.length) return none
    const inSpecials = (item.ParentIndexNumber ?? 0) === 0
    const chain = seriesEps.Items.filter(
      (e) =>
        e.Id === item.Id ||
        (e.LocationType !== 'Virtual' && ((e.ParentIndexNumber ?? 0) === 0) === inSpecials),
    )
    const i = chain.findIndex((e) => e.Id === item.Id)
    if (i < 0) return none
    return { prevEp: chain[i - 1], nextEp: chain[i + 1] }
  }, [item, seriesEps])

  /** Switch to another episode in place (same <video>, so mobile autoplay
   *  permission carries over), resuming it if it was part-watched. */
  const playEpisode = useCallback(
    (ep: JfItem) => {
      const ud = ep.UserData
      const t = !ud?.Played && ud?.PlaybackPositionTicks ? ud.PlaybackPositionTicks : 0
      navigate(`/play/${ep.Id}${t > 0 ? `?t=${t}` : ''}`, { replace: true })
    },
    [navigate],
  )

  const exitPlayer = useCallback(() => goBack(navigate), [navigate])
  // Back from the player morphs the video into whatever tile/backdrop opened it.
  useEffect(() => (itemId ? setReturnMorph(itemId, 'vt-hero') : undefined), [itemId])

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
      if (s && itemId && s.itemId === itemId) {
        return fn({
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
      const gen = ++loadGenRef.current
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
        const info = await api.getPlaybackInfo(itemId, atTicks, audio, subIdx, prevMediaSourceId)
        if (gen !== loadGenRef.current) return // superseded (episode switched / track changed again)
        const source = info.MediaSources[0]
        if (!source) throw new Error('This title has no playable file')

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

        // hls.js empties every text track on the video when it starts a stream
        // (and switches labelled ones off when the old one is torn down), so a
        // text subtitle overlay is painted again once the new stream is up.
        const repaintOverlay = () => {
          const raw = subVttRawRef.current
          if (subIdx === undefined && raw && gen === loadGenRef.current) applySubBlobFromRaw(raw, subDelayRef.current)
        }

        // Full VOD HLS timeline: offsetSec stays 0; we seek to resumeSec after parse.
        // (Do NOT put StartTimeTicks on the URL — JF returns 400 on segments.)
        streamRef.current = {
          itemId,
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
            repaintOverlay()
            setBuffering(false)
            video.play().catch(() => {})
          })
          hls.on(Hls.Events.FRAG_BUFFERED, () => {
            const s = streamRef.current
            if (s && video) setAbsTime(s.offsetSec + video.currentTime)
          })
        } else {
          video.src = url
          repaintOverlay()
          if (resumeSec > 0) {
            video.addEventListener('loadedmetadata', applyResumeSeek, { once: true })
            video.addEventListener('canplay', applyResumeSeek, { once: true })
          }
          await video.play().catch(() => {})
          if (gen === loadGenRef.current) setBuffering(false)
        }

        report(api.reportPlaybackStart)
      } catch (e) {
        if (gen !== loadGenRef.current) return
        setError(e instanceof Error ? e.message : 'Could not start playback')
        setBuffering(false)
      }
    },
    [itemId, report, teardownStream, applySubBlobFromRaw],
  )

  // Per-item state resets DURING render when the episode changes in place.
  // Resetting in an effect left one committed render where the new episode ran
  // with the old one's state — e.g. a finished countdown (0) that immediately
  // auto-advanced the *new* episode too, skipping one.
  const [stateFor, setStateFor] = useState(itemId)
  if (stateFor !== itemId) {
    setStateFor(itemId)
    setEnded(false)
    setError('')
    setNextCancelled(false)
    setCountdown(null)
    setSubIndex(-1)
    setAudioIndex(undefined)
    setMenu(null)
    setSegments([])
    setBufferedAbs(0)
    setPendingSeek(null)
    setHover(null)
    setAbsTime(ticksToSeconds(startTicks))
  }

  const cancelPendingSeek = useCallback(() => {
    window.clearTimeout(seekCommitTimer.current)
    pendingSeekRef.current = null
    setPendingSeek(null)
  }, [])

  // Per-item load + cleanup. The component (and its <video>) stays mounted
  // across next/prev episode switches, so per-item refs reset here (state
  // resets above, during render) — stale segments/streams from the last
  // episode caused phantom "Skip Intro" buttons and remembered tracks that
  // never applied.
  useEffect(() => {
    streamRef.current = null
    endHandled.current = false
    cancelPendingSeek()
    tracksApplied.current = false
    burnedInSubRef.current = false
    subVttRawRef.current = null
    revokeSubBlob()
    loadStream(startTicks)

    const progressTimer = setInterval(
      () => report(api.reportPlaybackProgress, videoRef.current?.paused),
      PROGRESS_INTERVAL_MS,
    )
    let alive = true
    api.getMediaSegments(itemId!).then(
      (r) => alive && setSegments(r.Items ?? []),
      () => alive && setSegments([]),
    )

    return () => {
      alive = false
      clearInterval(progressTimer)
      const stopped = report(api.reportPlaybackStopped)
      teardownStream(true)
      revokeSubBlob()
      const v = videoRef.current
      if (v) {
        v.removeAttribute('src')
        v.load()
      }
      // Once the server has the final position, refresh everything that shows it.
      Promise.resolve(stopped).finally(() => {
        for (const key of WATCH_STATE_KEYS) queryClient.invalidateQueries({ queryKey: [key] })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, startTicks])

  // ---------- Controls visibility ----------
  // Visible while paused, while a panel is open, or while scrubbing; otherwise
  // they fade after a few idle seconds (longer on TV, where reading is slower).
  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      const v = videoRef.current
      if (menuRef.current || scrubbingRef.current || !v || v.paused) return
      controlsVisibleRef.current = false
      setControlsVisible(false)
      // Don't leave focus on an invisible control — the next remote press
      // should re-reveal, not silently activate a hidden button.
      const a = document.activeElement
      if (a instanceof HTMLElement && (topBarRef.current?.contains(a) || bottomBarRef.current?.contains(a))) {
        a.blur()
        // TV: hand focus to an on-screen prompt so OK acts on it.
        if (IS_TV) (nextBtnRef.current ?? skipBtnRef.current)?.focus()
      }
    }, IS_TV ? 5000 : 3200)
  }, [])

  const reveal = useCallback(() => {
    if (!controlsVisibleRef.current) {
      controlsVisibleRef.current = true
      setControlsVisible(true)
    }
    scheduleHide()
  }, [scheduleHide])

  const hideControls = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    controlsVisibleRef.current = false
    setControlsVisible(false)
  }, [])

  useEffect(() => {
    reveal()
    // Mouse/Magic-Remote pointer movement reveals (pointermove with type mouse:
    // phones fire compatibility mouse events after taps, which would undo a
    // tap-to-hide). Touching the bars themselves keeps them up.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') reveal()
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (topBarRef.current?.contains(t) || bottomBarRef.current?.contains(t) || panelRef.current?.contains(t)) {
        reveal()
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.clearTimeout(hideTimer.current)
    }
  }, [reveal])

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
    const onPlay = () => {
      setPlaying(true)
      setEnded(false)
      scheduleHide()
      // Tell the server right away, so a remote on another device flips too.
      report(api.reportPlaybackProgress, false)
    }
    const onPause = () => {
      setPlaying(false)
      report(api.reportPlaybackProgress, true)
    }
    const onSeeked = () => report(api.reportPlaybackProgress, v.paused)
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    const onEnded = () => {
      setPlaying(false)
      setEnded(true)
    }
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('seeked', onSeeked)
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('playing', onPlaying)
    v.addEventListener('canplay', onPlaying)
    v.addEventListener('ended', onEnded)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('seeked', onSeeked)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('playing', onPlaying)
      v.removeEventListener('canplay', onPlaying)
      v.removeEventListener('ended', onEnded)
    }
  }, [report, scheduleHide])

  // Buffering watchdog — the spinner's source of truth. webOS Chromium drops or
  // misorders 'playing'/'canplay'/'timeupdate' often enough that event-driven
  // state gets stuck (ring over a playing video until you pause+resume). Instead
  // of trusting events, poll actual playback progress: if currentTime moved, we
  // are demonstrably playing → hide the ring; if we're nominally playing but the
  // clock is frozen, we're stalled → show it. While paused with decoded frames,
  // there's nothing to wait for → hide. Anything else (no media yet, mid-load,
  // renegotiating) leaves the event-set state alone.
  useEffect(() => {
    let lastT = -1
    const iv = window.setInterval(() => {
      const v = videoRef.current
      if (!v) return
      const t = v.currentTime
      const advanced = t !== lastT
      lastT = t
      if (advanced && t > 0) setBuffering(false)
      else if (!v.paused && !v.ended && v.readyState < 4) setBuffering(true)
      else if (v.paused && !v.seeking && v.readyState >= 3) setBuffering(false)
    }, 500)
    return () => window.clearInterval(iv)
  }, [])

  // Text cues sit at the bottom of the <video> box, under the control bar.
  // Blink/WebKit (browsers, the TV, phones) lift the whole caption layer with
  // CSS (--cue-lift, see video::-webkit-media-text-track-container in
  // index.css): clear of the edge normally, above the bar while it shows. Moving
  // the layer keeps wrapped and multi-line cues whole. Firefox has no hook for
  // that layer, so there each cue moves up a few lines instead.
  const liftCues = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const shown = controlsVisibleRef.current
    const bar = bottomBarRef.current
    // The bar's top padding is only its fade, so measure the controls themselves.
    const lift = shown && bar ? bar.offsetHeight - parseFloat(getComputedStyle(bar).paddingTop) + 16 : Math.round(v.clientHeight * 0.05)
    v.style.setProperty('--cue-lift', `${lift}px`)
    if (!IS_FIREFOX) return
    const line: number | 'auto' = shown ? -4 : 'auto'
    for (let i = 0; i < v.textTracks.length; i++) {
      const cues = v.textTracks[i].cues
      if (!cues) continue
      for (let j = 0; j < cues.length; j++) {
        const c = cues[j] as VTTCue
        // Count in lines: with snapToLines off, -4 would mean -4% (off screen).
        if ('snapToLines' in c && !c.snapToLines) c.snapToLines = true
        if ('line' in c && c.line !== line) c.line = line
      }
    }
  }, [])
  useEffect(() => {
    liftCues()
  }, [controlsVisible, liftCues])
  useEffect(() => {
    window.addEventListener('resize', liftCues)
    return () => window.removeEventListener('resize', liftCues)
  }, [liftCues])

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
      setEnded(false)
      endHandled.current = false

      // Text subtitles are an overlay (repainted after a restart); only a
      // burned-in (image) subtitle has to travel with the new stream.
      const subArg = burnedInSubRef.current && subIndex !== -1 ? subIndex : undefined
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
  const seekToRef = useRef(seekTo)
  seekToRef.current = seekTo

  /** Absolute playback position right now (prefer live video clock over React state). */
  const liveAbsSec = () => {
    const v = videoRef.current
    const s = streamRef.current
    if (v && s) return s.offsetSec + v.currentTime
    return absTime
  }

  /** Relative seek that accumulates (held key, repeated taps) and commits once. */
  const nudgeSeek = (delta: number) => {
    const base = pendingSeekRef.current ?? liveAbsSec()
    const max = durationSec > 0 ? Math.max(0, durationSec - 1) : Infinity
    const target = Math.max(0, Math.min(max, base + delta))
    pendingSeekRef.current = target
    setPendingSeek(target)
    window.clearTimeout(seekCommitTimer.current)
    seekCommitTimer.current = window.setTimeout(() => {
      const t = pendingSeekRef.current
      pendingSeekRef.current = null
      setPendingSeek(null)
      if (t != null) seekToRef.current(t)
    }, SEEK_COMMIT_MS)
  }

  const fullscreenSupported =
    !IS_TV &&
    (document.fullscreenEnabled ||
      typeof (HTMLVideoElement.prototype as HTMLVideoElement & { webkitEnterFullscreen?: unknown })
        .webkitEnterFullscreen === 'function')

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {})
      return
    }
    if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen()
        // Phones: go landscape with it (Android Chrome allows this in fullscreen).
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
        await o?.lock?.('landscape').catch(() => {})
      } catch {
        /* denied */
      }
      return
    }
    // iPhone Safari: no element fullscreen, only the native video player.
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    v?.webkitEnterFullscreen?.()
  }, [])
  useEffect(() => {
    const onFs = () => {
      setFullscreen(!!document.fullscreenElement)
      if (!document.fullscreenElement) {
        try {
          screen.orientation?.unlock?.()
        } catch {
          /* not supported */
        }
      }
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const langOfStream = (idx: number) =>
    streamRef.current?.mediaStreams.find((m) => m.Index === idx)?.Language ?? undefined

  /** Fetch a text subtitle and paint it as an overlay <track> (no stream
   *  restart, and the delay slider works). Falls back to a burn-in transcode
   *  if the VTT can't be fetched/parsed. */
  const loadTextSubOverlay = (chosen: JfMediaStream, atSec: number, audio = audioIndex) => {
    const s = streamRef.current
    if (!s || !itemId) return
    burnedInSubRef.current = false
    overlayForRef.current = chosen.Index
    const vttUrl = subtitleVttUrl(itemId, s.mediaSourceId, chosen)
    fetchVttText(vttUrl)
      .then((raw) => {
        if (streamRef.current?.itemId !== itemId || overlayForRef.current !== chosen.Index) return
        subVttRawRef.current = raw
        applySubBlobFromRaw(raw, subDelayRef.current)
      })
      .catch(() => {
        if (overlayForRef.current !== chosen.Index) return
        // Fallback: burn-in (no client-side delay on that path).
        burnedInSubRef.current = true
        loadStream(secondsToTicks(atSec), audio, chosen.Index)
      })
  }

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

  /** The subtitle a new stream must burn in: only an image one (text stays an overlay). */
  const burnedSub = () => (burnedInSubRef.current && subIndex !== -1 ? subIndex : undefined)

  const changeAudio = (idx: number) => {
    const at = liveAbsSec()
    setAudioIndex(idx)
    setAbsTime(at)
    loadStream(secondsToTicks(at), idx, burnedSub())
    rememberTrack({ audioLang: langOfStream(idx) })
  }
  const changeSub = (idx: number) => {
    const at = liveAbsSec()
    const streams = streamRef.current?.mediaStreams ?? []
    const chosen =
      idx === -1 ? undefined : streams.find((m) => m.Type === 'Subtitle' && m.Index === idx)
    // The title too: "Full" and "Signs & Songs" are often both English.
    rememberTrack(idx === -1 ? { subLang: 'off', subTitle: undefined } : { subLang: chosen?.Language || 'on', subTitle: chosen?.Title })
    overlayForRef.current = idx
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
    setAbsTime(at)
    // Re-negotiate the stream at the new cap from the current position
    loadStream(secondsToTicks(at), audioIndex, burnedSub())
  }

  // ---------- Panels (Audio & subtitles / Settings) ----------
  const openMenu = (which: Exclude<Menu, null>, trigger: HTMLElement) => {
    menuTriggerRef.current = trigger
    setMenu((m) => (m === which ? null : which))
    reveal()
  }
  const closeMenu = useCallback(() => {
    setMenu(null)
    if (inSpatialMode()) menuTriggerRef.current?.focus()
    scheduleHide()
  }, [scheduleHide])

  // Remote/keyboard users land on the current choice when a panel opens.
  useEffect(() => {
    if (!menu || !inSpatialMode()) return
    const raf = requestAnimationFrame(() => {
      const p = panelRef.current
      ;(p?.querySelector<HTMLElement>('[aria-checked="true"]') ?? p?.querySelector<HTMLElement>('button'))?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [menu])

  // Back closes an open panel before it leaves the player (App routes Back here).
  useEffect(
    () =>
      pushBackHandler(() => {
        if (!menuRef.current) return false
        closeMenu()
        return true
      }),
    [closeMenu],
  )

  // Live-refresh the stats panel while it's open
  useEffect(() => {
    if (!showStats) return
    const t = setInterval(() => setStatsTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [showStats])

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

  const showNextCard = !!nextEp && !nextCancelled && !error && absTime >= outroStartSec

  // ---------- Scrubber marks: chapters, intro / recap / credits ----------
  const chapterMarks = useMemo(() => {
    if (!durationSec || !item?.Chapters?.length) return []
    return item.Chapters.map((c) => ticksToSeconds(c.StartPositionTicks))
      .filter((t) => t > 5 && t < durationSec - 5)
      .map((t) => t / durationSec)
  }, [item?.Chapters, durationSec])
  const segmentBands = useMemo(() => {
    if (!durationSec) return []
    return segments
      .filter((sg) => sg.Type === 'Intro' || sg.Type === 'Outro' || sg.Type === 'Recap' || sg.Type === 'Preview')
      .map((sg) => {
        const a = Math.max(0, ticksToSeconds(sg.StartTicks) / durationSec)
        const b = Math.min(1, ticksToSeconds(sg.EndTicks) / durationSec)
        return { type: sg.Type, left: a, width: Math.max(0, b - a) }
      })
      .filter((b) => b.width > 0.002)
  }, [segments, durationSec])
  const chapterAt = useCallback(
    (sec: number) => {
      const list = item?.Chapters
      if (!list?.length) return ''
      let name = ''
      for (const c of list) {
        if (ticksToSeconds(c.StartPositionTicks) <= sec) name = c.Name ?? ''
        else break
      }
      // Jellyfin's auto-generated names ("Chapter 3") add nothing over the time.
      return /^chapter \d+$/i.test(name.trim()) ? '' : name
    },
    [item?.Chapters],
  )

  // ---------- Pause screen: what you're watching, after a beat paused ----------
  const [pausedLong, setPausedLong] = useState(false)
  useEffect(() => {
    if (playing || buffering || ended || error) {
      setPausedLong(false)
      return
    }
    const t = setTimeout(() => setPausedLong(true), 1500)
    return () => clearTimeout(t)
  }, [playing, buffering, ended, error])

  // The next episode's teaser clip (TV shows the still: a second video decode
  // alongside the main stream is too much for the TV's SoC). Warm it ~30s early
  // so it's already buffered when the card slides in.
  const { data: clipManifest } = useClipManifest()
  const nextClipUrl =
    nextEp && !IS_TV && !REDUCED_MOTION
      ? previewClipUrl(nextEp.Id, getPrefs().previewQuality, clipManifest ?? EMPTY_MANIFEST)
      : null
  const nearOutro = !!nextClipUrl && absTime >= outroStartSec - 30
  useEffect(() => {
    if (nearOutro && !window.matchMedia?.(SHORT_SCREEN).matches) prefetchClip(nextClipUrl)
  }, [nearOutro, nextClipUrl])

  // Countdown while the card is up and the video is actually playing (pausing
  // during the credits pauses the countdown too). Manual-only when auto-play
  // next is off.
  useEffect(() => {
    if (!showNextCard || !autoNext) {
      setCountdown(null)
      return
    }
    setCountdown((c) => c ?? NEXT_COUNTDOWN)
    if (!playing) return
    const t = setInterval(() => setCountdown((c) => (c == null ? null : Math.max(0, c - 1))), 1000)
    return () => clearInterval(t)
  }, [showNextCard, autoNext, playing])

  useEffect(() => {
    if (countdown === 0 && nextEp && !endHandled.current) {
      endHandled.current = true
      playEpisode(nextEp)
    }
  }, [countdown, nextEp, playEpisode])

  // The video ran out: roll into the next episode, leave the Up Next card up
  // (auto-play off), or head back out — never sit on a black frame.
  useEffect(() => {
    if (!ended || endHandled.current) return
    if (nextEp && !nextCancelled) {
      if (autoNext) {
        endHandled.current = true
        playEpisode(nextEp)
      } else {
        reveal()
      }
      return
    }
    endHandled.current = true
    exitPlayer()
  }, [ended, nextEp, nextCancelled, autoNext, playEpisode, exitPlayer, reveal])

  // TV: put the remote on the actionable prompt when it appears — unless the
  // user is mid-scrub/using the controls (then it's picked up when they fade).
  const remoteIdle = () =>
    !controlsVisibleRef.current || !playerRef.current?.contains(document.activeElement)
  useEffect(() => {
    if (IS_TV && showNextCard && remoteIdle()) nextBtnRef.current?.focus()
  }, [showNextCard])
  const introShowing = !!activeIntro
  useEffect(() => {
    if (IS_TV && introShowing && remoteIdle()) skipBtnRef.current?.focus()
  }, [introShowing])

  // Once the stream for THIS item is playable (and the saved prefs are in),
  // apply the remembered tracks for the series (audio + subtitle language),
  // falling back to the "subtitles on by default" pref. Guarded so it applies
  // once per item and can't loop.
  useEffect(() => {
    if (tracksApplied.current || buffering || !prefsReady) return
    const s = streamRef.current
    if (!s || s.itemId !== itemId || !item || item.Id !== itemId) return
    const streams = s.mediaStreams
    if (streams.length === 0) return
    tracksApplied.current = true

    const seriesId = item.Type === 'Episode' ? item.SeriesId : undefined
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
        pref.subLang === 'off'
          ? -1
          : pickSubtitle(subs, pref.subLang === 'on' ? undefined : pref.subLang, pref.subTitle)?.Index ?? subIndex
    } else if (getPrefs().subtitlesDefault && subs.length) {
      desiredSub = pickSubtitle(subs)?.Index ?? subIndex
    }

    if (desiredAudio !== audioIndex || desiredSub !== subIndex) {
      const at = liveAbsSec()
      setAbsTime(at)
      const chosen = desiredSub === -1 ? undefined : subs.find((x) => x.Index === desiredSub)
      const needsBurnIn = desiredSub !== -1 && isImageSubtitle(chosen)
      setAudioIndex(desiredAudio)
      setSubIndex(desiredSub)
      // Renegotiate the stream only when audio changes or subs need burn-in.
      // A pure text-sub default needs its VTT fetched into an overlay <track>
      // (setSubIndex alone paints nothing — the track is driven by subBlobUrl).
      if (desiredAudio !== audioIndex || needsBurnIn) {
        loadStream(secondsToTicks(at), desiredAudio, needsBurnIn ? desiredSub : undefined)
        // An overlay sub is fetched now and painted (again) once the new stream is up.
        if (chosen && !needsBurnIn) loadTextSubOverlay(chosen, at, desiredAudio)
      } else if (chosen) {
        loadTextSubOverlay(chosen, at)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffering, item, prefsReady, streamGen, itemId])

  // ---------- Keyboard / remote ----------
  // One handler for everything, reading live values through a ref so it never
  // re-subscribes. Back is routed by App (see lib/back.ts) so overlays close first.
  const latest = useRef({ nudgeSeek, seekTo, togglePlay, reveal, hideControls, playEpisode, exitPlayer, toggleFullscreen, changeAudio, changeSub, prevEp, nextEp })
  latest.current = { nudgeSeek, seekTo, togglePlay, reveal, hideControls, playEpisode, exitPlayer, toggleFullscreen, changeAudio, changeSub, prevEp, nextEp }

  // Remote control from another device (Finesse's mini remote, Jellyfin apps):
  // lib/remoteControl receives it over the server websocket and hands it here.
  useEffect(
    () =>
      onRemoteCommand((c) => {
        const L = latest.current
        const v = videoRef.current
        if (c.kind === 'playstate') {
          switch (c.command) {
            case 'PlayPause':
              L.togglePlay()
              break
            case 'Pause':
              v?.pause()
              break
            case 'Unpause':
              v?.play().catch(() => {})
              break
            case 'Stop':
              L.exitPlayer()
              return true
            case 'Seek':
              if (c.seekTicks != null) L.seekTo(ticksToSeconds(c.seekTicks))
              break
            case 'Rewind':
              L.nudgeSeek(-SEEK_STEP)
              break
            case 'FastForward':
              L.nudgeSeek(SEEK_STEP)
              break
            case 'NextTrack':
              if (L.nextEp) L.playEpisode(L.nextEp)
              break
            case 'PreviousTrack':
              if (L.prevEp) L.playEpisode(L.prevEp)
              break
            default:
              return false
          }
          L.reveal()
          return true
        }
        const n = Number(c.kind === 'general' ? c.args.Volume ?? c.args.Index : NaN)
        switch (c.name) {
          case 'SetVolume':
            if (Number.isFinite(n)) {
              setVolume(Math.max(0, Math.min(1, n / 100)))
              setMuted(false)
            }
            return true
          case 'VolumeUp':
            setVolume((x) => Math.min(1, x + 0.05))
            return true
          case 'VolumeDown':
            setVolume((x) => Math.max(0, x - 0.05))
            return true
          case 'Mute':
            setMuted(true)
            return true
          case 'Unmute':
            setMuted(false)
            return true
          case 'ToggleMute':
            setMuted((m) => !m)
            return true
          case 'SetAudioStreamIndex':
            if (Number.isFinite(n)) L.changeAudio(n)
            return true
          case 'SetSubtitleStreamIndex':
            if (Number.isFinite(n)) L.changeSub(n)
            return true
        }
        return false
      }),
    [],
  )

  useEffect(() => {
    const focusPlay = () =>
      playerRef.current?.querySelector<HTMLElement>('[data-play-toggle]')?.focus()

    const onKeyUp = () => {
      holdRef.current = { key: '', n: 0 }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (isTypingTarget(e.target) || isBackKey(e)) return
      const L = latest.current
      const wasHidden = !controlsVisibleRef.current
      L.reveal()
      const target = e.target as HTMLElement | null
      const onControl =
        target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement
      const onSeekbar = target === seekbarRef.current

      // Held arrow = accelerating scrub (10s steps, then 30s, then 60s).
      const hold = holdRef.current
      if (e.repeat && hold.key === e.key) hold.n++
      else holdRef.current = { key: e.key, n: 0 }
      const step = holdRef.current.n > 20 ? 60 : holdRef.current.n > 8 ? 30 : SEEK_STEP

      const dir = arrowDir(e)
      if (dir) {
        if (target instanceof HTMLInputElement && target.type === 'range') return // volume slider
        e.preventDefault()
        if (menuRef.current) {
          moveFocus(panelRef.current, dir)
          return
        }
        if (IS_TV) {
          // Hidden chrome: ←/→ scrub straight away (focus lands on the bar so
          // further presses keep scrubbing), ↑/↓ bring up the controls.
          if (wasHidden || !playerRef.current?.contains(document.activeElement)) {
            if (dir === 'left' || dir === 'right') {
              L.nudgeSeek(dir === 'left' ? -step : step)
              seekbarRef.current?.focus()
            } else {
              focusPlay()
            }
            return
          }
          if (onSeekbar && (dir === 'left' || dir === 'right')) {
            L.nudgeSeek(dir === 'left' ? -step : step)
            return
          }
          if (onSeekbar && dir === 'down') {
            focusPlay()
            return
          }
          moveFocus(playerRef.current, dir)
          return
        }
        // Keyboard: classic web-player mapping.
        if (dir === 'left') L.nudgeSeek(-step)
        else if (dir === 'right') L.nudgeSeek(step)
        else if (dir === 'up') setVolume((v) => Math.min(1, v + 0.05))
        else setVolume((v) => Math.max(0, v - 0.05))
        return
      }

      const playNow = () => videoRef.current?.play().catch(() => {})
      const pauseNow = () => videoRef.current?.pause()
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          L.togglePlay()
          return
        case 'Enter': // TV remote OK
          if (onControl) return // let the focused button activate natively
          e.preventDefault()
          if (IS_TV && wasHidden) focusPlay()
          L.togglePlay()
          return
        case 'm':
          setMuted((m) => !m)
          return
        case 'f':
          L.toggleFullscreen()
          return
        case 's':
          setShowStats((v) => !v)
          return
        case 'n':
        case 'N':
          if (L.nextEp) L.playEpisode(L.nextEp)
          return
        case 'p':
        case 'P':
          if (L.prevEp) L.playEpisode(L.prevEp)
          return
        // Dedicated transport buttons (named Media* keys; legacy keyCodes below).
        case 'MediaPlayPause':
          L.togglePlay()
          return
        case 'MediaPlay':
          playNow()
          return
        case 'MediaPause':
          pauseNow()
          return
        case 'MediaStop':
          L.exitPlayer()
          return
        case 'MediaRewind':
          L.nudgeSeek(-step)
          return
        case 'MediaFastForward':
          L.nudgeSeek(step)
          return
        case 'MediaTrackNext':
          if (L.nextEp) L.playEpisode(L.nextEp)
          else L.nudgeSeek(SEEK_STEP)
          return
        case 'MediaTrackPrevious':
          if (L.prevEp) L.playEpisode(L.prevEp)
          else L.nudgeSeek(-SEEK_STEP)
          return
      }
      // webOS / Fire TV / Tizen remotes often only set keyCode.
      switch (e.keyCode) {
        case 415: // webOS Play
          playNow()
          break
        case 19: // webOS Pause (NOT D-pad up inside a webOS app)
          pauseNow()
          break
        case 179: // Play/Pause (Fire TV, Android, Windows)
        case 10252: // Tizen Play/Pause
          L.togglePlay()
          break
        case 413: // Stop
          L.exitPlayer()
          break
        case 412: // Rewind
        case 227: // Fire TV rewind
          L.nudgeSeek(-step)
          break
        case 417: // Fast-forward
        case 228: // Fire TV fast-forward
          L.nudgeSeek(step)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // ---------- Touch surface: tap = show/hide controls, double-tap sides = ±10s ----------
  const toggleControls = () => {
    if (controlsVisibleRef.current) hideControls()
    else reveal()
  }
  const onSurfacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return // mouse uses click/dblclick below
    if (menuRef.current) {
      closeMenu()
      return
    }
    const now = performance.now()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const side = x < 0.35 ? 'left' : x > 0.65 ? 'right' : 'center'
    const prev = lastTapRef.current
    lastTapRef.current = { at: now, side }
    if (side !== 'center' && prev && prev.side === side && now - prev.at < 320) {
      window.clearTimeout(singleTapTimer.current)
      nudgeSeek(side === 'left' ? -SEEK_STEP : SEEK_STEP)
      setTapFx((fx) => ({
        side,
        secs: fx && fx.side === side && now - fx.at < 900 ? fx.secs + SEEK_STEP : SEEK_STEP,
        at: now,
      }))
      return
    }
    window.clearTimeout(singleTapTimer.current)
    // Sides wait a beat for a possible second tap; the centre answers at once.
    singleTapTimer.current = window.setTimeout(toggleControls, side === 'center' ? 0 : 260)
  }
  useEffect(() => {
    if (!tapFx) return
    const t = window.setTimeout(() => setTapFx(null), 700)
    return () => window.clearTimeout(t)
  }, [tapFx])

  // ---------- Media Session: lock screen / headset / notification controls ----------
  useEffect(() => {
    if (!('mediaSession' in navigator) || !item) return
    const ms = navigator.mediaSession
    try {
      if (typeof MediaMetadata !== 'undefined') {
        const art = api.backdropUrl(item, 640) ?? api.posterUrl(item, 480)
        ms.metadata = new MediaMetadata({
          title: item.Type === 'Episode' ? episodeLabel(item) : item.Name,
          artist: item.Type === 'Episode' ? item.SeriesName ?? '' : String(item.ProductionYear ?? ''),
          artwork: art ? [{ src: art, sizes: '640x360', type: 'image/jpeg' }] : [],
        })
      }
    } catch {
      /* older engines */
    }
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(a, h)
      } catch {
        /* action unsupported */
      }
    }
    set('play', () => videoRef.current?.play().catch(() => {}))
    set('pause', () => videoRef.current?.pause())
    set('seekbackward', () => latest.current.nudgeSeek(-SEEK_STEP))
    set('seekforward', () => latest.current.nudgeSeek(SEEK_STEP))
    set('previoustrack', prevEp ? () => playEpisode(prevEp) : null)
    set('nexttrack', nextEp ? () => playEpisode(nextEp) : null)
    return () => {
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack'] as const) set(a, null)
      try {
        ms.metadata = null
      } catch {
        /* ignore */
      }
    }
  }, [item, prevEp, nextEp, playEpisode])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, streamGen])

  // Scrub position: pointer hover/drag, or an in-progress remote/keyboard seek.
  const barWidth = seekbarRef.current?.clientWidth ?? 0
  const scrubFrac =
    hover?.frac ?? (pendingSeek != null && durationSec > 0 ? pendingSeek / durationSec : null)
  const scrubX = hover ? hover.x : scrubFrac != null ? scrubFrac * barWidth : 0

  const preview = useMemo(() => {
    if (scrubFrac == null || !trickplay || !durationSec || !itemId) return null
    const mediaSourceId = streamRef.current?.mediaSourceId || itemId
    const t = scrubFrac * durationSec
    const thumbIdx = Math.max(0, Math.floor((t * 1000) / trickplay.Interval))
    const perTile = Math.max(1, trickplay.TileWidth * trickplay.TileHeight)
    const tileIdx = Math.floor(thumbIdx / perTile)
    const pos = thumbIdx % perTile
    const col = pos % trickplay.TileWidth
    const row = Math.floor(pos / trickplay.TileWidth)
    // Smaller thumbnails on phones; scale the sprite sheet to match.
    const scale = Math.min(1, (TOUCH_UI ? 180 : 320) / trickplay.Width)
    return {
      url: api.trickplayTileUrl(itemId, trickplay.Width, tileIdx, mediaSourceId),
      x: -(col * trickplay.Width * scale),
      y: -(row * trickplay.Height * scale),
      w: trickplay.Width * scale,
      h: trickplay.Height * scale,
      sheetW: trickplay.TileWidth * trickplay.Width * scale,
      sheetH: trickplay.TileHeight * trickplay.Height * scale,
      time: t,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubFrac, trickplay, durationSec, itemId, streamGen])

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
  const hasTrackChoices = audioTracks.length > 1 || subTracks.length > 0
  // Shown on the button, so switching language is findable at a glance
  // ("Japanese" beats hunting behind a CC icon).
  const currentAudio =
    audioTracks.find((t) => t.Index === audioIndex) ?? audioTracks.find((t) => t.IsDefault) ?? audioTracks[0]
  const audioName = audioTracks.length > 1 && currentAudio ? trackLanguage(currentAudio) : null

  const isEpisode = item?.Type === 'Episode'
  const posterArt = item ? (isEpisode ? api.episodeThumbUrl(item, 1280) : api.backdropUrl(item, 1280)) : null
  const docTitle = item ? (isEpisode ? `${item.SeriesName ?? ''} · ${episodeLabel(item)}` : item.Name) : ''
  useEffect(() => {
    if (!docTitle) return
    document.title = `${docTitle} · Finesse`
    return () => {
      document.title = 'Finesse'
    }
  }, [docTitle])

  // The "you paused" card: the film or episode, its synopsis. Subtitles step
  // aside while it's up (they'd sit on top of it) and come back on play.
  const pauseScreen = pausedLong && !menu && !showNextCard && !!item && absTime > 1
  const shownTime = pendingSeek ?? absTime
  const progressFrac = durationSec ? Math.min(1, shownTime / durationSec) : 0
  const bufferedFrac = durationSec ? Math.min(1, bufferedAbs / durationSec) : 0
  const chromeClass = `transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`
  const iconBtn =
    'h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-90 transition disabled:opacity-30 disabled:pointer-events-none'
  const previewW = preview?.w ?? 0
  const previewLeft = Math.max(previewW / 2 - 8, Math.min(barWidth - previewW / 2 + 8, scrubX))

  return (
    <div
      ref={playerRef}
      className={`fixed inset-0 bg-black select-none overflow-hidden ${controlsVisible ? '' : 'cursor-none'}`}
    >
      {!IS_TV && ambient && <AmbientGlow videoRef={videoRef} />}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // No crossOrigin — it forces CORS on <track> VTT and silently kills subs
        // when Jellyfin is reached via Funnel/LAN with mismatched origins.
        // Morph target for the detail backdrop / Continue Watching tile (lib/motion);
        // the backdrop doubles as the loading poster so there's no black flash.
        data-vt-static="vt-hero"
        data-cues-hidden={pauseScreen || undefined}
        poster={posterArt ?? undefined}
        className="relative z-[1] h-full w-full"
      >
        {showTextTrack && subBlobUrl && (
          <track
            key={subBlobUrl}
            ref={(el) => el?.addEventListener('load', liftCues)}
            kind="subtitles"
            src={subBlobUrl}
            srcLang="en"
            label="Subtitles"
            default
          />
        )}
      </video>

      {/* Gesture surface: mouse click = play/pause, dbl-click = fullscreen;
          touch tap = show/hide controls, double-tap left/right = ∓10s. */}
      <div
        className="absolute inset-0 z-10"
        onPointerDown={(e) => (lastPointerType.current = e.pointerType)}
        onPointerUp={onSurfacePointerUp}
        onClick={() => {
          if (lastPointerType.current !== 'mouse') return
          if (menuRef.current) {
            closeMenu()
            return
          }
          togglePlay()
        }}
        onDoubleClick={() => {
          if (lastPointerType.current === 'mouse' && fullscreenSupported) toggleFullscreen()
        }}
      />

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

      {buffering && !error && !(TOUCH_UI && controlsVisible) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="spinner" />
        </div>
      )}

      {/* Double-tap seek feedback */}
      {tapFx && (
        <div
          key={tapFx.at}
          className={`absolute inset-y-0 z-20 w-1/3 flex items-center justify-center pointer-events-none toast-in ${
            tapFx.side === 'left' ? 'left-0 rounded-r-full' : 'right-0 rounded-l-full'
          } bg-white/10`}
        >
          <div className="flex flex-col items-center gap-1 text-white">
            {tapFx.side === 'left' ? <IconReplay className="h-9 w-9" /> : <IconForward className="h-9 w-9" />}
            <span className="text-sm font-semibold">
              {tapFx.side === 'left' ? '−' : '+'}
              {tapFx.secs}s
            </span>
          </div>
        </div>
      )}

      {/* Skip Intro — above the control bar so it stays clickable */}
      {activeIntro && !showNextCard && (
        <button
          ref={skipBtnRef}
          onClick={() => seekTo(ticksToSeconds(activeIntro.EndTicks))}
          className="absolute bottom-32 right-4 sm:right-8 z-30 rounded-lg bg-white/90 hover:bg-white text-ink-950 px-5 py-2.5 text-sm font-semibold shadow-2xl active:scale-95 transition-all"
        >
          Skip Intro
        </button>
      )}

      {/* Up next: the next episode's teaser (generated on the NAS by
          deploy/genclips.sh), synopsis, and a countdown Play button */}
      {showNextCard && nextEp && (
        <UpNextCard
          ep={nextEp}
          clipUrl={nextClipUrl}
          countdown={countdown}
          playRef={nextBtnRef}
          onPlay={() => playEpisode(nextEp)}
          onCancel={() => setNextCancelled(true)}
        />
      )}

      {/* Pause screen: the episode / film you're on, its synopsis — the
          streaming-app "you paused" moment instead of a bare frame. */}
      {pauseScreen && item && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[5] fade-in">
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
          <div className="absolute left-5 sm:left-10 lg:left-14 right-5 bottom-40 sm:bottom-48 max-w-xl">
            <p className="text-xs sm:text-sm font-semibold uppercase tracking-[0.16em] text-accent-300">Paused</p>
            <p className="mt-2 font-display text-4xl sm:text-6xl leading-[0.95] text-white">{item.Name}</p>
            <p className="mt-2 text-sm sm:text-base text-ink-200">
              {isEpisode
                ? [item.SeriesName, item.ParentIndexNumber != null ? `Season ${item.ParentIndexNumber}, Episode ${item.IndexNumber ?? '?'}` : null]
                    .filter(Boolean)
                    .join(' · ')
                : [item.ProductionYear, item.OfficialRating].filter(Boolean).join(' · ')}
            </p>
            {item.Overview && (
              <p className={`mt-3 text-sm sm:text-base leading-relaxed text-ink-200 line-clamp-3 [@media(max-height:520px)]:hidden`}>{item.Overview}</p>
            )}
          </div>
        </div>
      )}

      {/* Top bar */}
      <div
        ref={topBarRef}
        data-hidden={!controlsVisible}
        className={`absolute top-0 inset-x-0 z-20 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-2 sm:px-4 pt-2 sm:pt-3 pb-10 flex items-center gap-2 sm:gap-3 ${chromeClass}`}
        style={TOUCH_UI ? { paddingTop: 'max(0.5rem, env(safe-area-inset-top))' } : undefined}
      >
        <button onClick={exitPlayer} className={iconBtn} aria-label="Back">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          {isEpisode && item?.SeriesName && (
            <p className="text-xs text-ink-400 truncate">{item.SeriesName}</p>
          )}
          <p className="text-sm sm:text-base font-semibold text-white truncate">
            {item ? (isEpisode ? episodeLabel(item) : item.Name) : ''}
          </p>
        </div>
        {streamRef.current?.transcoding && (
          <span
            title={streamRef.current.transcodeReasons || 'Server is re-encoding this stream'}
            className="shrink-0 rounded-full bg-amber-400/15 border border-amber-300/30 text-amber-300 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5"
          >
            Transcoding
          </span>
        )}
      </div>

      {/* Touch: big centre transport (thumb-reachable, YouTube/Netflix-style) */}
      {TOUCH_UI && (
        <div
          data-hidden={!controlsVisible}
          className={`absolute inset-0 z-20 flex items-center justify-center gap-10 sm:gap-16 pointer-events-none ${chromeClass}`}
        >
          <button
            onClick={() => nudgeSeek(-SEEK_STEP)}
            className={`h-14 w-14 rounded-full flex items-center justify-center text-white active:scale-90 transition ${controlsVisible && !menu ? 'pointer-events-auto' : ''}`}
            aria-label="Back 10 seconds"
          >
            <IconReplay className="h-9 w-9" />
          </button>
          <button
            data-play-toggle
            onClick={togglePlay}
            className={`h-[4.5rem] w-[4.5rem] rounded-full bg-black/55 flex items-center justify-center text-white active:scale-90 transition ${controlsVisible && !menu ? 'pointer-events-auto' : ''}`}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {buffering && !error ? (
              <div className="spinner !h-12 !w-12" />
            ) : playing ? (
              <IconPause className="h-10 w-10" />
            ) : (
              <IconPlay className="h-10 w-10 translate-x-0.5" />
            )}
          </button>
          <button
            onClick={() => nudgeSeek(SEEK_STEP)}
            className={`h-14 w-14 rounded-full flex items-center justify-center text-white active:scale-90 transition ${controlsVisible && !menu ? 'pointer-events-auto' : ''}`}
            aria-label="Forward 10 seconds"
          >
            <IconForward className="h-9 w-9" />
          </button>
        </div>
      )}

      {/* Bottom bar */}
      <div
        ref={bottomBarRef}
        data-hidden={!controlsVisible}
        className={`absolute bottom-0 inset-x-0 z-20 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 sm:px-6 pt-20 pb-2 sm:pb-4 ${chromeClass}`}
        style={TOUCH_UI ? { paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' } : undefined}
      >
        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-ink-200">{fmt(shownTime)}</span>
          {/* Seekbar: hover = trickplay preview only; seek commits on pointer up/click.
              Focusable on TV/keyboard: ←/→ scrub while it has focus. */}
          <div
            ref={seekbarRef}
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(durationSec)}
            aria-valuenow={Math.round(shownTime)}
            aria-valuetext={`${fmt(shownTime)} of ${fmt(durationSec)}`}
            onFocus={() => setSeekFocused(true)}
            onBlur={() => setSeekFocused(false)}
            className="group/seek relative flex-1 h-8 flex items-center cursor-pointer touch-none rounded-full outline-none"
            onPointerMove={(e) => {
              if (durationSec <= 0) return
              if (e.pointerType !== 'mouse' && !scrubbingRef.current) return
              const frac = fracFromEvent(e)
              setHover({ frac, x: relXFromEvent(e) })
              // Visual-only while dragging — don't hit the player until release.
              if (scrubbingRef.current) setAbsTime(frac * durationSec)
            }}
            onPointerLeave={() => {
              if (!scrubbingRef.current) setHover(null)
            }}
            onPointerDown={(e) => {
              if (durationSec <= 0) return
              scrubbingRef.current = true
              cancelPendingSeek()
              ;(e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId)
              const frac = fracFromEvent(e)
              setHover({ frac, x: relXFromEvent(e) })
              setAbsTime(frac * durationSec)
            }}
            onPointerUp={(e) => {
              if (!scrubbingRef.current) return
              scrubbingRef.current = false
              if (durationSec > 0) seekTo(fracFromEvent(e) * durationSec)
              if (e.pointerType !== 'mouse') setHover(null)
              try {
                ;(e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId)
              } catch {
                /* ignore */
              }
              scheduleHide()
            }}
            onPointerCancel={() => {
              scrubbingRef.current = false
              setHover(null)
            }}
          >
            {/* Scrub preview: trickplay frame when the server has them, else a time bubble */}
            {scrubFrac != null && (preview || pendingSeek != null || TOUCH_UI || !!chapterAt(scrubFrac * durationSec)) && (
              <div
                className="absolute bottom-full mb-3 -translate-x-1/2 pointer-events-none"
                style={{ left: preview ? previewLeft : scrubX }}
              >
                {preview ? (
                  <div
                    className="relative overflow-hidden rounded-lg ring-1 ring-white/20 shadow-2xl bg-black"
                    style={{ width: preview.w, height: preview.h }}
                  >
                    <div
                      style={{
                        width: preview.w,
                        height: preview.h,
                        backgroundImage: `url(${preview.url})`,
                        backgroundSize: `${preview.sheetW}px ${preview.sheetH}px`,
                        backgroundPosition: `${preview.x}px ${preview.y}px`,
                      }}
                    />
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] font-semibold text-white bg-black/70 rounded px-1.5 py-0.5">
                      {fmt(preview.time)}
                    </span>
                  </div>
                ) : (
                  <span className="block rounded-md bg-black/80 px-2 py-1 text-xs font-semibold tabular-nums text-white">
                    {fmt(scrubFrac * durationSec)}
                  </span>
                )}
                {chapterAt(scrubFrac * durationSec) && (
                  <span className="mt-1.5 block text-center text-xs font-semibold text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)] whitespace-nowrap">
                    {chapterAt(scrubFrac * durationSec)}
                  </span>
                )}
              </div>
            )}
            <div
              className={`relative w-full rounded-full bg-white/20 transition-all ${
                seekFocused || TOUCH_UI ? 'h-1.5' : 'h-1 group-hover/seek:h-1.5'
              }`}
            >
              <div className="absolute h-full rounded-full bg-white/30" style={{ width: `${bufferedFrac * 100}%` }} />
              {/* Intro / recap / credits as amber bands (the skippable bits) */}
              {segmentBands.map((b, i) => (
                <div
                  key={`seg${i}`}
                  title={b.type === 'Outro' ? 'Credits' : b.type}
                  className="absolute h-full bg-amber-300/55"
                  style={{ left: `${b.left * 100}%`, width: `${b.width * 100}%` }}
                />
              ))}
              <div className="absolute h-full rounded-full bg-accent-400" style={{ width: `${progressFrac * 100}%` }} />
              {/* Chapter breaks: small gaps in the bar */}
              {chapterMarks.map((f, i) => (
                <div key={`ch${i}`} className="absolute top-0 h-full w-[3px] -translate-x-1/2 bg-black/80" style={{ left: `${f * 100}%` }} />
              ))}
              <div
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-accent-300 shadow-md transition-opacity ${
                  seekFocused ? 'h-5 w-5 opacity-100 ring-4 ring-white/40' : TOUCH_UI ? 'h-4 w-4 opacity-100' : 'h-3.5 w-3.5 opacity-0 group-hover/seek:opacity-100'
                }`}
                style={{ left: `${progressFrac * 100}%` }}
              />
            </div>
          </div>
          <span className="w-14 shrink-0 text-xs tabular-nums text-ink-400">{fmt(durationSec)}</span>
        </div>

        <div className="mt-1 flex items-center gap-0.5 sm:gap-1.5 text-white">
          {!TOUCH_UI && (
            <>
              {isEpisode && (
                <button
                  onClick={() => prevEp && playEpisode(prevEp)}
                  disabled={!prevEp}
                  className={iconBtn}
                  aria-label="Previous episode"
                  title={prevEp ? `Previous: ${episodeLabel(prevEp)} (p)` : 'No previous episode'}
                >
                  <IconPrev className="h-6 w-6" />
                </button>
              )}
              <button onClick={() => nudgeSeek(-SEEK_STEP)} className={iconBtn} aria-label="Back 10 seconds" title="Back 10s (←)">
                <IconReplay className="h-7 w-7" />
              </button>
              <button data-play-toggle onClick={togglePlay} className={`${iconBtn} !h-12 !w-12`} aria-label={playing ? 'Pause' : 'Play'} title="Play/Pause (space)">
                {playing ? <IconPause className="h-8 w-8" /> : <IconPlay className="h-8 w-8 translate-x-px" />}
              </button>
              <button onClick={() => nudgeSeek(SEEK_STEP)} className={iconBtn} aria-label="Forward 10 seconds" title="Forward 10s (→)">
                <IconForward className="h-7 w-7" />
              </button>
              {isEpisode && (
                <button
                  onClick={() => nextEp && playEpisode(nextEp)}
                  disabled={!nextEp}
                  className={iconBtn}
                  aria-label="Next episode"
                  title={nextEp ? `Next: ${episodeLabel(nextEp)} (n)` : 'No next episode'}
                >
                  <IconNext className="h-6 w-6" />
                </button>
              )}
              {!IS_TV && (
                <div className="flex items-center group/vol">
                  <button onClick={() => setMuted((m) => !m)} className={iconBtn} aria-label={muted ? 'Unmute' : 'Mute'} title="Mute (m)">
                    {muted || volume === 0 ? <IconMuted className="h-5 w-5" /> : <IconVolume className="h-5 w-5" />}
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
                    className="w-0 opacity-0 group-hover/vol:w-24 group-hover/vol:opacity-100 focus:w-24 focus:opacity-100 transition-all accent-accent-400"
                    aria-label="Volume"
                  />
                </div>
              )}
            </>
          )}
          {TOUCH_UI && isEpisode && (
            <>
              <button
                onClick={() => prevEp && playEpisode(prevEp)}
                disabled={!prevEp}
                className={iconBtn}
                aria-label="Previous episode"
              >
                <IconPrev className="h-6 w-6" />
              </button>
              <button
                onClick={() => nextEp && playEpisode(nextEp)}
                disabled={!nextEp}
                className={iconBtn}
                aria-label="Next episode"
              >
                <IconNext className="h-6 w-6" />
              </button>
            </>
          )}

          <div className="flex-1" />

          {hasTrackChoices && (
            <button
              onClick={(e) => openMenu('tracks', e.currentTarget)}
              className={`h-10 shrink-0 rounded-full flex items-center gap-2 px-2 ${
                audioName ? 'sm:pl-2.5 sm:pr-3.5' : ''
              } text-white hover:bg-white/10 active:scale-95 transition ${menu === 'tracks' ? 'bg-white/10' : ''}`}
              aria-label="Audio and subtitles"
              title="Audio & subtitles"
              aria-expanded={menu === 'tracks'}
            >
              <IconAudioSubs className="h-6 w-6" />
              {audioName && <span className="hidden sm:inline text-sm font-semibold">{audioName}</span>}
              {subIndex >= 0 && (
                <span className="hidden sm:inline rounded border border-white/40 px-1 text-[10px] font-bold leading-4">CC</span>
              )}
            </button>
          )}
          {/* Move it to the TV: it carries on there from here, and this player steps back. */}
          {!IS_TV && item && !itemId?.startsWith('f-') && (
            <CastMenu
              item={item}
              variant="player"
              className={iconBtn}
              startTicks={positionTicks}
              onCast={() => {
                videoRef.current?.pause()
                exitPlayer()
              }}
            />
          )}
          <button
            onClick={(e) => openMenu('settings', e.currentTarget)}
            className={`${iconBtn} ${menu === 'settings' ? 'text-accent-300' : ''}`}
            aria-label="Playback settings"
            title="Settings"
            aria-expanded={menu === 'settings'}
          >
            <IconGear className={`h-6 w-6 transition-transform duration-300 ${menu === 'settings' ? 'rotate-45' : ''}`} />
          </button>
          {fullscreenSupported && (
            <button onClick={toggleFullscreen} className={iconBtn} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen (f)">
              {fullscreen ? <IconExitFullscreen className="h-6 w-6" /> : <IconFullscreen className="h-6 w-6" />}
            </button>
          )}
        </div>
      </div>

      {/* Panels: anchored above the bar on desktop/TV, a bottom sheet on phones */}
      {menu && (
        <>
          {TOUCH_UI && <div className="absolute inset-0 z-30 bg-black/50 toast-in" onClick={closeMenu} />}
          <div
            ref={panelRef}
            role="dialog"
            aria-label={menu === 'tracks' ? 'Audio and subtitles' : 'Playback settings'}
            className={`z-40 overflow-y-auto overscroll-contain border border-white/10 bg-ink-900/95 shadow-2xl toast-in ${
              TOUCH_UI
                ? 'absolute inset-x-0 bottom-0 max-h-[75%] rounded-t-2xl p-4'
                : 'absolute right-3 sm:right-6 bottom-24 max-h-[calc(var(--vh)*60)] w-[34rem] max-w-[calc(var(--vw)*100_-_1.5rem)] rounded-2xl p-4'
            }`}
            style={TOUCH_UI ? { paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' } : undefined}
          >
            {TOUCH_UI && <div className="mx-auto -mt-1 mb-3 h-1 w-10 rounded-full bg-white/20" aria-hidden />}
            {menu === 'tracks' ? (
              <div className={`grid gap-4 ${audioTracks.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                {audioTracks.length > 1 && (
                  <section>
                    <h3 className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Audio</h3>
                    {audioTracks.map((t) => (
                      <PanelOption
                        key={t.Index}
                        selected={t.Index === audioIndex || (audioIndex === undefined && !!t.IsDefault)}
                        onSelect={() => changeAudio(t.Index)}
                      >
                        {t.DisplayTitle ?? `Track ${t.Index}`}
                      </PanelOption>
                    ))}
                  </section>
                )}
                <section>
                  <h3 className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Subtitles</h3>
                  <PanelOption selected={subIndex === -1} onSelect={() => changeSub(-1)}>
                    Off
                  </PanelOption>
                  {subTracks.map((t) => (
                    <PanelOption key={t.Index} selected={t.Index === subIndex} onSelect={() => changeSub(t.Index)}>
                      {t.DisplayTitle ?? `Track ${t.Index}`}
                    </PanelOption>
                  ))}
                </section>
                {/* Timing only applies to overlay (text) subs, not burned-in ones */}
                {hasOverlaySubs && (
                  <div className={`border-t border-white/5 pt-3 px-3 ${audioTracks.length > 1 ? 'sm:col-span-2' : ''}`}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Subtitle timing</p>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setSubDelay(subDelayMs - SUB_DELAY_STEP_LARGE_MS)} className={stepBtn} aria-label="Subtitles 0.5 seconds earlier">−0.5</button>
                      <button onClick={() => setSubDelay(subDelayMs - SUB_DELAY_STEP_MS)} className={stepBtn} aria-label="Subtitles 0.1 seconds earlier">−0.1</button>
                      <button
                        onClick={() => setSubDelay(0)}
                        className="min-w-[4.5rem] h-9 rounded-lg px-2 text-xs font-semibold tabular-nums text-white hover:bg-white/10"
                        title="Reset subtitle timing"
                      >
                        {subDelayMs === 0 ? 'In sync' : `${subDelayMs > 0 ? '+' : ''}${(subDelayMs / 1000).toFixed(1)}s`}
                      </button>
                      <button onClick={() => setSubDelay(subDelayMs + SUB_DELAY_STEP_MS)} className={stepBtn} aria-label="Subtitles 0.1 seconds later">+0.1</button>
                      <button onClick={() => setSubDelay(subDelayMs + SUB_DELAY_STEP_LARGE_MS)} className={stepBtn} aria-label="Subtitles 0.5 seconds later">+0.5</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <section>
                  <h3 className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Quality</h3>
                  {BITRATE_OPTIONS.map((o) => (
                    <PanelOption key={o.value} selected={o.value === maxBitrate} onSelect={() => changeQuality(o.value)}>
                      {o.label}
                    </PanelOption>
                  ))}
                </section>
                <section className="border-t border-white/5 pt-3">
                  {isEpisode && (
                    <PanelToggle
                      label="Auto-play next episode"
                      on={autoNext}
                      onToggle={() => {
                        setPrefs({ autoPlayNext: !autoNext })
                        setAutoNext(!autoNext)
                      }}
                    />
                  )}
                  {!IS_TV && (
                    <PanelToggle
                      label="Ambient glow"
                      on={ambient}
                      onToggle={() => {
                        setPrefs({ ambient: !ambient })
                        setAmbient(!ambient)
                      }}
                    />
                  )}
                  <PanelToggle label="Stats for nerds" on={showStats} onToggle={() => setShowStats((v) => !v)} />
                </section>
              </div>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center">
          <p className="text-white">{error}</p>
          <div className="flex gap-3">
            <button
              autoFocus
              onClick={() => loadStream(secondsToTicks(liveAbsSec()), audioIndex, subIndex === -1 ? undefined : subIndex)}
              className="rounded-lg bg-white px-5 py-2 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition-colors"
            >
              Try again
            </button>
            <button
              onClick={exitPlayer}
              className="rounded-lg bg-white/10 px-5 py-2 text-sm text-white hover:bg-white/20 transition-colors"
            >
              Go back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Ambient mode: the current scene, shrunk to a few pixels and blurred huge,
 *  glows in the letterbox bars behind the picture (phones held upright, wide
 *  films on 16:9 screens, 4:3 shows). Draws ~12×/s, blending over the previous
 *  frames so colour shifts glide instead of flickering at cuts. Only drawn,
 *  never read back — so it works on cross-origin streams too. */
function AmbientGlow({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const v = videoRef.current as
      | (HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number) => void) => number; cancelVideoFrameCallback?: (h: number) => void })
      | null
    const c = canvasRef.current
    const ctx = c?.getContext('2d', { alpha: false })
    if (!v || !c || !ctx) return
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, c.width, c.height)
    let stopped = false
    let pending = false
    let last = 0
    let handle = 0
    const rvfc = typeof v.requestVideoFrameCallback === 'function'
    const paint = (alpha: number) => {
      if (v.readyState < 2) return
      ctx.globalAlpha = alpha
      try {
        ctx.drawImage(v, 0, 0, c.width, c.height)
      } catch {
        /* no frame yet */
      }
    }
    const tick = (now: number) => {
      pending = false
      if (stopped) return
      if (now - last > 80 && !v.paused) {
        last = now
        paint(0.35)
      }
      schedule()
    }
    const schedule = () => {
      if (pending || stopped) return
      pending = true
      // Per-frame callbacks where supported (idle while paused); rAF otherwise.
      handle = rvfc ? v.requestVideoFrameCallback!(tick) : requestAnimationFrame(tick)
    }
    const snap = () => {
      paint(1) // after a seek or a new episode: jump straight to the new scene
      schedule()
    }
    v.addEventListener('seeked', snap)
    v.addEventListener('loadeddata', snap)
    v.addEventListener('play', schedule)
    snap()
    return () => {
      stopped = true
      if (rvfc) v.cancelVideoFrameCallback?.(handle)
      else cancelAnimationFrame(handle)
      v.removeEventListener('seeked', snap)
      v.removeEventListener('loadeddata', snap)
      v.removeEventListener('play', schedule)
    }
  }, [videoRef])
  return <canvas ref={canvasRef} width={32} height={18} aria-hidden className="ambient-glow" />
}

const SHORT_SCREEN = '(max-height: 520px)'

/** End-of-episode card: the next episode's teaser clip (or still), its synopsis,
 *  and Play now (with the auto-play countdown filling it) / Cancel. */
function UpNextCard({
  ep,
  clipUrl,
  countdown,
  playRef,
  onPlay,
  onCancel,
}: {
  ep: JfItem
  clipUrl: string | null
  countdown: number | null
  playRef: React.Ref<HTMLButtonElement>
  onPlay: () => void
  onCancel: () => void
}) {
  const [clipPlaying, setClipPlaying] = useState(false)
  const [clipFailed, setClipFailed] = useState(false)
  // Short screens (landscape phones) hide the media block — don't fetch or
  // decode a clip nobody can see.
  const [shortScreen, setShortScreen] = useState(() => window.matchMedia?.(SHORT_SCREEN).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(SHORT_SCREEN)
    if (!mq?.addEventListener) return
    const on = () => setShortScreen(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const still = api.episodeThumbUrl(ep, 640)
  const runtime = formatRuntime(ep.RunTimeTicks)
  return (
    <div className="absolute bottom-28 sm:bottom-32 right-3 sm:right-8 z-30 w-[26rem] max-w-[calc(var(--vw)*100_-_1.5rem)] overflow-hidden rounded-2xl bg-ink-900/95 border border-white/10 shadow-2xl toast-in">
      {/* Media — skipped on short landscape phones so the card never covers the video */}
      <div className="relative aspect-video bg-ink-800 [@media(max-height:520px)]:hidden">
        {still && <img src={still} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        {clipUrl && !clipFailed && !shortScreen && (
          <video
            src={clipUrl}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onPlaying={() => setClipPlaying(true)}
            onError={() => setClipFailed(true)}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
              clipPlaying ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-transparent to-black/30" />
        <span className="absolute top-2.5 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">
          Up next{countdown != null ? ` · ${countdown}s` : ''}
        </span>
        {runtime && (
          <span className="absolute top-2.5 right-3 rounded-full bg-black/60 px-2 py-1 text-[11px] font-semibold text-ink-200">
            {runtime}
          </span>
        )}
      </div>
      <div className="relative px-4 pt-3 [@media(min-height:521px)]:-mt-6">
        <p className="hidden [@media(max-height:520px)]:block text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Up next{countdown != null ? ` · ${countdown}s` : ''}
        </p>
        <p className="text-base font-semibold text-white line-clamp-2 drop-shadow">{episodeLabel(ep)}</p>
        {ep.Overview && (
          <p className="mt-1 text-sm leading-snug text-ink-200/90 line-clamp-3 [@media(max-height:520px)]:line-clamp-2">
            {ep.Overview}
          </p>
        )}
      </div>
      <div className="flex gap-2 p-4 pt-3">
        <button
          ref={playRef}
          onClick={onPlay}
          className="relative flex-1 overflow-hidden rounded-lg bg-white py-2.5 text-sm font-semibold text-ink-950 hover:bg-ink-200 active:scale-95 transition-all"
        >
          {countdown != null && (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-accent-300/60 transition-[width] duration-1000 ease-linear"
              style={{ width: `${((NEXT_COUNTDOWN - countdown) / NEXT_COUNTDOWN) * 100}%` }}
            />
          )}
          <span className="relative inline-flex items-center gap-1.5">
            <IconPlay className="h-4 w-4" /> Play now
          </span>
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg bg-white/10 py-2.5 text-sm font-semibold text-white hover:bg-white/20 active:scale-95 transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

const stepBtn =
  'h-9 min-w-[2.75rem] rounded-lg bg-white/5 px-2 text-xs font-semibold tabular-nums text-ink-200 hover:bg-white/15 hover:text-white active:scale-95 transition'

function PanelOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/10 ${
        selected ? 'text-white font-semibold' : 'text-ink-200'
      }`}
    >
      <span className="w-4 shrink-0 text-accent-300">
        {selected && (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        )}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </button>
  )
}

function PanelToggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-ink-200 hover:bg-white/10 transition-colors"
    >
      {label}
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-accent-fill' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[1.125rem]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

// ---------- Icons ----------
type IconProps = { className?: string }

/** Circular arrow turning counter-clockwise (↺) with "10" — skip BACK. */
function IconReplay({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
      <text x="12" y="15.6" fontSize="6.6" fontWeight="700" textAnchor="middle" fontFamily="system-ui, sans-serif">10</text>
    </svg>
  )
}

/** Mirror of IconReplay (↻) — skip FORWARD. The digits stay unmirrored. */
function IconForward({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path
        transform="matrix(-1 0 0 1 24 0)"
        d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
      />
      <text x="12" y="15.6" fontSize="6.6" fontWeight="700" textAnchor="middle" fontFamily="system-ui, sans-serif">10</text>
    </svg>
  )
}

function IconPlay({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z" />
    </svg>
  )
}

function IconPause({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

/** Bar on the left + triangle pointing left (⏮). */
function IconPrev({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z" />
    </svg>
  )
}

/** Triangle pointing right + bar on the right (⏭). */
function IconNext({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
    </svg>
  )
}

function IconVolume({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  )
}

function IconMuted({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z" />
    </svg>
  )
}

/** Speech bubble: the usual "Audio & subtitles" mark (a CC icon read as
 *  subtitles only, hiding the audio-language switch). */
function IconAudioSubs({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
      />
    </svg>
  )
}

/** "Japanese - Opus - Stereo" → "Japanese" (Jellyfin's DisplayTitle leads with the language). */
function trackLanguage(t: JfMediaStream): string {
  return (t.DisplayTitle ?? t.Language ?? 'Audio').split(' - ')[0]
}

function IconGear({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.03 7.03 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.93 6.93 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  )
}

function IconFullscreen({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  )
}

function IconExitFullscreen({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
    </svg>
  )
}
