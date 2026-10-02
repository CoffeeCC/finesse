import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { streamingApi, systemApi, type StreamingCheck, type SystemStatus } from '../../api/setup'
import { useToast } from '../../components/Toast'
import { useFinesse } from '../../lib/finesseServer'
import { Spinner } from '../setup/ui'

const CARD = 'rounded-2xl bg-ink-900/60 border border-white/5'
const smallBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12.5px] font-medium text-ink-200 hover:border-white/25 hover:text-white disabled:opacity-50 transition-colors'
const primaryBtn = 'inline-flex h-10 items-center gap-2 rounded-lg bg-accent-fill px-4 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 transition'
const input = 'h-10 w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 text-sm text-white placeholder:text-ink-500 outline-none focus:border-accent-500'
const label = 'block text-[11px] font-semibold uppercase tracking-wider text-ink-400'

/** One Moonlight device waiting to pair: its PIN and a name for it. */
function PendingDevice({ id, ip, onPaired }: { id: string; ip: string; onPaired: () => void }) {
  const toast = useToast()
  const [pin, setPin] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ready = /^\d{4}$/.test(pin)

  return (
    <form
      className="space-y-3 rounded-xl border border-accent-400/30 bg-accent-500/10 px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready || busy) return
        setBusy(true)
        setErr('')
        streamingApi
          .pair(id, pin, name)
          .then((r) => {
            if (r.ok) {
              toast(`Paired ${r.device?.name ?? 'the device'}. Pick a game in Moonlight.`)
              onPaired()
            } else setErr(r.error ?? 'Pairing didn’t finish. Start again in Moonlight.')
          })
          .catch((e: Error) => setErr(e.message))
          .finally(() => setBusy(false))
      }}
    >
      <p className="text-[13px] text-white">
        <span className="font-semibold">A device at {ip || 'your network'}</span> wants to pair.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <div>
          <label className={label} htmlFor={`stream-name-${id}`}>
            Name it
          </label>
          <input id={`stream-name-${id}`} className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Living room TV" maxLength={40} autoComplete="off" />
        </div>
        <div>
          <label className={label} htmlFor={`stream-pin-${id}`}>
            PIN in Moonlight
          </label>
          <input
            id={`stream-pin-${id}`}
            className={`${input} mt-1 font-mono tracking-[0.3em]`}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="0000"
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
      </div>
      {err && <p className="text-[12.5px] text-red-300">{err}</p>}
      <button type="submit" className={primaryBtn} disabled={!ready || busy}>
        {busy && <Spinner className="h-3 w-3" />}
        {busy ? 'Pairing…' : 'Pair'}
      </button>
    </form>
  )
}

