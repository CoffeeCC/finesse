// Settings → Downloads (administrators): which quality profile and folder new requests use
// in Radarr, Sonarr and Lidarr, picked from what each app really has. Saved on the server
// by the app's own ids (server/src/requestDefaults.ts) and used by every request
// (src/api/arr.ts resolveConfig → src/lib/arrProfiles.ts), so this, setup and requests agree.

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { arrRequestOptions, forgetArrConfig, type ArrKind } from '../../api/arr'
import { requestDefaultsApi, type RequestApp, type RequestAppConfig } from '../../api/setup'
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
    <div className="rounded-2xl bg-ink-900/60 border border-white/5 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[15px] font-semibold text-white">
          {def.what} <span className="font-normal text-ink-400">· {def.name}</span>
        </h3>
        {!loading && <span className="text-xs text-ink-400">{where}</span>}
      </div>
      {options.isLoading && <p className="mt-3 text-sm text-ink-400">Asking {def.name} what it has…</p>}
      {options.isError && <p className="mt-3 text-sm text-red-300">Couldn’t reach {def.name}. Make sure it’s running (Settings → Server shows its health), then reload.</p>}
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
              className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-ink-950 transition-colors hover:bg-ink-200 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            {saved?.source === 'settings' && (
              <button type="button" onClick={() => void save(true)} disabled={busy} className="h-10 rounded-lg px-3 text-sm font-medium text-ink-300 hover:text-white">
                Use setup’s quality
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
