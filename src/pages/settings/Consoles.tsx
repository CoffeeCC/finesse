// Settings → Server → Game streaming → Consoles: add or remove a console, and
// see plainly where each one stands: ready, downloading, or what's still
// missing and the folder to put it in (with a copy button). It looks again on
// its own every few seconds, so a file you drop in shows up without a restart.

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { consolesApi, type ConsoleView, type InstallId } from '../../api/setup'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { withoutFolder } from '../../lib/consoleText'
import { CONSOLES, mb } from '../../lib/consoles'

const CARD = 'rounded-2xl bg-ink-900/60 border border-white/5'
const smallBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12.5px] font-medium text-ink-200 hover:border-white/25 hover:text-white disabled:opacity-50 transition-colors'
const addBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-fill px-3 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50 transition'

/** Copies even where the page isn't https (a home server's plain address). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** A thing still missing, as a short phrase: "the PS2 BIOS", "prod.keys"… */
const what = (label: string) => (/^(PS2 BIOS|Switch firmware)/.test(label) ? `the ${label.replace(/ \(.*\)$/, '')}` : label.replace(/ \(.*\)$/, ''))

/** The one-line status: Ready, Downloading 45%, Needs the PS2 BIOS… */
export function consoleStatus(c: ConsoleView): { text: string; tone: 'ok' | 'busy' | 'warn' | 'off' | 'bad' } {
  if (!c.added) return { text: 'Not added', tone: 'off' }
  const d = c.download
  if (!c.own) {
    if (d.state === 'queued') return { text: 'Waiting to download', tone: 'busy' }
    if (d.state === 'downloading') return { text: `Downloading ${Math.floor((d.received / Math.max(1, d.size)) * 100)}%`, tone: 'busy' }
    if (d.state === 'checking') return { text: 'Checking the download', tone: 'busy' }
    if (d.state === 'failed') return { text: 'Download failed', tone: 'bad' }
    if (d.state === 'missing') return { text: 'Not downloaded yet', tone: 'warn' }
  }
  const missing = c.needs.filter((n) => n.required && !n.ok)
  if (missing.length) return { text: `Needs ${what(missing[0]!.label)}${missing.length > 1 ? ` and ${missing.length - 1} more` : ''}`, tone: 'warn' }
  return { text: 'Ready', tone: 'ok' }
}

const TONE = {
  ok: 'bg-emerald-400/15 text-emerald-300',
  busy: 'bg-sky-400/15 text-sky-200',
  warn: 'bg-amber-300/15 text-amber-200',
  bad: 'bg-red-400/15 text-red-200',
  off: 'bg-white/10 text-ink-300',
}

function Folder({ path }: { path: string }) {
  const toast = useToast()
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      <code className="min-w-0 max-w-full break-all rounded-md bg-ink-950/70 px-2 py-1 text-[12px] text-ink-100">{path}</code>
      <button
        type="button"
        className={smallBtn}
        aria-label={`Copy the folder ${path}`}
        onClick={() => void copyText(path).then((ok) => toast(ok ? 'Folder copied' : 'Couldn’t copy. Select the text instead.', ok ? undefined : 'error'))}
      >
        Copy
      </button>
    </span>
  )
}

