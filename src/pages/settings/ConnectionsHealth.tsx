// Settings → Health: each connected app by its own account (server/src/connections.ts):
// can Finesse reach it, what its own health list says, whether its download clients
// or indexers pass their tests, and the VPN. For servers Finesse set up and for
// apps someone runs themselves alike. When Finesse can put a problem right itself
// (server/src/connectionFixes.ts), the row has a button that does, and "Fix
// everything" runs them all.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { connectionsApi, graphicsApi, type ConnCheck, type ConnReport } from '../../api/setup'
import { useToast } from '../../components/Toast'

type Row = Pick<ConnCheck, 'id' | 'name' | 'ok' | 'summary' | 'problems' | 'fix' | 'fixes' | 'notes'>

function Dot({ ok }: { ok: boolean | null }) {
  return <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${ok === true ? 'bg-emerald-400' : ok === null ? 'bg-amber-300' : 'bg-red-400'}`} />
}

const word = (ok: boolean | null) => (ok === true ? 'Working' : ok === null ? 'Needs a look' : 'Not working')

const KEY = ['connections']

/** The connected apps' report, shared by this panel and the Settings nav badge. Admins only. */
export function useConnections(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: () => connectionsApi.get(), staleTime: 60_000, retry: false, enabled })
}

const rowsOf = (data: ConnReport): Row[] => [
  ...(Array.isArray(data.apps) ? data.apps : []),
  ...(data.vpn ? [{ id: 'vpn', name: data.vpn.source === 'gluetun' ? 'VPN' : 'VPN (guessed from the apps)', ok: data.vpn.ok, summary: data.vpn.summary, problems: [] }] : []),
]

/** How many connected apps need attention (for the Settings nav). */
export const connectionProblems = (data: ConnReport | undefined) => (data ? rowsOf(data).filter((r) => r.ok !== true).length : 0)

const pill = 'inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-semibold disabled:opacity-60 transition-colors'
const primary = `${pill} bg-white text-ink-950 hover:bg-ink-200`

export default function ConnectionsHealth() {
  const toast = useToast()
  const qc = useQueryClient()
  const q = useConnections()
  const [busy, setBusy] = useState('')

  const recheck = async () => {
    const fresh = await connectionsApi.get(true)
    qc.setQueryData(KEY, fresh)
    return fresh
  }

  /** Runs repairs one after another, says what each did, then looks again. */
  const run = async (key: string, jobs: { app: string; name: string; fix: string }[]) => {
    setBusy(key)
    let fixed = 0
    try {
      for (const j of jobs) {
        try {
          toast((await connectionsApi.fix(j.app, j.fix)).message)
          fixed++
        } catch (e) {
          toast(`${j.name}: ${(e as Error).message}`, 'error')
        }
      }
      const fresh = await recheck().catch(() => null)
      if (fresh && fixed && jobs.length > 1) {
        const left = connectionProblems(fresh)
        toast(left ? `Fixed what Finesse could. ${left} still need${left > 1 ? '' : 's'} a look.` : 'All fixed. Every app is working.')
      }
    } finally {
      setBusy('')
    }
  }

  const data = q.data
  if (q.isError && !data) return <p className="text-sm text-ink-400">Couldn’t check the connected apps. Try again in a moment.</p>
  if (!data) return <div className="h-24 rounded-2xl shimmer" />
  const rows = rowsOf(data)
  if (!rows.length) return null
  const bad = rows.filter((r) => r.ok !== true).length
  const all = rows.flatMap((r) => (r.fixes ?? []).map((f) => ({ app: r.id, name: r.name, fix: f.id })))

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Connected apps</h3>
        <div className="flex gap-2">
          {all.length > 1 && (
            <button type="button" disabled={!!busy} onClick={() => void run('all', all)} className={primary}>
              {busy === 'all' ? 'Fixing…' : `Fix everything (${all.length})`}
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              setBusy('check')
              try {
                await recheck()
              } catch (e) {
                toast((e as Error).message, 'error')
              } finally {
                setBusy('')
              }
            }}
            disabled={!!busy}
            className={`${pill} border border-white/10 bg-white/5 font-medium text-ink-200 hover:text-white`}
          >
            {busy === 'check' ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </div>
      <p className="mb-2 text-[12.5px] text-ink-400">
        {bad ? `${bad} need${bad > 1 ? '' : 's'} attention.` : 'Every app answers, and its own checks pass.'} Indexers and download clients are tested the way their Test buttons do.
        {all.length > 0 && ' Finesse can fix the ones with a button.'}
      </p>
      <ul className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-ink-900/60">
        {rows.map((r) => (
          <li key={r.id} className="flex min-w-0 gap-3 px-5 py-3">
            <Dot ok={r.ok} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-white">
                {r.name} <span className="sr-only">: {word(r.ok)}</span>
              </p>
              {r.ok !== true || r.summary !== 'Working' ? <p className="break-words text-[12.5px] leading-relaxed text-ink-200">{r.summary}</p> : null}
              {r.problems.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {r.problems.map((p, i) => (
                    <li key={i} className="break-words text-[12.5px] leading-relaxed text-ink-400">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
              {r.notes?.map((n, i) => (
                <p key={i} className="mt-1 break-words text-[12px] leading-relaxed text-ink-400 opacity-80">
                  {n}
                </p>
              ))}
              {(r.fix || r.fixes?.length) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.fixes?.map((f) => (
                    <button key={f.id} type="button" title={f.detail} disabled={!!busy} onClick={() => void run(`${r.id}:${f.id}`, [{ app: r.id, name: r.name, fix: f.id }])} className={primary}>
                      {busy === `${r.id}:${f.id}` ? 'Fixing…' : f.label}
                    </button>
                  ))}
                  {r.fix && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={async () => {
                        setBusy(r.id)
                        try {
                          const res = await graphicsApi.fixJellyfin(r.fix!.gpu)
                          toast(`Jellyfin now converts video on ${res.card}`)
                          await recheck()
                        } catch (e) {
                          toast((e as Error).message, 'error')
                        } finally {
                          setBusy('')
                        }
                      }}
                      className={primary}
                    >
                      {busy === r.id ? 'Switching…' : r.fix.label}
                    </button>
                  )}
                </div>
              )}
              {r.fixes?.length === 1 && <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-400 opacity-80">{r.fixes[0]!.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
