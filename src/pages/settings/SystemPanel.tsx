// Settings → Server for a Finesse that runs the whole stack: how every app is
// doing, the VPN, disk space, backups, app updates, and the public address +
// email used for invites. Administrators only.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { mediaBrowserAuthHeader } from '../../api/client'
import { systemApi, type SystemStatus } from '../../api/setup'
import { useToast } from '../../components/Toast'
import { pushBackHandler } from '../../lib/back'
import { CONTENT_BASE, setContentOrigin } from '../../lib/contentOrigin'
import { useFinesse } from '../../lib/finesseServer'
import { SMTP_PRESETS } from '../setup/presets'
import { gb, Spinner, StatusDot, TextField, Toggle } from '../setup/ui'

const CARD = 'rounded-2xl bg-ink-900/60 border border-white/5'
const smallBtn = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12.5px] font-medium text-ink-200 hover:border-white/25 hover:text-white disabled:opacity-50 transition-colors'
const primaryBtn = 'inline-flex h-9 items-center gap-2 rounded-lg bg-accent-fill px-4 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50 transition'

const ago = (iso: string | null | undefined) => {
  if (!iso) return 'never'
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const STATE_TEXT: Record<string, string> = {
  running: 'Running',
  starting: 'Starting…',
  restarting: 'Restarting over and over',
  stopped: 'Stopped',
  paused: 'Paused',
  missing: 'Missing',
  unreachable: 'Not answering',
}

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function LogsDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    systemApi.logs(id, 400).then(setText, (e) => setText(String(e.message ?? e)))
    return pushBackHandler(() => {
      onClose()
      return true
    })
  }, [id, onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={`${name} logs`} className="fixed inset-0 z-[90] flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur" onClick={onClose}>
      <div className="flex max-h-[calc(var(--vh)*85)] w-full max-w-4xl flex-col rounded-2xl border border-white/10 bg-ink-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <p className="font-semibold text-white">{name} — recent log</p>
          <button type="button" onClick={onClose} className={smallBtn} autoFocus>
            Close
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-5 font-mono text-[11.5px] leading-relaxed text-ink-300 whitespace-pre-wrap break-all">{text ?? 'Loading…'}</pre>
      </div>
    </div>
  )
}

