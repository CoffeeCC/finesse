// Settings → Server → Graphics (administrators): the graphics cards on this
// server, each with what its test conversion said, and which card Jellyfin and
// game streaming use, in plain words (server/src/stack/graphics.ts). On servers
// Finesse set up, an administrator can pick the cards; the choice is kept and
// used while that card still works. On servers using someone's own Jellyfin,
// it shows what Jellyfin's container can use, with the one-click fix.

import { useCallback, useEffect, useState } from 'react'
import { graphicsApi, type GpuInfo, type GraphicsStatus } from '../../api/setup'
import { useToast } from '../../components/Toast'
import { Spinner, StatusDot } from '../setup/ui'

const CARD = 'rounded-2xl bg-ink-900/60 border border-white/5'
const smallBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12.5px] font-medium text-ink-200 hover:border-white/25 hover:text-white disabled:opacity-50 transition-colors'
const select = 'h-9 w-full rounded-lg border border-white/10 bg-ink-800 px-3 text-[13px] text-white outline-none focus:border-accent-500'

const pci = (g: GpuInfo) => (g.pci ? g.pci.replace(/^0000:/, '') : '')
const label = (g: GpuInfo) => `${g.name}${g.pci ? ` (${pci(g)})` : ''}`

function CardRow({ g }: { g: GpuInfo }) {
  const test = g.encodes === true ? 'Passed a test video conversion.' : g.encodes === false ? `Failed a test video conversion${g.problem ? `: ${g.problem}` : ''}. Finesse doesn’t use it.` : 'Not tested yet.'
  const facts = [g.integrated ? 'Built in' : 'Graphics card', g.vramMiB ? `${Math.round(g.vramMiB / 1024)} GB` : '', g.sessionLimit ? `up to ${g.sessionLimit} conversions at once` : ''].filter(Boolean).join(' · ')
  return (
    <li className="flex gap-3 px-5 py-3">
      <span className="mt-0.5">
        <StatusDot ok={g.encodes === false ? null : true} />
      </span>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-white">{label(g)}</p>
        <p className="text-[12.5px] text-ink-400">{facts}</p>
        <p className={`text-[12.5px] leading-relaxed ${g.encodes === false ? 'text-amber-200' : 'text-ink-400'}`}>{test}</p>
      </div>
    </li>
  )
}

