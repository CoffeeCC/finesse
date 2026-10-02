import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { streamingApi } from '../../api/setup'
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
export default function StreamingAdmin() {
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
      </div>
    </div>
  )
}

/** Only on servers connected to Wolf (WOLF_SOCKET). */
export function StreamingSettings() {
  const { info } = useFinesse()
  return info?.features.streaming ? <StreamingAdmin /> : null
}
