// Settings → Downloads (administrators): which quality profile and folder new requests use
// in Radarr, Sonarr and Lidarr, picked from what each app really has. Saved on the server
// by the app's own ids (server/src/requestDefaults.ts) and used by every request
// (src/api/arr.ts resolveConfig → src/lib/arrProfiles.ts), so this, setup and requests agree.

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { arrRequestOptions, forgetArrConfig, type ArrKind } from '../../api/arr'
import {
  downloadRescueApi,
  requestDefaultsApi,
  RESCUE_WAIT_RANGE,
  type RequestApp,
  type RequestAppConfig,
  type RescueEvent,
  type RescueStatus,
  type RescueWatch,
} from '../../api/setup'
import { SelectMenu } from '../../components/Menu'
import { useToast } from '../../components/Toast'
import { pickArrConfig } from '../../lib/arrProfiles'
import { useFinesse } from '../../lib/finesseServer'

const APPS: { app: RequestApp; kind: ArrKind; name: string; what: string; feature: string }[] = [
  { app: 'radarr', kind: 'movie', name: 'Radarr', what: 'Movies', feature: 'movies' },
  { app: 'sonarr', kind: 'series', name: 'Sonarr', what: 'Shows', feature: 'shows' },
  { app: 'lidarr', kind: 'artist', name: 'Lidarr', what: 'Music', feature: 'music' },
]

const TRIGGER =
  'inline-flex max-w-full items-center gap-2 h-10 rounded-lg bg-ink-800/80 border border-white/10 pl-3.5 pr-2.5 text-sm text-ink-200 hover:text-white hover:border-white/20 transition-colors'
const PRIMARY = 'h-10 rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100'
const QUIET = 'h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 text-sm font-medium text-ink-200 transition hover:border-white/20 hover:text-white active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100'
const CARD = 'rounded-2xl bg-ink-900/60 border border-white/5'

export default function DownloadsSettings() {
  const { info } = useFinesse()
  const config = useQuery({ queryKey: ['requestDefaults'], queryFn: requestDefaultsApi.get, staleTime: 30_000, retry: false })
  const apps = APPS.filter((a) => info?.features?.[a.feature])
  if (!apps.length) return null
  if (config.isError) {
    return <p className="text-sm text-ink-400">Couldn’t load where requests go. Try again in a moment; if it keeps happening, update the Finesse server.</p>
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-400">Where new requests download, and in what quality. Titles already requested keep theirs.</p>
      {apps.map((a) => (
        <AppRow key={a.app} def={a} saved={config.data?.apps.find((x) => x.app === a.app)} loading={config.isLoading} />
      ))}
    </div>
  )
}

