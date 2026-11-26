// Settings → Downloads → Quality (administrators): each Radarr/Sonarr quality profile as two
// plain choices (how sharp, which languages) and, per app, whether very big files may download.
// Changes save as soon as they're picked (server/src/qualityRules.ts writes them to the app).

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { qualityApi, requestDefaultsApi, type LanguageMode, type Picture, type QualityAppView, type QualityProfileView } from '../../api/setup'
import { SelectMenu } from '../../components/Menu'
import { useToast } from '../../components/Toast'

const WHAT = { radarr: 'Movies', sonarr: 'Shows' } as const
const PICTURE: { value: Picture; label: string }[] = [
  { value: 480, label: 'SD' },
  { value: 720, label: 'Up to 720p' },
  { value: 1080, label: 'Up to 1080p' },
  { value: 2160, label: 'Up to 4K' },
]
const TRIGGER =
  'inline-flex max-w-full items-center gap-2 h-10 rounded-lg bg-ink-800/80 border border-white/10 pl-3.5 pr-2.5 text-sm text-ink-200 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50'

function languages(household: string | null | undefined): { value: LanguageMode; label: string }[] {
  return [
    { value: 'original', label: household ? `Original language or ${household}` : 'Original language first' },
    ...(household ? [{ value: 'mine' as const, label: `${household} only` }] : []),
    { value: 'any', label: 'Any language' },
  ]
}

export default function QualitySettings() {
  const q = useQuery({ queryKey: ['qualityRules'], queryFn: qualityApi.get, staleTime: 30_000, retry: false })
  if (q.isLoading)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Asking Radarr and Sonarr how they’re set up">
        <div className="h-4 w-44 rounded shimmer" />
        <div className="h-28 rounded-2xl shimmer" />
      </div>
    )
  if (q.isError)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-ink-900/60 px-5 py-4">
        <p className="text-sm text-ink-300">Couldn’t load the quality settings. Try again in a moment; if it keeps happening, update the Finesse server.</p>
        <button
          type="button"
          onClick={() => void q.refetch()}
          disabled={q.isFetching}
          className="h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 text-sm font-medium text-ink-200 transition hover:border-white/20 hover:text-white disabled:opacity-50"
        >
          {q.isFetching ? 'Loading…' : 'Retry'}
        </button>
      </div>
    )
  const apps = q.data?.apps ?? []
  if (!apps.length) return null
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[15px] font-semibold text-white">Quality and languages</h3>
        <p className="mt-1 text-sm text-ink-400">
          What Radarr and Sonarr may download. If a request never starts, the usual cause is a language or size setting here. Changes apply to new downloads straight away.
        </p>
      </div>
      {apps.map((a) => (
        <AppCard key={a.app} view={a} />
      ))}
    </div>
  )
}

