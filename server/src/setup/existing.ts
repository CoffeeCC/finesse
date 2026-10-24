// "I already have these apps": setup finds the Jellyfin, Sonarr, Radarr, Lidarr, Prowlarr,
// SABnzbd and qBittorrent someone already runs, reads the keys out of the apps' own settings
// files, checks every connection, and connects Finesse to them. Nothing of theirs changes.
//
// Where it looks:
//   Docker (a NAS, TrueNAS, any Docker host): the containers themselves. A container's settings
//     file is read straight out of it (running or stopped), and its address is worked out from
//     how it's networked: a network Finesse shares, a published port, its own address.
//   This computer (Windows, or apps installed without Docker): the apps' usual settings folders,
//     and their usual ports here.
// Anything not found can be typed in; anything found can be corrected.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Settings } from '../config.ts'
import type { ContainerInspect, Docker } from '../stack/docker.ts'
import { logger } from '../log.ts'

const log = logger('existing')

export type ExistingId = 'jellyfin' | 'sonarr' | 'radarr' | 'lidarr' | 'prowlarr' | 'sabnzbd' | 'qbittorrent'
export const EXISTING_IDS: ExistingId[] = ['jellyfin', 'sonarr', 'radarr', 'lidarr', 'prowlarr', 'sabnzbd', 'qbittorrent']

interface Def {
  id: ExistingId
  name: string
  /** The port it listens on unless its settings say otherwise. */
  port: number
  /** Other ports it's commonly moved to (tried on this computer). */
  alsoPorts?: number[]
  /** The last part of the image name (no tag): lscr.io/linuxserver/sonarr:latest → sonarr. */
  image: RegExp
  /** Its settings file, inside the container's /config. */
  files: string[]
  /** What Finesse needs from the person: nothing (the key is in the file), a login, or an admin login. */
  ask: 'key' | 'login' | 'admin'
  /** *arr API prefix. */
  api?: string
}

const DEFS: Record<ExistingId, Def> = {
  jellyfin: { id: 'jellyfin', name: 'Jellyfin', port: 8096, image: /^jellyfin(-server)?$/i, files: ['network.xml', 'config/network.xml'], ask: 'admin' },
  sonarr: { id: 'sonarr', name: 'Sonarr', port: 8989, image: /^sonarr(-?v?\d)?$/i, files: ['config.xml'], ask: 'key', api: '/api/v3' },
  radarr: { id: 'radarr', name: 'Radarr', port: 7878, image: /^radarr(-?v?\d)?$/i, files: ['config.xml'], ask: 'key', api: '/api/v3' },
  lidarr: { id: 'lidarr', name: 'Lidarr', port: 8686, image: /^lidarr$/i, files: ['config.xml'], ask: 'key', api: '/api/v1' },
  prowlarr: { id: 'prowlarr', name: 'Prowlarr', port: 9696, image: /^prowlarr$/i, files: ['config.xml'], ask: 'key', api: '/api/v1' },
  sabnzbd: { id: 'sabnzbd', name: 'SABnzbd', port: 8080, alsoPorts: [8085, 9090], image: /^sabnzbd(vpn)?$/i, files: ['sabnzbd.ini'], ask: 'key' },
  qbittorrent: { id: 'qbittorrent', name: 'qBittorrent', port: 8080, alsoPorts: [8090, 8081], image: /^qbittorrent(vpn|-nox|-enhanced)?$/i, files: ['qBittorrent/qBittorrent.conf', 'qBittorrent/config/qBittorrent.conf', 'config/qBittorrent.conf'], ask: 'login' },
}

export const appName = (id: ExistingId) => DEFS[id].name

/** What an app's own settings file says. */
export interface AppConfig {
  apiKey?: string
  port?: number
  /** The path it's served under ("" or "/sonarr"). */
  base?: string
  username?: string
}

