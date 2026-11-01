// Where a request stands, said the same way on the Request page, in search, on a movie's
// request page and in the Requested list (lib/requestStatus.ts decides; this draws it).

import { Link } from 'react-router-dom'
import type { ArrResult } from '../api/arr'
import { useArrFailures, useArrQueue, useLibraryMatch } from '../api/queries'
import { requestStatus, type RequestStatus } from '../lib/requestStatus'

const TONE = { ok: 'text-emerald-300', busy: 'text-accent-300', wait: 'text-ink-200', bad: 'text-amber-200' } as const

/** The status of a title the app knows about (or one just requested here). */
export function useRequestStatus(r: Pick<ArrResult, 'kind' | 'id' | 'hasFile'> | undefined, opts: { justRequested?: boolean; available?: boolean } = {}): RequestStatus | null {
  const known = Boolean(r && r.id > 0)
  const { data: queue } = useArrQueue(Boolean(r))
  const { data: failures } = useArrFailures(known && !r?.hasFile)
  if (!r) return null
  const key = `${r.kind}-${r.id}`
  return requestStatus({
    requested: known || Boolean(opts.justRequested),
    hasFile: r.hasFile,
    available: opts.available,
    queue: known ? queue?.find((q) => q.key === key || (q.kind === r.kind && q.refId === r.id)) : undefined,
    failure: known ? failures?.get(key) : undefined,
  })
}

function StageIcon({ s, className }: { s: RequestStatus; className: string }) {
  const path =
    s.stage === 'ready'
      ? 'm4.5 12.75 6 6 9-13.5'
      : s.stage === 'downloading' || s.stage === 'paused' || s.stage === 'queued' || s.stage === 'importing'
        ? 'M12 3v13.5m0 0 4.5-4.5M12 16.5 7.5 12M3.75 18.75A2.25 2.25 0 0 0 6 21h12a2.25 2.25 0 0 0 2.25-2.25'
        : s.stage === 'stuck'
          ? 'M12 9v3.75m0 3.75h.008M10.3 3.9 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'
          : 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  )
}

/** The words, a bar while it downloads, and a second line when there's more to say.
 *  `size`: sm for cards and search rows, lg beside a page's main button. */
export function RequestStatusView({ status, size = 'sm', className = '' }: { status: RequestStatus; size?: 'sm' | 'lg'; className?: string }) {
  const lg = size === 'lg'
  return (
    <div className={`min-w-0 ${className}`} role="status">
      <span className={`inline-flex items-center gap-1.5 font-semibold ${lg ? 'text-[15px]' : 'text-xs'} ${TONE[status.tone]}`}>
        <StageIcon s={status} className={lg ? 'h-5 w-5 shrink-0' : 'h-4 w-4 shrink-0'} />
        {status.label}
      </span>
      {status.progress !== undefined && (
        <span className={`mt-1.5 block h-1 overflow-hidden rounded-full bg-white/10 ${lg ? 'w-56' : 'w-32'}`} aria-hidden>
          <span className="block h-full rounded-full bg-accent-400 transition-all duration-700" style={{ width: `${status.progress}%` }} />
        </span>
      )}
      {status.detail && <span className={`mt-1 block text-ink-400 break-words ${lg ? 'text-[13px] max-w-md' : 'text-[11.5px] leading-snug'}`}>{status.detail}</span>}
    </div>
  )
}

/** In the library: say so, and open it there when Finesse finds its copy. */
export function ReadyLink({ r, className = '' }: { r: ArrResult; className?: string }) {
  const { data: item } = useLibraryMatch(r, r.hasFile)
  const ready: RequestStatus = { stage: 'ready', label: item ? 'Ready to watch' : 'In your library', tone: 'ok' }
  if (!item) return <RequestStatusView status={ready} className={className} />
  return (
    <Link
      to={`/item/${item.Id}`}
      className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 hover:bg-emerald-400/25 border border-emerald-300/30 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors ${className}`}
    >
      <StageIcon s={ready} className="h-4 w-4 shrink-0" />
      Ready — open it
    </Link>
  )
}
