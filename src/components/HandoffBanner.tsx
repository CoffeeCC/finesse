import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHandoff } from '../api/queries'
import { backdropUrl } from '../api/client'
import * as api from '../api/client'
import { formatRuntime, ticksToSeconds } from '../api/types'

/**
 * When another of the user's devices is actively playing, offer to pick it up
 * here at the same spot — a one-click cross-device handoff.
 */
export default function HandoffBanner() {
  const { data: session } = useHandoff()
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState<string | null>(null)

  const item = session?.NowPlayingItem
  if (!session || !item || dismissed === session.Id) return null

  const pos = session.PlayState?.PositionTicks ?? 0
  const bg = backdropUrl(item, 600)
  const title =
    item.Type === 'Episode'
      ? `${item.SeriesName ?? ''} · S${item.ParentIndexNumber ?? '?'}:E${item.IndexNumber ?? '?'}`
      : item.Name
  const remaining = item.RunTimeTicks
    ? `${formatRuntime(item.RunTimeTicks - pos)} left`
    : ''

  const resumeHere = () => {
    if (session.Id) api.sendStopToSession(session.Id) // pause the other device
    navigate(`/play/${item.Id}${pos > 0 ? `?t=${pos}` : ''}`)
  }

  return (
    <div className="px-4 sm:px-6 lg:px-12 mt-6">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-ink-900/70 backdrop-blur">
        {bg && (
          <img src={bg} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-20" />
        )}
        <div className="relative flex items-center gap-4 p-4">
          <span className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-500/20 text-accent-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-accent-300 font-medium">
              Playing on {session.DeviceName || session.Client || 'another device'}
            </p>
            <p className="text-sm font-semibold text-white truncate">
              {title}
              {remaining && <span className="text-ink-400 font-normal"> · {remaining}</span>}
            </p>
          </div>
          <button
            onClick={resumeHere}
            className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-white text-ink-950 px-4 py-2 text-sm font-semibold hover:bg-ink-200 active:scale-95 transition-all"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            Continue here
          </button>
          <button
            onClick={() => setDismissed(session.Id)}
            className="shrink-0 h-8 w-8 rounded-full hover:bg-white/10 flex items-center justify-center text-ink-400 hover:text-white transition-colors"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    </div>
  )
}
