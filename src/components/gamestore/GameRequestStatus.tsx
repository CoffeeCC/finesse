// A game request's status: the words, a bar while it moves, and a second line. The same on
// cards, the game's page and the requests list (lib/gameRequestStatus.ts decides the words).

import type { GameRequest } from '../../api/gameStore'
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
        <span className={`mt-1.5 block h-1 overflow-hidden rounded-full bg-white/10 ${lg ? 'w-56 max-w-full' : 'w-full max-w-[10rem]'}`} aria-hidden>
          <span className="block h-full rounded-full bg-accent-400 transition-all duration-700" style={{ width: `${v.progress}%` }} />
        </span>
      )}
      {v.detail && <span className={`mt-1 block text-ink-400 break-words ${lg ? 'text-[13px] max-w-md' : 'text-[11.5px] leading-snug'}`}>{v.detail}</span>}
    </div>
  )
}

/** A small pill for a card's corner. */
export function GameRequestBadge({ request }: { request: GameRequest }) {
  const v = gameRequestView(request)
  const label = request.state === 'ready' ? 'Ready' : request.state === 'needs-you' ? 'Needs you' : request.state === 'failed' ? 'Didn’t work' : v.progress !== undefined ? `${v.progress}%` : 'Requested'
  return <span className={`rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold ${TONE[v.tone]}`}>{label}</span>
}
