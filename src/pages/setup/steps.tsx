// The wizard's steps. Each gets the draft and an updater; `stepBlocker`
// says what (if anything) still stops the person moving on.

import { useState, type ReactNode } from 'react'
import { setupApi, type SetupInfo, type SystemItem } from '../../api/setup'
import { indexerKey, newServer, vpnDoc, type Draft } from './draft'
import { countries, LANGUAGES, parseWireGuard, QUALITY_PRESETS, SMTP_PRESETS, timeZones, USENET_PRESETS } from './presets'
import { Callout, CheckButton, ChoiceCard, ExternalLink, gb, SectionTitle, SelectField, StatusDot, TextField, Toggle } from './ui'

export type StepId = 'welcome' | 'machine' | 'account' | 'libraries' | 'downloads' | 'usenet' | 'vpn' | 'indexers' | 'quality' | 'remote' | 'email' | 'review'

export type Update = (fn: (d: Draft) => void) => void

export interface StepProps {
  d: Draft
  set: Update
  info: SetupInfo | null
  system: { items: SystemItem[]; ok: boolean } | null
}

export const STEP_META: Record<StepId, { nav: string; title: string; lead: ReactNode }> = {
  welcome: { nav: 'Welcome', title: 'Let’s build your media server', lead: 'A few questions, then Finesse installs and connects everything for you — streaming, downloads and a VPN for torrents. It takes about ten minutes.' },
  machine: { nav: 'This machine', title: 'Checking this machine', lead: 'Finesse runs every app in its own container on this computer. Here’s what it found.' },
  account: { nav: 'Your account', title: 'Create your account', lead: 'You’ll be the administrator: you sign in with this, invite people and approve requests.' },
  libraries: { nav: 'Libraries', title: 'What will you collect?', lead: 'Each library gets its own folder, and its own manager to find new additions if you set up downloads.' },
  downloads: { nav: 'Downloads', title: 'How should new things arrive?', lead: 'Finesse can find and download what you request automatically. Pick one, both, or neither.' },
  usenet: { nav: 'Usenet', title: 'Your Usenet provider', lead: 'The account you pay for that stores the files. Finesse sets up SABnzbd with it.' },
  vpn: { nav: 'VPN', title: 'Your VPN', lead: 'qBittorrent only ever connects through this VPN. If it drops, torrents stop — nothing leaks.' },
  indexers: { nav: 'Indexers', title: 'Where to search', lead: 'Indexers are search engines for downloads. Finesse adds them to Prowlarr, which shares them with every app.' },
  quality: { nav: 'Quality', title: 'How good should it look?', lead: 'The default for new requests. You can pick a different quality for any single request.' },
  remote: { nav: 'Away from home', title: 'Watching away from home', lead: 'Optional. Reach Finesse from anywhere without opening ports on your router.' },
  email: { nav: 'Invite emails', title: 'Emailing invites', lead: 'Optional. Send invites straight to people’s inboxes. You can always share an invite link instead.' },
  review: { nav: 'Review', title: 'Ready to build', lead: 'Here’s everything Finesse will set up. Nothing is installed until you press Build.' },
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const I = {
  film: <path d="M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4" />,
  tv: <path d="M3 6h18v11H3zM8 21h8M12 17v4" />,
  music: <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />,
  cloud: <path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8H7Z" />,
  shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.4-8 9-4.6-.6-8-4.5-8-9V6l8-3Z" />,
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z" />,
  globe: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  server: <path d="M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01" />,
  games: <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-3.96 3.43l-.9 6.3A2.5 2.5 0 0 0 4.3 17.6c.63 0 1.24-.24 1.7-.67L8.5 14.5h7l2.5 2.43c.46.43 1.07.67 1.7.67a2.5 2.5 0 0 0 2.46-2.87l-.9-6.3A4 4 0 0 0 17.3 5Z" />,
}

export function Icon({ name, className = 'h-5 w-5' }: { name: keyof typeof I; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {I[name]}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Validation per step
// ---------------------------------------------------------------------------

const B64KEY = /^[A-Za-z0-9+/]{42,43}=?$/
const HOST = /^[^\s/]+$/

export function stepBlocker(step: StepId, d: Draft, ctx: { codeOk: boolean; system: StepProps['system'] }): string | null {
  switch (step) {
    case 'welcome':
      return ctx.codeOk ? null : 'Enter the setup code'
    case 'machine':
      if (!ctx.system) return 'Checking…'
      return ctx.system.ok ? null : 'Fix the problems above, then check again'
    case 'account': {
      const u = d.admin.username.trim()
      if (!/^[A-Za-z0-9._@-]{2,64}$/.test(u)) return 'Choose a username (letters, numbers, . _ @ -)'
      if (d.admin.password.length < 8) return 'Choose a password with at least 8 characters'
      // Not a mismatch until they've typed something in the second box.
      if (!d.admin.confirm) return 'Type the password again to confirm it'
      if (d.admin.password !== d.admin.confirm) return 'The passwords don’t match'
      return null
    }
    case 'libraries':
      if (!(d.libraries.movies || d.libraries.shows || d.libraries.music || d.libraries.games)) return 'Pick at least one library'
      if (d.libraries.games && d.games.steamGridDbKey.trim() && !/^[A-Za-z0-9]{16,64}$/.test(d.games.steamGridDbKey.trim())) return 'That SteamGridDB key doesn’t look right'
      if (d.libraries.games && Boolean(d.games.igdbClientId.trim()) !== Boolean(d.games.igdbClientSecret.trim())) return 'IGDB needs both the Client ID and the Client Secret'
      return null
    case 'downloads':
      return null
    case 'usenet': {
      if (!d.servers.length) return 'Add your Usenet server'
      for (const s of d.servers) {
        if (!HOST.test(s.host.trim())) return 'Enter the server address'
        if (!(Number(s.port) > 0 && Number(s.port) < 65536)) return 'Enter the port (usually 563)'
        if (!s.username.trim() || !s.password) return 'Enter your Usenet username and password'
        if (!(Number(s.connections) >= 1 && Number(s.connections) <= 100)) return 'Connections must be 1–100'
      }
      return null
    }
    case 'vpn': {
      const v = d.vpn
      if (!v.provider) return 'Choose your VPN provider'
      if (v.type === 'wireguard') {
        if (!B64KEY.test(v.privateKey.trim())) return 'Paste your WireGuard private key'
        if (v.provider !== 'nordvpn' && !v.addresses.trim()) return 'Paste your WireGuard address'
        if (v.provider === 'custom' && (!v.endpointIp.trim() || !v.publicKey.trim())) return 'Add the server’s endpoint and public key'
      } else if (!v.username.trim() || !v.password) return 'Enter your OpenVPN username and password'
      return null
    }
    case 'indexers': {
      for (const ix of d.indexers) {
        if (!ix.name.trim()) return 'Give each indexer a name'
        if (!/^https?:\/\/\S+$/.test(ix.url.trim())) return `Enter ${ix.name || 'the indexer'}’s address`
      }
      return null
    }
    case 'quality':
      return null
    case 'remote':
      if (d.remote === 'tailscale' && !d.tailscale.authKey.trim().startsWith('tskey-')) return 'Paste a Tailscale auth key (tskey-…)'
      if (d.remote === 'tailscale' && !/^[a-z0-9-]{1,63}$/.test(d.tailscale.hostname.trim().toLowerCase())) return 'Use lowercase letters, numbers and dashes for the name'
      if (d.remote === 'cloudflare' && d.cloudflare.token.trim().length < 20) return 'Paste the tunnel token'
      if (d.remote === 'cloudflare' && !/^https:\/\/\S+$/.test(d.cloudflare.publicUrl.trim())) return 'Enter the public address (https://…)'
      if (d.remote === 'own' && !/^https?:\/\/[^\s/]+/.test(d.publicUrl.trim())) return 'Enter the address people use (https://…)'
      return null
    case 'email':
      if (!d.emailOn) return null
      if (!d.email.host.trim()) return 'Enter the SMTP server'
      if (!(Number(d.email.port) > 0)) return 'Enter the SMTP port'
      if (!d.email.from.includes('@')) return 'Enter the address invites come from'
      return null
    case 'review':
      return null
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export function MachineStep({ system, info, recheck, checking }: StepProps & { recheck: () => void; checking: boolean }) {
  const order = ['docker', 'data', 'root', 'tun', 'gpu', 'ports', 'machine']
  const items = [...(system?.items ?? [])].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  const data = items.find((i) => i.id === 'data')?.detail as { free?: number; path?: string; low?: boolean } | undefined
  return (
    <div className="space-y-5">
      {!system ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-xl shimmer" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-3 px-4 py-3.5">
              <span className="mt-0.5">
                <StatusDot ok={it.ok ? true : it.id === 'tun' ? null : false} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium text-white">{it.title}</span>
                <span className="block break-words text-[13px] leading-relaxed text-ink-400">{it.message}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {system && !system.ok && (
        <Callout tone="error" title="Finesse can’t continue yet">
          The problems marked in red need fixing on this machine first — the install guide’s troubleshooting section walks through each one. Then press <b>Check again</b>.
        </Callout>
      )}
      {data?.path && (
        <Callout title="Where your media lives">
          Movies, shows and music go in <code className="rounded bg-white/10 px-1.5 py-0.5 text-[12.5px]">{data.path}/media</code>. Downloads land in the same folder tree, so finished files are moved instantly
          instead of copied.{data.free !== undefined && <> You have {gb(data.free)} free.</>}
        </Callout>
      )}
      <button type="button" onClick={recheck} disabled={checking} className="text-[13px] font-semibold text-accent-300 hover:text-accent-200 disabled:opacity-50">
        {checking ? 'Checking…' : 'Check again'}
      </button>
      {info && <p className="text-[12px] text-ink-400">Config folder: {info.defaults.root}</p>}
    </div>
  )
}

export function AccountStep({ d, set }: StepProps) {
  const [tzs] = useState(timeZones)
  const [cs] = useState(() => countries())
  const mismatch = d.admin.confirm.length > 0 && d.admin.confirm !== d.admin.password
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <TextField label="Username" value={d.admin.username} onChange={(v) => set((x) => void (x.admin.username = v))} placeholder="alex" autoComplete="username" autoFocus />
        </div>
        <TextField label="Password" type="password" value={d.admin.password} onChange={(v) => set((x) => void (x.admin.password = v))} autoComplete="new-password" hint="At least 8 characters." />
        <TextField label="Password again" type="password" value={d.admin.confirm} onChange={(v) => set((x) => void (x.admin.confirm = v))} autoComplete="new-password" error={mismatch ? 'Doesn’t match yet' : null} />
      </div>
      <div className="space-y-4">
        <SectionTitle>Your server</SectionTitle>
        <TextField label="Name" value={d.server.name} onChange={(v) => set((x) => void (x.server.name = v))} hint="Shown to people you invite — “The Den”, “Casa Cinema”…" />
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Time zone" value={d.server.timezone} onChange={(v) => set((x) => void (x.server.timezone = v))} options={(tzs.includes(d.server.timezone) ? tzs : [d.server.timezone, ...tzs]).map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} />
          <SelectField label="Country" value={d.server.country} onChange={(v) => set((x) => void (x.server.country = v))} options={cs.map((c) => ({ value: c.code, label: c.name }))} hint="For ratings & release dates." />
          <SelectField label="Language" value={d.server.language} onChange={(v) => set((x) => void (x.server.language = v))} options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))} hint="For titles, descriptions & downloads." />
        </div>
      </div>
    </div>
  )
}

export function LibrariesStep({ d, set }: StepProps) {
  const toggle = (k: keyof Draft['libraries']) => set((x) => void (x.libraries[k] = !x.libraries[k]))
  return (
    <div className="grid gap-3">
      <ChoiceCard multi selected={d.libraries.movies} onClick={() => toggle('movies')} icon={<Icon name="film" />} title="Movies">
        Films, with trailers, collections and 4K when you have it. Managed by Radarr.
      </ChoiceCard>
      <ChoiceCard multi selected={d.libraries.shows} onClick={() => toggle('shows')} icon={<Icon name="tv" />} title="TV shows">
        Series with seasons, “up next” and new episodes as they air. Managed by Sonarr.
      </ChoiceCard>
      <ChoiceCard multi selected={d.libraries.music} onClick={() => toggle('music')} icon={<Icon name="music" />} title="Music">
        Albums and artists, with synced lyrics and a lyric-video mode. Managed by Lidarr.
      </ChoiceCard>
      <ChoiceCard multi selected={d.libraries.games} onClick={() => toggle('games')} icon={<Icon name="games" />} title="Games">
        Retro games you play right in the browser: NES, SNES, Game Boy, Genesis, PlayStation and more. Managed by RomM. You add the games yourself.
      </ChoiceCard>
      {d.libraries.games && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
          <p className="text-sm text-ink-300">
            Box art comes from free sources without an account. For more art and descriptions, add these <b className="text-ink-100">optional</b> keys:
          </p>
          <TextField
            label="SteamGridDB API key"
            optional
            mono
            value={d.games.steamGridDbKey}
            onChange={(v) => set((x) => void (x.games.steamGridDbKey = v))}
            hint={<>Free: steamgriddb.com → Preferences → API.</>}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <TextField label="IGDB Client ID" optional mono value={d.games.igdbClientId} onChange={(v) => set((x) => void (x.games.igdbClientId = v))} hint={<>Free: create an app at dev.twitch.tv.</>} />
            <TextField label="IGDB Client Secret" optional mono type="password" value={d.games.igdbClientSecret} onChange={(v) => set((x) => void (x.games.igdbClientSecret = v))} />
          </div>
        </div>
      )}
    </div>
  )
}

export function DownloadsStep({ d, set, system }: StepProps) {
  const tun = system?.items.find((i) => i.id === 'tun')?.ok !== false
  return (
    <div className="space-y-4">
      <ChoiceCard
        multi
        selected={d.usenet}
        badge="Recommended"
        onClick={() =>
          set((x) => {
            x.usenet = !x.usenet
            if (x.usenet && !x.servers.length) x.servers.push(newServer(true))
          })
        }
        icon={<Icon name="cloud" />}
        title="Usenet"
      >
        Fast, private and reliable — downloads at your connection’s full speed. You’ll need a Usenet provider (about $3–10 a month) and an indexer (about $10–20 a year).
      </ChoiceCard>
      <ChoiceCard multi selected={d.torrents && tun} onClick={() => tun && set((x) => void (x.torrents = !x.torrents))} icon={<Icon name="shield" />} title="Torrents, through a VPN">
        {tun ? (
          <>Huge selection and free to use. Finesse only lets qBittorrent connect through your VPN — if the VPN drops, torrents stop. You’ll need a VPN subscription (about $3–10 a month).</>
        ) : (
          <>Not available: this machine can’t run VPN tunnels (/dev/net/tun is missing), and Finesse never runs torrents without one.</>
        )}
      </ChoiceCard>
      {!d.usenet && !d.torrents && (
        <Callout title="Just streaming">
          Finesse will set up Jellyfin only. Add your own files to the media folders and they’ll appear in the app. Want downloads later? Re-apply your setup with them turned on (the install guide shows how) — your library stays as it is.
        </Callout>
      )}
      <p className="text-[12.5px] leading-relaxed text-ink-400">Only download what you have the right to. Finesse is a tool; what you do with it is up to you.</p>
    </div>
  )
}

export function UsenetStep({ d, set }: StepProps) {
  const upd = (i: number, fn: (s: Draft['servers'][number]) => void) => set((x) => fn(x.servers[i]!))
  return (
    <div className="space-y-6">
      {d.servers.map((s, i) => (
        <div key={i} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <SectionTitle
            action={
              i > 0 ? (
                <button type="button" className="text-[12.5px] font-medium text-ink-400 hover:text-red-300" onClick={() => set((x) => void x.servers.splice(i, 1))}>
                  Remove
                </button>
              ) : undefined
            }
          >
            {i === 0 ? 'Main server' : 'Backup server'}
          </SectionTitle>
          <SelectField
            label="Provider"
            value={s.preset}
            onChange={(v) =>
              upd(i, (srv) => {
                srv.preset = v
                const p = USENET_PRESETS.find((x) => x.id === v)
                if (p) {
                  srv.name = p.name
                  srv.host = p.host
                  srv.port = String(p.port)
                  srv.ssl = true
                  srv.connections = String(p.connections)
                }
              })
            }
            options={[{ value: '', label: 'Choose your provider…' }, ...USENET_PRESETS.map((p) => ({ value: p.id, label: p.name })), { value: 'other', label: 'Another provider' }]}
          />
          {(s.preset === 'other' || (s.preset === '' && s.host)) && (
            <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
              <TextField label="Server address" value={s.host} onChange={(v) => upd(i, (x) => void (x.host = v))} placeholder="news.example.com" mono />
              <TextField label="Port" value={s.port} onChange={(v) => upd(i, (x) => void (x.port = v.replace(/\D/g, '')))} inputMode="numeric" />
            </div>
          )}
          {s.preset && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Username" value={s.username} onChange={(v) => upd(i, (x) => void (x.username = v))} autoComplete="off" />
                <TextField label="Password" type="password" value={s.password} onChange={(v) => upd(i, (x) => void (x.password = v))} autoComplete="off" />
              </div>
              <div className="grid gap-4 sm:grid-cols-[7rem_1fr] sm:items-end">
                <TextField label="Connections" value={s.connections} onChange={(v) => upd(i, (x) => void (x.connections = v.replace(/\D/g, '')))} inputMode="numeric" />
                <p className="pb-2 text-[12.5px] leading-relaxed text-ink-400">Your plan’s limit (often 20–100). More connections = faster downloads.</p>
              </div>
              {s.preset !== 'other' && (
                <p className="text-[12.5px] text-ink-400">
                  {s.host}:{s.port} · SSL
                  <button type="button" className="ml-2 font-medium text-accent-300 hover:text-accent-200" onClick={() => upd(i, (x) => void (x.preset = 'other'))}>
                    Change
                  </button>
                </p>
              )}
              <CheckButton
                label="Test connection"
                disabled={!s.host || !s.username || !s.password}
                run={() => setupApi.checkUsenet({ name: s.name || s.host, host: s.host.trim(), port: Number(s.port) || 563, ssl: s.ssl, username: s.username.trim(), password: s.password, connections: 1 })}
              />
            </>
          )}
        </div>
      ))}
      {d.servers.length < 3 && (
        <button type="button" onClick={() => set((x) => void x.servers.push(newServer(false)))} className="text-[13.5px] font-semibold text-accent-300 hover:text-accent-200">
          + Add a backup (block) account
        </button>
      )}
    </div>
  )
}

