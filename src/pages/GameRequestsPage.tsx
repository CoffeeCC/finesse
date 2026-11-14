// Every game request on this server, grouped by what it needs: you, time, nothing, or another go.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatSize, PLATFORM_LABEL, type GameRequest } from '../api/gameStore'
import { useGameRequestActions, useGameRequests, useStoreMode } from '../api/gameStoreQueries'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/Toast'
import { GameRequestStatusView } from '../components/gamestore/GameRequestStatus'
import { StoreThumb, storeGameHref } from '../components/gamestore/StoreCards'
import { StoreHeader } from '../components/gamestore/StoreHeader'

const GROUPS: { title: string; has: (r: GameRequest) => boolean }[] = [
  { title: 'Needs you', has: (r) => r.state === 'needs-you' },
  { title: 'On the way', has: (r) => r.state !== 'needs-you' && r.state !== 'ready' && r.state !== 'failed' },
  { title: 'Didn’t work', has: (r) => r.state === 'failed' },
  { title: 'Ready to play', has: (r) => r.state === 'ready' },
]

export default function GameRequestsPage() {
  const mode = useStoreMode()
  const { data, isLoading, isError } = useGameRequests()
  if (!mode) return null
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-12">
      <StoreHeader title="Game requests" />
      {isError ? (
        <p className="py-12 text-center text-sm text-ink-400">Couldn’t load the requests. Try again in a moment.</p>
      ) : isLoading ? (
        <div className="max-w-3xl space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl shimmer" />
          ))}
        </div>
      ) : !data?.length ? (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-white">No game requests yet</p>
          <p className="mt-1 text-sm text-ink-400">Find a game in the store and press Request. It shows up here while it downloads and installs.</p>
          <Link to="/games/store" className="mt-5 inline-flex h-10 items-center rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 hover:bg-ink-200">
            Open the store
          </Link>
        </div>
      ) : (
        <div className="max-w-3xl">
          {GROUPS.map((grp) => {
            const list = data.filter(grp.has)
            if (!list.length) return null
            return (
              <section key={grp.title} className="mb-8">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">{grp.title}</h2>
                <ul className="space-y-2">
                  {list.map((r) => (
                    <RequestRow key={r.id} r={r} />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RequestRow({ r }: { r: GameRequest }) {
  const actions = useGameRequestActions()
  const toast = useToast()
  const [confirm, setConfirm] = useState(false)
  const facts = [PLATFORM_LABEL[r.platform], formatSize(r.sizeBytes), r.requestedBy ? `requested by ${r.requestedBy}` : null].filter(Boolean).join(' · ')
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'That didn’t work', 'error')
  return (
    <li className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
      <Link to={storeGameHref(r.gameId)} className="shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent-400" tabIndex={-1} aria-hidden>
        <StoreThumb id={r.gameId} title={r.title} cover={r.cover} className="h-20 w-[3.75rem]" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={storeGameHref(r.gameId)} className="block truncate font-semibold text-white hover:text-accent-200">
          {r.title}
        </Link>
        <p className="mb-1.5 truncate text-xs text-ink-400">{facts}</p>
        <GameRequestStatusView request={r} />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
        {r.state === 'needs-you' && (
          <Link to={`/games/store/requests/${encodeURIComponent(r.id)}/installer`} className="inline-flex h-9 items-center rounded-lg bg-white px-3.5 text-sm font-semibold text-ink-950 hover:bg-ink-200">
            Finish installing
          </Link>
        )}
        {r.state === 'failed' && (
          <button type="button" onClick={() => actions.retry.mutate(r.id, { onError: fail })} className="inline-flex h-9 items-center rounded-lg bg-white px-3.5 text-sm font-semibold text-ink-950 hover:bg-ink-200">
            Try again
          </button>
        )}
        {r.state === 'ready' ? (
          <Link to="/games" className="inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/10 px-3.5 text-sm font-semibold text-white hover:bg-white/20">
            Play
          </Link>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-300 hover:bg-white/10 hover:text-white">
            {r.state === 'failed' ? 'Remove' : 'Cancel'}
          </button>
        )}
      </div>
      {confirm && (
        <ConfirmDialog
          title={r.state === 'failed' ? `Remove “${r.title}”?` : `Cancel “${r.title}”?`}
          confirmLabel={r.state === 'failed' ? 'Remove' : 'Cancel the request'}
          cancelLabel="Keep it"
          busy={actions.cancel.isPending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => actions.cancel.mutate(r.id, { onError: fail, onSettled: () => setConfirm(false) })}
        >
          The download stops and what was downloaded is deleted. You can request it again later.
        </ConfirmDialog>
      )}
    </li>
  )
}