function AppCard({ view }: { view: QualityAppView }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const defaults = useQuery({ queryKey: ['requestDefaults'], queryFn: requestDefaultsApi.get, staleTime: 30_000, retry: false })
  const used = defaults.data?.apps.find((x) => x.app === view.app)
  const isUsed = (p: QualityProfileView) => (used?.profileId ? used.profileId === p.id : used?.profileName === p.name)

  const store = (next: QualityAppView) =>
    qc.setQueryData<{ apps: QualityAppView[] }>(['qualityRules'], (old) => ({ apps: (old?.apps ?? []).map((x) => (x.app === next.app ? next : x)) }))

  const bigFiles = async (allowed: boolean) => {
    setBusy(true)
    try {
      store(await qualityApi.setBigFiles(view.app, allowed))
      toast(allowed ? `${WHAT[view.app]}: big files can download now` : `${WHAT[view.app]}: size limits are back`)
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : 'Couldn’t change that', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl bg-ink-900/60 border border-white/5 px-5 py-4">
      <h4 className="text-[15px] font-semibold text-white">
        {WHAT[view.app]} <span className="font-normal text-ink-400">· {view.name}</span>
      </h4>
      {view.error && <p className="mt-3 text-sm text-red-300">{view.error}</p>}
      {view.bigFiles && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-800/40 px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-100">Very big files</p>
            <p className="text-xs text-ink-400">
              {view.bigFiles.allowed
                ? 'Any size can download. Best picture and sound, but a film can take 30 GB or more.'
                : `${view.name}’s size limits apply, so the biggest copies (like untouched Blu-rays) are skipped.`}
            </p>
            {view.bigFiles.allowed && !view.bigFiles.canRestore && (
              <p className="mt-1 text-xs text-amber-200/90">
                Finesse doesn’t know the old limits, so “Limit” is unavailable here. Set them in {view.name} → Settings → Quality.
              </p>
            )}
          </div>
          <div className="inline-flex rounded-full bg-ink-800/80 border border-white/10 p-0.5">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                aria-pressed={view.bigFiles!.allowed === on}
                disabled={busy || view.bigFiles!.allowed === on || (!on && !view.bigFiles!.canRestore)}
                title={!on && !view.bigFiles!.canRestore && view.bigFiles!.allowed ? `Finesse doesn’t know the old limits. Set them in ${view.name} → Settings → Quality.` : undefined}
                onClick={() => void bigFiles(on)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition active:scale-[0.97] disabled:active:scale-100 disabled:cursor-default ${
                  view.bigFiles!.allowed === on ? 'bg-[#f5f3ee] text-ink-950' : 'text-ink-300 hover:text-white disabled:opacity-50'
                }`}
              >
                {on ? 'Allow' : 'Limit'}
              </button>
            ))}
          </div>
        </div>
      )}
      {view.profiles && (
        <ul className="mt-3 divide-y divide-white/5">
          {view.profiles.map((p) => (
            <ProfileRow key={p.id} app={view} profile={p} used={isUsed(p)} onSaved={store} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ProfileRow({ app, profile: p, used, onSaved }: { app: QualityAppView; profile: QualityProfileView; used: boolean; onSaved: (v: QualityAppView) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const save = async (choice: { picture?: Picture; language?: LanguageMode }) => {
    if (busy) return
    setBusy(true)
    try {
      onSaved(await qualityApi.setProfile(app.app, p.id, choice))
      toast(`“${p.name}” saved`)
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : `Couldn’t save “${p.name}”`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const langOptions: { value: LanguageMode | 'custom'; label: string }[] = languages(app.household)
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-[8rem] flex-1 text-sm font-medium text-ink-100">
          {p.name}
          {used && <span className="ml-2 rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-300">New requests</span>}
        </p>
        <fieldset disabled={busy} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-0 m-0 p-0 min-w-0">
          <SelectMenu
            label={`${p.name}: picture`}
            prefix="Picture:"
            value={p.picture ?? 0}
            options={[...(p.picture ? [] : [{ value: 0, label: 'Custom' }]), ...PICTURE]}
            onChange={(v) => !busy && v && v !== p.picture && void save({ picture: v as Picture })}
            triggerClassName={TRIGGER}
          />
          <SelectMenu
            label={`${p.name}: languages`}
            prefix="Languages:"
            value={p.language}
            options={p.language === 'custom' ? [{ value: 'custom' as const, label: 'Your own rules' }, ...langOptions] : langOptions}
            onChange={(v) => !busy && v !== p.language && v !== 'custom' && void save({ language: v })}
            triggerClassName={TRIGGER}
          />
        </fieldset>
        {busy && <span className="text-xs text-ink-400">Saving…</span>}
      </div>
      {p.otherRules.length > 0 && (
        <p className="mt-1.5 text-xs text-amber-200/90">
          {p.language === 'custom' ? 'Your own rules decide the languages here' : 'Also keeping other languages out'}: {p.otherRules.join(', ')}. Picking “{langOptions[0]!.label}” or
          “Any language” turns {p.otherRules.length === 1 ? 'it' : 'them'} off for this profile.{p.language === 'custom' && ' If a request in another language never starts, this is usually why.'}
        </p>
      )}
    </li>
  )
}
