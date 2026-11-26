// One-click repairs for what Connected apps finds (connections.ts). Each one is
// small, says what it changes before it's clicked, and changes only that:
//   sab-hostname: SABnzbd turns Finesse away by name (its hostname check).
//     SABnzbd skips that check for an address given as an IP, so Finesse asks
//     it by IP to add the name to its allowed list (misc → host_whitelist).
//   remote-paths: Radarr/Sonarr/Lidarr can't find the folder their download
//     client says it saved to. Finesse works out where that folder is inside
//     the app, from the two containers' folders in Docker or from a mapping
//     another app already uses for the same client, checks the app can see
//     it, and adds (or corrects) the remote path mapping.
// Works on someone's own apps (adopt) and on Finesse's alike. Never logs a key.

import { lookup } from 'node:dns/promises'
import { mkdirSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { posix } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Endpoint, Settings, SettingsStore } from './config.ts'
import { ARRS, connectionRepairs, liveFetch, REMOTE_PATH, unreachable, type AutoConnectionFix, type ConnFetch, type ConnFix } from './connections.ts'
import { logger } from './log.ts'
import { joinUrl } from './http/proxy.ts'
import { fromApp } from './stack/apppaths.ts'

export interface FixDeps {
  get: ConnFetch
  /** A GET to the same port by IP address, with the IP as the Host (SABnzbd's hostname check skips those). */
  byIp: (url: string | URL) => Promise<{ status: number; json: unknown }>
  /** Docker's API, when Finesse can reach it (to read containers' folders). */
  docker?: { call: <T>(method: string, path: string) => Promise<T | null> }
}

export class FixError extends Error {}

async function bounded<T>(work: Promise<T>): Promise<T> {
  const controller = new AbortController()
  try {
    return await Promise.race([work, delay(10000, undefined, { signal: controller.signal, ref: false }).then(() => { throw new Error('timeout') })])
  } finally {
    controller.abort()
  }
}

// ---------- SABnzbd's hostname check ----------