export default function GraphicsAdmin() {
  const toast = useToast()
  const [st, setSt] = useState<GraphicsStatus | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async (refresh = false) => {
    try {
      setSt(await graphicsApi.get(refresh))
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  // While the apps are being moved to their cards, follow it.
  const working = st?.mode === 'bundle' && st.working
  useEffect(() => {
    if (!working) return
    const t = window.setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [working, load])

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await fn()
      toast(done)
      await load()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }

  if (!st) return err ? <p className="text-sm text-ink-400">Couldn’t look at the graphics cards: {err}</p> : null
  const gpus = st.inventory?.gpus ?? []
  const usable = gpus.filter((g) => g.encodes !== false && (g.vendor !== 'nvidia' || st.inventory?.nvidiaRuntime))

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">Graphics</h3>
        <button type="button" className={smallBtn} disabled={busy === 'check'} onClick={() => act('check', () => load(true), 'Checked the cards again')}>
          {busy === 'check' && <Spinner className="h-3 w-3" />}
          {busy === 'check' ? 'Testing each card…' : 'Check again'}
        </button>
      </div>
      <div className={`${CARD} divide-y divide-white/5`}>
        {gpus.length ? (
          <ul className="divide-y divide-white/5">
            {gpus.map((g) => (
              <CardRow key={g.id} g={g} />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-[13px] text-ink-300">{st.inventory ? 'This server has no graphics card. Jellyfin converts video on the processor, and only when it has to.' : 'Finesse couldn’t look at this server’s graphics cards.'}</p>
        )}
        {st.inventory && !st.inventory.nvidiaRuntime && gpus.some((g) => g.vendor === 'nvidia') && (
          <p className="px-5 py-3 text-[12.5px] leading-relaxed text-amber-200">Apps in Docker can’t use the NVIDIA card until the NVIDIA Container Toolkit is installed on this server.</p>
        )}

        {st.mode === 'bundle' && st.plan && (
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1">
              <p className="text-[13.5px] text-white">
                <span className="font-semibold">Jellyfin:</span> {st.plan.jellyfin.name ?? 'the processor'}
                {st.plan.jellyfin.maxTranscodes ? <span className="text-ink-400"> · up to {st.plan.jellyfin.maxTranscodes} conversion{st.plan.jellyfin.maxTranscodes > 1 ? 's' : ''} at once</span> : null}
              </p>
              <p className="text-[12.5px] leading-relaxed text-ink-400">{st.plan.jellyfin.why}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[13.5px] text-white">
                <span className="font-semibold">Game streaming:</span> {st.plan.wolf.name ?? 'can’t run here'}
                {!st.streaming && st.plan.wolf.name ? <span className="text-ink-400"> (when it’s on)</span> : null}
              </p>
              <p className="text-[12.5px] leading-relaxed text-ink-400">{st.plan.wolf.why}</p>
            </div>
            {st.plan.clipsNightOnly && <p className="text-[12.5px] text-ink-400">Preview clips are made at night, when the processor is free.</p>}
            {st.plan.notes.map((n, i) => (
              <p key={i} className="text-[12.5px] leading-relaxed text-amber-200">
                {n}
              </p>
            ))}
            {st.note && <p className="text-[12.5px] leading-relaxed text-ink-400">{st.note}</p>}
            {working ? (
              <p className="flex items-center gap-2 text-[12.5px] text-ink-300">
                <Spinner className="h-3 w-3" /> Moving the apps to their cards…
              </p>
            ) : (
              st.pending && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-4 py-3">
                  <p className="text-[12.5px] leading-relaxed text-ink-300">{st.applied ? 'This is a change from what the apps use now.' : 'The apps don’t use this yet.'} It happens tonight, or now: Jellyfin restarts, which stops anything playing.</p>
                  <button type="button" className={smallBtn} disabled={busy === 'apply'} onClick={() => act('apply', () => graphicsApi.choose({}), 'Moving the apps to their cards')}>
                    Do it now
                  </button>
                </div>
              )
            )}
            {usable.length > 0 && (
              <div className="grid gap-4 border-t border-white/5 pt-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-medium text-ink-300">Card for Jellyfin</span>
                  <select className={select} value={st.override.jellyfin ?? 'auto'} disabled={busy === 'jf'} onChange={(e) => act('jf', () => graphicsApi.choose({ jellyfin: e.target.value }), 'Saved. Jellyfin restarts on its card.')}>
                    <option value="auto">Automatic</option>
                    {usable.map((g) => (
                      <option key={g.id} value={g.id}>
                        {label(g)}
                      </option>
                    ))}
                    <option value="cpu">The processor</option>
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12.5px] font-medium text-ink-300">Card for game streaming</span>
                  <select className={select} value={st.override.wolf ?? 'auto'} disabled={busy === 'wolf'} onChange={(e) => act('wolf', () => graphicsApi.choose({ wolf: e.target.value }), 'Saved. Game streaming moves to that card.')}>
                    <option value="auto">Automatic</option>
                    {usable.map((g) => (
                      <option key={g.id} value={g.id}>
                        {label(g)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-[12px] leading-relaxed text-ink-500 sm:col-span-2">Your choice is kept. If that card goes or stops working, Finesse chooses again by itself, so the apps keep running.</p>
              </div>
            )}
          </div>
        )}

        {st.mode === 'adopt' && (
          <div className="space-y-2 px-5 py-4">
            {st.jellyfin && (
              <p className="text-[13.5px] text-white">
                <span className="font-semibold">Jellyfin</span> <span className="text-ink-400">({st.jellyfin.name})</span>: {st.check?.summary ?? (st.jellyfin.encoding && st.jellyfin.encoding !== 'none' ? `converts video with ${st.jellyfin.encoding}` : 'converts video on the processor')}
              </p>
            )}
            {st.check?.problems.map((p, i) => (
              <p key={i} className="text-[12.5px] leading-relaxed text-ink-400">
                {p}
              </p>
            ))}
            {st.check?.fix && (
              <button
                type="button"
                className="h-8 rounded-full bg-white px-3 text-[12.5px] font-semibold text-ink-950 hover:bg-ink-200 disabled:opacity-60"
                disabled={busy === 'fix'}
                onClick={() => act('fix', () => graphicsApi.fixJellyfin(st.check!.fix!.gpu), 'Jellyfin now converts video on the card')}
              >
                {busy === 'fix' ? 'Switching…' : st.check.fix.label}
              </button>
            )}
            {st.reason && <p className="text-[12.5px] leading-relaxed text-ink-400">{st.reason}</p>}
            <p className="text-[12px] leading-relaxed text-ink-500">Finesse doesn’t change apps it didn’t set up: which cards Jellyfin’s container gets is set in that app’s own settings.</p>
          </div>
        )}
      </div>
    </div>
  )
}
