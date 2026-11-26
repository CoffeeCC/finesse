// Full-width visual requests manager: filter tabs (All / Active / Needs attention / Ready),
// live speed & count summary, responsive cards with stage progress bar, and per-row pending state.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatSize, needsProgramPick, PLATFORM_LABEL, type GameRequest } from '../api/gameStore'
import { useGameRequestActions, useGameRequests, useStoreMode } from '../api/gameStoreQueries'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { ChooseProgramLink, GameRequestStatusView, installerHref, RequestStageBar } from '../components/gamestore/GameRequestStatus'
import GameTransferModal from '../components/gamestore/GameTransferModal'
import { StoreThumb, storeGameHref } from '../components/gamestore/StoreCards'
import { StoreHeader, StoreUnavailable } from '../components/gamestore/StoreHeader'
import { formatSpeed } from '../lib/gameRequestStatus'

type FilterTab = 'all' | 'active' | 'attention' | 'ready'

const isActiveReq = (r: GameRequest) => r.state !== 'ready' && r.state !== 'failed' && r.state !== 'needs-you'
const isAttentionReq = (r: GameRequest) => r.state === 'needs-you' || r.state === 'failed'

export default function GameRequestsPage() {
  const mode = useStoreMode()
  const { data, isLoading, isError, refetch } = useGameRequests()
  const [tab, setTab] = useState<FilterTab>('all')

  const stats = useMemo(() => {
    const list = data ?? []
    const active = list.filter(isActiveReq)
    const attention = list.filter(isAttentionReq)
    const ready = list.filter((r) => r.state === 'ready')
    const downloading = list.filter((r) => r.state === 'downloading')
    const totalBps = downloading.reduce((sum, r) => sum + (r.bytesPerSecond ?? 0), 0)
    return { all: list, active, attention, ready, downloadingCount: downloading.length, totalBps }
  }, [data])

  if (!mode) return <StoreUnavailable title="Game requests" />

  const visible =
    tab === 'active'
      ? stats.active
      : tab === 'attention'
        ? stats.attention
        : tab === 'ready'
          ? stats.ready
          : stats.all

  const tabs: { id: FilterTab; label: string; count: number; accent?: string }[] = [
    { id: 'all', label: 'All', count: stats.all.length },
    { id: 'active', label: 'Active', count: stats.active.length },
    { id: 'attention', label: 'Needs attention', count: stats.attention.length, accent: stats.attention.length > 0 ? 'bg-sky-400 text-ink-950' : undefined },
    { id: 'ready', label: 'Ready', count: stats.ready.length },
  ]

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-12">
      <StoreHeader title="Game requests" />

      {isError ? (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-white">Couldn’t load your requests</p>
          <p className="mt-1 text-sm text-ink-400">The game store didn’t answer. Try again in a moment.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
          >
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 rounded-2xl shimmer" />
          ))}
        </div>
      ) : !stats.all.length ? (
        <div className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <p className="text-lg font-semibold text-white">No game requests yet</p>
          <p className="mt-1.5 text-sm text-ink-400">
            Find a game in the store or search live PC indexers and press Request. Downloads and installs show up here.
          </p>
          <Link
            to="/games/store"
            className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
          >
            Open the store
          </Link>
        </div>
      ) : (
        <>
          {/* Filter tabs + live speed/count summary */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5" role="tablist" aria-label="Filter requests">
              {tabs.map((t) => {
                const on = tab === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTab(t.id)}
                    className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
                      on
                        ? 'border-accent-400/50 bg-accent-500/20 text-white'
                        : 'border-white/10 bg-white/[0.04] text-ink-300 hover:border-white/20 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    <span>{t.label}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-mono text-[11px] font-bold leading-none tabular-nums ${
                        t.accent ?? (on ? 'bg-accent-400/25 text-accent-100' : 'bg-white/10 text-ink-300')
                      }`}
                    >
                      {t.count}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-300">
              {stats.downloadingCount > 0 && (
                <span className="inline-flex items-center gap-2 rounded-full border border-accent-400/30 bg-accent-500/10 px-3 py-1 font-medium text-accent-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-400" aria-hidden />
                  {stats.downloadingCount} downloading
                  {stats.totalBps > 0 && <span className="font-mono font-semibold text-white">· {formatSpeed(stats.totalBps)}</span>}
                </span>
              )}
              <span className="text-ink-400">
                {stats.ready.length} ready · {stats.all.length} total
              </span>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-12 text-center">
              <p className="text-sm font-medium text-ink-300">Nothing in this view right now.</p>
              <button
                type="button"
                onClick={() => setTab('all')}
                className="mt-3 text-xs font-semibold text-accent-300 hover:text-accent-200"
              >
                Show all requests
              </button>
            </div>
          ) : (
            <ul className="grid gap-3.5 xl:grid-cols-2">
              {visible.map((r) => (
                <RequestCard key={r.id} r={r} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function RequestCard({ r }: { r: GameRequest }) {
  const actions = useGameRequestActions()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const [transfer, setTransfer] = useState(false)

  const facts = [PLATFORM_LABEL[r.platform], formatSize(r.sizeBytes), r.requestedBy ? `requested by ${r.requestedBy}` : null]
    .filter(Boolean)
    .join(' · ')
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'That didn’t work', 'error')
  const picking = needsProgramPick(r)
  const canTransfer = r.state === 'ready' || r.state === 'needs-you' || (r.state === 'failed' && (r.progress ?? 0) >= 100)

  // Per-row pending flags so acting on one request never disables every other row.
  const pausingThis = actions.pause.isPending && actions.pause.variables === r.id
  const resumingThis = actions.resume.isPending && actions.resume.variables === r.id
  const retryingThis = actions.retry.isPending && actions.retry.variables === r.id
  const cancellingThis = actions.cancel.isPending && actions.cancel.variables === r.id

  const borderTone =
    r.state === 'needs-you'
      ? 'border-sky-400/30 bg-sky-500/[0.04]'
      : r.state === 'failed'
        ? 'border-amber-400/25 bg-amber-500/[0.03]'
        : r.state === 'ready'
          ? 'border-emerald-400/20 bg-emerald-500/[0.03]'
          : 'border-white/10 bg-white/[0.03]'

  return (
    <li className={`flex flex-col justify-between gap-4 rounded-2xl border p-4 transition-colors hover:border-white/20 ${borderTone}`}>
      <div className="flex items-start gap-3.5">
        <Link
          to={storeGameHref(r.gameId)}
          className="shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
          tabIndex={-1}
          aria-hidden
        >
          <StoreThumb id={r.gameId} title={r.title} cover={r.cover} className="h-20 w-[3.75rem]" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={storeGameHref(r.gameId)} className="block truncate text-base font-semibold text-white transition-colors hover:text-accent-200">
            {r.title}
          </Link>
          <p className="mb-2 truncate text-xs text-ink-400">{facts}</p>
          <GameRequestStatusView request={r} />
        </div>
      </div>

      <RequestStageBar request={r} />

      {/* Actions wrap cleanly on mobile and desktop without ever crushing the title */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-3">
        <ChooseProgramLink request={r} />
        {r.state === 'needs-you' && !picking && (
          <Link
            to={installerHref(r)}
            className="inline-flex h-9 items-center rounded-lg bg-white px-3.5 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97]"
          >
            Finish installing
          </Link>
        )}
        {r.state === 'failed' && (
          <button
            type="button"
            onClick={() => actions.retry.mutate(r.id, { onError: fail })}
            disabled={retryingThis}
            className={`inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-50 ${
              picking ? 'border border-white/15 bg-white/10 text-white hover:bg-white/20' : 'bg-white text-ink-950 hover:bg-ink-200'
            }`}
          >
            {retryingThis ? 'Retrying…' : 'Try again'}
          </button>
        )}
        {actions.canPause && r.state === 'downloading' && (
          <button
            type="button"
            onClick={() => actions.pause.mutate(r.id, { onError: fail })}
            disabled={pausingThis}
            className="inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-3.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
          >
            {pausingThis ? 'Pausing…' : 'Pause'}
          </button>
        )}
        {actions.canPause && r.state === 'paused' && (
          <button
            type="button"
            onClick={() => actions.resume.mutate(r.id, { onError: fail })}
            disabled={resumingThis}
            className="inline-flex h-9 items-center rounded-lg bg-white px-3.5 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97] disabled:opacity-50"
          >
            {resumingThis ? 'Resuming…' : 'Carry on'}
          </button>
        )}
        {r.state === 'ready' && (
          <Link
            to="/games"
            className="inline-flex h-9 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200"
          >
            Play
          </Link>
        )}
        {canTransfer && (
          <button
            type="button"
            onClick={() => setTransfer(true)}
            className="inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-3.5 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            Transfer
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={cancellingThis}
          className={`inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition disabled:opacity-50 ${
            r.state === 'ready' ? 'text-ink-300 hover:bg-red-500/15 hover:text-red-200' : 'text-ink-300 hover:bg-white/10 hover:text-white'
          }`}
        >
          {r.state === 'ready' ? 'Uninstall' : r.state === 'failed' ? 'Remove' : 'Cancel'}
        </button>
      </div>

      {transfer && <GameTransferModal requestId={r.id} title={r.title} onClose={() => setTransfer(false)} />}
      {confirm && (
        <ConfirmDialog
          title={r.state === 'ready' ? `Uninstall “${r.title}”?` : r.state === 'failed' ? `Remove “${r.title}”?` : `Cancel “${r.title}”?`}
          confirmLabel={r.state === 'ready' ? 'Uninstall' : r.state === 'failed' ? 'Remove' : 'Cancel the request'}
          cancelLabel="Keep it"
          busy={cancellingThis}
          onCancel={() => setConfirm(false)}
          onConfirm={() => actions.cancel.mutate(r.id, { onError: fail, onSettled: () => setConfirm(false) })}
        >
          {r.state === 'ready'
            ? 'The installed game files and its download are deleted from the server to free space. You can request it again later.'
            : 'The download stops and what was downloaded is deleted. You can request it again later.'}
        </ConfirmDialog>
      )}
    </li>
  )
}
