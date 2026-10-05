import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SelectMenu } from '../components/Menu'
import { IS_TV, TOUCH_UI } from '../lib/device'
import { requestTiltPermission } from '../lib/depth'
import { BITRATE_OPTIONS, PREVIEW_QUALITY_OPTIONS, UI_SCALE_OPTIONS, applyUiScale, getPrefs, setPrefs, type Prefs } from '../lib/settings'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'
import { createUser, ApiError, setAccentPref, setPreviewQualityPref } from '../api/client'
import { ACCENT_PRESETS, applyAccent, getStoredAccent, setStoredAccent } from '../lib/accent'
import { currentVersion } from '../lib/webosUpdate'
import { applyClientUpdate, beginServerUpdate, useClientUpdate, useServerRun, useServerUpdate } from '../lib/appUpdate'
import { SparkIcon } from '../components/Update'
import { playSelect, playNav } from '../lib/sound'
import { useFinesse } from '../lib/finesseServer'
import { DONATE_URL, PROJECT_URL } from '../lib/project'
import SystemPanel, { TvServerAddress } from './settings/SystemPanel'
import GroupsAdmin from './settings/GroupsAdmin'
import { StreamingSettings } from './settings/StreamingAdmin'
import {
  createInvite,
  deleteInvite,
  emailInvite,
  getServerUpdate,
  inviteShareUrls,
  listInviteLibraries,
  listInvites,
  InviteError,
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
        className="mt-3 rounded-lg bg-accent-fill hover:brightness-110 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white active:scale-[0.98] transition-all"
      >
        {busy ? 'Creating…' : 'Create account'}
      </button>
    </form>
  )
}

type Scope = 'device' | 'account'

