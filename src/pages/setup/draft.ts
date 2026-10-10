// The wizard's working copy of the setup document: friendlier shapes for the
// forms (strings for numbers, UI-only toggles), converted with toDoc().

import type { Indexer, SetupDoc, UsenetServer } from '../../api/setup'
import { browserLocale } from './presets'

export interface Draft {
  admin: { username: string; password: string; confirm: string }
  server: { name: string; timezone: string; country: string; language: string }
  libraries: { movies: boolean; shows: boolean; music: boolean; games: boolean; samples: boolean }
  /** Optional game-artwork accounts (only sent when Games is on). */
  games: { steamGridDbKey: string; igdbClientId: string; igdbClientSecret: string }
  usenet: boolean
  torrents: boolean
  servers: (Omit<UsenetServer, 'port' | 'connections'> & { preset: string; port: string; connections: string })[]
  indexers: (Indexer & { url: string; key: string })[]
  /** The built-in search sites were offered (ticked) once; after that, the choice is the person's. */
  builtinOffered: boolean
  vpn: {
    provider: string
    type: 'wireguard' | 'openvpn'
    privateKey: string
    addresses: string
    presharedKey: string
    endpointIp: string
    endpointPort: string
    publicKey: string
    username: string
    password: string
    countries: string
  }
  quality: '720p' | '1080p' | '4k' | 'any'
  remote: 'none' | 'tailscale' | 'cloudflare' | 'own'
  tailscale: { authKey: string; hostname: string }
  cloudflare: { token: string; publicUrl: string }
  publicUrl: string
  emailOn: boolean
  email: { preset: string; host: string; port: string; secure: boolean; username: string; password: string; from: string }
}

export function newDraft(): Draft {
  const loc = browserLocale()
  return {
    admin: { username: '', password: '', confirm: '' },
    server: { name: 'Finesse', ...loc },
    libraries: { movies: true, shows: true, music: true, games: false, samples: true },
    games: { steamGridDbKey: '', igdbClientId: '', igdbClientSecret: '' },
    usenet: false,
    torrents: false,
    servers: [],
    indexers: [],
    builtinOffered: false,
    vpn: { provider: '', type: 'wireguard', privateKey: '', addresses: '', presharedKey: '', endpointIp: '', endpointPort: '51820', publicKey: '', username: '', password: '', countries: '' },
    quality: '1080p',
    remote: 'none',
    tailscale: { authKey: '', hostname: 'finesse' },
    cloudflare: { token: '', publicUrl: '' },
    publicUrl: '',
    emailOn: false,
    email: { preset: 'gmail', host: 'smtp.gmail.com', port: '465', secure: true, username: '', password: '', from: '' },
  }
}

export function newServer(primary: boolean): Draft['servers'][number] {
  return { preset: '', name: '', host: '', port: '563', ssl: true, username: '', password: '', connections: '20', priority: primary ? 0 : 1 }
}

let seq = 0
/** One of Prowlarr's own search sites: named, with no address or key to enter. */
export const isBuiltInSite = (ix: { definition?: string; url?: string }) => Boolean(ix.definition) && !(ix.url ?? '').trim()
export const indexerKey = () => `ix${Date.now().toString(36)}${seq++}`

const clean = (s: string) => s.trim()

/** A secret the server already has (changing a finished setup): sent back as-is, the server fills it in. */
export const KEEP = '__finesse_keep__'
export const kept = (s: string | undefined) => s === KEEP

export function vpnDoc(d: Draft): NonNullable<NonNullable<SetupDoc['downloads']>['torrents']>['vpn'] {
  const v = d.vpn
  const countries = v.countries
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  return {
    provider: v.provider,
    type: v.type,
    ...(v.type === 'wireguard'
      ? {
          wireguard: {
            privateKey: clean(v.privateKey),
            ...(clean(v.addresses) ? { addresses: clean(v.addresses) } : {}),
            ...(clean(v.presharedKey) ? { presharedKey: clean(v.presharedKey) } : {}),
            ...(v.provider === 'custom' ? { endpointIp: clean(v.endpointIp), endpointPort: Number(v.endpointPort) || 51820, publicKey: clean(v.publicKey) } : {}),
          },
        }
      : { openvpn: { username: clean(v.username), password: v.password } }),
    ...(countries.length ? { countries } : {}),
  }
}

