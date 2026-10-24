// "Use the apps I already have": Finesse looks for them, shows what it found, asks only for what
// it can't read itself (a Jellyfin administrator's sign-in, qBittorrent's password, a key it
// couldn't find), checks everything, and connects. Nothing of the person's apps changes.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { setupApi, type ExistingEntry, type ExistingFound, type ExistingId, type ExistingScan } from '../../api/setup'
import { Callout, GhostButton, PrimaryButton, Spinner, StatusDot, TextField } from './ui'

const ORDER: ExistingId[] = ['jellyfin', 'sonarr', 'radarr', 'lidarr', 'prowlarr', 'sabnzbd', 'qbittorrent']

const ROLE: Record<ExistingId, string> = {
  jellyfin: 'Your library and streaming',
  sonarr: 'TV shows',
  radarr: 'Movies',
  lidarr: 'Music',
  prowlarr: 'Search sites',
  sabnzbd: 'Usenet downloads',
  qbittorrent: 'Torrent downloads',
}

const PORT: Record<ExistingId, number> = { jellyfin: 8096, sonarr: 8989, radarr: 7878, lidarr: 8686, prowlarr: 9696, sabnzbd: 8080, qbittorrent: 8080 }

const KEY_HINT: Partial<Record<ExistingId, string>> = {
  sonarr: 'In Sonarr: Settings → General → API Key',
  radarr: 'In Radarr: Settings → General → API Key',
  lidarr: 'In Lidarr: Settings → General → API Key',
  prowlarr: 'In Prowlarr: Settings → General → API Key',
  sabnzbd: 'In SABnzbd: Config → General → API Key',
}

interface Row extends ExistingEntry {
  use: boolean
  /** Fields open (to correct a find, or to add one that wasn't found). */
  editing: boolean
  /** The last check or connect result for this app. */
  result?: { ok: boolean; message: string }
  checking?: boolean
}