export default function SystemPanel() {
  const toast = useToast()
  const { info: finesse, refresh: refreshFinesse } = useFinesse()
  const [s, setS] = useState<SystemStatus | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [logs, setLogs] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async (refresh = false) => {
    try {
      setS(await systemApi.status(refresh))
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 30000)
    return () => clearInterval(t)
  }, [load])

  // Adding or removing Games: follow it closely, then let the menus catch up.
  const gamesJob = s?.games?.job.state
  const [sgdb, setSgdb] = useState('')
  const [armGames, setArmGames] = useState(false)
  useEffect(() => {
    if (gamesJob !== 'working') return
    const t = window.setInterval(() => void load(), 3000)
    return () => {
      clearInterval(t)
      refreshFinesse()
    }
  }, [gamesJob, load, refreshFinesse])

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await fn()
      toast(done)
      await load(true)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!finesse?.features.system) return null
  if (!s)
    return (
      <div className={`${CARD} p-5`}>
        {err ? <p className="text-sm text-red-300">{err}</p> : <div className="h-40 rounded-xl shimmer" />}
      </div>
    )

  const h = s.health
  const problems = h.services.filter((x) => !['running', 'starting', 'paused'].includes(x.state)).length + (h.vpn && !h.vpn.connected ? 1 : 0) + (h.docker ? 0 : 1)
  const pending = h.services.filter((x) => x.updatePending)

  return (
    <div className="space-y-7">
      {/* Summary */}
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-4 px-5 py-4`}>
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${problems ? 'bg-amber-300/15 text-amber-200' : 'bg-emerald-400/15 text-emerald-300'}`}>
            <StatusDot ok={problems ? null : true} />
          </span>
          <div>
            <p className="font-semibold text-white">{problems ? `${problems} thing${problems > 1 ? 's' : ''} need${problems > 1 ? '' : 's'} attention` : 'Everything is running'}</p>
            <p className="text-[12.5px] text-ink-400">
              Finesse {s.version} · checked {ago(h.checkedAt)} · repairs itself every minute
            </p>
          </div>
        </div>
        <button type="button" className={smallBtn} disabled={busy === 'refresh'} onClick={() => act('refresh', () => load(true), 'Checked')}>
          {busy === 'refresh' && <Spinner className="h-3 w-3" />}
          Check now
        </button>
      </div>

      {/* Apps */}
      <Block title="Apps">
        <ul className={`${CARD} divide-y divide-white/5`}>
          {h.services.map((svc) => {
            const ok = svc.state === 'running' ? true : svc.state === 'starting' || svc.state === 'paused' ? null : false
            return (
              <li key={svc.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <StatusDot ok={ok} pending={svc.state === 'starting'} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-white">
                    {svc.name}
                    <span className="ml-2 text-[12.5px] font-normal text-ink-400">{svc.role}</span>
                    {svc.updatePending && <span className="ml-2 rounded-full bg-accent-500/20 px-2 py-0.5 text-[10.5px] font-semibold text-accent-200">Update ready</span>}
                  </p>
                  <p className="truncate text-[12.5px] text-ink-400">
                    {STATE_TEXT[svc.state] ?? svc.state}
                    {svc.detail ? ` — ${svc.detail}` : svc.state === 'running' && svc.startedAt ? ` · since ${ago(svc.startedAt)}` : ''}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" className={smallBtn} onClick={() => setLogs({ id: svc.id, name: svc.name })}>
                    Logs
                  </button>
                  <button type="button" className={smallBtn} disabled={busy === svc.id} onClick={() => act(svc.id, () => systemApi.restart(svc.id), `${svc.name} restarted`)}>
                    {busy === svc.id && <Spinner className="h-3 w-3" />}
                    Restart
                  </button>
                  {svc.id !== 'jellyfin' &&
                    (svc.state === 'paused' ? (
                      <button type="button" className={smallBtn} disabled={busy === svc.id} onClick={() => act(svc.id, () => systemApi.start(svc.id), `${svc.name} started`)}>
                        Resume
                      </button>
                    ) : (
                      <button type="button" className={smallBtn} disabled={busy === svc.id} onClick={() => act(svc.id, () => systemApi.stop(svc.id), `${svc.name} paused`)}>
                        Pause
                      </button>
                    ))}
                </div>
              </li>
            )
          })}
        </ul>
      </Block>

      {/* VPN + storage */}
      <div className="grid gap-7 md:grid-cols-2">
        {h.vpn && (
          <Block title="VPN">
            <div className={`${CARD} flex items-start gap-3 px-5 py-4`}>
              <StatusDot ok={h.vpn.connected ? true : null} />
              <div>
                <p className="text-[14px] font-medium text-white">{h.vpn.connected ? 'Connected' : 'Not connected'}</p>
                <p className="text-[12.5px] leading-relaxed text-ink-400">
                  {h.vpn.connected ? `Torrents appear as ${h.vpn.publicIp}${h.vpn.country ? ` (${[h.vpn.city, h.vpn.country].filter(Boolean).join(', ')})` : ''}.` : `${h.vpn.error ?? ''} Torrents wait until it’s back — nothing goes around it.`}
                </p>
              </div>
            </div>
          </Block>
        )}
        <Block title="Storage">
          <div className={`${CARD} space-y-4 px-5 py-4`}>
            {h.disks.map((d) => {
              const used = 1 - d.free / d.total
              return (
                <div key={d.path}>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-white">{d.label}</span>
                    <span className="text-ink-400">
                      {gb(d.free)} free of {gb(d.total)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className={`h-full rounded-full ${used > 0.95 ? 'bg-red-400' : used > 0.85 ? 'bg-amber-300' : 'bg-accent-400'}`} style={{ width: `${Math.round(used * 100)}%` }} />
                  </div>
                  <p className="mt-1 truncate text-[11.5px] text-ink-400">{d.path}</p>
                </div>
              )
            })}
          </div>
        </Block>
      </div>

      {/* Updates */}
      <Block title="App updates">
        <div className={`${CARD} space-y-4 px-5 py-4`}>
          <Toggle
            checked={s.updates.auto}
            onChange={(v) => act('auto', () => systemApi.setAutoUpdates(v), v ? 'Apps will update overnight' : 'Automatic app updates off')}
            label="Update apps automatically"
            description="When a Finesse update brings newer tested versions of Jellyfin, Sonarr & co., install them between 3 and 6 am (after a backup)."
          />
          {pending.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
              <p className="flex-1 text-[13px] text-ink-300">Ready to update: {pending.map((p) => p.name).join(', ')}</p>
              <button type="button" className={primaryBtn} disabled={busy === 'apps'} onClick={() => act('apps', () => systemApi.updateApps(), 'Apps updated')}>
                {busy === 'apps' && <Spinner className="h-3.5 w-3.5" />}
                {busy === 'apps' ? 'Updating…' : 'Update now'}
              </button>
            </div>
          )}
        </div>
      </Block>

      {/* Preview clips */}
      {s.previews && (
        <Block title="Preview clips">
          <div className={`${CARD} space-y-3 px-5 py-4`}>
            <Toggle
              checked={s.previews.enabled}
              onChange={(v) => act('previews', () => systemApi.setPreviews(v), v ? 'Preview clips on' : 'Preview clips off')}
              label="Make preview clips"
              description="Short clips play when you hover a poster or open a title, and episodes get a “next time on…” teaser. Made quietly in the background at low priority."
            />
            {s.previews.enabled && s.previews.total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-3 text-[13px] text-ink-300">
                <span>{s.previews.pending > 0 ? `${s.previews.total - s.previews.pending} of ${s.previews.total} titles have clips — the rest are on the way.` : `All ${s.previews.total} titles have clips.`}</span>
                {s.previews.pending > 0 && (
                  <button type="button" className={smallBtn} disabled={busy === 'mkclips'} onClick={() => act('mkclips', () => systemApi.makePreviews(), 'Making clips in the background')}>
                    Make them now
                  </button>
                )}
              </div>
            )}
          </div>
        </Block>
      )}

      {/* Games (RomM) */}
      {s.games && (
        <Block title="Games">
          <div className={`${CARD} space-y-3 px-5 py-4`}>
            {s.games.job.state === 'working' ? (
              <p className="flex items-center gap-2 text-[13.5px] text-ink-200">
                <Spinner className="h-3.5 w-3.5" />
                {s.games.job.detail ?? 'Working…'}
              </p>
            ) : s.games.enabled ? (
              <>
                <p className="text-[14px] font-medium text-white">Games is on</p>
                <p className="text-[12.5px] leading-relaxed text-ink-400">
                  Put games you own in <code className="rounded bg-white/10 px-1 text-[12px]">{s.games.folder ?? '…/media/games/roms'}/snes</code>, one folder per system (nes, snes, gb, gba, n64, genesis, psx…). They appear under Games within a few minutes.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className={smallBtn}
                    disabled={busy === 'games'}
                    onClick={() => {
                      if (!armGames) {
                        setArmGames(true)
                        window.setTimeout(() => setArmGames(false), 4000)
                        return
                      }
                      setArmGames(false)
                      void act('games', () => systemApi.setGames(false), 'Removing Games — your game files stay where they are')
                    }}
                  >
                    {armGames ? 'Tap again to remove' : 'Remove Games'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[14px] font-medium text-white">Retro games, right in the browser</p>
                <p className="text-[12.5px] leading-relaxed text-ink-400">
                  Adds RomM to keep a library of games you own, from NES to PlayStation, that everyone can play in Finesse. Box art comes from free sources; a SteamGridDB key adds more.
                </p>
                <TextField label="SteamGridDB API key" optional mono value={sgdb} onChange={setSgdb} hint="Free: steamgriddb.com → Preferences → API." />
                <div className="flex justify-end">
                  <button type="button" className={primaryBtn} disabled={busy === 'games'} onClick={() => act('games', () => systemApi.setGames(true, sgdb.trim() || undefined), 'Adding Games — this takes a few minutes')}>
                    {busy === 'games' && <Spinner className="h-3.5 w-3.5" />}
                    Add Games
                  </button>
                </div>
              </>
            )}
            {s.games.job.state === 'error' && <p className="text-[12.5px] leading-relaxed text-red-300">{s.games.job.error}</p>}
          </div>
        </Block>
      )}

      {/* Backups */}
      <Block
        title="Backups"
        action={
          <button type="button" className={smallBtn} disabled={busy === 'backup'} onClick={() => act('backup', () => systemApi.backupNow(), 'Backed up')}>
            {busy === 'backup' && <Spinner className="h-3 w-3" />}
            Back up now
          </button>
        }
      >
        <div className={`${CARD} px-5 py-4`}>
          <p className="text-[13px] text-ink-300">
            Nightly, automatically. Last backup: <span className="text-white">{ago(h.backups.last)}</span>. Each app also keeps its own database snapshots in its config folder.
          </p>
          {h.backups.error && <p className="mt-2 text-[12.5px] text-amber-200">{h.backups.error}</p>}
          {h.backups.files.length > 0 && (
            <ul className="mt-3 divide-y divide-white/5">
              {h.backups.files.slice(0, 5).map((f) => (
                <li key={f.name} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                  <span className="truncate font-mono text-ink-300">{f.name}</span>
                  <button
                    type="button"
                    className={smallBtn}
                    onClick={async () => {
                      const r = await fetch(systemApi.backupUrl(f.name), { headers: { Authorization: mediaBrowserAuthHeader() } })
                      if (!r.ok) return toast('Download failed', 'error')
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(await r.blob())
                      a.download = f.name
                      a.click()
                      setTimeout(() => URL.revokeObjectURL(a.href), 5000)
                    }}
                  >
                    Download · {Math.max(1, Math.round(f.size / 1024))} KB
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Block>

      <SharingSettings onSaved={refreshFinesse} />

      {/* Activity */}
      {h.events.length > 0 && (
        <Block title="Recent activity">
          <ul className={`${CARD} divide-y divide-white/5`}>
            {h.events.slice(0, 8).map((e, i) => (
              <li key={i} className="flex gap-3 px-5 py-2.5 text-[12.5px]">
                <span className="w-20 shrink-0 text-ink-400">{ago(e.at)}</span>
                <span className={e.level === 'error' ? 'text-red-300' : e.level === 'warn' ? 'text-amber-200' : 'text-ink-300'}>{e.message}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {logs && <LogsDialog id={logs.id} name={logs.name} onClose={() => setLogs(null)} />}
    </div>
  )
}

/** Public address (for invite links) + SMTP (for invite emails). */
function SharingSettings({ onSaved }: { onSaved: () => void }) {
  const toast = useToast()
  const [loaded, setLoaded] = useState(false)
  const [publicUrl, setPublicUrl] = useState('')
  const [on, setOn] = useState(false)
  const [hasPassword, setHasPassword] = useState(false)
  const [e, setE] = useState({ host: '', port: '587', secure: false, username: '', password: '', from: '' })
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    systemApi.email().then((r) => {
      setPublicUrl(r.publicUrl ?? '')
      if (r.email) {
        setOn(true)
        setHasPassword(r.email.hasPassword)
        setE({ host: r.email.host, port: String(r.email.port), secure: Boolean(r.email.secure), username: r.email.username ?? '', password: '', from: r.email.from })
      }
      setLoaded(true)
    }, () => setLoaded(true))
  }, [])

  const save = async () => {
    setBusy('save')
    try {
      const r = await systemApi.saveEmail({
        publicUrl: publicUrl.trim() || null,
        email: on ? { host: e.host.trim(), port: Number(e.port), secure: e.secure, username: e.username.trim() || undefined, password: e.password || undefined, keepPassword: !e.password && hasPassword, from: e.from.trim() } : null,
      })
      setHasPassword(Boolean(r.email?.hasPassword))
      setE((x) => ({ ...x, password: '' }))
      toast('Saved')
      onSaved()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }

  if (!loaded) return null
  return (
    <Block title="Invites & sharing">
      <div className={`${CARD} space-y-5 px-5 py-5`}>
        <TextField label="Public address" value={publicUrl} onChange={setPublicUrl} placeholder="https://media.example.com" optional hint="Where people reach Finesse from outside your home. Invite links and emails use it." mono />
        <Toggle checked={on} onChange={setOn} label="Email invites" description="Send invites straight to people’s inboxes." />
        {on && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {SMTP_PRESETS.filter((p) => p.id !== 'other').map((p) => (
                <button key={p.id} type="button" className={smallBtn} onClick={() => setE((x) => ({ ...x, host: p.host, port: String(p.port), secure: p.secure, username: p.username && p.username !== 'email' ? p.username : x.username }))}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
              <TextField label="SMTP server" value={e.host} onChange={(v) => setE((x) => ({ ...x, host: v }))} placeholder="smtp.example.com" mono />
              <TextField label="Port" value={e.port} onChange={(v) => setE((x) => ({ ...x, port: v.replace(/\D/g, ''), secure: v === '465' }))} inputMode="numeric" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Username" value={e.username} onChange={(v) => setE((x) => ({ ...x, username: v }))} />
              <TextField label="Password" type="password" value={e.password} onChange={(v) => setE((x) => ({ ...x, password: v }))} placeholder={hasPassword ? 'Saved — leave empty to keep' : ''} />
            </div>
            <TextField label="Invites come from" value={e.from} onChange={(v) => setE((x) => ({ ...x, from: v }))} placeholder="The Den <you@example.com>" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
          <button type="button" className={primaryBtn} disabled={busy === 'save'} onClick={save}>
            {busy === 'save' && <Spinner className="h-3.5 w-3.5" />}
            Save
          </button>
          {on && hasPassword !== undefined && (
            <form
              className="flex flex-1 flex-wrap items-center gap-2"
              onSubmit={async (ev) => {
                ev.preventDefault()
                setBusy('test')
                try {
                  await systemApi.testEmail(testTo.trim())
                  toast(`Test email sent to ${testTo.trim()}`)
                } catch (err) {
                  toast((err as Error).message, 'error')
                } finally {
                  setBusy('')
                }
              }}
            >
              <input type="email" value={testTo} onChange={(ev) => setTestTo(ev.target.value)} placeholder="Send a test to…" className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-800 px-3 text-[13px] outline-none focus:border-accent-500" />
              <button type="submit" className={smallBtn} disabled={busy === 'test' || !testTo.includes('@')}>
                {busy === 'test' && <Spinner className="h-3 w-3" />}
                Send test
              </button>
            </form>
          )}
        </div>
      </div>
    </Block>
  )
}

/** On a TV: which Finesse server the app talks to. */
export function TvServerAddress({ className = '' }: { className?: string }) {
  if (!__WEBOS__) return null
  return (
    <div className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${className}`}>
      <div>
        <p className="text-sm font-semibold text-white">Finesse server</p>
        <p className="text-[12.5px] text-ink-400">{CONTENT_BASE || 'Not connected'}</p>
      </div>
      <button
        type="button"
        className={smallBtn}
        onClick={() => {
          setContentOrigin(null)
          window.location.hash = '#/connect'
          window.location.reload()
        }}
      >
        Change
      </button>
    </div>
  )
}