/** Reads the parts of an app's settings file Finesse needs. */
export function parseConfig(id: ExistingId, text: string): AppConfig {
  const tag = (name: string) => {
    const m = new RegExp(`<${name}>([^<]*)</${name}>`, 'i').exec(text)
    return m ? m[1]!.trim() : undefined
  }
  const ini = (key: string) => {
    const m = new RegExp(`^\\s*${key.replace(/[\\]/g, '\\\\')}\\s*=\\s*(.*?)\\s*$`, 'mi').exec(text)
    return m ? m[1]!.replace(/^"(.*)"$/, '$1') : undefined
  }
  const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined)
  switch (id) {
    case 'jellyfin':
      return { port: num(tag('InternalHttpPort')) ?? num(tag('HttpServerPortNumber')), base: cleanBase(tag('BaseUrl')) }
    case 'sabnzbd':
      return { apiKey: ini('api_key') || undefined, port: num(ini('port')), base: cleanBase(ini('url_base') ?? '/sabnzbd') }
    case 'qbittorrent':
      return { port: num(ini('WebUI\\Port')), username: ini('WebUI\\Username') || undefined, base: '' }
    default:
      return { apiKey: tag('ApiKey') || undefined, port: num(tag('Port')), base: cleanBase(tag('UrlBase')) }
  }
}

function cleanBase(b?: string): string {
  const t = (b ?? '').trim().replace(/\/+$/, '')
  if (!t) return ''
  return t.startsWith('/') ? t : `/${t}`
}