export function toDoc(d: Draft): SetupDoc {
  const doc: SetupDoc = {
    admin: { username: clean(d.admin.username), password: d.admin.password },
    server: { name: clean(d.server.name) || 'Finesse', timezone: d.server.timezone, country: d.server.country, language: d.server.language },
    libraries: { ...d.libraries, games: Boolean(d.libraries.games), samples: Boolean(d.libraries.samples && d.libraries.music) },
    quality: { preset: d.quality },
  }
  if (d.libraries.games) {
    const g = d.games
    const games: NonNullable<SetupDoc['games']> = {}
    if (clean(g.steamGridDbKey)) games.steamGridDbKey = clean(g.steamGridDbKey)
    if (clean(g.igdbClientId) && clean(g.igdbClientSecret)) games.igdb = { clientId: clean(g.igdbClientId), clientSecret: clean(g.igdbClientSecret) }
    if (Object.keys(games).length) doc.games = games
  }
  if (d.usenet || d.torrents) {
    doc.downloads = {
      usenet: d.usenet
        ? {
            servers: d.servers.map((s, i) => ({
              name: clean(s.name) || clean(s.host) || `Server ${i + 1}`,
              host: clean(s.host),
              port: Number(s.port) || 563,
              ssl: s.ssl,
              username: clean(s.username),
              password: s.password,
              connections: Number(s.connections) || 20,
              priority: s.priority ?? (i === 0 ? 0 : 1),
            })),
          }
        : null,
      torrents: d.torrents ? { vpn: vpnDoc(d) } : null,
      indexers: d.indexers
        .filter((ix) => (ix.kind === 'newznab' ? d.usenet : d.torrents))
        .map((ix) =>
          isBuiltInSite(ix)
            ? { name: clean(ix.name), kind: ix.kind, definition: ix.definition }
            : { name: clean(ix.name), kind: ix.kind, url: clean(ix.url), ...(ix.definition ? { definition: ix.definition } : {}), ...(clean(ix.apiKey ?? '') ? { apiKey: clean(ix.apiKey!) } : {}) },
        ),
    }
  }
  if (d.remote === 'tailscale') doc.remoteAccess = { method: 'tailscale', tailscale: { authKey: clean(d.tailscale.authKey), hostname: clean(d.tailscale.hostname).toLowerCase() || 'finesse' } }
  else if (d.remote === 'cloudflare') doc.remoteAccess = { method: 'cloudflare', cloudflare: { token: clean(d.cloudflare.token), publicUrl: clean(d.cloudflare.publicUrl).replace(/\/+$/, '') } }
  else doc.remoteAccess = { method: 'none' }
  if (d.remote === 'own' && clean(d.publicUrl)) doc.publicUrl = clean(d.publicUrl).replace(/\/+$/, '')
  doc.email = d.emailOn
    ? {
        host: clean(d.email.host),
        port: Number(d.email.port) || 587,
        secure: d.email.secure,
        ...(clean(d.email.username) ? { username: clean(d.email.username) } : {}),
        ...(d.email.password ? { password: d.email.password } : {}),
        from: clean(d.email.from),
      }
    : null
  return doc
}

// ---------- persistence (this tab only) ----------

const KEY = 'finesse.setupDraft'

export function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? { ...newDraft(), ...(JSON.parse(raw) as Draft) } : null
  } catch {
    return null
  }
}

export function saveDraft(d: Draft) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* private mode */
  }
}

export function clearDraft() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/** The wizard's draft for a finished server's last setup (secrets arrive masked as KEEP and go back that way). */
export function fromDoc(doc: SetupDoc): Draft {
  const d = newDraft()
  d.admin = { username: doc.admin?.username ?? '', password: doc.admin?.password ?? '', confirm: doc.admin?.password ?? '' }
  if (doc.server) d.server = { ...d.server, ...doc.server, name: doc.server.name || 'Finesse' } as Draft['server']
  d.libraries = { ...d.libraries, ...doc.libraries, games: Boolean(doc.libraries?.games), samples: Boolean(doc.libraries?.samples) }
  d.games = { steamGridDbKey: doc.games?.steamGridDbKey ?? '', igdbClientId: doc.games?.igdb?.clientId ?? '', igdbClientSecret: doc.games?.igdb?.clientSecret ?? '' }
  const dl = doc.downloads
  d.usenet = Boolean(dl?.usenet)
  d.torrents = Boolean(dl?.torrents)
  d.servers = (dl?.usenet?.servers ?? []).map((s) => ({ ...s, preset: '', port: String(s.port ?? 563), connections: String(s.connections ?? 20) }))
  d.indexers = (dl?.indexers ?? []).map((ix) => ({ ...ix, url: ix.url ?? '', key: indexerKey() }))
  d.builtinOffered = true // an existing setup: whatever is (or isn't) there is their choice
  const v = dl?.torrents?.vpn
  if (v) {
    d.vpn = {
      ...d.vpn,
      provider: v.provider,
      type: v.type,
      privateKey: v.wireguard?.privateKey ?? '',
      addresses: v.wireguard?.addresses ?? '',
      presharedKey: v.wireguard?.presharedKey ?? '',
      endpointIp: v.wireguard?.endpointIp ?? '',
      endpointPort: String(v.wireguard?.endpointPort ?? 51820),
      publicKey: v.wireguard?.publicKey ?? '',
      username: v.openvpn?.username ?? '',
      password: v.openvpn?.password ?? '',
      countries: (v.countries ?? []).join(', '),
    }
  }
  if (doc.quality?.preset) d.quality = doc.quality.preset as Draft['quality']
  const ra = doc.remoteAccess
  if (ra?.method === 'tailscale') { d.remote = 'tailscale'; d.tailscale = { authKey: ra.tailscale?.authKey ?? '', hostname: ra.tailscale?.hostname ?? 'finesse' } }
  else if (ra?.method === 'cloudflare') { d.remote = 'cloudflare'; d.cloudflare = { token: ra.cloudflare?.token ?? '', publicUrl: ra.cloudflare?.publicUrl ?? '' } }
  else if (doc.publicUrl) { d.remote = 'own'; d.publicUrl = doc.publicUrl }
  if (doc.email) {
    d.emailOn = true
    d.email = { ...d.email, preset: '', host: doc.email.host, port: String(doc.email.port ?? 587), secure: Boolean(doc.email.secure), username: doc.email.username ?? '', password: doc.email.password ?? '', from: doc.email.from ?? '' }
  }
  return d
}