export function VpnStep({ d, set, info }: StepProps) {
  const providers = info?.vpnProviders ?? []
  const p = providers.find((x) => x.id === d.vpn.provider)
  const [paste, setPaste] = useState('')
  const v = d.vpn
  const setV = (fn: (vpn: Draft['vpn']) => void) => set((x) => fn(x.vpn))
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Provider</SectionTitle>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {providers.map((pr) => (
            <button
              key={pr.id}
              type="button"
              aria-pressed={v.provider === pr.id}
              onClick={() =>
                setV((vpn) => {
                  vpn.provider = pr.id
                  vpn.type = pr.wireguard ? 'wireguard' : 'openvpn'
                })
              }
              className={`own-focus h-11 rounded-xl border px-3 text-left text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 ${
                v.provider === pr.id ? 'border-accent-400 bg-accent-500/15 text-white' : 'border-white/10 bg-white/[0.03] text-ink-200 hover:border-white/25'
              }`}
            >
              {pr.name}
            </button>
          ))}
        </div>
      </div>
      {p && (
        <>
          {p.wireguard && p.openvpn && (
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
              {(['wireguard', 'openvpn'] as const).map((t) => (
                <button key={t} type="button" aria-pressed={v.type === t} onClick={() => setV((vpn) => void (vpn.type = t))} className={`h-8 rounded-full px-4 text-[13px] font-semibold transition-colors ${v.type === t ? 'bg-white text-ink-950' : 'text-ink-300 hover:text-white'}`}>
                  {t === 'wireguard' ? 'WireGuard (faster)' : 'OpenVPN'}
                </button>
              ))}
            </div>
          )}
          <Callout title={`Where to find this at ${p.name}`}>{p.help}</Callout>
          {v.type === 'wireguard' ? (
            <div className="space-y-4">
              <Field2 label="Paste your WireGuard config (optional shortcut)">
                <textarea
                  className="h-24 w-full resize-y rounded-xl border border-white/10 bg-ink-900/80 px-3.5 py-2.5 font-mono text-[12.5px] text-white outline-none placeholder:text-ink-400/60 focus:border-accent-400"
                  placeholder={'[Interface]\nPrivateKey = …\nAddress = 10.64.…/32'}
                  value={paste}
                  onChange={(e) => {
                    setPaste(e.target.value)
                    const w = parseWireGuard(e.target.value)
                    setV((vpn) => {
                      if (w.privateKey) vpn.privateKey = w.privateKey
                      if (w.addresses) vpn.addresses = w.addresses
                      if (w.presharedKey) vpn.presharedKey = w.presharedKey
                      if (vpn.provider === 'custom') {
                        if (w.publicKey) vpn.publicKey = w.publicKey
                        if (w.endpointIp) vpn.endpointIp = w.endpointIp
                        if (w.endpointPort) vpn.endpointPort = String(w.endpointPort)
                      }
                    })
                  }}
                />
              </Field2>
              <TextField label="Private key" type="password" mono value={v.privateKey} onChange={(x) => setV((vpn) => void (vpn.privateKey = x.trim()))} placeholder="44 characters ending in =" />
              {v.provider !== 'nordvpn' && <TextField label="Address" mono value={v.addresses} onChange={(x) => setV((vpn) => void (vpn.addresses = x))} placeholder="10.64.222.21/32" />}
              {(v.provider === 'airvpn' || v.provider === 'windscribe' || v.provider === 'custom') && (
                <TextField label="Preshared key" type="password" mono optional value={v.presharedKey} onChange={(x) => setV((vpn) => void (vpn.presharedKey = x.trim()))} />
              )}
              {v.provider === 'custom' && (
                <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                  <TextField label="Server endpoint (IP)" mono value={v.endpointIp} onChange={(x) => setV((vpn) => void (vpn.endpointIp = x.trim()))} placeholder="203.0.113.10" />
                  <TextField label="Port" value={v.endpointPort} onChange={(x) => setV((vpn) => void (vpn.endpointPort = x.replace(/\D/g, '')))} inputMode="numeric" />
                  <div className="sm:col-span-2">
                    <TextField label="Server public key" mono value={v.publicKey} onChange={(x) => setV((vpn) => void (vpn.publicKey = x.trim()))} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="OpenVPN username" value={v.username} onChange={(x) => setV((vpn) => void (vpn.username = x))} hint="Often a service username, not your email." />
              <TextField label="OpenVPN password" type="password" value={v.password} onChange={(x) => setV((vpn) => void (vpn.password = x))} />
            </div>
          )}
          {v.provider !== 'custom' && (
            <TextField label="Countries" optional value={v.countries} onChange={(x) => setV((vpn) => void (vpn.countries = x))} placeholder="Netherlands, Switzerland" hint="Comma-separated. Leave empty to let the VPN choose." />
          )}
          <CheckButton label="Test the VPN" busyLabel="Connecting a test tunnel… (up to a minute)" disabled={stepBlocker('vpn', d, { codeOk: true, system: null }) !== null} run={() => setupApi.checkVpn(vpnDoc(d))} />
        </>
      )}
    </div>
  )
}

function Field2({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-ink-200">{label}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}

export function IndexersStep({ d, set, info }: StepProps) {
  const suggestions = info?.indexerSuggestions ?? []
  const add = (ix: { name: string; url: string; kind: 'newznab' | 'torznab' }) => set((x) => void x.indexers.push({ ...ix, apiKey: '', key: indexerKey() }))
  const shown = d.indexers.filter((ix) => (ix.kind === 'newznab' ? d.usenet : d.torrents))
  const upd = (key: string, fn: (ix: Draft['indexers'][number]) => void) => set((x) => fn(x.indexers.find((i) => i.key === key)!))
  return (
    <div className="space-y-6">
      {shown.length === 0 && (
        <Callout tone="warn" title="No indexers yet">
          Without at least one, requests can’t find anything to download. You can skip this and add indexers later in Prowlarr.
        </Callout>
      )}
      {shown.map((ix) => (
        <div key={ix.key} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <SectionTitle
            action={
              <button type="button" className="text-[12.5px] font-medium text-ink-400 hover:text-red-300" onClick={() => set((x) => void (x.indexers = x.indexers.filter((i) => i.key !== ix.key)))}>
                Remove
              </button>
            }
          >
            {ix.kind === 'newznab' ? 'Usenet indexer' : 'Torrent indexer'}
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={ix.name} onChange={(v) => upd(ix.key, (i) => void (i.name = v))} />
            <TextField label="Address" mono value={ix.url} onChange={(v) => upd(ix.key, (i) => void (i.url = v))} placeholder={ix.kind === 'newznab' ? 'https://api.example.com' : 'https://…/torznab/api'} />
          </div>
          <TextField label="API key" type="password" mono value={ix.apiKey ?? ''} onChange={(v) => upd(ix.key, (i) => void (i.apiKey = v.trim()))} hint="On your indexer’s profile or API page." optional={ix.kind === 'torznab'} />
          <CheckButton label="Test" disabled={!/^https?:\/\//.test(ix.url)} run={() => setupApi.checkIndexer({ name: ix.name, kind: ix.kind, url: ix.url.trim(), apiKey: ix.apiKey })} />
        </div>
      ))}
      <div className="space-y-2">
        <SectionTitle>Add an indexer</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {d.usenet &&
            suggestions
              .filter((s) => !d.indexers.some((i) => i.url === s.url))
              .map((s) => (
                <button key={s.url} type="button" onClick={() => add({ name: s.name, url: s.url, kind: 'newznab' })} className="h-9 rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-[13px] font-medium text-ink-200 hover:border-white/25 hover:text-white">
                  + {s.name}
                </button>
              ))}
          {d.usenet && (
            <button type="button" onClick={() => add({ name: '', url: '', kind: 'newznab' })} className="h-9 rounded-full border border-dashed border-white/20 px-3.5 text-[13px] font-medium text-ink-300 hover:text-white">
              + Other Usenet indexer
            </button>
          )}
          {d.torrents && (
            <button type="button" onClick={() => add({ name: '', url: '', kind: 'torznab' })} className="h-9 rounded-full border border-dashed border-white/20 px-3.5 text-[13px] font-medium text-ink-300 hover:text-white">
              + Torrent indexer (Torznab)
            </button>
          )}
        </div>
        {d.usenet && <p className="text-[12.5px] leading-relaxed text-ink-400">These are popular Usenet indexers — you still need your own account with each (most have a free tier or a small yearly fee).</p>}
      </div>
    </div>
  )
}

export function QualityStep({ d, set }: StepProps) {
  return (
    <div className="grid gap-3">
      {QUALITY_PRESETS.map((q) => (
        <ChoiceCard key={q.id} selected={d.quality === q.id} onClick={() => set((x) => void (x.quality = q.id))} title={q.title} badge={'badge' in q ? q.badge : undefined}>
          {q.body}
        </ChoiceCard>
      ))}
    </div>
  )
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2 text-[13.5px] leading-relaxed text-ink-300">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white">{i + 1}</span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  )
}

export function RemoteStep({ d, set, system }: StepProps) {
  const tun = system?.items.find((i) => i.id === 'tun')?.ok !== false
  return (
    <div className="space-y-4">
      <ChoiceCard selected={d.remote === 'none'} onClick={() => set((x) => void (x.remote = 'none'))} icon={<Icon name="home" />} title="Only at home">
        Finesse works on your home network. You can add remote access any time.
      </ChoiceCard>
      <ChoiceCard selected={d.remote === 'tailscale'} onClick={() => tun && set((x) => void (x.remote = 'tailscale'))} icon={<Icon name="globe" />} title="Tailscale Funnel" badge={tun ? 'Free' : undefined}>
        {tun ? 'A private https address like finesse.your-tailnet.ts.net. No domain or router changes needed.' : 'Needs /dev/net/tun, which this machine doesn’t have.'}
      </ChoiceCard>
      {d.remote === 'tailscale' && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <Steps
            items={[
              <>
                Create a free account at <ExternalLink href="https://login.tailscale.com/start">tailscale.com</ExternalLink>.
              </>,
              <>In the admin console → DNS: turn on <b>MagicDNS</b> and <b>HTTPS certificates</b>.</>,
              <>In Access controls, allow Funnel (the default policy includes a “funnel” attribute you can enable).</>,
              <>
                Settings → Keys → <b>Generate auth key</b>, then paste it here.
              </>,
            ]}
          />
          <TextField label="Auth key" type="password" mono value={d.tailscale.authKey} onChange={(v) => set((x) => void (x.tailscale.authKey = v.trim()))} placeholder="tskey-auth-…" />
          <TextField label="Name" mono value={d.tailscale.hostname} onChange={(v) => set((x) => void (x.tailscale.hostname = v.toLowerCase()))} hint="Your address will be https://<name>.<your-tailnet>.ts.net" />
        </div>
      )}
      <ChoiceCard selected={d.remote === 'cloudflare'} onClick={() => set((x) => void (x.remote = 'cloudflare'))} icon={<Icon name="cloud" />} title="Cloudflare Tunnel">
        Use your own domain (media.example.com). Free, but you need a domain on Cloudflare.
      </ChoiceCard>
      {d.remote === 'cloudflare' && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <Steps
            items={[
              <>
                In <ExternalLink href="https://one.dash.cloudflare.com">Cloudflare Zero Trust</ExternalLink> → Networks → Tunnels, create a tunnel (type “Cloudflared”).
              </>,
              <>
                Add a public hostname (e.g. media.example.com) with service <code className="rounded bg-white/10 px-1">http://finesse:8080</code>.
              </>,
              <>Copy the token from the install command (the long string after “--token”) and paste it here.</>,
            ]}
          />
          <TextField label="Tunnel token" type="password" mono value={d.cloudflare.token} onChange={(v) => set((x) => void (x.cloudflare.token = v.trim().replace(/^.*--token\s+/, '')))} />
          <TextField label="Public address" mono value={d.cloudflare.publicUrl} onChange={(v) => set((x) => void (x.cloudflare.publicUrl = v.trim()))} placeholder="https://media.example.com" />
        </div>
      )}
      <ChoiceCard selected={d.remote === 'own'} onClick={() => set((x) => void (x.remote = 'own'))} icon={<Icon name="link" />} title="I already have a reverse proxy">
        Caddy, Nginx Proxy Manager, Traefik… point it at port 8080 of this machine and tell Finesse the address.
      </ChoiceCard>
      {d.remote === 'own' && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <TextField label="Public address" mono value={d.publicUrl} onChange={(v) => set((x) => void (x.publicUrl = v.trim()))} placeholder="https://media.example.com" hint="Used in invite links." />
        </div>
      )}
    </div>
  )
}

