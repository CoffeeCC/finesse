import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BITRATE_OPTIONS, PREVIEW_QUALITY_OPTIONS, UI_SCALE_OPTIONS, applyUiScale, getPrefs, setPrefs, type Prefs } from '../lib/settings'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { createUser, ApiError, setAccentPref, setPreviewQualityPref } from '../api/client'
import { ACCENT_PRESETS, applyAccent, getStoredAccent, setStoredAccent } from '../lib/accent'
import { checkForUpdate, currentVersion, downloadAndStage, type UpdateInfo } from '../lib/webosUpdate'
import { playSelect, playNav } from '../lib/sound'
import {
  createInvite,
  deleteInvite,
  inviteShareUrls,
  listInviteLibraries,
  listInvites,
  type InviteAdmin,
} from '../api/invite'

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

          <Toggle
            label="Interface sounds"
            hint="A subtle tick as you move around and a soft confirm on select. Silenced while something is playing."
            checked={prefs.uiSounds}
            onChange={(v) => {
              update({ uiSounds: v })
              if (v) playSelect()
            }}
          />

          {prefs.uiSounds && (
            <>
              <div className="py-4">
                <label className="block text-sm font-medium text-ink-200 mb-1">Sound volume</label>
                <p className="text-xs text-ink-400 mb-3">Drag to preview the level.</p>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={prefs.uiSoundsVolume}
                  onChange={(e) => {
                    update({ uiSoundsVolume: Number(e.target.value) })
                    playNav() // live feedback as you slide
                  }}
                  className="w-full accent-accent-500 cursor-pointer"
                  aria-label="Interface sound volume"
                />
              </div>

              <Toggle
                label="Tick on mouse hover"
                hint="Also play the nav tick when your mouse passes over cards and controls, not just with the keyboard/remote."
                checked={prefs.uiSoundsHover}
                onChange={(v) => update({ uiSoundsHover: v })}
              />
            </>
          )}

          <div className="py-4">
            <label className="block text-sm font-medium text-ink-200 mb-1">Preview quality</label>
            <p className="text-xs text-ink-400 mb-3">
              Resolution of the hover &amp; detail previews. Higher looks sharper but uses more
              bandwidth — pick what your connection handles. Synced to your account.
            </p>
            <select
              value={prefs.previewQuality}
              onChange={(e) => {
                const v = e.target.value as Prefs['previewQuality']
                update({ previewQuality: v })
                setPreviewQualityPref(v).catch(() => {})
                toast('Preview quality saved')
              }}
              className="w-full rounded-lg bg-ink-800 border border-white/10 px-3 py-2 text-sm outline-none focus:border-accent-500 text-ink-200"
            >
              {PREVIEW_QUALITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <Toggle
            label="Preview sound"
            hint="Play audio on hover-previews. Only one plays at a time, and it's silenced while you're actually watching something."
            checked={prefs.previewSound}
            onChange={(v) => update({ previewSound: v })}
          />

          <Toggle
            label="Screensaver"
            hint="When idle, the screen becomes drifting library art — backdrops, logos, and a clock. Any input dismisses it. Never during playback."
            checked={prefs.screensaver}
            onChange={(v) => update({ screensaver: v })}
          />

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
          <div className="rounded-2xl bg-ink-900/60 border border-white/5 px-5 py-4 space-y-8">
            <CreateUserForm />
            <div className="border-t border-white/5 pt-6">
              <InvitesAdmin />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

/** QR of an invite link — point a phone camera at the screen instead of typing.
 *  The encoder is lazy-imported so it never weighs on app startup. */
function InviteQr({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    import('qrcode')
      .then((QR) =>
        QR.toDataURL(url, { width: 320, margin: 1, color: { dark: '#0b0d12', light: '#ffffff' } }),
      )
      .then((d) => {
        if (alive) setSrc(d)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [url])
  if (!src) return <p className="text-xs text-ink-400 mt-2">Generating…</p>
  return (
    <div className="mt-3 inline-block rounded-xl bg-white p-2 shadow-lg">
      <img src={src} alt={`QR code for ${url}`} className="h-40 w-40" />
    </div>
  )
}

function InvitesAdmin() {
  const toast = useToast()
  const [invites, setInvites] = useState<InviteAdmin[] | null>(null)
  const [qrFor, setQrFor] = useState<number | null>(null)
  const [libs, setLibs] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preset, setPreset] = useState<'standard' | 'family' | 'custom'>('standard')
  const [code, setCode] = useState('')
  const [expiry, setExpiry] = useState<'never' | '7' | '30'>('7')
  const [selectedLibs, setSelectedLibs] = useState<string[]>([])
  const [liveTv, setLiveTv] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [inv, lib] = await Promise.all([listInvites(), listInviteLibraries()])
      setInvites(inv.invites)
      setLibs(lib.libraries)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load invites')
      setInvites([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!libs.length) return
    if (preset === 'standard') {
      setSelectedLibs(
        libs.filter((l) => /movie|show|series|tv/i.test(l.name)).map((l) => l.id),
      )
      setLiveTv(false)
    } else if (preset === 'family') {
      setSelectedLibs(libs.map((l) => l.id))
      setLiveTv(true)
    }
  }, [preset, libs])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const inv = await createInvite({
        code: code.trim() || undefined,
        label: preset === 'family' ? 'Family' : preset === 'standard' ? 'Standard' : undefined,
        library_ids: selectedLibs,
        expires_in_days: expiry === 'never' ? null : Number(expiry),
        unlimited: false,
        allow_downloads: true,
        allow_live_tv: liveTv,
      })
      toast(`Invite ${inv.code} created`)
      setCode('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast(`Copied ${label}`)
    } catch {
      toast('Could not copy')
    }
  }

  const revoke = async (id: number, c: string) => {
    if (!confirm(`Revoke invite ${c}?`)) return
    try {
      await deleteInvite(id)
      toast(`Revoked ${c}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed')
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-ink-200 mb-1">Invites</label>
      <p className="text-xs text-ink-400 mb-4">
        Share a Finesse link — they create an account and land in the app. Works on LAN and Funnel.
      </p>

      <form onSubmit={create} className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['standard', 'family', 'custom'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                preset === p
                  ? 'bg-accent-500 text-white'
                  : 'bg-ink-800 text-ink-300 border border-white/10 hover:border-accent-500/50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Custom code (optional)"
          className={inputClass}
          autoComplete="off"
        />

        <select
          value={expiry}
          onChange={(e) => setExpiry(e.target.value as 'never' | '7' | '30')}
          className={inputClass}
        >
          <option value="7">Link expires in 7 days</option>
          <option value="30">Link expires in 30 days</option>
          <option value="never">Link never expires</option>
        </select>

        {preset === 'custom' && (
          <div className="flex flex-wrap gap-2">
            {libs.map((l) => {
              const on = selectedLibs.includes(l.id)
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() =>
                    setSelectedLibs((prev) =>
                      on ? prev.filter((x) => x !== l.id) : [...prev, l.id],
                    )
                  }
                  className={`rounded-full px-3 py-1 text-xs border transition-colors ${
                    on
                      ? 'border-accent-400 bg-accent-500/20 text-ink-100'
                      : 'border-white/10 text-ink-400'
                  }`}
                >
                  {l.name}
                </button>
              )
            })}
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy || selectedLibs.length === 0}
          className="rounded-lg bg-accent-500 hover:bg-accent-400 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white active:scale-[0.98] transition-all"
        >
          {busy ? 'Creating…' : 'Create invite'}
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {invites === null && <p className="text-xs text-ink-400">Loading…</p>}
        {invites?.length === 0 && <p className="text-xs text-ink-400">No invites yet.</p>}
        {invites?.map((inv) => {
          const urls = inviteShareUrls(inv.code)
          return (
            <div
              key={inv.id}
              className="rounded-xl border border-white/5 bg-ink-950/40 px-4 py-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono font-semibold text-ink-100">{inv.code}</span>
                  <span
                    className={`ml-2 text-[10px] uppercase tracking-wider ${
                      inv.status === 'pending'
                        ? 'text-accent-400'
                        : inv.status === 'used'
                          ? 'text-ink-400'
                          : 'text-red-400'
                    }`}
                  >
                    {inv.status}
                  </span>
                  {inv.label && (
                    <span className="ml-2 text-xs text-ink-400">{inv.label}</span>
                  )}
                </div>
                {inv.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => revoke(inv.id, inv.code)}
                    className="text-xs text-ink-400 hover:text-red-400"
                  >
                    Revoke
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-ink-400 truncate">
                {inv.libraries.join(' · ') || 'No libraries'}
              </p>
              {inv.status === 'pending' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copy(urls.funnel, 'Funnel link')}
                    className="rounded-lg bg-ink-800 border border-white/10 px-2.5 py-1 text-[11px] text-ink-200 hover:border-accent-500/50"
                  >
                    Copy Funnel link
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(urls.lan, 'LAN link')}
                    className="rounded-lg bg-ink-800 border border-white/10 px-2.5 py-1 text-[11px] text-ink-200 hover:border-accent-500/50"
                  >
                    Copy LAN link
                  </button>
                  <button
                    type="button"
                    onClick={() => setQrFor((q) => (q === inv.id ? null : inv.id))}
                    className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors ${
                      qrFor === inv.id
                        ? 'bg-accent-500 text-white'
                        : 'bg-ink-800 border border-white/10 text-ink-200 hover:border-accent-500/50'
                    }`}
                  >
                    QR
                  </button>
                </div>
              )}
              {qrFor === inv.id && inv.status === 'pending' && <InviteQr url={urls.funnel} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
