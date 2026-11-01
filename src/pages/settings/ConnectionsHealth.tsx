// Settings → Server: each connected app by its own account (server/src/connections.ts):
// can Finesse reach it, what its own health list says, whether its download clients
// or indexers pass their tests, and the VPN. For servers Finesse set up and for
// apps someone runs themselves alike.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { connectionsApi, graphicsApi, type ConnCheck } from '../../api/setup'
import { useToast } from '../../components/Toast'

function Dot({ ok }: { ok: boolean | null }) {
  return <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${ok === true ? 'bg-emerald-400' : ok === null ? 'bg-amber-300' : 'bg-red-400'}`} />
}

const word = (ok: boolean | null) => (ok === true ? 'Working' : ok === null ? 'Needs a look' : 'Not working')

export default function ConnectionsHealth() {
  const toast = useToast()
  const [fixing, setFixing] = useState('')
  const q = useQuery({ queryKey: ['connections'], queryFn: () => connectionsApi.get(), staleTime: 60_000, retry: false })
  const recheck = useQuery({ queryKey: ['connections', 'refresh'], queryFn: () => connectionsApi.get(true), enabled: false, retry: false })
  const data = recheck.data && (!q.data || recheck.data.checkedAt > q.data.checkedAt) ? recheck.data : q.data
  if (q.isError && !data) return <p className="text-sm text-ink-400">Couldn’t check the connected apps. Try again in a moment.</p>
  if (!data) return <div className="h-24 rounded-2xl shimmer" />
  if (!data.apps.length && !data.vpn) return null
  const rows: (ConnCheck | { id: string; name: string; ok: boolean | null; summary: string; problems: string[] })[] = [
    ...data.apps,
    ...(data.vpn ? [{ id: 'vpn', name: data.vpn.source === 'gluetun' ? 'VPN' : 'VPN (guessed from the apps)', ok: data.vpn.ok, summary: data.vpn.summary, problems: [] }] : []),
  ]
  const bad = rows.filter((r) => r.ok !== true).length
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Connected apps</h3>
        <button
          type="button"
          onClick={() => void recheck.refetch()}
          disabled={recheck.isFetching}
          className="h-8 rounded-full border border-white/10 bg-white/5 px-3 text-[12.5px] font-medium text-ink-200 hover:text-white disabled:opacity-60"
        >
          {recheck.isFetching ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <p className="mb-2 text-[12.5px] text-ink-400">
        {bad ? `${bad} need${bad > 1 ? '' : 's'} attention.` : 'Every app answers, and its own checks pass.'} Indexers and download clients are tested the way their Test buttons do.
      </p>
      <ul className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-ink-900/60">
        {rows.map((r) => (
          <li key={r.id} className="flex min-w-0 gap-3 px-5 py-3">
            <Dot ok={r.ok} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-white">
                {r.name} <span className="sr-only">: {word(r.ok)}</span>
              </p>
              {r.ok !== true || r.summary !== 'Working' ? <p className="break-words text-[12.5px] leading-relaxed text-ink-300">{r.summary}</p> : null}
              {'fix' in r && r.fix && (
                <button
                  type="button"
                  disabled={fixing === r.id}
                  onClick={async () => {
                    setFixing(r.id)
                    try {
                      const res = await graphicsApi.fixJellyfin(r.fix!.gpu)
                      toast(`Jellyfin now converts video on ${res.card}`)
                      await recheck.refetch()
                    } catch (e) {
                      toast((e as Error).message, 'error')
                    } finally {
                      setFixing('')
                    }
                  }}
                  className="mt-2 h-8 rounded-full bg-white px-3 text-[12.5px] font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-60"
                >
                  {fixing === r.id ? 'Switching…' : r.fix.label}
                </button>
              )}
              {r.problems.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {r.problems.map((p, i) => (
                    <li key={i} className="break-words text-[12.5px] leading-relaxed text-ink-400">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