/** Settings → Server → Game streaming: pair Moonlight devices with Wolf, and remove them. */
export default function StreamingAdmin({ footer }: { footer?: ReactNode }) {
  const toast = useToast()
  const qc = useQueryClient()
  // Moonlight asks for pairing while this is open: look for it every few seconds.
  const { data, error, refetch } = useQuery({ queryKey: ['streaming', 'admin'], queryFn: streamingApi.admin, refetchInterval: 3000, retry: false })
  const [armed, setArmed] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(null), 4000)
    return () => clearTimeout(t)
  }, [armed])

  const remove = async (id: string, name: string) => {
    setBusy(id)
    try {
      await streamingApi.remove(id)
      toast(`Removed ${name}`)
      await refetch()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
      setArmed(null)
    }
  }

  return (
    <div id="settings-streaming" className="space-y-3 scroll-mt-24">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Game streaming</p>
      <div className={`${CARD} space-y-6 px-5 py-5`}>
        <p className="text-[13px] leading-relaxed text-ink-300">
          Wolf streams Steam and other apps from this server to Moonlight on TVs, phones and computers. To add a device, open Moonlight on it and pick this server. It shows a PIN, and the device appears here.
        </p>

        {error ? (
          <p className="text-[13px] text-red-300">{(error as Error).message}</p>
        ) : !data ? (
          <div className="h-16 rounded-xl shimmer" />
        ) : !data.ok ? (
          <p className="rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-[13px] text-amber-100">{data.error}</p>
        ) : (
          <>
            {data.pending.length > 0 ? (
              <div className="space-y-3">
                {data.pending.map((p) => (
                  <PendingDevice
                    key={p.id}
                    id={p.id}
                    ip={p.ip}
                    onPaired={() => {
                      void refetch()
                      void qc.invalidateQueries({ queryKey: ['streaming', 'apps'] })
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-[12.5px] text-ink-400">
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-400" />
                </span>
                Waiting for a device. Start pairing in Moonlight and it shows up here.
              </p>
            )}

            <div className="space-y-2 border-t border-white/5 pt-5">
              <p className="text-[13px] font-semibold text-white">Paired devices</p>
              {data.devices.length === 0 ? (
                <p className="text-[12.5px] text-ink-400">None yet.</p>
              ) : (
                <ul className="divide-y divide-white/5">
                  {data.devices.map((d) => {
                    const name = d.name ?? 'A Moonlight device'
                    return (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-white">{name}</p>
                          <p className="text-[12px] text-ink-400">{d.pairedAt ? `Paired ${new Date(d.pairedAt).toLocaleDateString()}` : 'Paired in Wolf'}</p>
                        </div>
                        <button
                          type="button"
                          className={smallBtn}
                          disabled={busy === d.id}
                          onClick={() => (armed === d.id ? void remove(d.id, name) : setArmed(d.id))}
                        >
                          {busy === d.id && <Spinner className="h-3 w-3" />}
                          {armed === d.id ? 'Remove it?' : 'Remove'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}
        {footer}
      </div>
    </div>
  )
}

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

const isCommand = (line: string) => /^(sudo|echo)\s/.test(line)

/** What Wolf needs from this machine: a line per part, and how to fix what's missing. */
function Readiness({ check }: { check: StreamingCheck }) {
  const toast = useToast()
  return (
    <ul className="space-y-3">
      {check.items.map((i) => {
        const cmds = (i.fix ?? []).filter(isCommand)
        const steps = (i.fix ?? []).filter((l) => !isCommand(l))
        return (
          <li key={i.id} className="flex gap-3">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i.ok ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-300/15 text-amber-200'}`}
              aria-hidden
            >
              {i.ok ? '✓' : '!'}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-[13px] font-medium text-white">
                {i.title}
                <span className="sr-only">{i.ok ? ' (ready)' : ' (needs attention)'}</span>
              </p>
              <p className="text-[12.5px] leading-relaxed text-ink-400">{i.detail}</p>
              {steps.map((l) => (
                <p key={l} className="text-[12.5px] leading-relaxed text-ink-300">
                  {l}
                </p>
              ))}
              {cmds.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-ink-950/70 px-3 py-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre text-[12px] leading-relaxed text-ink-200">{cmds.join('\n')}</pre>
                  <button
                    type="button"
                    className={smallBtn}
                    onClick={() => void copyText(cmds.join('\n')).then((ok) => toast(ok ? 'Copied. Run it on the server.' : 'Couldn’t copy. Select the text instead.', ok ? undefined : 'error'))}
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Full installs: Finesse sets Wolf up itself, after a look at what this machine has. */
function ManagedStreaming() {
  const toast = useToast()
  const qc = useQueryClient()
  const { info, refresh: refreshFinesse } = useFinesse()
  const [status, setStatus] = useState<SystemStatus['streaming'] | null>(null)
  const [check, setCheck] = useState<StreamingCheck | null>(null)
  const [checkErr, setCheckErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)

  const load = useCallback(async () => {
    try {
      setStatus((await systemApi.status()).streaming ?? null)
    } catch {
      /* Server → Status shows what's wrong */
    }
  }, [])
  const [checking, setChecking] = useState(false)

  useEffect(() => void load(), [load])
  const enabled = Boolean(status?.enabled)
  const job = status?.job
  // Look at the machine while streaming is off (and again after "check again").
  useEffect(() => {
    if (!status || enabled || check || checkErr || checking) return
    setChecking(true)
    systemApi
      .streamingCheck()
      .then(setCheck)
      .catch((e: Error) => setCheckErr(e.message))
      .finally(() => setChecking(false))
  }, [status, enabled, check, checkErr, checking])
  // Turning on or off: follow it closely, then let Games and the menu catch up.
  useEffect(() => {
    if (job?.state !== 'working') return
    const t = window.setInterval(() => void load(), 2000)
    return () => {
      clearInterval(t)
      refreshFinesse()
      void qc.invalidateQueries({ queryKey: ['streaming'] })
    }
  }, [job?.state, load, refreshFinesse, qc])
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])

  const turn = async (on: boolean) => {
    setBusy(true)
    try {
      await systemApi.setStreaming(on)
      if (on) toast('Setting up game streaming. Wolf is about 1 GB, so the first time takes a few minutes.')
      else toast('Game streaming is off. Wolf’s folder, with paired devices and games, stays on the server.')
      await load()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }

  if (!status) return null
  // A Wolf this server was pointed at (WOLF_SOCKET), not one Finesse runs.
  if (!enabled && info?.features.streaming && job?.state !== 'working') return <StreamingAdmin />

  const errorLine = job?.state === 'error' && <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-red-300">{job.error}</p>

  if (job?.state === 'working')
    return (
      <div id="settings-streaming" className="space-y-3 scroll-mt-24">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Game streaming</p>
        <div className={`${CARD} px-5 py-5`}>
          <p className="flex items-center gap-2 text-[13.5px] text-ink-200">
            <Spinner className="h-3.5 w-3.5" />
            {job.detail ?? 'Working…'}
          </p>
        </div>
      </div>
    )

  if (enabled)
    return (
      <StreamingAdmin
        footer={
          <div className="space-y-2 border-t border-white/5 pt-5">
            {errorLine}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12.5px] text-ink-400">Finesse runs Wolf and keeps it up to date.</p>
              <button type="button" className={smallBtn} disabled={busy} onClick={() => (armed ? void turn(false) : setArmed(true))}>
                {busy && <Spinner className="h-3 w-3" />}
                {armed ? 'Tap again to turn off' : 'Turn off game streaming'}
              </button>
            </div>
          </div>
        }
      />
    )

  return (
    <div id="settings-streaming" className="space-y-3 scroll-mt-24">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Game streaming</p>
      <div className={`${CARD} space-y-5 px-5 py-5`}>
        <div className="space-y-1.5">
          <p className="text-[14px] font-medium text-white">Play your PC games on any screen in the house</p>
          <p className="text-[12.5px] leading-relaxed text-ink-400">
            Finesse sets up Wolf, which runs Steam and other apps on this server and streams them to Moonlight on TVs, phones, tablets and computers. Everyone who plays gets their own session, and games run on this server’s graphics card.
          </p>
        </div>

        <div className="space-y-3 border-t border-white/5 pt-5">
          <p className="text-[13px] font-semibold text-white">This server</p>
          {checkErr ? (
            <div className="space-y-2">
              <p className="text-[12.5px] text-red-300">{checkErr}</p>
              <button type="button" className={smallBtn} onClick={() => setCheckErr('')}>
                Check again
              </button>
            </div>
          ) : !check ? (
            <p className="flex items-center gap-2 text-[12.5px] text-ink-400">
              <Spinner className="h-3 w-3" />
              Looking at what this server has…
            </p>
          ) : (
            <>
              <Readiness check={check} />
              {!check.allGood && !check.blocked && (
                <p className="text-[12.5px] leading-relaxed text-ink-400">
                  Fixed something? Restart the server if it said to, then{' '}
                  <button type="button" className="font-medium text-accent-300 hover:text-accent-200" onClick={() => setCheck(null)}>
                    check again
                  </button>
                  .
                </p>
              )}
            </>
          )}
        </div>

        {errorLine}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-5">
          <p className="text-[12px] text-ink-400">{check?.blocked ? 'Move Finesse’s folder first (see above).' : 'Wolf is about 1 GB to download.'}</p>
          <button type="button" className={primaryBtn} disabled={busy || !check || Boolean(check.blocked)} onClick={() => void turn(true)}>
            {busy && <Spinner className="h-3 w-3" />}
            {check && !check.allGood && !check.blocked ? 'Turn on anyway' : 'Turn on game streaming'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Full installs: turn game streaming on or off (Finesse runs Wolf). Otherwise
 *  only on servers connected to a Wolf of their own (WOLF_SOCKET). */
export function StreamingSettings() {
  const { info } = useFinesse()
  if (info?.mode === 'bundle') return <ManagedStreaming />
  return info?.features.streaming ? <StreamingAdmin /> : null
}