/** "This device" / "Your account": what follows you, and what stays put. */
function ScopeTag({ scope }: { scope: Scope }) {
  return (
    <span className={`mt-1 inline-block text-[11px] font-semibold ${scope === 'account' ? 'text-accent-300' : 'text-ink-400'}`}>
      {scope === 'account' ? 'Your account · syncs everywhere' : 'This device'}
    </span>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  scope,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  scope?: Scope
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-4 py-3.5 text-left"
    >
      <span>
        <span className="block text-sm font-semibold text-white">{label}</span>
        {hint && <span className="block text-[13px] leading-snug text-ink-400 mt-0.5">{hint}</span>}
        {scope && <ScopeTag scope={scope} />}
      </span>
      <span
        className={`shrink-0 h-7 w-12 rounded-full p-1 transition-colors ${
          checked ? 'bg-accent-fill' : 'bg-ink-700'
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

/** A labelled setting with a control underneath (menus, swatches, sliders). */
function Field({ label, hint, scope, children }: { label: string; hint?: string; scope?: Scope; children: ReactNode }) {
  return (
    <div className="py-4">
      <p className="text-sm font-semibold text-white">{label}</p>
      {hint && <p className="text-[13px] leading-snug text-ink-400 mt-0.5">{hint}</p>}
      {scope && <ScopeTag scope={scope} />}
      <div className="mt-3">{children}</div>
    </div>
  )
}

const WIDE_TRIGGER =
  'w-full sm:w-80 flex items-center justify-between gap-3 h-10 rounded-lg bg-ink-800 border border-white/10 px-3 text-sm text-ink-200 hover:border-white/20 transition-colors'

const SECTION_CARD = 'rounded-2xl bg-ink-900/60 border border-white/5 px-5 divide-y divide-white/5'

/** The accent, live, on the parts it actually colours. */
function AccentPreview() {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-ink-950/60 border border-white/5 p-4">
      <div className="relative h-24 w-16 shrink-0 rounded-lg bg-ink-700 ring-2 ring-accent-400 ring-offset-2 ring-offset-ink-950 overflow-hidden">
        <div className="absolute bottom-0 inset-x-0 h-1 bg-black/50">
          <div className="h-full w-3/5 bg-accent-400" />
        </div>
      </div>
      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex h-8 items-center rounded-lg bg-white px-3 text-xs font-semibold text-ink-950">Resume</span>
          <span className="inline-flex h-8 items-center rounded-lg bg-accent-fill px-3 text-xs font-semibold text-white">Request</span>
          <span className="inline-flex h-8 items-center rounded-full bg-accent-500/15 border border-accent-400/50 px-3 text-xs text-accent-300">Genre: Mystery</span>
        </div>
        <p className="text-xs text-ink-400">
          Focus rings, progress, links like <span className="text-accent-300 font-semibold">See all</span>, and filled buttons.
        </p>
      </div>
    </div>
  )
}

/** This device's version (web: reloads into what the NAS serves; TV: pulls its
 *  OTA bundle from GitHub) and, for admins, the server's (installs the latest
 *  GitHub release on the NAS). See lib/appUpdate. */
function UpdatesSection({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast()
  const client = useClientUpdate()
  const server = useServerUpdate()
  const run = useServerRun()
  const [busy, setBusy] = useState(false)
  const running = __WEBOS__ ? currentVersion() : __APP_VERSION__
  const ready = client.data

  const queryClient = useQueryClient()
  const check = async () => {
    // "This app" only compares this browser with what the server serves. An admin
    // also needs to hear about a release the server hasn't installed yet.
    const [r, s] = await Promise.all([
      client.refetch(),
      isAdmin && !__WEBOS__ ? getServerUpdate(true).catch(() => null) : Promise.resolve(null),
    ])
    if (s) queryClient.setQueryData(['serverUpdate'], s)
    if (r.error) toast(r.error instanceof Error ? r.error.message : 'Couldn’t check for updates', 'error')
    else if (r.data) return
    else if (s?.available && s.latest) toast(`Finesse ${s.latest} is out — update the server just below`)
    // The server couldn't ask GitHub: say so, rather than "latest" on a guess.
    else if (s?.error) toast(`Couldn’t check for a new Finesse: ${s.error}`, 'error')
    else toast('You’re on the latest version')
  }
  const install = async () => {
    if (!ready) return
    setBusy(true)
    try {
      await applyClientUpdate(ready)
    } catch (e) {
      setBusy(false)
      toast(e instanceof Error ? e.message : 'Update failed', 'error')
    }
  }

  const btn =
    'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-50'
  const primary = `${btn} bg-accent-fill text-white hover:brightness-110`
  const secondary = `${btn} bg-white/10 border border-white/15 text-white hover:bg-white/15`
  const s = server.data
  const noEndpoint = server.error instanceof InviteError && server.error.status === 404

  return (
    <div className={SECTION_CARD}>
      <div className="py-4">
        <p className="text-sm font-semibold text-white">{__WEBOS__ ? 'This TV' : 'This app'}</p>
        <p className="text-[13px] text-ink-400 mt-0.5">
          Version <span className="font-mono text-ink-200">{running}</span>
          {' · '}
          {client.isFetching
            ? 'checking…'
            : ready
              ? <span className="text-accent-300 font-semibold">Finesse {ready.version} is ready</span>
              : client.isError
                ? 'couldn’t check'
                : 'up to date'}
        </p>
        <div className="mt-3">
          {ready ? (
            <button type="button" onClick={install} disabled={busy} className={primary}>
              <SparkIcon />
              {busy ? (ready.kind === 'ota' ? 'Downloading…' : 'Updating…') : `Update to ${ready.version}`}
            </button>
          ) : (
            <button type="button" onClick={check} disabled={client.isFetching} className={secondary}>
              {client.isFetching ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </div>
      </div>

      {isAdmin && !__WEBOS__ && (
        <div className="py-4">
          <p className="text-sm font-semibold text-white">Server</p>
          {noEndpoint ? (
            <p className="text-[13px] leading-snug text-ink-400 mt-0.5">
              One-time setup: copy the new invite service to the NAS and restart it (see “One-time setup” in
              deploy/README.md). After that, updates install from here.
            </p>
          ) : server.isError ? (
            <p className="text-[13px] text-ink-400 mt-0.5">
              {server.error instanceof Error ? server.error.message : 'Couldn’t reach the update service'}
            </p>
          ) : (
            <>
              <p className="text-[13px] text-ink-400 mt-0.5">
                Serving <span className="font-mono text-ink-200">{s?.current ?? (s ? 'an older build' : '…')}</span>
                {s?.latest && (
                  <>
                    {' · latest release '}
                    <span className="font-mono text-ink-200">{s.latest}</span>
                  </>
                )}
                {s?.error && ` · ${s.error}`}
              </p>
              {s?.available && s.notes && (
                <p className="mt-2 text-[13px] leading-relaxed text-ink-300 whitespace-pre-line line-clamp-4">{s.notes}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {s?.available ? (
                  <button
                    type="button"
                    onClick={() => void beginServerUpdate(s.latest, s.kind)}
                    disabled={run.phase === 'running'}
                    className={primary}
                  >
                    <SparkIcon />
                    Update everyone to {s.latest}
                  </button>
                ) : (
                  <button type="button" onClick={() => void server.refetch()} disabled={server.isFetching} className={secondary}>
                    {server.isFetching ? 'Checking…' : 'Check GitHub'}
                  </button>
                )}
              </div>
              <p className="mt-2 text-[12px] text-ink-400">
                Installs the latest GitHub release on the NAS. Everyone gets an “Update” button; TVs update themselves.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const SECTIONS = [
  { id: 'playback', label: 'Playback' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'sound', label: 'Sound' },
  { id: 'account', label: 'Account' },
] as const

export default function SettingsPage() {
  const { session, logout } = useAuth()
  const toast = useToast()
  const [prefs, setLocal] = useState<Prefs>(getPrefs())
  const [accent, setAccent] = useState(getStoredAccent())
  const [active, setActive] = useState<string>('playback')

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

  const sections = [
    ...SECTIONS,
    { id: 'updates', label: 'Updates' },
    { id: 'about', label: 'About' },
    ...(session?.isAdmin ? [{ id: 'server', label: 'Server' }] : []),
  ]

  // Highlight the section you're reading.
  useEffect(() => {
    const els = sections.map((x) => document.getElementById(`settings-${x.id}`)).filter((e): e is HTMLElement => !!e)
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id.replace('settings-', ''))
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections.length])

  const jump = (id: string) => {
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(id)
  }

  const heading = (id: string, title: string, extra?: ReactNode) => (
    <div className="flex items-center gap-2 mb-3">
      <h2 id={`settings-${id}-title`} className="text-lg font-semibold text-white tracking-tight">{title}</h2>
      {extra}
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-12 py-8">
      <h1 className="page-title mb-6">Settings</h1>

      <div className="lg:grid lg:grid-cols-[13rem_1fr] lg:gap-10">
        {/* Section nav: a sticky sidebar on desktop, a chip row on phones */}
        <nav aria-label="Settings sections" className="lg:sticky lg:top-24 lg:self-start mb-6 lg:mb-0">
          <div className="flex lg:flex-col gap-1.5 overflow-x-auto no-scrollbar">
            {sections.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => jump(x.id)}
                aria-current={active === x.id ? 'true' : undefined}
                className={`shrink-0 flex items-center gap-2 h-9 lg:h-10 px-3.5 rounded-full lg:rounded-lg text-sm text-left transition-colors ${
                  active === x.id ? 'bg-white/10 text-white font-semibold' : 'text-ink-300 hover:text-white font-medium'
                }`}
              >
                {x.label}
                {x.id === 'server' && (
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">Admin</span>
                )}
              </button>
            ))}
          </div>
        </nav>

        <div className="space-y-10 min-w-0">
          <section id="settings-playback" aria-labelledby="settings-playback-title" className="scroll-mt-24">
            {heading('playback', 'Playback')}
            <div className={SECTION_CARD}>
              <Field
                label="Maximum streaming quality"
                hint="Caps what the server transcodes to. Lower it when you're watching away from home. On Auto, music plays in its original quality (lossless included)."
                scope="device"
              >
                <SelectMenu
                  label="Maximum streaming quality"
                  value={prefs.maxBitrate}
                  options={BITRATE_OPTIONS}
                  onChange={(v) => {
                    update({ maxBitrate: v })
                    toast('Quality preference saved')
                  }}
                  triggerClassName={WIDE_TRIGGER}
                />
              </Field>
              <Toggle
                label="Subtitles on by default"
                hint="Turn on the first subtitle track when there is one."
                checked={prefs.subtitlesDefault}
                onChange={(v) => update({ subtitlesDefault: v })}
                scope="device"
              />
              <Toggle
                label="Auto-play next episode"
                hint="Start the next episode when one ends."
                checked={prefs.autoPlayNext}
                onChange={(v) => update({ autoPlayNext: v })}
                scope="device"
              />
              {!IS_TV && (
                <Toggle
                  label="Ambient glow"
                  hint="The scene's colors softly fill the black bars around the picture."
                  checked={prefs.ambient}
                  onChange={(v) => update({ ambient: v })}
                  scope="device"
                />
              )}
            </div>
          </section>

          <section id="settings-appearance" aria-labelledby="settings-appearance-title" className="scroll-mt-24">
            {heading('appearance', 'Appearance')}
            <div className={SECTION_CARD}>
              <Field label="Accent color" scope="account">
                <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-3">
                  {ACCENT_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      role="radio"
                      aria-checked={accent === p.name}
                      onClick={() => chooseAccent(p.name)}
                      title={p.label}
                      aria-label={p.label}
                      className={`h-10 w-10 rounded-full transition-transform hover:scale-110 active:scale-95 ring-2 ring-offset-2 ring-offset-ink-900 ${
                        accent === p.name ? 'ring-white' : 'ring-transparent'
                      }`}
                      style={{ backgroundColor: p.shades[500] }}
                    >
                      {accent === p.name && (
                        <svg className="h-5 w-5 mx-auto text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
                <div className="mt-4">
                  <AccentPreview />
                </div>
              </Field>
              <Field label="Display size" hint="Scale everything up for couch distance." scope="device">
                <SelectMenu
                  label="Display size"
                  value={prefs.uiScale}
                  options={UI_SCALE_OPTIONS}
                  onChange={(v) => {
                    update({ uiScale: v })
                    applyUiScale(v)
                    toast('Display size updated')
                  }}
                  triggerClassName={WIDE_TRIGGER}
                />
              </Field>
              <Field label="Preview quality" hint="Resolution of hover and detail previews. Higher looks sharper but uses more bandwidth." scope="account">
                <SelectMenu
                  label="Preview quality"
                  value={prefs.previewQuality}
                  options={PREVIEW_QUALITY_OPTIONS}
                  onChange={(v) => {
                    update({ previewQuality: v })
                    setPreviewQualityPref(v).catch(() => {})
                    toast('Preview quality saved')
                  }}
                  triggerClassName={WIDE_TRIGGER}
                />
              </Field>
              <Toggle
                label="Screensaver"
                hint="When idle, library art drifts by with a clock. Any input dismisses it; never during playback."
                checked={prefs.screensaver}
                onChange={(v) => update({ screensaver: v })}
                scope="device"
              />
              {TOUCH_UI && (
                <Toggle
                  label="Tilt parallax"
                  hint="Tilt your phone and the artwork shifts in depth (your phone may ask for motion access)."
                  checked={prefs.tiltParallax}
                  onChange={async (v) => {
                    if (v && !(await requestTiltPermission())) return
                    update({ tiltParallax: v })
                  }}
                  scope="device"
                />
              )}
            </div>
          </section>

          <section id="settings-sound" aria-labelledby="settings-sound-title" className="scroll-mt-24">
            {heading('sound', 'Sound')}
            <div className={SECTION_CARD}>
              <Toggle
                label="Interface sounds"
                hint="A soft note as you move around, pitched by the poster's color, and a confirm on select. Silent while something plays."
                checked={prefs.uiSounds}
                onChange={(v) => {
                  update({ uiSounds: v })
                  if (v) playSelect()
                }}
                scope="device"
              />
              {prefs.uiSounds && (
                <>
                  <Field label="Sound volume" hint="Drag to hear the level.">
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
                      className="w-full sm:w-80 accent-accent-500 cursor-pointer"
                      aria-label="Interface sound volume"
                    />
                  </Field>
                  <Toggle
                    label="Sound on mouse hover"
                    hint="Also play the nav note when your mouse passes over cards, not just with the keyboard or remote."
                    checked={prefs.uiSoundsHover}
                    onChange={(v) => update({ uiSoundsHover: v })}
                    scope="device"
                  />
                </>
              )}
              <Toggle
                label="Preview sound"
                hint="Play audio on hover previews. Only one plays at a time."
                checked={prefs.previewSound}
                onChange={(v) => update({ previewSound: v })}
                scope="device"
              />
              <Toggle
                label="Thumbnail previews"
                hint="When a title has no preview clip, hovering its card flips through its scrub thumbnails instead."
                checked={prefs.thumbPreviews}
                onChange={(v) => update({ thumbPreviews: v })}
                scope="device"
              />
              <Toggle
                label="Find lyrics online"
                hint="When a song in your library has no lyrics, look up synced ones on LRCLIB (sends only the song, artist, album and length)."
                checked={prefs.onlineLyrics}
                onChange={(v) => update({ onlineLyrics: v })}
                scope="device"
              />
            </div>
          </section>

          <section id="settings-account" aria-labelledby="settings-account-title" className="scroll-mt-24">
            {heading('account', 'Account')}
            <div className="rounded-2xl bg-ink-900/60 border border-white/5 px-5 py-4 text-sm">
              <div className="flex justify-between gap-4 py-1.5">
                <span className="text-ink-400">Signed in as</span>
                <span className="text-ink-200 font-medium">{session?.userName}</span>
              </div>
              <div className="flex justify-between gap-4 py-1.5">
                <span className="text-ink-400">Server</span>
                <span className="text-ink-200 font-mono text-xs break-all text-right">{session?.server}</span>
              </div>
              <button
                type="button"
                onClick={logout}
                className="mt-3 inline-flex h-10 items-center rounded-lg bg-white/10 border border-white/15 px-4 text-sm font-semibold text-white hover:bg-white/15 transition-colors"
              >
                Switch profile / sign out
              </button>
            </div>
            {/* TV app: anyone can point it at a different server, not just admins. */}
            <TvServerAddress className="mt-3" />
          </section>

          <section id="settings-updates" aria-labelledby="settings-updates-title" className="scroll-mt-24">
            {heading('updates', 'Updates')}
            <UpdatesSection isAdmin={!!session?.isAdmin} />
          </section>

          <section id="settings-about" aria-labelledby="settings-about-title" className="scroll-mt-24">
            {heading('about', 'About')}
            <AboutSection />
          </section>

          {session?.isAdmin && (
            <section id="settings-server" aria-labelledby="settings-server-title" className="scroll-mt-24">
              {heading(
                'server',
                'Server',
                <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">Admin</span>,
              )}
              <p className="text-sm text-ink-400 mb-3">Apps, people and invites for everyone on this server.</p>
              <div className="space-y-8">
                <SystemPanel />
                <GroupsAdmin />
                <StreamingSettings />
                <div className="rounded-2xl bg-ink-900/60 border border-white/5 px-5 py-4 space-y-8">
                  <CreateUserForm />
                  <div className="border-t border-white/5 pt-6">
                    <InvitesAdmin />
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

/** About Finesse, and a way to support it. On a TV (which can't open links)
 *  "Support Finesse" shows a QR code to scan with a phone instead. */
function AboutSection() {
  const [qr, setQr] = useState(false)
  const btn = 'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors'
  const primary = `${btn} bg-accent-fill text-white hover:brightness-110`
  const secondary = `${btn} bg-white/10 border border-white/15 text-white hover:bg-white/15`
  const heart = (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.5 1.1 4.2 2.3h2c.7-1.2 2.1-2.3 4.2-2.3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" />
    </svg>
  )
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-[15px] font-semibold text-white">Finesse is free and open source.</p>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-300">
        It’s made in spare time. If it makes movie night better, you can chip in to keep it going.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {DONATE_URL &&
          (IS_TV ? (
            <button type="button" onClick={() => setQr((v) => !v)} className={primary}>
              {heart} Support Finesse
            </button>
          ) : (
            <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" className={primary}>
              {heart} Support Finesse
            </a>
          ))}
        {!IS_TV && (
          <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer" className={secondary}>
            Source code
          </a>
        )}
      </div>
      {IS_TV && qr && DONATE_URL && (
        <div>
          <InviteQr url={DONATE_URL} />
          <p className="mt-2 text-xs text-ink-400">Scan with your phone’s camera.</p>
        </div>
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
  const { info: finesse } = useFinesse()
  const [emailFor, setEmailFor] = useState<number | null>(null)
  const [emailTo, setEmailTo] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const canEmail = Boolean(finesse?.features.email)

  const sendEmail = async (inv: InviteAdmin) => {
    setEmailBusy(true)
    try {
      const r = await emailInvite(inv.code, emailTo.trim())
      toast(`Invite sent to ${r.to}`)
      setEmailFor(null)
      setEmailTo('')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send the email', 'error')
    } finally {
      setEmailBusy(false)
    }
  }

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
        Share a link{canEmail ? ' or send an email' : ''} — they create their own account and land in the app.
        {!finesse?.publicUrl && ' Links use this address; set a public address in Settings → Server to invite people away from home.'}
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
                  ? 'bg-[#f5f3ee] text-ink-950'
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
          className="rounded-lg bg-accent-fill hover:brightness-110 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white active:scale-[0.98] transition-all"
        >
          {busy ? 'Creating…' : 'Create invite'}
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {invites === null && <p className="text-xs text-ink-400">Loading…</p>}
        {invites?.length === 0 && <p className="text-xs text-ink-400">No invites yet.</p>}
        {invites?.map((inv) => {
          const urls = inviteShareUrls(inv.code, finesse?.publicUrl)
          const link = urls.public ?? urls.home
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
                    onClick={() => copy(link, 'invite link')}
                    className="rounded-lg bg-ink-800 border border-white/10 px-2.5 py-1 text-[11px] text-ink-200 hover:border-accent-500/50"
                  >
                    Copy link
                  </button>
                  {urls.public && urls.public !== urls.home && (
                    <button
                      type="button"
                      onClick={() => copy(urls.home, 'home link')}
                      className="rounded-lg bg-ink-800 border border-white/10 px-2.5 py-1 text-[11px] text-ink-200 hover:border-accent-500/50"
                    >
                      Copy home link
                    </button>
                  )}
                  {canEmail && (
                    <button
                      type="button"
                      onClick={() => setEmailFor((q) => (q === inv.id ? null : inv.id))}
                      className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors ${
                        emailFor === inv.id ? 'bg-[#f5f3ee] text-ink-950' : 'bg-ink-800 border border-white/10 text-ink-200 hover:border-accent-500/50'
                      }`}
                    >
                      Email
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setQrFor((q) => (q === inv.id ? null : inv.id))}
                    className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors ${
                      qrFor === inv.id
                        ? 'bg-[#f5f3ee] text-ink-950'
                        : 'bg-ink-800 border border-white/10 text-ink-200 hover:border-accent-500/50'
                    }`}
                  >
                    QR
                  </button>
                </div>
              )}
              {emailFor === inv.id && inv.status === 'pending' && (
                <form
                  className="mt-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void sendEmail(inv)
                  }}
                >
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    placeholder="friend@example.com"
                    autoFocus
                    className={inputClass}
                  />
                  <button type="submit" disabled={emailBusy || !emailTo.includes('@')} className="shrink-0 rounded-lg bg-accent-fill px-3 text-xs font-semibold text-white disabled:opacity-50">
                    {emailBusy ? 'Sending…' : 'Send'}
                  </button>
                </form>
              )}
              {qrFor === inv.id && inv.status === 'pending' && <InviteQr url={link} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