function AppRow({ def, saved, loading }: { def: (typeof APPS)[number]; saved?: RequestAppConfig; loading: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const options = useQuery({ queryKey: ['arrRequestOptions', def.kind], queryFn: () => arrRequestOptions(def.kind), staleTime: 60_000, retry: false })
  const [profileId, setProfileId] = useState<number>(0)
  const [root, setRoot] = useState('')
  const [busy, setBusy] = useState(false)

  // What requests use today, as the app has it now (or why it can't be used).
  const pick = options.data ? pickArrConfig(def.kind, options.data.profiles, options.data.roots, saved ?? null) : null
  useEffect(() => {
    if (!pick?.ok) return
    setProfileId((v) => v || pick.profile.id)
    setRoot((v) => v || pick.root.path)
  }, [pick?.ok, pick && pick.ok ? pick.profile.id : 0, pick && pick.ok ? pick.root.path : ''])

  const save = async (clear = false) => {
    setBusy(true)
    try {
      const out = await requestDefaultsApi.set(def.app, clear ? null : profileId, clear ? undefined : root || undefined)
      qc.setQueryData(['requestDefaults'], out)
      forgetArrConfig(def.kind)
      toast(clear ? `${def.what}: back to setup’s quality` : `${def.what}: new requests use this from now on`)
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : `Couldn’t save the ${def.what.toLowerCase()} choice`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const where = saved?.source === 'settings' ? 'Chosen here' : saved?.source === 'setup' ? 'From setup' : 'Not chosen yet (Finesse picks one)'
  const changed = pick?.ok ? profileId !== pick.profile.id || root !== pick.root.path : profileId > 0
  return (
    <div className={`${CARD} px-5 py-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold text-white">
          {def.what} <span className="font-normal text-ink-400">· {def.name}</span>
        </h3>
        {!loading && <span className="text-xs text-ink-400">{where}</span>}
      </div>
      {options.isLoading && (
        <div className="mt-3 flex flex-wrap gap-3" aria-busy="true" aria-label={`Asking ${def.name} what it has`}>
          <div className="h-10 w-48 rounded-lg shimmer" />
          <div className="h-10 w-20 rounded-lg shimmer" />
        </div>
      )}
      {options.isError && <p className="mt-3 text-sm text-red-300">Couldn’t reach {def.name}. Make sure it’s running (Settings → Health shows how it’s doing), then reload.</p>}
      {pick && !pick.ok && <p className="mt-3 text-sm text-amber-200">{pick.problem.replace(/, then request again\.$/, '.').replace(/ Pick (one|a folder) there again\./, ' Pick one below.')}</p>}
      {options.data && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SelectMenu
            label={`${def.what}: quality profile`}
            prefix="Quality:"
            value={profileId}
            options={[...(profileId ? [] : [{ value: 0, label: 'Pick one' }]), ...options.data.profiles.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={setProfileId}
            triggerClassName={TRIGGER}
          />
          {options.data.roots.length > 1 || (root && !options.data.roots.some((r) => r.path === root)) ? (
            <SelectMenu
              label={`${def.what}: folder`}
              prefix="Folder:"
              value={root}
              options={options.data.roots.map((r) => ({ value: r.path, label: r.path }))}
              onChange={setRoot}
              triggerClassName={TRIGGER}
            />
          ) : (
            options.data.roots[0] && <span className="min-w-0 break-all text-xs text-ink-400">Folder: {options.data.roots[0].path}</span>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !profileId || (!changed && saved?.source === 'settings' && pick?.ok === true)}
              className={PRIMARY}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            {saved?.source === 'settings' && (
              <button type="button" onClick={() => void save(true)} disabled={busy} className="h-10 rounded-lg px-3 text-sm font-medium text-ink-300 transition hover:text-white active:scale-[0.97]">
                Use setup’s quality
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Automatic download rescue (server/src/downloadRescue.ts) ----------

const WAITS = [15, 30, 60, 120, 240, 480, 1440]
const waitLabel = (m: number) => (m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : m % 60 === 0 ? `${m / 60} hours` : `${Math.floor(m / 60)} h ${m % 60} min`)

const WHAT: Record<RescueEvent['what'], { label: string; tone: string }> = {
  swapped: { label: 'Swapped for another release', tone: 'text-emerald-300' },
  dropped: { label: 'Removed (not needed any more)', tone: 'text-ink-200' },
  'gave-up': { label: 'Left for you', tone: 'text-amber-200' },
}

function ago(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const mins = Math.round((Date.now() - t) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function due(w: RescueWatch, on: boolean): string {
  if (w.action === 'report') return 'Needs a person: Finesse won’t touch it'
  if (w.exhausted) return 'Swapped 3 times today: left for tomorrow'
  if (!on) return 'Automatic rescue is off'
  const t = w.dueAt ? Date.parse(w.dueAt) : NaN
  if (!Number.isFinite(t)) return 'Next check'
  const mins = Math.round((t - Date.now()) / 60_000)
  return mins <= 0 ? 'At the next check' : mins < 60 ? `In ${mins} min` : `In about ${Math.round(mins / 60)} h`
}

/** "Automatic download rescue": a stuck download gets swapped for another release by itself. */
export function DownloadRescue() {
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['downloadRescue']
  const q = useQuery({
    queryKey: key,
    queryFn: downloadRescueApi.get,
    staleTime: 30_000,
    retry: false,
    // Something it's watching gets acted on in minutes: keep the countdowns honest.
    refetchInterval: (query) => (query.state.data?.watching.length ? 60_000 : false),
  })
  const change = useMutation({
    mutationFn: downloadRescueApi.set,
    // The switch moves at once; the server's answer (or the old value on failure) follows.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<RescueStatus | null>(key)
      if (before) qc.setQueryData<RescueStatus>(key, { ...before, ...v })
      return { before }
    },
    onSuccess: (out, v) => {
      qc.setQueryData(key, out)
      toast(v.enabled === false ? 'Automatic rescue is off: stuck downloads wait for you' : v.enabled ? 'Finesse rescues stuck downloads again' : 'Saved')
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before !== undefined) qc.setQueryData(key, ctx.before)
      toast(e instanceof Error && e.message ? e.message : 'Couldn’t save that', 'error')
    },
  })
  const check = useMutation({
    mutationFn: downloadRescueApi.check,
    onSuccess: (out) => {
      qc.setQueryData(key, out)
      toast(out.watching.length ? `Checked: ${out.watching.length} download${out.watching.length > 1 ? 's' : ''} being watched` : 'Checked: nothing is stuck')
    },
    onError: (e) => toast(e instanceof Error && e.message ? e.message : 'Couldn’t check now', 'error'),
  })

  if (q.isLoading)
    return (
      <div className={`${CARD} px-5 py-4 space-y-3`} aria-busy="true" aria-label="Loading automatic rescue">
        <div className="h-4 w-56 rounded shimmer" />
        <div className="h-3 w-80 max-w-full rounded shimmer" />
        <div className="h-10 w-48 rounded-lg shimmer" />
      </div>
    )
  if (q.isError) return <p className="text-sm text-ink-400">Couldn’t load automatic rescue. Try again in a moment.</p>
  const st = q.data
  // A server from before automatic rescue: say so once, quietly.
  if (!st) return <p className={`${CARD} px-5 py-4 text-sm text-ink-400`}>Automatic download rescue comes with a newer Finesse server. Update it in Settings → Updates to turn it on.</p>

  const on = st.enabled
  const waits = WAITS.includes(st.stalledMinutes) ? WAITS : [...WAITS, st.stalledMinutes].sort((a, b) => a - b)
  const recent = st.log.slice(0, 8)
  return (
    <div className="space-y-3">
      <div className={`${CARD} px-5 divide-y divide-white/5`}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => change.mutate({ enabled: !on })}
          disabled={change.isPending}
          className="w-full flex items-center justify-between gap-4 py-4 text-left disabled:cursor-wait"
        >
          <span>
            <span className="block text-sm font-semibold text-white">Rescue stuck downloads automatically</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-ink-400">
              When a download stalls, Finesse drops it, keeps that release from coming back and grabs another one. At most {st.maxSwaps} times a day per title; anything it
              can’t fix waits for you under Downloading.
            </span>
          </span>
          <span className={`shrink-0 h-7 w-12 rounded-full p-1 transition-colors ${on ? 'bg-accent-fill' : 'bg-ink-700'}`} aria-hidden>
            <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
          </span>
        </button>

        <div className={`py-4 transition-opacity ${on ? '' : 'opacity-50'}`}>
          <p className="text-sm font-semibold text-white">Wait before rescuing</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-400">How long a download can sit without moving before it’s swapped. Slow ones get a little longer.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SelectMenu
              label="Wait before rescuing"
              prefix="Wait:"
              value={st.stalledMinutes}
              options={waits.filter((m) => m >= RESCUE_WAIT_RANGE[0] && m <= RESCUE_WAIT_RANGE[1]).map((m) => ({ value: m, label: waitLabel(m) }))}
              onChange={(m) => m !== st.stalledMinutes && change.mutate({ stalledMinutes: m })}
              triggerClassName={TRIGGER}
            />
            {st.both && (
              <div className="inline-flex rounded-lg border border-white/10 bg-ink-800/80 p-0.5" role="group" aria-label="Try first">
                {(['usenet', 'torrent'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={st.prefer === p}
                    onClick={() => st.prefer !== p && change.mutate({ prefer: p })}
                    disabled={change.isPending}
                    className={`h-9 rounded-md px-3 text-[13px] font-medium transition active:scale-[0.97] ${st.prefer === p ? 'bg-white/10 text-white' : 'text-ink-300 hover:text-white'}`}
                  >
                    {p === 'usenet' ? 'Usenet first' : 'Torrents first'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
          <p className="text-[13px] text-ink-400">{st.lastRun ? `Last looked ${ago(st.lastRun)}` : 'Hasn’t looked yet: it checks every few minutes'}</p>
          <button type="button" onClick={() => check.mutate()} disabled={check.isPending} className={QUIET}>
            {check.isPending ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>

      {st.watching.length > 0 && (
        <div className={`${CARD} px-5 py-4`}>
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">Keeping an eye on</h3>
          <ul className="mt-2 divide-y divide-white/5">
            {st.watching.map((w) => (
              <li key={w.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">{w.title}</span>
                  <span className="block text-[12.5px] leading-snug text-ink-400">{w.reason}</span>
                </span>
                <span className={`shrink-0 text-[12.5px] tabular-nums ${w.action === 'report' || w.exhausted ? 'text-amber-200' : 'text-ink-300'}`}>{due(w, on)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recent.length > 0 && (
        <div className={`${CARD} px-5 py-4`}>
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-400">Rescued lately</h3>
          <ul className="mt-2 divide-y divide-white/5">
            {recent.map((e, i) => (
              <li key={`${e.key}-${e.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">{e.title}</span>
                  <span className="block text-[12.5px] leading-snug text-ink-400">
                    <span className={WHAT[e.what]?.tone ?? 'text-ink-200'}>{WHAT[e.what]?.label ?? e.what}</span>
                    {e.reason ? ` · ${e.reason}` : ''}
                    {e.via ? ` · now by ${e.via}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-[12.5px] tabular-nums text-ink-400">{ago(e.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