export function EmailStep({ d, set }: StepProps) {
  const preset = SMTP_PRESETS.find((p) => p.id === d.email.preset) ?? SMTP_PRESETS.at(-1)!
  return (
    <div className="space-y-5">
      <Toggle checked={d.emailOn} onChange={(v) => set((x) => void (x.emailOn = v))} label="Email invites" description="Finesse sends a friendly invite with a one-tap sign-up link." />
      {d.emailOn && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            {SMTP_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={d.email.preset === p.id}
                onClick={() =>
                  set((x) => {
                    x.email.preset = p.id
                    if (p.id !== 'other') {
                      x.email.host = p.host
                      x.email.port = String(p.port)
                      x.email.secure = p.secure
                      if (p.username && p.username !== 'email') x.email.username = p.username
                    }
                  })
                }
                className={`h-9 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${d.email.preset === p.id ? 'border-accent-400 bg-accent-500/15 text-white' : 'border-white/10 bg-white/[0.03] text-ink-300 hover:text-white'}`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <Callout>
            {preset.help} {preset.link && <ExternalLink href={preset.link}>Open</ExternalLink>}
          </Callout>
          {preset.id === 'other' && (
            <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
              <TextField label="SMTP server" mono value={d.email.host} onChange={(v) => set((x) => void (x.email.host = v.trim()))} placeholder="smtp.example.com" />
              <TextField label="Port" value={d.email.port} onChange={(v) => set((x) => void ((x.email.port = v.replace(/\D/g, '')), (x.email.secure = v === '465')))} inputMode="numeric" />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={preset.username && preset.username !== 'email' ? 'Username' : 'Email address'}
              value={d.email.username}
              onChange={(v) =>
                set((x) => {
                  x.email.username = v.trim()
                  if (preset.username === 'email' && (!x.email.from || x.email.from.includes(d.email.username))) x.email.from = `${d.server.name || 'Finesse'} <${v.trim()}>`
                })
              }
              inputMode="email"
            />
            <TextField label={preset.id === 'resend' || preset.id === 'sendgrid' ? 'API key' : 'App password'} type="password" value={d.email.password} onChange={(v) => set((x) => void (x.email.password = v))} />
          </div>
          <TextField label="Invites come from" value={d.email.from} onChange={(v) => set((x) => void (x.email.from = v))} placeholder="The Den <you@example.com>" hint="Most providers require this to be your own address." />
          <p className="text-[12.5px] text-ink-400">You can send a test email from Settings → Server once Finesse is running.</p>
        </div>
      )}
    </div>
  )
}
