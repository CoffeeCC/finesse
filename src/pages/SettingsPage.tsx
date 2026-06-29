import { useState, type FormEvent } from 'react'
import { BITRATE_OPTIONS, UI_SCALE_OPTIONS, applyUiScale, getPrefs, setPrefs, type Prefs } from '../lib/settings'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { createUser, ApiError, setAccentPref } from '../api/client'
import { ACCENT_PRESETS, applyAccent, getStoredAccent, setStoredAccent } from '../lib/accent'
import { checkForUpdate, currentVersion, downloadAndStage, type UpdateInfo } from '../lib/webosUpdate'

const inputClass =
  'w-full rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 transition-colors'

function CreateUserForm() {
  const toast = useToast()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const mismatch = password !== '' && password !== confirm

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (mismatch) {
      setError('Passwords don’t match')
      return
    }
    setError('')
    setBusy(true)
    try {
      await createUser({ name: name.trim(), password: password || undefined })
      toast(`Account "${name.trim()}" created`)
      setName('')
      setPassword('')
      setConfirm('')
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? 'That username is already taken' : 'Could not create the account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <label className="block text-sm font-medium text-ink-200 mb-1">Create account</label>
      <p className="text-xs text-ink-400 mb-3">
        Adds a new sign-in to this server. Leave the password blank for a one-click
        profile, like the others on the login screen.
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Username"
        autoComplete="off"
        className={inputClass}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password (optional)"
        autoComplete="new-password"
        className={`${inputClass} mt-2`}
      />
      {password && (
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          autoComplete="new-password"
          className={`${inputClass} mt-2`}
        />
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy || !name.trim() || mismatch}
        className="mt-3 rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white active:scale-[0.98] transition-all"
      >
        {busy ? 'Creating…' : 'Create account'}
      </button>
    </form>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-4 py-3 text-left"
    >
      <span>
        <span className="block text-sm font-medium text-ink-200">{label}</span>
        {hint && <span className="block text-xs text-ink-400 mt-0.5">{hint}</span>}
      </span>
      <span
        className={`shrink-0 h-6 w-11 rounded-full p-0.5 transition-colors ${
          checked ? 'bg-accent-500' : 'bg-ink-700'
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </span>
    </button>
  )
}

// TV-only: lets the sideloaded webOS app update its own bundle from GitHub
// releases without a reinstall. Rendered only when __WEBOS__ (see below).
function AppUpdateSection() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [staged, setStaged] = useState(false)
  const [error, setError] = useState('')

  const check = async () => {
    setBusy(true)
    setError('')
    setStaged(false)
    try {
      const result = await checkForUpdate()
      setInfo(result)
      if (!result.available) toast('You’re on the latest version')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach GitHub')
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    if (!info) return
    setBusy(true)
    setError('')
    try {
      await downloadAndStage(info)
      setStaged(true)
      toast(`Version ${info.latest} downloaded`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-3">App updates</h2>
      <div className="rounded-2xl bg-ink-900/60 border border-white/5 px-5 py-4 text-sm">
        <div className="flex justify-between py-1">
          <span className="text-ink-400">Installed version</span>
          <span className="text-ink-200 font-mono text-xs">v{currentVersion()}</span>
        </div>

        {info?.available && !staged && (
          <div className="mt-3 rounded-lg bg-accent-500/10 border border-accent-500/30 px-3 py-3">
            <p className="text-ink-100 font-medium">Version {info.latest} is available</p>
            {info.notes && (
              <p className="text-xs text-ink-400 mt-1 whitespace-pre-line line-clamp-4">{info.notes}</p>
            )}
          </div>
        )}

        {staged && (
          <div className="mt-3 rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-3">
            <p className="text-ink-100 font-medium">Update ready</p>
            <p className="text-xs text-ink-400 mt-1">Restart Finesse to finish installing.</p>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-4 flex gap-3">
          {staged ? (
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-400 transition-colors"
            >
              Restart now
            </button>
          ) : info?.available ? (
            <button
              onClick={install}
              disabled={busy}
              className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-400 transition-colors disabled:opacity-50"
            >
              {busy ? 'Downloading…' : `Download & install v${info.latest}`}
            </button>
          ) : (
            <button
              onClick={check}
              disabled={busy}
              className="rounded-lg bg-ink-800 border border-white/10 px-4 py-2 text-sm font-medium text-ink-100 hover:border-accent-500 transition-colors disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

export default function SettingsPage() {
  const { session } = useAuth()
  const toast = useToast()
  const [prefs, setLocal] = useState<Prefs>(getPrefs())
  const [accent, setAccent] = useState(getStoredAccent())

  const update = (patch: Partial<Prefs>) => {
    const next = setPrefs(patch)
    setLocal(next)
  }

  const chooseAccent = (name: string) => {
    setAccent(name)
    applyAccent(name)
    setStoredAccent(name)
    setAccentPref(name).catch(() => {})
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-12 py-8">
      <h1 className="text-2xl font-bold text-white tracking-tight mb-8">Settings</h1>

      <section className="mb-10">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-3">
          Playback
        </h2>
        <div className="rounded-2xl bg-ink-900/60 border border-white/5 px-5 divide-y divide-white/5">
          <div className="py-4">
            <label className="block text-sm font-medium text-ink-200 mb-1">
              Maximum streaming quality
            </label>
            <p className="text-xs text-ink-400 mb-3">
              Caps the bitrate the server transcodes to. Lower it when you&rsquo;re watching
              away from home over the internet.
            </p>
            <select
              value={prefs.maxBitrate}
              onChange={(e) => {
                update({ maxBitrate: Number(e.target.value) })
                toast('Quality preference saved')
              }}
              className="w-full rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 text-ink-200"
            >
              {BITRATE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <Toggle
            label="Subtitles on by default"
            hint="Turn on the first subtitle track automatically when available."
            checked={prefs.subtitlesDefault}
            onChange={(v) => update({ subtitlesDefault: v })}
          />

          <Toggle
            label="Auto-play next episode"
            hint="Start the next episode automatically when one ends."
            checked={prefs.autoPlayNext}
            onChange={(v) => update({ autoPlayNext: v })}
          />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-3">
          Appearance
        </h2>
        <div className="rounded-2xl bg-ink-900/60 border border-white/5 px-5 divide-y divide-white/5">
          <div className="py-4">
            <label className="block text-sm font-medium text-ink-200 mb-1">Accent color</label>
            <p className="text-xs text-ink-400 mb-3">Personalizes this account, synced across your devices.</p>
            <div className="flex flex-wrap gap-3">
              {ACCENT_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => chooseAccent(p.name)}
                  title={p.label}
                  aria-label={p.label}
                  className={`h-9 w-9 rounded-full transition-transform hover:scale-110 active:scale-95 ring-2 ring-offset-2 ring-offset-ink-900 ${
                    accent === p.name ? 'ring-white' : 'ring-transparent'
                  }`}
                  style={{ backgroundColor: p.shades[500] }}
                >
                  {accent === p.name && (
                    <svg className="h-5 w-5 mx-auto text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="py-4">
            <label className="block text-sm font-medium text-ink-200 mb-1">Display size</label>
            <p className="text-xs text-ink-400 mb-3">
              Scales the whole interface. Bump it up for comfortable viewing from the couch on a TV.
            </p>
            <select
              value={prefs.uiScale}
              onChange={(e) => {
                const v = Number(e.target.value)
                update({ uiScale: v })
                applyUiScale(v)
                toast('Display size updated')
              }}
              className="w-full rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 text-ink-200"
            >
              {UI_SCALE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-3">
          Account
        </h2>
        <div className="rounded-2xl bg-ink-900/60 border border-white/5 px-5 py-4 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-ink-400">Signed in as</span>
            <span className="text-ink-200 font-medium">{session?.userName}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-ink-400">Server</span>
            <span className="text-ink-200 font-mono text-xs">{session?.server}</span>
          </div>
        </div>
      </section>

      {__WEBOS__ && <AppUpdateSection />}

      {session?.isAdmin && (
        <section className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-400 mb-3">
            Administration
          </h2>
          <div className="rounded-2xl bg-ink-900/60 border border-white/5 px-5 py-4">
            <CreateUserForm />
          </div>
        </section>
      )}
    </div>
  )
}