/** "192.168.1.5:8989", "http://nas:8989/sonarr/" → "http://192.168.1.5:8989", "http://nas:8989/sonarr". */
export function normalizeUrl(input: string): string {
  let t = input.trim()
  if (!t) return ''
  if (!/^https?:\/\//i.test(t)) t = `http://${t}`
  try {
    const u = new URL(t)
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Talking to the apps
// ---------------------------------------------------------------------------

async function get(url: string, opts: { headers?: Record<string, string>; method?: string; body?: string; timeoutMs?: number } = {}): Promise<{ status: number; text: string; headers: Headers } | null> {
  try {
    const r = await fetch(url, { method: opts.method ?? 'GET', headers: opts.headers, body: opts.body, signal: AbortSignal.timeout(opts.timeoutMs ?? 4000), redirect: 'manual' })
    return { status: r.status, text: await r.text(), headers: r.headers }
  } catch {
    return null
  }
}

const json = <T>(text: string): T | null => {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** Is `id` answering at `url` (no sign-in needed)? For Jellyfin, under which path. */
export async function answers(id: ExistingId, url: string, timeoutMs = 4000): Promise<{ ok: boolean; base?: string; version?: string }> {
  const def = DEFS[id]
  if (id === 'jellyfin') {
    for (const base of ['', '/jellyfin']) {
      const r = await get(`${url}${base}/System/Info/Public`, { timeoutMs })
      const info = r?.status === 200 ? json<{ ProductName?: string; Version?: string; Id?: string }>(r.text) : null
      if (info && (/jellyfin/i.test(info.ProductName ?? '') || (info.Id && info.Version))) return { ok: true, base, version: info.Version }
    }
    return { ok: false }
  }
  if (id === 'sabnzbd') {
    const r = await get(`${url}/api?mode=version&output=json`, { timeoutMs })
    const v = r?.status === 200 ? json<{ version?: string }>(r.text) : null
    return v?.version ? { ok: true, version: v.version } : { ok: false }
  }
  if (id === 'qbittorrent') {
    const r = await get(`${url}/api/v2/app/version`, { timeoutMs })
    if (!r) return { ok: false }
    if (r.status === 200 && /^v?\d+\.\d+/.test(r.text.trim())) return { ok: true, version: r.text.trim() }
    if (r.status === 403 || r.status === 401) {
      // Signed out: make sure it's qBittorrent's web page, not anything that says Forbidden.
      const page = await get(`${url}/`, { timeoutMs })
      return { ok: Boolean(page && /qbittorrent/i.test(page.text)) }
    }
    return { ok: false }
  }
  // *arr: /ping answers without a key; the status call says which app it is once there's a key.
  const r = await get(`${url}/ping`, { timeoutMs })
  if (r?.status === 200 && /ok/i.test(r.text)) return { ok: true }
  const s = await get(`${url}${def.api}/system/status`, { timeoutMs })
  return { ok: Boolean(s && (s.status === 401 || s.status === 200)) }
}

/** A connection to check (and, if it works, to save). */
export interface Endpoint {
  url: string
  apiKey?: string
  username?: string
  password?: string
}

export interface Verdict {
  ok: boolean
  message: string
  version?: string
  /** What to save (Jellyfin: its own API key for Finesse, and its path). */
  save?: { url: string; apiKey?: string; username?: string; password?: string; basePath?: string }
}

/** Checks a connection end to end, with the credentials, and says plainly what's wrong if it fails. */
export async function verify(id: ExistingId, ep: Endpoint): Promise<Verdict> {
  const def = DEFS[id]
  const url = normalizeUrl(ep.url)
  if (!url) return { ok: false, message: `Enter ${def.name}’s address, like http://192.168.1.20:${def.port}` }
  const unreachable: Verdict = { ok: false, message: `Nothing answered at ${url}. Check the address and port, and that ${def.name} is running.` }

  if (id === 'jellyfin') {
    const a = await answers('jellyfin', url, 8000)
    if (!a.ok) return { ok: false, message: `${unreachable.message} (If it uses a path like /jellyfin, include it.)` }
    if (!ep.username) return { ok: false, message: 'Enter the username and password of a Jellyfin administrator' }
    const J = `${url}${a.base}`
    const client = 'MediaBrowser Client="Finesse", Device="finesse-server", DeviceId="finesse-server", Version="1.0.0"'
    const auth = await get(`${J}/Users/AuthenticateByName`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: client }, body: JSON.stringify({ Username: ep.username, Pw: ep.password ?? '' }), timeoutMs: 15000 })
    if (!auth || auth.status === 401) return { ok: false, message: 'Jellyfin didn’t accept that username and password' }
    const me = json<{ AccessToken?: string; User?: { Policy?: { IsAdministrator?: boolean } } }>(auth.text)
    if (auth.status !== 200 || !me?.AccessToken) return { ok: false, message: `Jellyfin answered ${auth.status} when signing in` }
    if (!me.User?.Policy?.IsAdministrator) return { ok: false, message: `${ep.username} isn’t an administrator in Jellyfin. Use an administrator’s account.` }
    const h = { Authorization: `${client}, Token="${me.AccessToken}"` }
    const keys = async () => json<{ Items?: { AppName?: string; AccessToken?: string }[] }>((await get(`${J}/Auth/Keys`, { headers: h, timeoutMs: 10000 }))?.text ?? '')?.Items ?? []
    let key = (await keys()).find((k) => k.AppName === 'Finesse')?.AccessToken
    if (!key) {
      await get(`${J}/Auth/Keys?app=Finesse`, { method: 'POST', headers: h, timeoutMs: 10000 })
      key = (await keys()).find((k) => k.AppName === 'Finesse')?.AccessToken
    }
    if (!key) return { ok: false, message: 'Signed in, but Jellyfin wouldn’t create an API key for Finesse' }
    return { ok: true, message: `Connected to Jellyfin ${a.version ?? ''}`.trim(), version: a.version, save: { url, apiKey: key, basePath: a.base ?? '' } }
  }

  if (id === 'sabnzbd') {
    const a = await answers('sabnzbd', url)
    if (!a.ok) {
      // A common slip: the address without SABnzbd's /sabnzbd path.
      if (!/\/sabnzbd$/i.test(url) && (await answers('sabnzbd', `${url}/sabnzbd`)).ok) return verify(id, { ...ep, url: `${url}/sabnzbd` })
      return unreachable
    }
    if (!ep.apiKey) return { ok: false, message: 'Enter SABnzbd’s API key (Config → General → API Key)' }
    const r = await get(`${url}/api?mode=queue&output=json&limit=1&apikey=${encodeURIComponent(ep.apiKey)}`, { timeoutMs: 10000 })
    const body = r ? json<{ error?: string; queue?: unknown }>(r.text) : null
    if (!body?.queue) return { ok: false, message: body?.error ? `SABnzbd says: ${body.error}` : 'SABnzbd didn’t accept that API key' }
    return { ok: true, message: `Connected to SABnzbd ${a.version}`, version: a.version, save: { url, apiKey: ep.apiKey } }
  }

  if (id === 'qbittorrent') {
    const a = await answers('qbittorrent', url)
    if (!a.ok) return unreachable
    const r = await get(`${url}/api/v2/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, Origin: url }, body: new URLSearchParams({ username: ep.username ?? '', password: ep.password ?? '' }).toString(), timeoutMs: 10000 })
    if (!r) return unreachable
    if (r.status === 403) return { ok: false, message: 'qBittorrent has locked sign-ins for a while after too many wrong passwords. Wait a few minutes and try again.' }
    if (r.text.trim() !== 'Ok.') return { ok: false, message: 'qBittorrent didn’t accept that username and password' }
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
    const v = await get(`${url}/api/v2/app/version`, { headers: { Cookie: cookie }, timeoutMs: 8000 })
    const version = v?.status === 200 ? v.text.trim() : a.version
    return { ok: true, message: `Connected to qBittorrent ${version ?? ''}`.trim(), version, save: { url, username: ep.username, password: ep.password } }
  }

  // Sonarr, Radarr, Lidarr, Prowlarr.
  if (!ep.apiKey) {
    return (await answers(id, url)).ok ? { ok: false, message: `Enter ${def.name}’s API key (Settings → General → API Key)` } : unreachable
  }
  const r = await get(`${url}${def.api}/system/status`, { headers: { 'X-Api-Key': ep.apiKey }, timeoutMs: 10000 })
  if (!r) return unreachable
  if (r.status === 401) return { ok: false, message: `${def.name} didn’t accept that API key` }
  const status = r.status === 200 ? json<{ appName?: string; instanceName?: string; version?: string }>(r.text) : null
  if (!status) return (await answers(id, url)).ok ? { ok: false, message: `${def.name} answered ${r.status}` } : unreachable
  if (status.appName && status.appName.toLowerCase() !== def.name.toLowerCase()) return { ok: false, message: `That’s ${status.appName}, not ${def.name}. Check the port.` }
  return { ok: true, message: `Connected to ${status.instanceName && status.instanceName !== def.name ? `${status.instanceName} (${def.name})` : def.name} ${status.version ?? ''}`.trim(), version: status.version, save: { url, apiKey: ep.apiKey } }
}

// ---------------------------------------------------------------------------
// Finding them
// ---------------------------------------------------------------------------

/** One app found somewhere. */
interface Candidate {
  id: ExistingId
  /** In words: 'container “sonarr”', 'this computer'. */
  where: string
  source: 'docker' | 'computer'
  container?: string
  running: boolean
  /** Addresses to try, best first. */
  urls: string[]
  config: AppConfig
}

/** What the setup page shows for an app (no secrets: those stay on the server). */
export interface Found {
  id: ExistingId
  name: string
  state: 'ready' | 'needs-login' | 'needs-key' | 'stopped' | 'unreachable' | 'not-found'
  message: string
  where?: string
  url?: string
  version?: string
  /** A username its settings file gave (qBittorrent). */
  username?: string
  /** More than one was found; this one was picked. */
  others?: number
}

export interface ScanResult {
  apps: Found[]
  /** Where Finesse looked, in words. */
  looked: string[]
}

/** The secrets (keys) a scan found, kept on the server for connect. */
export type Secrets = Partial<Record<ExistingId, Endpoint & { container?: string; where?: string }>>

const imageName = (image: string) => {
  const noDigest = image.split('@')[0]!
  const last = noDigest.split('/').pop()!
  // binhex/arch-sonarr, binhex/arch-qbittorrentvpn: the same apps.
  return last.replace(/:[^:]*$/, '').replace(/^(binhex-|arch-)+/i, '')
}

export function appOfImage(image: string): ExistingId | null {
  const n = imageName(image)
  return EXISTING_IDS.find((id) => DEFS[id].image.test(n)) ?? null
}

async function fromDocker(docker: Docker, me: ContainerInspect | null, extraHosts: string[]): Promise<Candidate[]> {
  const out: Candidate[] = []
  const all = await docker.list()
  const myNets = new Set(Object.keys(me?.NetworkSettings.Networks ?? {}).filter((n) => !['bridge', 'host', 'none'].includes(n)))
  const gateways = [...new Set([...Object.values(me?.NetworkSettings.Networks ?? {}).map((n) => n.Gateway).filter((g): g is string => Boolean(g)), ...extraHosts, 'host.docker.internal', '172.17.0.1'])]
  for (const c of all) {
    if (c.Labels?.['finesse.managed'] === 'true') continue // Finesse's own apps
    if (me && c.Id === me.Id) continue
    const id = appOfImage(c.Image)
    if (!id) continue
    const info = await docker.inspect(c.Id).catch(() => null)
    if (!info) continue
    const name = (info.Name ?? c.Names?.[0] ?? '').replace(/^\//, '')
    const def = DEFS[id]
    // Its settings file, straight out of the container.
    let config: AppConfig = {}
    const configDir = info.Mounts.find((m) => m.Destination === '/config') ? '/config' : (info.Mounts.find((m) => /config/i.test(m.Destination))?.Destination ?? '/config')
    for (const f of def.files) {
      const data = await docker.readFile(c.Id, `${configDir}/${f}`).catch(() => null)
      if (data) {
        config = parseConfig(id, data.toString('utf8'))
        break
      }
    }
    const port = config.port ?? def.port
    const base = id === 'jellyfin' ? '' : (config.base ?? '')
    const urls: string[] = []
    const nets = info.NetworkSettings.Networks ?? {}
    const mode = String((info.HostConfig as { NetworkMode?: string }).NetworkMode ?? '')
    // 1. A network Finesse is on too: by name.
    if (Object.keys(nets).some((n) => myNets.has(n))) urls.push(`http://${name}:${port}${base}`)
    // 2. Host networking: on the host's address.
    if (mode === 'host') for (const g of gateways) urls.push(`http://${g}:${port}${base}`)
    // 3. A published port, on the host's address.
    const pub = info.NetworkSettings.Ports?.[`${port}/tcp`]?.find((b) => b.HostPort)?.HostPort
    if (pub) for (const g of gateways) urls.push(`http://${g}:${pub}${base}`)
    // 4. Its own address.
    for (const n of Object.values(nets)) if (n.IPAddress) urls.push(`http://${n.IPAddress}:${port}${base}`)
    out.push({ id, where: `container “${name}”`, source: 'docker', container: name, running: info.State.Running, urls: [...new Set(urls)], config })
  }
  return out
}

/** Settings files of apps installed on this computer, where their installers put them. */
function localConfigs(extraDirs: string[]): { id: ExistingId; file: string; config: AppConfig }[] {
  const home = homedir()
  const win = process.platform === 'win32'
  const users = win ? listDir('C:\\Users').map((u) => join('C:\\Users', u)) : []
  const known: [ExistingId, string][] = []
  for (const [id, folder] of [['sonarr', 'Sonarr'], ['radarr', 'Radarr'], ['lidarr', 'Lidarr'], ['prowlarr', 'Prowlarr']] as const) {
    if (win) known.push([id, join(process.env.ProgramData ?? 'C:\\ProgramData', folder, 'config.xml')])
    known.push([id, join('/var/lib', id, 'config.xml')], [id, join(home, '.config', folder, 'config.xml')])
  }
  for (const u of win ? users : [home]) {
    known.push(['sabnzbd', win ? join(u, 'AppData', 'Local', 'sabnzbd', 'sabnzbd.ini') : join(u, '.sabnzbd', 'sabnzbd.ini')])
    known.push(['qbittorrent', win ? join(u, 'AppData', 'Roaming', 'qBittorrent', 'qBittorrent.ini') : join(u, '.config', 'qBittorrent', 'qBittorrent.conf')])
  }
  if (win) known.push(['jellyfin', join(process.env.ProgramData ?? 'C:\\ProgramData', 'Jellyfin', 'Server', 'config', 'network.xml')])
  else known.push(['jellyfin', '/etc/jellyfin/network.xml'])
  // Extra folders to search (FINESSE_EXISTING_DIRS): each app's settings file, a few levels down.
  for (const dir of extraDirs) for (const file of walk(dir, 4)) {
    const base = file.split(/[\\/]/).pop()!.toLowerCase()
    const lower = file.toLowerCase()
    if (base === 'config.xml') {
      const text = safeRead(file)
      const inst = /<InstanceName>([^<]+)</i.exec(text)?.[1]?.toLowerCase()
      const id = (['sonarr', 'radarr', 'lidarr', 'prowlarr'] as const).find((a) => inst === a || lower.includes(a))
      if (id) known.push([id, file])
    } else if (base === 'sabnzbd.ini') known.push(['sabnzbd', file])
    else if (base === 'qbittorrent.conf' || base === 'qbittorrent.ini') known.push(['qbittorrent', file])
    else if (base === 'network.xml' && lower.includes('jellyfin')) known.push(['jellyfin', file])
  }
  const out: { id: ExistingId; file: string; config: AppConfig }[] = []
  for (const [id, file] of known) {
    const text = safeRead(file)
    if (text) out.push({ id, file, config: parseConfig(id, text) })
  }
  return out
}

function listDir(d: string): string[] {
  try {
    return readdirSync(d)
  } catch {
    return []
  }
}

function safeRead(f: string): string {
  try {
    return existsSync(f) && statSync(f).size < 1 << 20 ? readFileSync(f, 'utf8') : ''
  } catch {
    return ''
  }
}

function* walk(dir: string, depth: number): Generator<string> {
  if (depth < 0) return
  for (const n of listDir(dir)) {
    const p = join(dir, n)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walk(p, depth - 1)
    else yield p
  }
}

async function fromComputer(hosts: string[], extraDirs: string[]): Promise<Candidate[]> {
  const out: Candidate[] = []
  const configs = localConfigs(extraDirs)
  for (const id of EXISTING_IDS) {
    const def = DEFS[id]
    const mine = configs.filter((c) => c.id === id)
    // Its port from its settings first, then the usual ones.
    const tries: { port: number; base: string; config: AppConfig; where: string }[] = []
    for (const c of mine) tries.push({ port: c.config.port ?? def.port, base: id === 'jellyfin' ? '' : (c.config.base ?? ''), config: c.config, where: 'this computer' })
    for (const port of [def.port, ...(def.alsoPorts ?? [])]) tries.push({ port, base: id === 'sabnzbd' ? '/sabnzbd' : '', config: {}, where: 'this computer' })
    const seen = new Set<string>()
    for (const t of tries) {
      for (const h of hosts) {
        const url = `http://${h}:${t.port}${t.base}`
        if (seen.has(url)) continue
        seen.add(url)
        out.push({ id, where: t.where, source: 'computer', running: true, urls: [url], config: t.config })
      }
    }
  }
  return out
}

/** Looks everywhere it can, then checks each find. Secrets go in `secrets`, never in the result. */
export async function scan(opts: { docker?: Docker | null; me?: ContainerInspect | null; hosts?: string[]; extraDirs?: string[]; joinNetworks?: boolean; computer?: boolean }): Promise<{ result: ScanResult; secrets: Secrets }> {
  const looked: string[] = []
  const candidates: Candidate[] = []
  // This computer, plus (in Docker) the host it runs on, where apps installed without Docker live.
  const gateways = Object.values(opts.me?.NetworkSettings.Networks ?? {}).map((n) => n.Gateway).filter((g): g is string => Boolean(g))
  const hosts = [...new Set(['127.0.0.1', ...(opts.hosts ?? []), ...gateways])]
  if (opts.docker) {
    try {
      candidates.push(...(await fromDocker(opts.docker, opts.me ?? null, opts.hosts ?? [])))
      looked.push('in your Docker containers')
    } catch (e) {
      log.warn(`couldn't list containers: ${(e as Error).message}`)
    }
  }
  if (opts.computer !== false) {
    candidates.push(...(await fromComputer(hosts, opts.extraDirs ?? [])))
    looked.push(gateways.length ? 'on the server Docker runs on' : 'on this computer')
  }

  // Try every address of every find at once (an address that doesn't answer costs its timeout,
  // so one after another could take minutes); keep the first that answers, in order of preference.
  const reach = new Map<Candidate, { url: string; version?: string; base?: string } | null>()
  await Promise.all(
    candidates.map(async (c) => {
      if (!c.running) return reach.set(c, null)
      const tries = await Promise.all(c.urls.map((url) => answers(c.id, url, c.source === 'computer' ? 1500 : 4000).then((a) => ({ url, ...a }))))
      const hit = tries.find((t) => t.ok)
      reach.set(c, hit ? { url: hit.url, version: hit.version, base: hit.base } : null)
    }),
  )

  const apps: Found[] = []
  const secrets: Secrets = {}
  for (const id of EXISTING_IDS) {
    const def = DEFS[id]
    const mine = candidates.filter((c) => c.id === id)
    const containers = mine.filter((c) => c.source === 'docker')
    let best: Found | null = null
    let bestSecret: Secrets[ExistingId] | undefined
    for (const c of mine) {
      if (!c.running) {
        best ??= { id, name: def.name, state: 'stopped', where: c.where, message: `Found ${c.where}, but it isn’t running. Start it, then look again.` }
        continue
      }
      let reached = reach.get(c) ?? null
      // Docker: a container on a network Finesse isn't on can't be reached; join it and try by name.
      if (!reached && c.source === 'docker' && c.container && opts.docker && opts.me && opts.joinNetworks !== false) {
        const info = await opts.docker.inspect(c.container).catch(() => null)
        for (const net of Object.keys(info?.NetworkSettings.Networks ?? {}).filter((n) => !['bridge', 'host', 'none'].includes(n))) {
          await opts.docker.connect(net, opts.me.Id).catch((e) => log.warn(`couldn't join ${net}: ${(e as Error).message}`))
          const port = c.config.port ?? def.port
          const url = `http://${c.container}:${port}${id === 'jellyfin' ? '' : (c.config.base ?? '')}`
          const a = await answers(id, url)
          if (a.ok) {
            reached = { url, version: a.version, base: a.base }
            break
          }
        }
      }
      if (!reached) {
        if (c.source === 'docker') best ??= { id, name: def.name, state: 'unreachable', where: c.where, message: `Found ${c.where}, but Finesse can’t reach it. Enter the address you open it at.` }
        continue
      }
      const ep: Endpoint = { url: reached.url, apiKey: c.config.apiKey, username: c.config.username }
      let found: Found
      if (def.ask === 'admin') found = { id, name: def.name, state: 'needs-login', where: c.where, url: reached.url, version: reached.version, message: 'Sign in with a Jellyfin administrator’s account' }
      else if (def.ask === 'login') found = { id, name: def.name, state: 'needs-login', where: c.where, url: reached.url, version: reached.version, username: c.config.username, message: 'Enter qBittorrent’s Web UI password' }
      else if (c.config.apiKey) {
        const v = await verify(id, ep)
        found = v.ok
          ? { id, name: def.name, state: 'ready', where: c.where, url: v.save?.url ?? reached.url, version: v.version ?? reached.version, message: v.message }
          : { id, name: def.name, state: 'needs-key', where: c.where, url: reached.url, version: reached.version, message: `Found it, but its key from its settings didn’t work (${v.message}). Paste its API key.` }
        if (v.ok && v.save) ep.url = v.save.url
      } else found = { id, name: def.name, state: 'needs-key', where: c.where, url: reached.url, version: reached.version, message: `Found it. Paste its API key (${id === 'sabnzbd' ? 'Config' : 'Settings'} → General → API Key).` }
      const rank = (f: Found | null) => (f ? ['ready', 'needs-login', 'needs-key', 'unreachable', 'stopped', 'not-found'].indexOf(f.state) : 99)
      if (rank(found) < rank(best)) {
        best = found
        bestSecret = { ...ep, container: c.container, where: c.where }
      }
      if (best?.state === 'ready' && c.source === 'computer') break
    }
    if (best && containers.length > 1) best.others = containers.length - 1
    apps.push(best ?? { id, name: def.name, state: 'not-found', message: `No ${def.name} found. If you have one, enter its address.` })
    if (bestSecret && best && best.state !== 'stopped' && best.state !== 'unreachable') secrets[id] = bestSecret
  }
  return { result: { apps, looked }, secrets }
}

// ---------------------------------------------------------------------------
// Connecting
// ---------------------------------------------------------------------------

/** What the setup page sends: per app, nothing (use what the scan found), corrections, or skip. */
export type ConnectRequest = Partial<Record<ExistingId, (Partial<Endpoint> & { skip?: boolean }) | undefined>>

export interface ConnectResult {
  ok: boolean
  results: Partial<Record<ExistingId, Verdict>>
}

/** Checks every chosen app with its credentials; saves only when every one of them works. */
export async function connect(req: ConnectRequest, secrets: Secrets, save: (s: (x: Settings) => void) => void): Promise<ConnectResult> {
  const results: Partial<Record<ExistingId, Verdict>> = {}
  const chosen = EXISTING_IDS.filter((id) => req[id] && !req[id]!.skip)
  if (!chosen.includes('jellyfin')) return { ok: false, results: { jellyfin: { ok: false, message: 'Finesse needs Jellyfin. Connect yours, or choose “Set it all up for me” instead.' } } }
  await Promise.all(
    chosen.map(async (id) => {
      const r = req[id]!
      const known = secrets[id] ?? ({} as Endpoint)
      const sameUrl = !r.url || normalizeUrl(r.url) === normalizeUrl(known.url ?? '')
      // A key found by the scan is only used for the address it was found at.
      const ep: Endpoint = {
        url: r.url || known.url || '',
        apiKey: r.apiKey || (sameUrl ? known.apiKey : undefined),
        username: r.username || (sameUrl ? known.username : undefined),
        password: r.password,
      }
      results[id] = await verify(id, ep).catch((e) => ({ ok: false, message: (e as Error).message }))
    }),
  )
  if (!chosen.every((id) => results[id]?.ok)) return { ok: false, results }
  const at = new Date().toISOString()
  save((s) => {
    const jf = results.jellyfin!.save!
    s.mode = 'adopt'
    s.jellyfin = { url: jf.url, apiKey: jf.apiKey, basePath: jf.basePath ?? '' }
    for (const id of chosen) {
      if (id === 'jellyfin') continue
      const v = results[id]!.save!
      s.services[id] = id === 'qbittorrent' ? { url: v.url, username: v.username, password: v.password } : { url: v.url, apiKey: v.apiKey }
    }
    s.existing = {
      connectedAt: at,
      apps: Object.fromEntries(chosen.map((id) => [id, { where: secrets[id]?.where ?? 'entered by hand', ...(secrets[id]?.container ? { container: secrets[id]!.container } : {}) }])),
    }
    s.setup = { ...s.setup, state: 'ready', completedAt: at, lastError: undefined }
  })
  log.info(`connected to existing ${chosen.map((id) => DEFS[id].name).join(', ')}`)
  return { ok: true, results }
}
