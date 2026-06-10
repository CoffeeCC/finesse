import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Hls from 'hls.js'
import * as api from '../api/client'
import { useItem } from '../api/queries'
import { secondsToTicks, ticksToSeconds } from '../api/types'

const PROGRESS_INTERVAL_MS = 10_000

export default function PlayerPage() {
  const { itemId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const startTicks = Number(searchParams.get('t') ?? 0)

  const { data: item } = useItem(itemId)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !itemId) return

    let hls: Hls | null = null
    let progressTimer: ReturnType<typeof setInterval> | null = null
    let cancelled = false

    // Ticks the current stream starts at (HLS transcodes begin at the seek point)
    let offsetTicks = 0
    let playSessionId = ''
    let mediaSourceId = ''
    let transcoding = false

    const positionTicks = () => offsetTicks + secondsToTicks(video.currentTime)

    const report = (
      fn: (r: {
        itemId: string
        mediaSourceId: string
        playSessionId: string
        positionTicks: number
        isPaused?: boolean
      }) => unknown,
      isPaused?: boolean,
    ) => {
      if (playSessionId) {
        fn({ itemId, mediaSourceId, playSessionId, positionTicks: positionTicks(), isPaused })
      }
    }

    const start = async () => {
      try {
        const info = await api.getPlaybackInfo(itemId, startTicks)
        if (cancelled) return
        const source = info.MediaSources[0]
        if (!source) throw new Error('No playable media source')

        playSessionId = info.PlaySessionId
        mediaSourceId = source.Id

        let url: string
        if (source.SupportsDirectPlay) {
          url = api.directStreamUrl(itemId, source.Id, source.Container)
        } else if (source.TranscodingUrl) {
          url = api.transcodeUrl(source.TranscodingUrl)
          transcoding = true
          offsetTicks = startTicks
        } else {
          throw new Error('Server offered no playback method')
        }

        if (url.includes('.m3u8') && Hls.isSupported()) {
          hls = new Hls({ maxBufferLength: 60, backBufferLength: 30 })
          hls.loadSource(url)
          hls.attachMedia(video)
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) setError(`Playback failed (${data.type})`)
          })
        } else {
          video.src = url
        }

        // Direct play resumes by seeking; transcodes already start at the offset
        if (!transcoding && startTicks > 0) {
          const onMeta = () => {
            video.currentTime = ticksToSeconds(startTicks)
            video.removeEventListener('loadedmetadata', onMeta)
          }
          video.addEventListener('loadedmetadata', onMeta)
        }

        await video.play().catch(() => {})
        report(api.reportPlaybackStart)
        progressTimer = setInterval(
          () => report(api.reportPlaybackProgress, video.paused),
          PROGRESS_INTERVAL_MS,
        )
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not start playback')
      }
    }

    const onPause = () => report(api.reportPlaybackProgress, true)
    const onSeeked = () => report(api.reportPlaybackProgress, video.paused)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeked', onSeeked)

    start()

    return () => {
      cancelled = true
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeked', onSeeked)
      if (progressTimer) clearInterval(progressTimer)
      report(api.reportPlaybackStopped)
      if (transcoding && playSessionId) api.stopActiveEncoding(playSessionId)
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [itemId, startTicks])

  // Auto-hide the top bar while playing
  useEffect(() => {
    const show = () => {
      setControlsVisible(true)
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setControlsVisible(false), 3000)
    }
    show()
    window.addEventListener('mousemove', show)
    return () => {
      window.removeEventListener('mousemove', show)
      clearTimeout(hideTimer.current)
    }
  }, [])

  const title =
    item?.Type === 'Episode'
      ? `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? '?'}:E${item.IndexNumber ?? '?'} · ${item.Name}`
      : item?.Name ?? ''

  return (
    <div className="fixed inset-0 bg-black">
      <video ref={videoRef} controls autoPlay playsInline className="h-full w-full" />

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

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80">
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