export default function ExistingSetup({ onBack, onConnected }: { onBack: () => void; onConnected: (admin: { username: string; password: string }, connected: { name: string; version?: string }[]) => void }) {
  const [scan, setScan] = useState<ExistingScan | null>(null)
  const [scanning, setScanning] = useState(true)
  const [scanError, setScanError] = useState('')
  const [rows, setRows] = useState<Record<ExistingId, Row>>({} as Record<ExistingId, Row>)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  const look = useCallback(async () => {
    setScanning(true)
    setScanError('')
    setError('')
    try {
      const s = await setupApi.existingScan()
      setScan(s)
      setRows((prev) => {
        const next = {} as Record<ExistingId, Row>
        for (const f of s.apps) {
          const old = prev[f.id]
          next[f.id] = {
            use: f.id === 'jellyfin' || f.state !== 'not-found' ? (old?.use ?? true) : (old?.use ?? false),
            // Fields open where something's missing; Jellyfin is required, so not finding it opens its fields too.
            editing: f.state === 'needs-key' || f.state === 'unreachable' || f.state === 'stopped' || (f.id === 'jellyfin' && f.state === 'not-found') || (old?.editing ?? false),
            url: f.url ?? old?.url ?? '',
            apiKey: old?.apiKey ?? '',
            username: old?.username || f.username || '',
            password: old?.password ?? '',
          }
        }
        return next
      })
    } catch (e) {
      setScanError((e as Error).message || 'Couldn’t look for your apps')
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void look()
  }, [look])

  const found = useMemo(() => Object.fromEntries((scan?.apps ?? []).map((a) => [a.id, a])) as Partial<Record<ExistingId, ExistingFound>>, [scan])
  const set = (id: ExistingId, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id]!, ...patch, result: 'result' in patch ? patch.result : undefined } }))

  const entry = (id: ExistingId): ExistingEntry => {
    const r = rows[id]!
    const f = found[id]
    const e: ExistingEntry = {}
    if (r.url && r.url !== f?.url) e.url = r.url
    else if (f?.url) e.url = f.url
    if (r.apiKey) e.apiKey = r.apiKey
    if (r.username) e.username = r.username
    if (r.password) e.password = r.password
    return e
  }

  const check = async (id: ExistingId) => {
    set(id, { checking: true })
    try {
      const v = await setupApi.existingCheck({ id, ...entry(id) })
      setRows((r) => ({ ...r, [id]: { ...r[id]!, checking: false, result: { ok: v.ok, message: v.message }, ...(v.ok && v.url ? { url: v.url } : {}) } }))
    } catch (e) {
      setRows((r) => ({ ...r, [id]: { ...r[id]!, checking: false, result: { ok: false, message: (e as Error).message } } }))
    }
  }

  const jf = rows.jellyfin
  const missing = !jf || !(jf.url || found.jellyfin?.url) ? 'Enter your Jellyfin’s address' : !jf.username || !jf.password ? 'Sign in with your Jellyfin administrator account' : ''

  const go = async () => {
    setError('')
    setConnecting(true)
    try {
      const body: Partial<Record<ExistingId, ExistingEntry & { skip?: boolean }>> = {}
      for (const id of ORDER) if (rows[id]) body[id] = rows[id]!.use ? entry(id) : { skip: true }
      const r = await setupApi.existingConnect(body)
      setRows((prev) => {
        const next = { ...prev }
        for (const id of ORDER) {
          const v = r.results[id]
          if (v && next[id]) next[id] = { ...next[id]!, result: { ok: v.ok, message: v.message }, editing: next[id]!.editing || !v.ok }
        }
        return next
      })
      if (!r.ok) {
        setError('Some apps didn’t connect. Fix what’s marked below, or untick an app to leave it out.')
        return
      }
      onConnected(
        { username: jf!.username!, password: jf!.password! },
        ORDER.filter((id) => r.results[id]?.ok).map((id) => ({ name: found[id]?.name ?? id, version: r.results[id]?.version })),
      )
    } catch (e) {
      setError((e as Error).message || 'Couldn’t connect')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <h1 tabIndex={-1} className="font-display text-4xl text-white outline-none sm:text-5xl">
        Use the apps you already have
      </h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-300">
        Finesse connects to your Jellyfin and download apps and becomes the app everyone uses. Your apps, their settings and your
        libraries stay exactly as they are.
      </p>

      {scanning && !scan ? (
        <div className="mt-10 flex items-center gap-3 text-[15px] text-ink-200" role="status">
          <Spinner className="h-5 w-5 text-accent-300" />
          Looking for your apps… this takes a few seconds.
        </div>
      ) : scanError ? (
        <div className="mt-8 space-y-4">
          <Callout tone="error" title="Couldn’t look for your apps">
            {scanError}
          </Callout>
          <GhostButton onClick={() => void look()}>Try again</GhostButton>
        </div>
      ) : (
        <>
          <p className="mt-6 text-[13px] text-ink-400">
            {(() => {
              const n = (scan?.apps ?? []).filter((a) => a.state !== 'not-found').length
              return n ? `Found ${n} of your apps` : 'Didn’t find any apps automatically'
            })()}
            {scan?.looked.length ? ` ${scan.looked.join(' and ')}` : ''}.{' '}
            <button type="button" className="font-semibold text-accent-300 hover:text-accent-200" onClick={() => void look()} disabled={scanning}>
              {scanning ? 'Looking…' : 'Look again'}
            </button>
          </p>

          <ul className="mt-4 space-y-3">
            {ORDER.map((id) => {
              const f = found[id]
              const r = rows[id]
              if (!f || !r) return null
              return <AppRow key={id} id={id} f={f} r={r} set={(p) => set(id, p)} check={() => void check(id)} />
            })}
          </ul>

          {error && (
            <div className="mt-6">
              <Callout tone="error">{error}</Callout>
            </div>
          )}

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <GhostButton onClick={onBack}>Back</GhostButton>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <PrimaryButton onClick={() => void go()} disabled={Boolean(missing) || scanning} busy={connecting}>
                {connecting ? 'Checking and connecting…' : 'Connect'}
              </PrimaryButton>
              {missing && <p className="text-[12.5px] text-ink-400">{missing}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function AppRow({ id, f, r, set, check }: { id: ExistingId; f: ExistingFound; r: Row; set: (p: Partial<Row>) => void; check: () => void }) {
  const isJf = id === 'jellyfin'
  const isQbit = id === 'qbittorrent'
  const ready = f.state === 'ready' && !r.editing
  const notFound = f.state === 'not-found'
  const status: boolean | null = r.result ? r.result.ok : f.state === 'ready' ? true : notFound ? null : f.state === 'needs-login' ? null : false
  const line = r.result?.message ?? (f.state === 'ready' ? `${f.where ? `${cap(f.where)} · ` : ''}${f.message}` : f.message)
  const showFields = r.use && (r.editing || f.state === 'needs-login' || (isJf && notFound))
  const needsLogin = isJf || isQbit
  return (
    <li className={`rounded-2xl border p-4 transition-colors sm:p-5 ${r.use ? 'border-white/10 bg-white/[0.04]' : 'border-white/[0.06] bg-transparent'}`}>
      <div className="flex items-start gap-3">
        <label className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center ${isJf ? 'cursor-default' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            className="h-4 w-4 accent-[rgb(117,137,216)]"
            checked={r.use}
            disabled={isJf}
            aria-label={`Use ${f.name} with Finesse`}
            onChange={(e) => set({ use: e.target.checked, editing: e.target.checked && notFound ? true : r.editing })}
          />
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[15.5px] font-semibold text-white">{f.name}</span>
            <span className="text-[12.5px] text-ink-400">{ROLE[id]}</span>
            {f.version && <span className="text-[12px] text-ink-400">· {f.version.replace(/^v/, 'v')}</span>}
          </div>
          {r.use || !notFound ? (
            <div className="mt-1 flex items-start gap-2 text-[13px] leading-relaxed text-ink-300">
              <span className="mt-px shrink-0">
                <StatusDot ok={status} pending={r.checking} />
              </span>
              <span className="min-w-0">
                {line}
                {f.others ? ` (${f.others} more found; this one was picked)` : ''}
              </span>
            </div>
          ) : (
            <button type="button" className="mt-1 text-[13px] font-semibold text-accent-300 hover:text-accent-200" onClick={() => set({ use: true, editing: true })}>
              I have one: enter its address
            </button>
          )}
          {ready && r.use && (
            <button type="button" className="mt-1.5 text-[12.5px] text-ink-400 underline-offset-2 hover:text-white hover:underline" onClick={() => set({ editing: true })}>
              Change
            </button>
          )}

          {showFields && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(r.editing || !f.url) && (
                <div className="sm:col-span-2">
                  <TextField
                    label="Address"
                    value={r.url ?? ''}
                    onChange={(v) => set({ url: v })}
                    placeholder={`http://192.168.1.20:${PORT[id]}${id === 'sabnzbd' ? '/sabnzbd' : ''}`}
                    hint={f.url ? undefined : 'The address you open it at in your browser.'}
                    mono
                  />
                </div>
              )}
              {needsLogin ? (
                <>
                  <TextField
                    label={isJf ? 'Jellyfin administrator' : 'Web UI username'}
                    value={r.username ?? ''}
                    onChange={(v) => set({ username: v })}
                    autoComplete="username"
                    hint={isJf ? 'Finesse uses it once, to make its own key. It isn’t stored.' : undefined}
                  />
                  <TextField label="Password" type="password" value={r.password ?? ''} onChange={(v) => set({ password: v })} autoComplete={isJf ? 'current-password' : 'off'} />
                </>
              ) : (
                (r.editing || f.state !== 'ready') && (
                  <div className="sm:col-span-2">
                    <TextField label="API key" value={r.apiKey ?? ''} onChange={(v) => set({ apiKey: v.trim() })} mono hint={f.state === 'ready' && !r.apiKey ? 'Found in its settings. Paste one only to replace it.' : KEY_HINT[id]} />
                  </div>
                )
              )}
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={check}
                  disabled={r.checking}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.12] disabled:opacity-50"
                >
                  {r.checking && <Spinner className="h-3.5 w-3.5" />}
                  {r.checking ? 'Checking…' : 'Check'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