function ConsoleRow({ c, busy, onChange }: { c: ConsoleView; busy: boolean; onChange: (body: { add?: InstallId[]; remove?: InstallId[]; update?: InstallId[] }) => void }) {
  const info = CONSOLES.find((x) => x.id === c.id)
  const st = consoleStatus(c)
  const [confirm, setConfirm] = useState(false)
  const d = c.download
  const pct = d.state === 'downloading' ? Math.floor((d.received / Math.max(1, d.size)) * 100) : null
  // Only what's still missing, and what's needed most first.
  const todo = c.added ? c.needs.filter((n) => !n.ok).sort((a, b) => Number(b.required) - Number(a.required)) : []
  return (
    <li className="space-y-2 py-4 first:pt-0 last:pb-0" data-testid={`console-${c.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-white">
            {info?.title ?? c.consoles} <span className={`ml-1 inline-block rounded-full px-2 py-0.5 align-middle text-[11.5px] font-semibold ${TONE[st.tone]}`}>{st.text}</span>
          </p>
          <p className="text-[12.5px] text-ink-400">
            {c.own ? `${c.name}, your own copy` : `${c.name} ${c.version} · ${mb(c.size)}`}
            {!c.official && !c.own && ' · a community build (Dolphin has no ready-made Linux download of its own)'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {!c.added ? (
            <button type="button" className={addBtn} disabled={busy} onClick={() => onChange({ add: [c.id] })}>
              Add ({mb(c.size)})
            </button>
          ) : (
            <>
              {d.state === 'update' && !c.own && (
                <button type="button" className={smallBtn} disabled={busy} onClick={() => onChange({ update: [c.id] })}>
                  Update to {c.version}
                </button>
              )}
              {d.state === 'failed' && (
                <button type="button" className={smallBtn} disabled={busy} onClick={() => onChange(d.installed ? { update: [c.id] } : { add: [c.id] })}>
                  Try again
                </button>
              )}
              <button type="button" className={smallBtn} disabled={busy || d.state === 'downloading' || d.state === 'checking'} onClick={() => setConfirm(true)}>
                Remove
              </button>
            </>
          )}
        </div>
      </div>
      {pct !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} download`}>
          <div className="h-full rounded-full bg-sky-400 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {d.state === 'failed' && d.error && <p className="text-[12.5px] text-red-200">{d.error}</p>}
      {d.state === 'update' && d.installed && <p className="text-[12.5px] text-ink-400">You have {d.installed}. Finesse never updates on its own; your saves stay either way.</p>}
      {todo.length > 0 && (
        <ul className="space-y-2">
          {todo.map((n) => (
            <li key={n.label} className="text-[12.5px] leading-relaxed">
              <span className={n.required ? 'text-amber-100' : 'text-ink-300'}>
                {n.required ? 'Needs' : 'Optional:'} {what(n.label)}.
              </span>{' '}
              <span className="text-ink-400">{withoutFolder(n.detail)}</span>
              {n.folder && (
                <>
                  <span className="block text-ink-400">Put it in this folder on the server:</span>
                  <Folder path={n.folder} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!c.added && info && <p className="text-[12.5px] text-ink-400">{info.yours ? `You add: ${info.yours}` : 'Nothing else to add.'}</p>}
      {confirm && (
        <ConfirmDialog
          title={`Remove ${info?.title ?? c.name}?`}
          confirmLabel="Remove"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false)
            onChange({ remove: [c.id] })
          }}
        >
          <p>{c.own ? 'Its app goes from the games list. Your own emulator file stays where it is.' : `Finesse deletes its copy of ${c.name}.`} Saves, games and your firmware stay.</p>
        </ConfirmDialog>
      )}
    </li>
  )
}

export default function Consoles() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const { data, error, refetch } = useQuery({
    queryKey: ['emulators', 'consoles'],
    queryFn: consolesApi.list,
    retry: false,
    // Quick while something downloads; otherwise a look every few seconds, so new files show up on their own.
    refetchInterval: (q) => (q.state.data?.consoles.some((c) => ['queued', 'downloading', 'checking'].includes(c.download.state)) ? 1500 : 5000),
  })
  const change = async (body: { add?: InstallId[]; remove?: InstallId[]; update?: InstallId[] }) => {
    setBusy(true)
    try {
      const r = await consolesApi.change(body)
      await refetch()
      if (r.notes?.length) toast(r.notes[0]!, 'error')
      else if (body.add?.length) toast('Added. The download runs in the background.')
      else if (body.remove?.length) toast('Removed')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const order = (c: ConsoleView) => CONSOLES.findIndex((x) => x.id === c.id)
  const list = [...(data?.consoles ?? [])].sort((a, b) => Number(b.added) - Number(a.added) || order(a) - order(b))
  return (
    <div className={`${CARD} space-y-4 px-5 py-5`} data-testid="consoles">
      <div>
        <p className="text-[13px] font-semibold text-white">Consoles</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-400">
          Finesse downloads each console’s emulator, checks it, and sets it up with your controller, full screen and saves. You add the files only your own console has; each one says what and where.
        </p>
      </div>
      {data?.notes?.map((n) => (
        <p key={n} className="rounded-xl bg-amber-300/10 px-3 py-2 text-[12.5px] leading-relaxed text-amber-100">
          {n}
        </p>
      ))}
      {error ? (
        <p className="text-[13px] text-red-300">{(error as Error).message}</p>
      ) : !data ? (
        <div className="h-16 rounded-xl shimmer" />
      ) : (
        <ul className="divide-y divide-white/5">
          {list.map((c) => (
            <ConsoleRow key={c.id} c={c} busy={busy} onChange={(b) => void change(b)} />
          ))}
        </ul>
      )}
    </div>
  )
}
