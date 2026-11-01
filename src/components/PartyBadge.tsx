import type { PartyView } from '../api/parties'

/** The player's watch-party line: who's hosting, how many, whether everyone's in step, and Leave. */
export default function PartyBadge({ view, onLeave, className = '' }: { view: PartyView; onLeave: () => void; className?: string }) {
  const behind = view.members.filter((m) => !m.inStep && !m.buffering).map((m) => m.name)
  const status = view.waitingFor.length
    ? `Waiting for ${view.waitingFor.join(', ')}`
    : behind.length
      ? `${behind.join(', ')} catching up`
      : view.members.length > 1
        ? 'Everyone in step'
        : 'Waiting for the others to join'
  return (
    <div className={`absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-black/70 py-1.5 pl-4 pr-1.5 text-[13px] text-white backdrop-blur ${className}`} role="status" aria-live="polite">
      <span className="min-w-0 truncate">
        <span className="font-semibold">Watch party</span>
        <span className="text-white/70">
          {' '}· {view.isHost ? 'you’re hosting' : `${view.host.name} hosting`} · {view.members.length} {view.members.length === 1 ? 'person' : 'people'} ·{' '}
        </span>
        <span className={view.waitingFor.length ? 'text-amber-200' : 'text-emerald-300'}>{status}</span>
      </span>
      <button type="button" onClick={onLeave} className="h-8 shrink-0 rounded-full bg-white/15 px-3 text-[12.5px] font-semibold hover:bg-white/25">
        Leave
      </button>
    </div>
  )
}
