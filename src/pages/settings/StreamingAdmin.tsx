import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { streamingApi, systemApi, type EmulatorId, type EmulatorReadiness, type EmulatorSettings, type StreamingCheck, type SystemStatus } from '../../api/setup'
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

const EMULATORS: { id: EmulatorId; label: string; note: string }[] = [
  { id: 'pcsx2', label: 'PCSX2', note: 'PS2' },
  { id: 'dolphin', label: 'Dolphin', note: 'GameCube and Wii' },
  { id: 'rpcs3', label: 'RPCS3', note: 'PS3' },
  { id: 'cemu', label: 'Cemu', note: 'Wii U' },
  { id: 'switch', label: 'Switch', note: 'Ryujinx or Eden' },
  { id: 'esde', label: 'ES-DE', note: 'every console in one menu' },
]

const FOLDERS: { key: keyof EmulatorSettings['paths']; label: string; hint: string; placeholder: string }[] = [
  { key: 'roms', label: 'RomM’s library', hint: 'The folder with roms inside. Read-only.', placeholder: '/srv/finesse/data/media/games' },
  { key: 'emulators', label: 'Emulators', hint: 'The AppImages (pcsx2…, rpcs3…, Cemu…, Ryujinx… or Eden…, Dolphin…). Read-only.', placeholder: '/srv/games/emulators' },
  { key: 'firmware', label: 'Firmware and BIOS', hint: 'A folder per emulator inside: pcsx2, rpcs3, cemu, switch. Read-only.', placeholder: '/srv/games/firmware' },
  { key: 'keys', label: 'Keys', hint: 'A folder per emulator inside: cemu, switch, rpcs3. Read-only.', placeholder: '/srv/games/keys' },
  { key: 'saves', label: 'Saves', hint: 'Finesse makes a folder for each Wolf profile. Read-write.', placeholder: '/srv/games/saves' },
]

const mark = (state: 'ok' | 'missing' | 'unseen', required: boolean) =>
  state === 'ok' ? ['✓', 'bg-emerald-400/15 text-emerald-300'] : required ? ['!', 'bg-amber-300/15 text-amber-200'] : ['–', 'bg-white/10 text-ink-300']

