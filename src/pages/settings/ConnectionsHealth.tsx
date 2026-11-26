// Settings → Health: each connected app by its own account (server/src/connections.ts):
// can Finesse reach it, what its own health list says, whether its download clients
// or indexers pass their tests, and the VPN. For servers Finesse set up and for
// apps someone runs themselves alike. When Finesse can put a problem right itself
// (server/src/connectionFixes.ts), the row has a button that does, and "Fix
// everything" runs them all.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { connectionsApi, graphicsApi, type ConnAutoFix, type ConnCheck, type ConnReport } from '../../api/setup'
import { IS_TV } from '../../lib/device'
import { useFinesse } from '../../lib/finesseServer'
import { useToast } from '../../components/Toast'

type Row = Pick<ConnCheck, 'id' | 'name' | 'ok' | 'summary' | 'problems' | 'fix' | 'fixes' | 'notes' | 'openUrl'>
type FixJob =
  | { kind: 'conn'; app: string; name: string; fix: string }
  | { kind: 'gpu'; app: string; name: string; gpu: string }

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

const pill = 'inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-semibold transition active:scale-[0.97] disabled:opacity-60 disabled:active:scale-100'

function ago(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.round((Date.now() - t) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** Repairs Finesse made on its own, newest first; anything without words or a time is left out. */
const healedOf = (data: ConnReport): ConnAutoFix[] =>
  (Array.isArray(data.autoFixed) ? data.autoFixed : [])
    .filter((f) => f && typeof f.message === 'string' && f.message && typeof f.at === 'string')
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

/** "Finesse fixed this by itself": a quiet line, the details a press away. Nothing to do. */
function AutoHealed({ fixes, nameOf }: { fixes: ConnAutoFix[]; nameOf: (app: string) => string }) {
  const [open, setOpen] = useState(false)
  if (!fixes.length) return null
  const latest = fixes[0]!
  return (
    <div className="mb-3 rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.05] px-4 py-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2.5 text-left">
        <svg className="h-4 w-4 shrink-0 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
        </svg>
        <span className="min-w-0 flex-1 text-[13px] text-emerald-100">
          <span className="font-semibold">Auto-healed</span>
          <span className="text-emerald-100/75">
            {' '}
            · {fixes.length === 1 ? `${nameOf(latest.app)}, ${ago(latest.at)}. Nothing for you to do.` : `Finesse fixed ${fixes.length} things by itself, last ${ago(latest.at)}. Nothing for you to do.`}
          </span>
        </span>
        <svg className={`h-4 w-4 shrink-0 text-emerald-200/70 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 border-t border-emerald-300/10 pt-2">
          {fixes.slice(0, 10).map((f, i) => (
            <li key={`${f.app}-${f.fix}-${f.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12.5px] leading-relaxed">
              <span className="min-w-0 break-words text-ink-200">
                <span className="font-medium text-white">{nameOf(f.app)}</span> · {f.message}
              </span>
              <span className="shrink-0 tabular-nums text-ink-400">{ago(f.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
const primary = `${pill} bg-white text-ink-950 hover:bg-ink-200`

export default function ConnectionsHealth() {
  const toast = useToast()
  const qc = useQueryClient()
  const { info } = useFinesse()
  const q = useConnections()
  const [busy, setBusy] = useState('')
  const serverBehind = Boolean(info?.version && info?.web && info.version !== info.web)

  const recheck = async () => {
    const fresh = await connectionsApi.get(true)
    qc.setQueryData(KEY, fresh)
    return fresh
  }

  /** Runs repairs one after another, then looks again. Batch runs emit one clean summary toast. */
  const run = async (key: string, jobs: FixJob[]) => {
    setBusy(key)
    let fixed = 0
    let failed = 0
    let firstError = ''
    const batch = jobs.length > 1
    try {
      for (const j of jobs) {
        try {
          if (j.kind === 'gpu') {
            const res = await graphicsApi.fixJellyfin(j.gpu)
            if (!batch) toast(`Jellyfin now converts video on ${res.card}`)
          } else {
            const res = await connectionsApi.fix(j.app, j.fix)
            if (!batch) toast(res.message)
          }
          fixed++
        } catch (e) {
          const msg = `${j.name}: ${(e as Error).message}`
          if (!batch) toast(msg, 'error')
          else if (!firstError) firstError = msg
          failed++
        }
      }
      const fresh = await recheck().catch(() => null)
      if (batch) {
        if (failed === 0 && fixed > 0) {
          const left = fresh ? connectionProblems(fresh) : 0
          toast(left ? `Fixed ${fixed} ${fixed === 1 ? 'issue' : 'issues'}. ${left} still need${left > 1 ? '' : 's'} a look.` : 'All fixed. Every app is working.')
        } else if (fixed > 0 && failed > 0) {
          toast(`Fixed ${fixed} of ${jobs.length}; ${failed} failed (${firstError})`, 'error')
        } else if (failed > 0) {
          toast(firstError || `Couldn’t fix ${failed} ${failed === 1 ? 'issue' : 'issues'}`, 'error')
        }
      }
    } finally {
      setBusy('')
    }
  }

  const data = q.data
  if (q.isError && !data)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-ink-900/60 px-5 py-4">
        <p className="text-sm text-ink-300">Couldn’t check the connected apps. Try again in a moment.</p>
        <button type="button" onClick={() => void q.refetch()} disabled={q.isFetching} className={`${pill} border border-white/10 bg-white/5 font-medium text-ink-200 hover:text-white`}>
          {q.isFetching ? 'Checking…' : 'Retry'}
        </button>
      </div>
    )
  if (!data) return <div className="h-24 rounded-2xl shimmer" />
  const rows = rowsOf(data)
  if (!rows.length) return null
  const bad = rows.filter((r) => r.ok !== true).length
  const all: FixJob[] = rows.flatMap((r) => [
    ...(r.fixes ?? []).map((f) => ({ kind: 'conn' as const, app: r.id, name: r.name, fix: f.id })),
    ...(r.fix ? [{ kind: 'gpu' as const, app: r.id, name: r.name, gpu: r.fix.gpu }] : []),
  ])
  const healed = healedOf(data)
  const nameOf = (app: string) => rows.find((r) => r.id === app)?.name ?? app.charAt(0).toUpperCase() + app.slice(1)
  const healedAt = new Map<string, string>()
  for (const f of healed) if (!healedAt.has(f.app)) healedAt.set(f.app, f.at)

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Connected apps</h3>
        <div className="flex gap-2">
          {all.length > 0 && (
            <button type="button" disabled={!!busy} onClick={() => void run('all', all)} className={primary}>
              {busy === 'all' ? 'Fixing…' : all.length === 1 ? 'Fix automatically' : `Fix everything (${all.length})`}
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
      {serverBehind && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300/20 bg-amber-400/[0.06] px-4 py-2.5 text-[12.5px] text-amber-100">
          <span>
            Web app is <span className="font-semibold">v{info?.web}</span>, while the Finesse server container is still on{' '}
            <span className="font-semibold">v{info?.version}</span>. Update the server so the newest auto-repairs and health fixes run.
          </span>
          <Link to="/settings?s=updates" className={`${pill} border border-amber-200/30 bg-amber-200/15 text-amber-50 hover:bg-amber-200/25`}>
            Update server
          </Link>
        </div>
      )}
      <AutoHealed fixes={healed} nameOf={nameOf} />
      <ul className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-ink-900/60">
        {rows.map((r) => (
          <li key={r.id} className="flex min-w-0 gap-3 px-5 py-3">
            <Dot ok={r.ok} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] font-medium text-white">
                <span>
                  {r.name} <span className="sr-only">: {word(r.ok)}</span>
                </span>
                {healedAt.has(r.id) && (
                  <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200" title={`Finesse fixed something here ${ago(healedAt.get(r.id)!)}`}>
                    Auto-healed {ago(healedAt.get(r.id)!)}
                  </span>
                )}
                {!IS_TV && r.openUrl && (
                  <a
                    href={r.openUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex h-7 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 text-[11.5px] font-medium text-ink-200 hover:border-white/25 hover:bg-white/10 hover:text-white transition"
                  >
                    Open {r.name}
                    <svg className="h-3 w-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </a>
                )}
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
              {/* Boolean: an empty fixes list would otherwise draw a stray "0". */}
              {Boolean(r.fix || r.fixes?.length) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.fixes?.map((f) => (
                    <button key={f.id} type="button" title={f.detail} disabled={!!busy} aria-busy={busy === `${r.id}:${f.id}` || undefined} onClick={() => void run(`${r.id}:${f.id}`, [{ kind: 'conn', app: r.id, name: r.name, fix: f.id }])} className={primary}>
                      {busy === `${r.id}:${f.id}` ? 'Fixing…' : f.label}
                    </button>
                  ))}
                  {r.fix && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => void run(r.id, [{ kind: 'gpu', app: r.id, name: r.name, gpu: r.fix!.gpu }])}
                      className={primary}
                    >
                      {busy === r.id ? 'Switching…' : r.fix.label}
                    </button>
                  )}
                </div>
              )}
              {r.fixes?.length === 1 && <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-400 opacity-80">{r.fixes[0]!.detail}</p>}
              {r.fixes && r.fixes.length > 1 && (
                <ul className="mt-2 space-y-1 text-[11.5px] leading-relaxed text-ink-400">
                  {r.fixes.map((f) => (
                    <li key={f.id}>
                      <span className="font-medium text-ink-300">{f.label}:</span> {f.detail}
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