export const liveByIp: FixDeps['byIp'] = async (url) => {
  const u = new URL(url)
  const name = u.hostname.replace(/^\[|\]$/g, '')
  const ip = isIP(name) ? name : (await bounded(lookup(name))).address
  const port = u.port || (u.protocol === 'https:' ? '443' : '80')
  const host = `${ip.includes(':') ? `[${ip}]` : ip}:${port}`
  const send = u.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = send(
      { host: ip, port, path: u.pathname + u.search, headers: { host }, signal: AbortSignal.timeout(10000), ...(u.protocol === 'https:' ? { servername: isIP(name) ? undefined : name } : {}) },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('error', reject)
        res.on('data', (c: string) => {
          text += c
          if (text.length > 1 << 20) res.destroy(new Error('SABnzbd reply was too large'))
        })
        res.on('end', () => {
          let json: unknown = null
          try {
            json = JSON.parse(text)
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, json })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function fixSabHostname(svc: Endpoint, deps: FixDeps): Promise<string> {
  const name = new URL(svc.url!).hostname
  if (isIP(name.replace(/^\[|\]$/g, ''))) throw new FixError('SABnzbd is reached by its IP address, so its hostname check isn’t what’s wrong. Check again.')
  const api = (q: string) => joinUrl(svc.url!, '/api', `?${q}&output=json&apikey=${encodeURIComponent(svc.apiKey ?? '')}`)
  let r: Awaited<ReturnType<FixDeps['byIp']>>
  try {
    r = await deps.byIp(api('mode=get_config&section=misc&keyword=host_whitelist'))
  } catch (e) {
    throw new FixError(unreachable('SABnzbd', e))
  }
  const j = r.json as { error?: string; config?: { misc?: { host_whitelist?: string[] | string } } } | null
  if (r.status === 403 || /api key/i.test(j?.error ?? '')) throw new FixError('SABnzbd turned down Finesse’s API key. Copy it from SABnzbd (Config → General) into Finesse again.')
  const raw = j?.config?.misc?.host_whitelist
  if (r.status >= 400 || raw === undefined) throw new FixError('SABnzbd didn’t share its list of allowed names. Add the name yourself: Config → Special → host_whitelist.')
  if (!(typeof raw === 'string' || (Array.isArray(raw) && raw.every((x) => typeof x === 'string')))) throw new FixError('SABnzbd sent an invalid list of allowed names.')
  const list = (Array.isArray(raw) ? raw : raw.split(',')).map((x) => x.trim()).filter(Boolean)
  if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) {
    const set = await deps.byIp(api(`mode=set_config&section=misc&keyword=host_whitelist&value=${encodeURIComponent([...list, name].join(','))}`))
    if (set.status >= 400 || (set.json as { error?: string } | null)?.error) throw new FixError('SABnzbd didn’t take the change. Add the name yourself: Config → Special → host_whitelist.')
  }
  // Now it should answer by name.
  const check = await deps.get(api('mode=version'), {}).catch(() => null)
  if (!check || check.status >= 400) throw new FixError(`SABnzbd still turns Finesse away. Restart SABnzbd, then check again.`)
  return `SABnzbd now answers to “${name}”.`
}

// ---------- remote path mappings ----------

interface Mount {
  Source: string
  Destination: string
}

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const under = (p: string, base: string) => {
  const b = trim(base)
  return p === b || p.startsWith(b === '/' ? '/' : `${b}/`)
}
const slash = (p: string) => (p.endsWith('/') ? p : `${p}/`)
const deepest = (ms: Mount[], pick: (m: Mount) => string) => [...ms].sort((a, b) => pick(b).length - pick(a).length)
const cleanDir = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/') && !/[\\\x00-\x1f]/.test(p) &&
  !p.split('/').some((part) => part === '..' || part === '.')
const translate = (p: string, from: string, to: string) => posix.join(to, posix.relative(from, p))

/** Where the client's folder `remote` is inside the app, from the two containers' folders (pure).
 *  Gives the mapping at the folder both containers share, e.g. qBittorrent /data/ → Lidarr /data/data/. */
export function mapThroughMounts(remote: string, client: Mount[], app: Mount[]): { remotePath: string; localPath: string } | null {
  if (!cleanDir(remote)) return null
  const r = trim(remote)
  const usable = (m: Mount) => cleanDir(m?.Source) && cleanDir(m?.Destination)
  const visible = deepest(app.filter(usable), (x) => x.Destination)
  for (const m of deepest(client.filter(usable), (x) => x.Destination)) {
    if (!under(r, m.Destination)) continue
    const hostPath = translate(r, m.Destination, m.Source)
    for (const a of deepest(visible, (x) => x.Source)) {
      if (!under(hostPath, a.Source)) continue
      const [remotePath, localPath] = under(trim(a.Source), m.Source)
        ? // The app's folder is the narrower one: map from there.
          [translate(a.Source, m.Source, m.Destination), a.Destination]
        : [m.Destination, translate(m.Source, a.Source, a.Destination)]
      const local = translate(r, remotePath, localPath)
      const mounted = visible.find((mount) => under(local, mount.Destination))
      if (!mounted || translate(local, mounted.Destination, mounted.Source) !== hostPath) continue
      if (trim(remotePath) === trim(localPath)) return null // same name both sides: a mapping won't help
      return { remotePath: slash(remotePath || '/'), localPath: slash(localPath || '/') }
    }
    return null
  }
  return null
}

interface Summary {
  Id: string
  Names: string[]
  Image: string
  HostConfig?: { NetworkMode?: string }
  Ports?: { PrivatePort: number; PublicPort?: number }[]
}

/** The container behind a host:port as an app names it: by container name, or by a published port
 *  (and then any container sharing that one's network, like qBittorrent inside Gluetun). */
export function findContainer(list: Summary[], host: string, port: number, hint: string): Summary | null {
  const name = (c: Summary) => c.Names.map((n) => n.replace(/^\//, ''))
  const byName = list.filter((c) => name(c).includes(host))
  let found = byName.length ? byName : list.filter((c) => c.Ports?.some((p) => p.PublicPort === port))
  found = [...found, ...list.filter((c) => found.some((f) => c.HostConfig?.NetworkMode === `container:${f.Id}`))]
  const h = hint.toLowerCase()
  const hinted = found.filter((c) => name(c).some((n) => n.toLowerCase().includes(h)) || c.Image.toLowerCase().includes(h))
  const pick = hinted.length ? hinted : found
  return pick.length === 1 ? pick[0]! : null
}

const field = (c: { fields?: { name?: string; value?: unknown }[] }, n: string) => c.fields?.find((f) => f.name === n)?.value

interface Mapping {
  id?: number
  host?: string
  remotePath?: string
  localPath?: string
}

async function fixRemotePaths(def: (typeof ARRS)[number], s: Settings, deps: FixDeps): Promise<string> {
  const svc = s.services[def.id]!
  const headers = { 'x-api-key': svc.apiKey ?? '' }
  const url = (p: string) => {
    const [path, query] = p.split('?')
    return joinUrl(svc.url!, `${def.api}/${path}`, query ? `?${query}` : '')
  }
  const json = async <T>(p: string): Promise<T> => {
    const r = await deps.get(url(p), { headers }).catch((e) => {
      throw new FixError(unreachable(def.name, e))
    })
    if (r.status >= 400) throw new FixError(`${def.name} answered with an error (${r.status}). Check it’s running, then try again.`)
    return r.json as T
  }

  const health = await json<{ message?: string }[]>('health')
  if (!Array.isArray(health)) throw new FixError(`${def.name} sent an invalid health report.`)
  const missing = health.map((h) => typeof h?.message === 'string' ? REMOTE_PATH.exec(h.message) : null)
    .filter((m): m is RegExpExecArray => Boolean(m)).map((m) => ({
      client: m[1]!.trim(),
      remote: m[2]!.trim().replace(/^["']|["']$/g, '').replace(/\.$/, ''),
    }))
  if (!missing.length) return `${def.name} can find its download folders now. Nothing to change.`
  const clients = await json<{ name?: string; implementation?: string; fields?: { name?: string; value?: unknown }[] }[]>('downloadclient')
  const mappings = await json<Mapping[]>('remotepathmapping')
  if (!Array.isArray(clients) || !Array.isArray(mappings)) throw new FixError(`${def.name} sent invalid download client or folder data.`)

  // Docker, when Finesse can reach it: the app's container, once.
  let list: Summary[] | null = null
  const inspect = async (id: string) => (await bounded(deps.docker!.call<{ Mounts?: Mount[] }>('GET', `/containers/${id}/json`)))?.Mounts ?? []
  if (deps.docker) list = await bounded(deps.docker.call<Summary[]>('GET', '/containers/json')).catch(() => null)
  const appUrl = new URL(svc.url!)
  const appBox = list && findContainer(list, appUrl.hostname, Number(appUrl.port || 80), def.id)
  const appMounts = appBox ? await inspect(appBox.Id).catch(() => []) : []

  /** Lists subdirectories inside `dir` as seen by the app. */
  const listDirs = async (dir: string): Promise<string[]> => {
    const r = await json<{ directories?: { path?: string }[] }>(`filesystem?path=${encodeURIComponent(slash(trim(dir)))}&includeFiles=false`).catch(() => null)
    return Array.isArray(r?.directories) ? r.directories.map((x) => x?.path).filter(cleanDir) : []
  }

  /** Whether the app can see this folder (it lists the parent and looks for it). */
  const sees = async (dir: string) => {
    const d = trim(dir)
    if (d === '/') return true
    const parent = d.slice(0, d.lastIndexOf('/')) || '/'
    return (await listDirs(parent)).some((p) => trim(p) === d)
  }

  const done: string[] = []
  const written = new Set<string>()
  const failed: string[] = []
  for (const { client, remote } of missing) {
    const c = clients.find((x) => x?.name === client)
    const host = String(field(c ?? {}, 'host') ?? '')
    if (!c || !host || !cleanDir(remote)) {
      failed.push(client)
      continue
    }
    const candidates: { remotePath: string; localPath: string }[] = []
    if (list && appMounts.length) {
      const box = findContainer(list, host, Number(field(c, 'port') ?? 0), String(c.implementation ?? client))
      if (box) {
        const m = mapThroughMounts(remote, await inspect(box.Id).catch(() => []), appMounts)
        if (m) candidates.push(m)
      }
    }
    // Another app already maps this client's folders: the same mapping, if this app sees that folder too.
    for (const other of ARRS) {
      const o = s.services[other.id]
      if (other.id === def.id || !other.clients || !o?.url || !o.apiKey) continue
      const r = await deps.get(joinUrl(o.url, `${other.api}/remotepathmapping`), { headers: { 'x-api-key': o.apiKey } }).catch(() => null)
      for (const m of Array.isArray(r?.json) ? (r!.json as Mapping[]) : [])
        if (m?.host === host && cleanDir(m.remotePath) && cleanDir(m.localPath) && under(trim(remote), m.remotePath)) candidates.push({ remotePath: m.remotePath, localPath: m.localPath })
    }
    // Case mismatch or nested mount discovery straight from the app's own /filesystem API
    // (works on TrueNAS / Docker even without Docker socket access, e.g. /data/Torrents → /data/data/Torrents).
    const rTrim = trim(remote)
    if (rTrim !== '/') {
      const parent = rTrim.slice(0, rTrim.lastIndexOf('/')) || '/'
      const leaf = rTrim.slice(rTrim.lastIndexOf('/') + 1).toLowerCase()
      const parentDirs = await listDirs(parent)
      const sibling = parentDirs.find((p) => {
        const t = trim(p)
        return t !== rTrim && t.slice(t.lastIndexOf('/') + 1).toLowerCase() === leaf
      })
      if (sibling) {
        candidates.push({ remotePath: slash(rTrim), localPath: slash(trim(sibling)) })
      } else {
        // Check 1 level deeper inside the parent and common mount roots (bounded to 12 probes).
        const probeRoots = [...new Set([...parentDirs, '/data', '/downloads', '/mnt', '/media'])]
          .map(trim)
          .filter((d) => d !== rTrim && !/^\/(?:proc|sys|dev|etc|usr|var|bin|lib|config|tmp)(?:\/|$)/i.test(d))
          .slice(0, 12)
        for (const dir of probeRoots) {
          const children = await listDirs(dir)
          const hit = children.find((p) => {
            const t = trim(p)
            return t !== rTrim && t.slice(t.lastIndexOf('/') + 1).toLowerCase() === leaf
          })
          if (hit) {
            candidates.push({ remotePath: slash(rTrim), localPath: slash(trim(hit)) })
            break
          }
        }
      }
    }
    let fixed = false
    for (const m of candidates) {
      if (!(await sees(translate(trim(remote), m.remotePath, m.localPath)))) continue
      const key = `${host}\0${trim(m.remotePath)}`
      if (written.has(key)) { fixed = true; break }
      const same = mappings.find((x) => x?.host === host && cleanDir(x.remotePath) && trim(x.remotePath) === trim(m.remotePath))
      const body = { ...same, host, remotePath: m.remotePath, localPath: m.localPath }
      const w = await deps.get(url(same?.id ? `remotepathmapping/${same.id}` : 'remotepathmapping'), { method: same?.id ? 'PUT' : 'POST', headers, body }).catch(() => null)
      if (!w || w.status < 200 || w.status >= 300) continue
      written.add(key)
      done.push(`${m.remotePath} → ${m.localPath}`)
      fixed = true
      break
    }
    if (!fixed) failed.push(client)
  }
  if (!done.length)
    throw new FixError(
      `Finesse couldn’t find ${failed.join(' and ')}’s downloads folder inside ${def.name}. On TrueNAS or Docker, edit ${def.name}’s storage so it mounts the same downloads dataset as ${failed.join(' / ')} (for example at /data), then click Fix again.`,
    )
  // Ask the app to re-run its health check so the warning clears right away.
  await deps.get(url('command'), { method: 'POST', headers, body: { name: 'CheckHealth' } }).catch(() => {})
  return `Added to ${def.name}: ${done.join(', ')}.${failed.length ? ` ${failed.join(' and ')} still need${failed.length > 1 ? '' : 's'} a look.` : ''}`
}

async function fixSabResume(svc: Endpoint, deps: FixDeps): Promise<string> {
  const r = await deps.get(joinUrl(svc.url!, '/api', `?mode=resume&output=json&apikey=${encodeURIComponent(svc.apiKey ?? '')}`), {}).catch((e) => {
    throw new FixError(unreachable('SABnzbd', e))
  })
  const j = (r.json ?? {}) as { error?: string }
  if (r.status >= 400 || j.error) throw new FixError(`Couldn’t resume SABnzbd${j.error ? `: ${j.error}` : ` (${r.status})`}.`)
  return 'Resumed SABnzbd downloads.'
}

async function fixProwlarrSync(target: (typeof ARRS)[number], s: Settings, deps: FixDeps): Promise<string> {
  const prowlarr = s.services.prowlarr
  if (!prowlarr?.url || !prowlarr.apiKey) throw new FixError('Prowlarr isn’t connected, so Finesse can’t sync indexers automatically.')
  const pHeaders = { 'x-api-key': prowlarr.apiKey }
  if (target.id === 'prowlarr') {
    await deps.get(joinUrl(prowlarr.url, '/api/v1/indexer/testall'), { method: 'POST', headers: pHeaders }).catch(() => {})
  }
  const sync = await deps
    .get(joinUrl(prowlarr.url, '/api/v1/command'), { method: 'POST', headers: pHeaders, body: { name: 'ApplicationIndexerSync' } })
    .catch((e) => {
      throw new FixError(unreachable('Prowlarr', e))
    })
  if (sync.status >= 400) throw new FixError(`Prowlarr couldn’t sync indexers (${sync.status}).`)
  if (target.id !== 'prowlarr') {
    const svc = s.services[target.id]
    if (svc?.url && svc.apiKey) {
      await deps.get(joinUrl(svc.url, `${target.api}/command`), { method: 'POST', headers: { 'x-api-key': svc.apiKey }, body: { name: 'CheckHealth' } }).catch(() => {})
    }
    return `Synced indexers from Prowlarr into ${target.name} and refreshed health.`
  }
  await deps.get(joinUrl(prowlarr.url, '/api/v1/command'), { method: 'POST', headers: pHeaders, body: { name: 'CheckHealth' } }).catch(() => {})
  return 'Re-tested Prowlarr indexers and synced them to your connected apps.'
}

async function fixArrRootFolder(def: (typeof ARRS)[number], s: Settings, deps: FixDeps): Promise<string> {
  const svc = s.services[def.id]!
  const headers = { 'x-api-key': svc.apiKey ?? '' }
  const url = (p: string) => joinUrl(svc.url!, `${def.api}/${p}`)
  const rfRes = await deps.get(url('rootfolder'), { headers }).catch((e) => {
    throw new FixError(unreachable(def.name, e))
  })
  if (rfRes.status >= 400 || !Array.isArray(rfRes.json)) throw new FixError(`Couldn’t read ${def.name}’s library folders.`)
  const folders = rfRes.json as { id?: number; path?: string; accessible?: boolean }[]
  const broken = folders.filter((f) => f.accessible === false && typeof f.path === 'string')
  if (!broken.length) {
    await deps.get(url('command'), { method: 'POST', headers, body: { name: 'CheckHealth' } }).catch(() => {})
    return `${def.name}’s library folders look fine now.`
  }
  const fixed: string[] = []
  const healthyCount = folders.filter((f) => f.accessible !== false).length
  for (const rf of broken) {
    // In bundle mode, recreate a missing folder inside Finesse's own /data mount.
    if (s.mode === 'bundle' && s.stack?.hostData && rf.path) {
      const host = fromApp(s.stack.hostData, rf.path)
      if (host) {
        try {
          mkdirSync(host, { recursive: true })
          fixed.push(`created ${rf.path}`)
          continue
        } catch {
          /* fall through to stale removal */
        }
      }
    }
    // If another valid root folder already exists, remove the unused dead one.
    if (healthyCount > 0 && typeof rf.id === 'number') {
      const del = await deps.get(url(`rootfolder/${rf.id}`), { method: 'DELETE', headers }).catch(() => null)
      if (del && del.status >= 200 && del.status < 300) fixed.push(`removed dead folder ${rf.path}`)
    }
  }
  if (!fixed.length) {
    throw new FixError(`${def.name} can’t see its library folder (${broken.map((b) => b.path).join(', ')}). Check the container’s storage mount and try again.`)
  }
  await deps.get(url('command'), { method: 'POST', headers, body: { name: 'CheckHealth' } }).catch(() => {})
  return `Fixed ${def.name} folders: ${fixed.join(', ')}.`
}

async function fixArrRefresh(def: (typeof ARRS)[number], s: Settings, deps: FixDeps): Promise<string> {
  const svc = s.services[def.id]!
  const headers = { 'x-api-key': svc.apiKey ?? '' }
  const url = (p: string) => joinUrl(svc.url!, `${def.api}/${p}`)
  const what = def.clients ? 'downloadclient' : 'indexer'
  await deps.get(url(`${what}/testall`), { method: 'POST', headers }).catch(() => {})
  const r = await deps.get(url('command'), { method: 'POST', headers, body: { name: 'CheckHealth' } }).catch((e) => {
    throw new FixError(unreachable(def.name, e))
  })
  if (r.status >= 400) throw new FixError(`${def.name} couldn’t refresh its health check (${r.status}).`)
  return `Re-tested connections and refreshed ${def.name}’s health check.`
}

async function fixRestartApp(app: string, s: Settings, deps: FixDeps): Promise<string> {
  if (!deps.docker) throw new FixError(`Finesse doesn’t have Docker access to restart ${app}. Restart it from your host or NAS.`)
  const svc = s.services[app as keyof Settings['services']]
  const list = await bounded(deps.docker.call<Summary[]>('GET', '/containers/json?all=true')).catch(() => null)
  if (!list) throw new FixError(`Couldn’t reach Docker to restart ${app}.`)
  const u = svc?.url ? new URL(svc.url) : null
  const box = findContainer(list, u?.hostname ?? app, Number(u?.port ?? 0), app)
  if (!box) throw new FixError(`Couldn’t find a Docker container for ${app}.`)
  await bounded(deps.docker.call('POST', `/containers/${box.Id}/restart?t=10`))
  const label = ARRS.find((x) => x.id === app)?.name ?? app
  return `Restarted ${label}. Give it a few seconds to finish starting up.`
}

/** Runs one repair; answers in a sentence, or throws a FixError that says what to do instead. */
export async function runConnectionFix(s: Settings, app: string, fix: string, deps: Partial<FixDeps> = {}): Promise<string> {
  const d: FixDeps = { get: deps.get ?? liveFetch, byIp: deps.byIp ?? liveByIp, docker: deps.docker }
  if (fix === 'sab-hostname' && app === 'sabnzbd' && s.services.sabnzbd?.url) return fixSabHostname(s.services.sabnzbd, d)
  if (fix === 'sab-resume' && app === 'sabnzbd' && s.services.sabnzbd?.url) return fixSabResume(s.services.sabnzbd, d)
  if (fix === 'restart-app') return fixRestartApp(app, s, d)
  const def = ARRS.find((x) => x.id === app)
  if (fix === 'remote-paths' && def?.clients && s.services[def.id]?.url && s.services[def.id]?.apiKey) return fixRemotePaths(def, s, d)
  if (fix === 'prowlarr-sync' && def) return fixProwlarrSync(def, s, d)
  if (fix === 'arr-rootfolder' && def && s.services[def.id]?.url && s.services[def.id]?.apiKey) return fixArrRootFolder(def, s, d)
  if (fix === 'arr-refresh' && def && s.services[def.id]?.url && s.services[def.id]?.apiKey) return fixArrRefresh(def, s, d)
  throw new FixError('Finesse doesn’t know that fix. Check again for the latest list.')
}

const log = logger('connections')
export const REPAIR_COOLDOWN_MS = 30 * 60_000

export class ConnectionRepairLoop {
  private readonly running = new Map<string, Promise<string>>()
  private readonly cooldown = new Map<string, number>()
  private readonly recent: AutoConnectionFix[] = []
  private startup: NodeJS.Timeout | null = null
  private interval: NodeJS.Timeout | null = null
  private checking: Promise<void> | null = null

  constructor(
    settings: SettingsStore,
    options: Partial<FixDeps> & { changed?: () => void; now?: () => number } = {},
  ) {
    this.settings = settings
    this.options = options
  }

  private readonly settings: SettingsStore
  private readonly options: Partial<FixDeps> & { changed?: () => void; now?: () => number }

  get autoFixed(): AutoConnectionFix[] { return this.recent.slice() }

  start(everyMs = 15 * 60_000, startupMs = 15_000) {
    if (this.interval) return
    this.startup = setTimeout(() => void this.tick(), startupMs).unref()
    this.interval = setInterval(() => void this.tick(), everyMs).unref()
  }

  stop() {
    if (this.startup) clearTimeout(this.startup)
    if (this.interval) clearInterval(this.interval)
    this.startup = this.interval = null
  }

  /** Manual calls bypass the cooldown and share a repair already in progress. */
  fix(app: string, fix: string): Promise<string> {
    const key = `${app}:${fix}`
    let work = this.running.get(key)
    if (!work) {
      work = runConnectionFix(this.settings.get(), app, fix, this.options).finally(() => {
        this.running.delete(key)
        this.options.changed?.()
      })
      this.running.set(key, work)
    }
    return work
  }

  tick(): Promise<void> {
    this.checking ??= this.check().catch(() => log.debug('Couldn’t check connected apps for automatic repairs')).finally(() => { this.checking = null })
    return this.checking
  }

  private async check() {
    const now = this.options.now ?? Date.now
    for (const [key, until] of this.cooldown) if (until <= now()) this.cooldown.delete(key)
    const config = this.settings.get()
    for (const { app, fix } of await connectionRepairs(config, this.options.get)) {
      const key = `${app}:${fix}`
      if (this.cooldown.has(key) || this.running.has(key)) continue
      const id = app as keyof Settings['services']
      const live = this.settings.get().services[id]
      if (live?.url !== config.services[id]?.url || live?.apiKey !== config.services[id]?.apiKey) continue
      await this.tryFix(app, fix)
      this.cooldown.set(key, now() + REPAIR_COOLDOWN_MS)
    }
  }

  private async tryFix(app: string, fix: ConnFix['id']) {
    try {
      const message = await this.fix(app, fix)
      this.recent.unshift({ app, fix, at: new Date((this.options.now ?? Date.now)()).toISOString(), message })
      this.recent.length = Math.min(this.recent.length, 30)
    } catch {
      log.debug(`Automatic connection repair ${fix} for ${app} could not finish`)
    }
  }
}
