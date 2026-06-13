import { useState } from 'react'
import { BITRATE_OPTIONS, getPrefs, setPrefs, type Prefs } from '../lib/settings'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/Toast'

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

export default function SettingsPage() {
  const { session } = useAuth()
  const toast = useToast()
  const [prefs, setLocal] = useState<Prefs>(getPrefs())

  const update = (patch: Partial<Prefs>) => {
    const next = setPrefs(patch)
    setLocal(next)
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
    </div>
  )
}
