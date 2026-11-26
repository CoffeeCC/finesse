// A game request's status: the words, a bar while it moves, stage steps, and a second line.
// Shared on cards, the game's page and the requests manager (lib/gameRequestStatus.ts decides the words).

import { Link } from 'react-router-dom'
import { needsProgramPick, type GameRequest } from '../../api/gameStore'
import { gameRequestView, type GameRequestView } from '../../lib/gameRequestStatus'

const TONE: Record<GameRequestView['tone'], string> = {
  ok: 'text-emerald-300',
  busy: 'text-accent-300',
  wait: 'text-ink-200',
  bad: 'text-amber-200',
  you: 'text-sky-300',
}

const ICON: Record<GameRequest['state'], string> = {
  queued: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  downloading: 'M12 3v13.5m0 0 4.5-4.5M12 16.5 7.5 12M3.75 18.75A2.25 2.25 0 0 0 6 21h12a2.25 2.25 0 0 0 2.25-2.25',
  paused: 'M15.75 5.25v13.5m-7.5-13.5v13.5',
  checking: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  installing: 'M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25',
  'needs-you': 'M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243-1.59-1.59',
  finishing: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z',
  ready: 'm4.5 12.75 6 6 9-13.5',
  failed: 'M12 9v3.75m0 3.75h.008M10.3 3.9 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
}

export function GameRequestStatusView({ request, size = 'sm', className = '' }: { request: GameRequest; size?: 'sm' | 'lg'; className?: string }) {
  const v = gameRequestView(request)
  const lg = size === 'lg'
  return (
    <div className={`min-w-0 ${className}`} role="status">
      <span className={`inline-flex items-center gap-1.5 font-semibold ${lg ? 'text-[15px]' : 'text-xs'} ${TONE[v.tone]}`}>
        <svg className={lg ? 'h-5 w-5 shrink-0' : 'h-4 w-4 shrink-0'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d={ICON[request.state]} />
        </svg>
        {v.label}
      </span>
      {v.progress !== undefined && (
        <span className={`mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/10 ${lg ? 'w-64 max-w-full' : 'w-full max-w-[12rem]'}`} aria-hidden>
          <span
            className={`block h-full rounded-full transition-all duration-700 ${request.state === 'paused' ? 'bg-ink-400' : 'bg-accent-400'}`}
            style={{ width: `${v.progress}%` }}
          />
        </span>
      )}
      {v.detail && <span className={`mt-1 block break-words text-ink-400 ${lg ? 'max-w-md text-[13px]' : 'text-[11.5px] leading-snug'}`}>{v.detail}</span>}
      {/* Words only: this view sits inside card links, so the link itself is ChooseProgramLink. */}
      {needsProgramPick(request) && (
        <span className={`mt-1 block font-medium text-sky-200 ${lg ? 'text-[13px]' : 'text-[11.5px]'}`}>
          {request.candidates!.length === 1 ? 'Found 1 program: confirm it starts the game' : `Found ${request.candidates!.length} programs: choose the one that starts the game`}
        </span>
      )}
    </div>
  )
}

const STAGES = ['Downloading', 'Checking', 'Installing', 'Ready'] as const

function stageIndex(r: GameRequest): number {
  switch (r.state) {
    case 'queued':
    case 'downloading':
    case 'paused':
      return 0
    case 'checking':
      return 1
    case 'installing':
    case 'needs-you':
    case 'finishing':
      return 2
    case 'ready':
      return 3
    case 'failed':
      if (r.candidates?.length || (r.progress ?? 0) >= 100) return 2
      return 0
  }
}

/** Compact 4-stage pipeline indicator: Downloading → Checking → Installing → Ready. */
export function RequestStageBar({ request, className = '' }: { request: GameRequest; className?: string }) {
  const active = stageIndex(request)
  const failed = request.state === 'failed'
  const needsYou = request.state === 'needs-you'
  const paused = request.state === 'paused'
  const done = request.state === 'ready'

  return (
    <div className={`grid grid-cols-4 gap-1.5 ${className}`} aria-label="Install progress stages">
      {STAGES.map((label, idx) => {
        const isPast = done || idx < active
        const isCurrent = !done && idx === active
        const barColor = isPast
          ? 'bg-emerald-400/80'
          : isCurrent
            ? failed
              ? 'bg-amber-400'
              : needsYou
                ? 'bg-sky-400'
                : paused
                  ? 'bg-ink-400'
                  : 'bg-accent-400'
            : 'bg-white/10'
        const textColor = isPast
          ? 'text-emerald-300/90'
          : isCurrent
            ? failed
              ? 'text-amber-200'
              : needsYou
                ? 'text-sky-300'
                : 'text-white'
            : 'text-ink-500'
        return (
          <div key={label} className="min-w-0">
            <div className={`h-1 w-full rounded-full transition-colors ${barColor}`} />
            <p className={`mt-1 truncate text-[10.5px] font-medium ${textColor}`}>{label}</p>
          </div>
        )
      })}
    </div>
  )
}

/** A small pill for a card's corner. */
export function GameRequestBadge({ request }: { request: GameRequest }) {
  const v = gameRequestView(request)
  const label = request.state === 'ready' ? 'Ready' : request.state === 'needs-you' ? 'Needs you' : request.state === 'failed' ? 'Didn’t work' : v.progress !== undefined ? `${v.progress}%` : 'Requested'
  return <span className={`rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur-sm ${TONE[v.tone]}`}>{label}</span>
}

/** Where a request that needs a hand is finished: the installer's screen, or the program picker. */
export const installerHref = (r: GameRequest) => `/games/store/requests/${encodeURIComponent(r.id)}/installer`

/** "Choose executable": one press from a stuck archive (needs-you or failed) to the picker. */
export function ChooseProgramLink({ request, className = '' }: { request: GameRequest; className?: string }) {
  if (!needsProgramPick(request)) return null
  const base = className || 'inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3.5 text-sm font-semibold text-ink-950 hover:bg-ink-200 transition active:scale-[0.97]'
  return (
    <Link to={installerHref(request)} className={base}>
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" />
      </svg>
      Choose executable
    </Link>
  )
}