/** Each emulator: what it has and what it still needs. Checked by file name; nothing is opened. */
function EmulatorReadinessList({ list }: { list: EmulatorReadiness[] }) {
  return (
    <ul className="space-y-4">
      {list.map((e) => (
        <li key={e.id} className="space-y-1.5">
          <p className="text-[13px] font-semibold text-white">
            {e.title} <span className={e.ready ? 'font-normal text-emerald-300' : 'font-normal text-amber-200'}>{e.ready ? '· ready' : '· needs something'}</span>
          </p>
          <ul className="space-y-1">
            {e.items.map((i) => {
              const [sym, cls] = mark(i.state, i.required)
              return (
                <li key={i.label} className="flex gap-2 text-[12.5px] leading-relaxed">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${cls}`} aria-hidden>
                    {sym}
                  </span>
                  <span className="min-w-0">
                    <span className="text-ink-200">{i.label}</span> <span className="text-ink-400">{i.detail}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ul>
  )
}

/** Emulators as Wolf apps: which ones, the folders they get, and what each still needs. */
function Emulators() {
  const toast = useToast()
  const qc = useQueryClient()
  const { data, error, refetch } = useQuery({ queryKey: ['streaming', 'emulators'], queryFn: streamingApi.emulators, retry: false })
  const [form, setForm] = useState<EmulatorSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [more, setMore] = useState(false)
  useEffect(() => {
    if (data && !form) setForm(data.settings ?? { apps: [], paths: {} })
  }, [data, form])

  if (error) return <p className="text-[12.5px] text-red-300">{(error as Error).message}</p>
  if (!data || !form) return <div className="h-16 rounded-xl shimmer" />

  const set = (fn: (f: EmulatorSettings) => EmulatorSettings) => setForm((f) => (f ? fn(JSON.parse(JSON.stringify(f)) as EmulatorSettings) : f))
  const toggle = (id: EmulatorId) => set((f) => ({ ...f, apps: f.apps.includes(id) ? f.apps.filter((a) => a !== id) : [...f.apps, id] }))
  const save = async () => {
    setBusy(true)
    setErr('')
    // Empty boxes mean "not set".
    const clean = (o: Record<string, string | undefined> = {}) => Object.fromEntries(Object.entries(o).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v!.trim()]))
    const folders = Object.fromEntries(Object.entries(form.folders ?? {}).map(([k, v]) => [k, clean(v)]).filter(([, v]) => Object.keys(v as object).length))
    const body: EmulatorSettings = {
      apps: form.apps,
      ...(form.apps.includes('switch') ? { switchEmulator: form.switchEmulator ?? 'ryujinx' } : {}),
      paths: clean(form.paths),
      ...(Object.keys(folders).length ? { folders } : {}),
      ...(form.profiles?.length ? { profiles: form.profiles } : {}),
    }
    try {
      const r = await streamingApi.saveEmulators(body)
      if (r.ok) toast(body.apps.length ? `Saved. Wolf has the apps in ${r.profiles?.join(', ') || 'Moonlight'}.` : 'Saved. The emulator apps are out of Wolf.')
      else setErr(r.error ?? 'Wolf didn’t take the apps.')
      await refetch()
      void qc.invalidateQueries({ queryKey: ['streaming', 'apps'] })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 border-t border-white/5 pt-5">
      <div className="space-y-1">
        <p className="text-[13px] font-semibold text-white">Emulators</p>
        <p className="text-[12.5px] leading-relaxed text-ink-400">
          PS2, GameCube, Wii, PS3, Wii U and Switch games play here through Wolf, like Steam: no extra delay. Finesse hands the emulators your folders by path and checks them by file name. It never copies or opens your firmware, keys or games.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className={label}>Apps in Wolf</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {EMULATORS.map((e) => (
            <label key={e.id} className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2 text-[13px] text-white">
              <input type="checkbox" checked={form.apps.includes(e.id)} onChange={() => toggle(e.id)} />
              <span>
                {e.label} <span className="text-ink-400">· {e.note}</span>
              </span>
            </label>
          ))}
        </div>
        {form.apps.includes('switch') && (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-300">
            Switch emulator
            <select
              className="rounded-md border border-white/10 bg-ink-900 px-2 py-1 text-[13px] text-white"
              value={form.switchEmulator ?? 'ryujinx'}
              onChange={(e) => set((f) => ({ ...f, switchEmulator: e.target.value as 'ryujinx' | 'eden' }))}
            >
              <option value="ryujinx">Ryujinx</option>
              <option value="eden">Eden</option>
            </select>
          </label>
        )}
      </fieldset>

      <div className="space-y-3">
        <p className={label}>Folders on the server</p>
        <p className="text-[12px] leading-relaxed text-ink-400">Paths as Wolf sees them. Share them with Finesse at the same path too (read-only; saves read-write), so it can check what’s there.</p>
        {FOLDERS.map((f) => (
          <div key={f.key}>
            <label className="block text-[12.5px] font-medium text-ink-200" htmlFor={`emu-${f.key}`}>
              {f.label}
            </label>
            <input
              id={`emu-${f.key}`}
              className={`${input} mt-1 font-mono text-[13px]`}
              value={form.paths[f.key] ?? ''}
              onChange={(e) => set((x) => ({ ...x, paths: { ...x.paths, [f.key]: e.target.value } }))}
              placeholder={f.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[11.5px] text-ink-500">{f.hint}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <button type="button" className="text-[12.5px] font-medium text-accent-300 hover:text-accent-200" onClick={() => setMore((m) => !m)}>
          {more ? 'Fewer options' : 'Profiles, and a different folder for one emulator'}
        </button>
        {more && (
          <div className="space-y-4">
            {data.profiles.length > 0 && (
              <fieldset className="space-y-1.5">
                <legend className="text-[12.5px] font-medium text-ink-200">Wolf profiles that get the apps (none ticked: all)</legend>
                {data.profiles.map((p) => (
                  <label key={p.id} className="mr-4 inline-flex items-center gap-2 text-[13px] text-white">
                    <input
                      type="checkbox"
                      checked={Boolean(form.profiles?.includes(p.id))}
                      onChange={() =>
                        set((f) => ({ ...f, profiles: f.profiles?.includes(p.id) ? f.profiles.filter((x) => x !== p.id) : [...(f.profiles ?? []), p.id] }))
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </fieldset>
            )}
            {EMULATORS.filter((e) => e.id !== 'esde' && e.id !== 'dolphin' && form.apps.includes(e.id)).map((e) => (
              <div key={e.id} className="grid gap-2 sm:grid-cols-2">
                {(['firmware', 'keys'] as const).map((what) => (
                  <div key={what}>
                    <label className="block text-[12px] text-ink-300" htmlFor={`emu-${e.id}-${what}`}>
                      {e.label} {what}
                    </label>
                    <input
                      id={`emu-${e.id}-${what}`}
                      className={`${input} mt-1 font-mono text-[12.5px]`}
                      value={form.folders?.[e.id]?.[what] ?? ''}
                      onChange={(ev) => set((f) => ({ ...f, folders: { ...f.folders, [e.id]: { ...f.folders?.[e.id], [what]: ev.target.value } } }))}
                      placeholder={form.paths[what] ? `${form.paths[what]!.replace(/\/+$/, '')}/${e.id}` : 'Same as above'}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {err && <p className="whitespace-pre-wrap text-[12.5px] text-red-300">{err}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-ink-400">Saving adds the apps to Wolf (or takes them out).</p>
        <button type="button" className={primaryBtn} disabled={busy} onClick={() => void save()}>
          {busy && <Spinner className="h-3 w-3" />}
          {busy ? 'Saving…' : 'Save emulators'}
        </button>
      </div>

      {data.readiness.length > 0 && (
        <div className="space-y-3 border-t border-white/5 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-white">What each emulator has</p>
            <button type="button" className={smallBtn} onClick={() => void refetch()}>
              Check again
            </button>
          </div>
          <EmulatorReadinessList list={data.readiness} />
        </div>
      )}
    </div>
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
            <Emulators />
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
