// Connection health: how each app Finesse is connected to is doing *by its own
// account*. A container that's running (or an address that answers) isn't the
// same as working: Radarr can be up while its indexers fail, its download
// client is unreachable, or the VPN is down. So this asks each app:
//   Radarr / Sonarr / Lidarr: can we reach it with its key; its own health list
//     (what its System → Status page shows); and its download-client tests;
//   Prowlarr: its health list, and its indexer tests;
//   SABnzbd: reachable with its key, and whether its queue is paused;
//   qBittorrent: reachable;
//   VPN: Gluetun's control API when it's set up; otherwise guessed from the apps'
//     download-client failures when torrents are in use.
// Works whether Finesse set the apps up (bundle) or connected to someone's own
// (adopt). Messages are plain, say what to do next, and never include a key.

import type { Endpoint, Settings } from './config.ts'
import { joinUrl } from './http/proxy.ts'

export type ConnOk = boolean | null // true fine · null needs a look · false broken

export interface ConnCheck {
  id: string
  name: string
  ok: ConnOk
  /** One line: what's wrong (or "Working"). */
  summary: string
  /** Each problem the app reports, with what to do. */
  problems: string[]
  /** Something an administrator can put right in one click (Settings → Server). */
  fix?: { label: string; gpu: string }
  /** Repairs Finesse can make in the app itself (connectionFixes.ts), one click each. */
  fixes?: ConnFix[]
  /** Worth knowing, but nothing's wrong (a newer version of someone's own app). */
  notes?: string[]
  /** Browser-reachable web UI address when known (e.g. LAN IP/hostname; omitted for Docker-internal hostnames). */
  openUrl?: string
}

/** A repair: POST /api/system/connections/fix { app: check id, fix: id }. */
export interface ConnFix {
  id: 'sab-hostname' | 'sab-resume' | 'remote-paths' | 'prowlarr-sync' | 'arr-rootfolder' | 'arr-refresh' | 'restart-app'
  label: string
  /** What the click changes, said before it's clicked. */
  detail: string
}

export interface ConnReport {
  checkedAt: string
  apps: ConnCheck[]
  vpn: { ok: ConnOk; summary: string; source: 'gluetun' | 'inferred' } | null
  autoFixed?: AutoConnectionFix[]
}

export interface AutoConnectionFix {
  app: string
  fix: ConnFix['id']
  at: string
  message: string
}

/** GET/POST returning parsed JSON, or throwing an Error whose message is a plain reason. */
export type ConnFetch = (
  url: string | URL,
  init: { method?: string; headers?: Record<string, string>; body?: unknown },
) => Promise<{ status: number; json: unknown; text?: string }>

export const liveFetch: ConnFetch = async (url, init) => {
  const body = init.body === undefined ? undefined : JSON.stringify(init.body)
  const headers = body ? { 'content-type': 'application/json', ...init.headers } : init.headers
  const r = await fetch(url, { method: init.method ?? 'GET', headers, body, signal: AbortSignal.timeout(10000), redirect: 'error' })
  const text = await r.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: r.status, json, text: text.slice(0, 2000) }
}

export const ARRS = [
  { id: 'radarr', name: 'Radarr', api: '/api/v3', clients: true },
  { id: 'sonarr', name: 'Sonarr', api: '/api/v3', clients: true },
  { id: 'lidarr', name: 'Lidarr', api: '/api/v1', clients: true },
  { id: 'prowlarr', name: 'Prowlarr', api: '/api/v1', clients: false },
] as const

/** Why a call failed, said plainly (network errors carry codes, not sentences). */
export function unreachable(name: string, e: unknown): string {
  const msg = String((e as Error)?.message ?? e)
  const code = String((e as { cause?: { code?: string } })?.cause?.code ?? '')
  if (/ENOTFOUND|EAI_AGAIN/.test(code + msg)) return `Can’t find ${name} at its address. Check the address in Finesse’s settings.`
  if (/ECONNREFUSED/.test(code + msg)) return `${name} isn’t answering at its address: it may be stopped, or on another port. Start it, or fix the address.`
  if (/timeout|aborted|ETIMEDOUT/i.test(code + msg)) return `${name} didn’t answer in time. It may be busy or stopped; check it’s running.`
  return `Can’t reach ${name} (${msg.slice(0, 80)}). Check it’s running and the address is right.`
}

/** "download client qBittorrent places/is placing downloads in /data/Torrents but this directory does not appear to exist inside the container" (and older/quoted wordings). */
export const REMOTE_PATH = /download client (.+?) (?:(?:is )?placing downloads|places downloads|reports files) in ["']?([^"']+?)["']? but this directory does not appear to exist/i

/** A browser-clickable URL for the app's own web UI, or undefined if it's an internal Docker-only name. */
export function browserUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return undefined
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
  const h = u.hostname.toLowerCase()
  if (h === 'host.docker.internal' || h === 'gateway.docker.internal') return undefined
  // Single-label hostnames like "radarr", "lidarr", "sabnzbd" only resolve inside Docker's bridge network.
  if (!h.includes('.') && !h.includes(':') && h !== 'localhost') return undefined
  return `${u.origin}${u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')}`
}

/** Their own "a newer version is out": not a fault, and on a server Finesse set up it's Finesse's to bring. */
const isUpdateNotice = (item: ArrHealthItem) => item.source === 'UpdateCheck' || /^new update is available/i.test(item.message ?? '')

/** Indexer health issues that Prowlarr app sync can repair. */
export const INDEXER_HEALTH = (item: ArrHealthItem) =>
  /Indexer(Status|LongTermStatus|Rss|Search)Check/i.test(item.source ?? '') ||
  /no indexers available|indexers? (?:are )?unavailable|all (?:rss-capable|search-capable) indexers/i.test(item.message ?? '')

/** Missing root folder warning (e.g. leftover old path after moving folders). */
export const ROOT_FOLDER_HEALTH = (item: ArrHealthItem) =>
  /RootFolderCheck/i.test(item.source ?? '') || /missing root folder/i.test(item.message ?? '')

interface ArrHealthItem {
  source?: string
  type?: string
  message?: string
}
interface ArrTest {
  id?: number
  isValid?: boolean
  validationFailures?: { errorMessage?: string }[]
}

async function checkArr(def: (typeof ARRS)[number], svc: Endpoint, get: ConnFetch, s: Settings): Promise<ConnCheck> {
  const mode = s.mode
  const hasProwlarr = Boolean(def.id !== 'prowlarr' && s.services.prowlarr?.url && s.services.prowlarr?.apiKey)
  const headers = { 'x-api-key': svc.apiKey ?? '' }
  const url = (p: string) => joinUrl(svc.url!, `${def.api}/${p}`)
  const out: ConnCheck = { id: def.id, name: def.name, ok: true, summary: 'Working', problems: [], ...(browserUrl(svc.url) ? { openUrl: browserUrl(svc.url) } : {}) }
  const addFix = (fix: ConnFix) => {
    if (!out.fixes?.some((f) => f.id === fix.id)) (out.fixes ??= []).push(fix)
  }
  let status: Awaited<ReturnType<ConnFetch>>
  try {
    status = await get(url('system/status'), { headers })
  } catch (e) {
    if (mode === 'bundle') {
      addFix({
        id: 'restart-app',
        label: `Restart ${def.name}`,
        detail: `Finesse restarts the ${def.name} container and checks it again.`,
      })
    }
    return { ...out, ok: false, summary: unreachable(def.name, e) }
  }
  if (status.status === 401 || status.status === 403) return { ...out, ok: false, summary: `${def.name} turned down Finesse’s API key. Copy the key from ${def.name} (Settings → General) into Finesse again.` }
  if (status.status >= 400) return { ...out, ok: false, summary: `${def.name} answered with an error (${status.status}). Check its logs.` }

  // Its own health list: errors break things, warnings are worth a look.
  try {
    const h = await get(url('health'), { headers })
    for (const item of Array.isArray(h.json) ? (h.json as ArrHealthItem[]) : []) {
      if (!item?.message) continue
      if (isUpdateNotice(item)) {
        // Finesse pins the versions it runs; someone's own app updates the way they installed it.
        if (mode === 'adopt') (out.notes ??= []).push(`${item.message.trim().replace(/^New update is available/i, 'A newer version is out')}. Update ${def.name} the way you installed it.`)
        continue
      }
      if (REMOTE_PATH.test(item.message)) {
        addFix({
          id: 'remote-paths',
          label: 'Fix the folder mapping',
          detail: `Finesse locates the download client’s folder inside ${def.name} and adds a remote path mapping automatically.`,
        })
      } else if (hasProwlarr && INDEXER_HEALTH(item)) {
        addFix({
          id: 'prowlarr-sync',
          label: 'Sync indexers from Prowlarr',
          detail: `Finesse tells Prowlarr to push fresh indexers into ${def.name} and re-runs its health check.`,
        })
      } else if (ROOT_FOLDER_HEALTH(item)) {
        addFix({
          id: 'arr-rootfolder',
          label: 'Fix library folder',
          detail: `Finesse removes unused broken library folders (or recreates a missing Finesse folder) in ${def.name}.`,
        })
      }
      if (item.type === 'error') out.ok = false
      else if (item.type === 'warning' && out.ok) out.ok = null
      else if (item.type !== 'error' && item.type !== 'warning') continue
      out.problems.push(`${def.name}: ${item.message.trim()}`)
    }
  } catch {
    /* older apps: no health list */
  }

  // Test each download client (Radarr/Sonarr/Lidarr) or indexer (Prowlarr), as their Test buttons do.
  const what = def.clients ? 'downloadclient' : 'indexer'
  try {
    const [list, tests] = await Promise.all([get(url(what), { headers }), get(url(`${what}/testall`), { method: 'POST', headers })])
    const names = new Map((Array.isArray(list.json) ? (list.json as { id?: number; name?: string }[]) : []).map((x) => [x.id, x.name ?? '']))
    for (const t of Array.isArray(tests.json) ? (tests.json as ArrTest[]) : []) {
      if (t.isValid !== false) continue
      out.ok = false
      const label = names.get(t.id) || (def.clients ? 'A download client' : 'An indexer')
      const why = t.validationFailures?.map((f) => f.errorMessage).filter(Boolean).join('; ') || 'its test failed'
      out.problems.push(`${label} (in ${def.name}): ${why}`)
      if (def.id === 'prowlarr') {
        addFix({
          id: 'prowlarr-sync',
          label: 'Sync & re-test indexers',
          detail: 'Finesse re-tests Prowlarr’s indexers and pushes working ones to your connected apps.',
        })
      } else {
        addFix({
          id: 'arr-refresh',
          label: `Re-test & refresh ${def.name}`,
          detail: `Finesse re-tests ${def.name}’s connections and refreshes its health status.`,
        })
      }
    }
  } catch {
    /* the list itself was checked above; a failing test call isn't a verdict */
  }
  const n = out.problems.length
  if (n && !out.fixes?.length) {
    addFix({
      id: 'arr-refresh',
      label: `Refresh ${def.name} health`,
      detail: `Finesse tells ${def.name} to re-check its health and clear stale warnings.`,
    })
  }
  if (n) out.summary = out.ok === false ? `${n} problem${n > 1 ? 's' : ''}: ${out.fixes?.length ? (n > 1 ? 'Finesse can fix them here' : 'Finesse can fix it here') : `open ${def.name} to fix ${n > 1 ? 'them' : 'it'}`}` : 'Working, with warnings'
  return out
}

async function checkSab(svc: Endpoint, get: ConnFetch): Promise<ConnCheck> {
  const out: ConnCheck = { id: 'sabnzbd', name: 'SABnzbd', ok: true, summary: 'Working', problems: [], ...(browserUrl(svc.url) ? { openUrl: browserUrl(svc.url) } : {}) }
  const q = (mode: string) => joinUrl(svc.url!, '/api', `?mode=${mode}&output=json&apikey=${encodeURIComponent(svc.apiKey ?? '')}`)
  let r: Awaited<ReturnType<ConnFetch>>
  try {
    r = await get(q('queue'), {})
  } catch (e) {
    return { ...out, ok: false, summary: unreachable('SABnzbd', e) }
  }
  if (r.status === 403 && /hostname verification/i.test(r.text ?? '')) {
    const host = new URL(svc.url!).hostname
    return {
      ...out,
      ok: false,
      summary: `SABnzbd won’t answer to the name “${host}”: its hostname check turns Finesse away.`,
      problems: [`SABnzbd only answers to names on its list (Config → Special → host_whitelist). Add “${host}” there, or let Finesse do it.`],
      fixes: [{ id: 'sab-hostname', label: `Add “${host}” to SABnzbd`, detail: `Finesse adds “${host}” to SABnzbd’s list of allowed names. Nothing else changes.` }],
    }
  }
  const j = (r.json ?? {}) as { error?: string; queue?: { paused?: boolean; status?: string } }
  if (r.status >= 400 || j.error) {
    const key = /api key/i.test(j.error ?? '')
    return { ...out, ok: false, summary: key ? 'SABnzbd turned down Finesse’s API key. Copy it from SABnzbd (Config → General) into Finesse again.' : `SABnzbd answered with an error${j.error ? `: ${j.error}` : ` (${r.status})`}.` }
  }
  if (j.queue?.paused) {
    out.ok = null
    out.summary = 'Downloads are paused'
    out.problems.push('SABnzbd is paused: nothing downloads until it’s resumed.')
    out.fixes = [{ id: 'sab-resume', label: 'Resume downloads', detail: 'Finesse unpauses SABnzbd so queued downloads start moving again.' }]
  }
  return out
}

async function checkQbit(svc: Endpoint, get: ConnFetch): Promise<ConnCheck> {
  const out: ConnCheck = { id: 'qbittorrent', name: 'qBittorrent', ok: true, summary: 'Answering', problems: [], ...(browserUrl(svc.url) ? { openUrl: browserUrl(svc.url) } : {}) }
  try {
    // Answers 403 without a sign-in: that still means it's there.
    await get(joinUrl(svc.url!, '/api/v2/app/version'), {})
  } catch (e) {
    return { ...out, ok: false, summary: unreachable('qBittorrent', e) }
  }
  return out
}

async function checkGluetun(svc: Endpoint, get: ConnFetch): Promise<ConnReport['vpn']> {
  const headers: Record<string, string> = svc.apiKey ? { 'X-API-Key': svc.apiKey } : {}
  try {
    const st = await get(joinUrl(svc.url!, '/v1/vpn/status'), { headers })
    const status = (st.json as { status?: string } | null)?.status
    if (st.status === 401) return { ok: false, summary: 'The VPN’s control panel turned down Finesse’s key.', source: 'gluetun' }
    if (status !== 'running') return { ok: false, summary: `The VPN is ${status ?? 'down'}. Torrents wait until it’s back; check the VPN account and server in Gluetun’s logs.`, source: 'gluetun' }
    const ip = await get(joinUrl(svc.url!, '/v1/publicip/ip'), { headers })
    const pub = (ip.json as { public_ip?: string; country?: string } | null) ?? {}
    return pub.public_ip ? { ok: true, summary: `Connected${pub.country ? ` (${pub.country})` : ''}`, source: 'gluetun' } : { ok: null, summary: 'Connecting…', source: 'gluetun' }
  } catch (e) {
    return { ok: false, summary: unreachable('The VPN (Gluetun)', e), source: 'gluetun' }
  }
}

/** Download-client trouble that points at the VPN (torrents go through it; when it drops, qBittorrent can't be reached). */
const VPN_HINT = /qbittorrent|torrent/i
const DOWN_HINT = /unable to (communicate|connect)|connection refused|timed? ?out|unreachable|not available|failed/i

/** Background probes only read the health endpoints needed to decide on a repair. */
export async function connectionRepairs(s: Settings, get: ConnFetch = liveFetch): Promise<{ app: string; fix: ConnFix['id'] }[]> {
  const tasks: Promise<{ app: string; fix: ConnFix['id'] }[]>[] = []
  const hasProwlarr = Boolean(s.services.prowlarr?.url && s.services.prowlarr?.apiKey)
  for (const def of ARRS) {
    const svc = s.services[def.id]
    if (!def.clients || !svc?.url || !svc.apiKey) continue
    tasks.push(Promise.resolve().then(async () => {
      const r = await get(joinUrl(svc.url!, `${def.api}/health`), { headers: { 'x-api-key': svc.apiKey! } })
      if (r.status !== 200 || !Array.isArray(r.json)) return []
      const items = r.json as ArrHealthItem[]
      const found: { app: string; fix: ConnFix['id'] }[] = []
      if (items.some((item) => typeof item?.message === 'string' && REMOTE_PATH.test(item.message))) {
        found.push({ app: def.id, fix: 'remote-paths' })
      }
      if (hasProwlarr && items.some((item) => typeof item?.message === 'string' && INDEXER_HEALTH(item))) {
        found.push({ app: def.id, fix: 'prowlarr-sync' })
      }
      if (items.some((item) => typeof item?.message === 'string' && ROOT_FOLDER_HEALTH(item))) {
        found.push({ app: def.id, fix: 'arr-rootfolder' })
      }
      return found
    }).catch(() => []))
  }
  const sab = s.services.sabnzbd
  if (sab?.url && sab.apiKey) {
    tasks.push(checkSab(sab, get).then((r) => r.fixes?.some((f) => f.id === 'sab-hostname')
      ? [{ app: 'sabnzbd', fix: 'sab-hostname' as const }] : []).catch(() => []))
  }
  return (await Promise.all(tasks)).flat()
}

/** Every connected app, checked. */
export async function checkConnections(s: Settings, get: ConnFetch = liveFetch): Promise<ConnReport> {
  const svc = s.services
  const jobs: Promise<ConnCheck>[] = []
  for (const def of ARRS) {
    const e = svc[def.id]
    if (e?.url && e.apiKey) jobs.push(checkArr(def, e, get, s))
  }
  if (svc.sabnzbd?.url && svc.sabnzbd.apiKey) jobs.push(checkSab(svc.sabnzbd, get))
  if (svc.qbittorrent?.url) jobs.push(checkQbit(svc.qbittorrent, get))
  const [apps, gluetun] = await Promise.all([Promise.all(jobs), svc.gluetun?.url ? checkGluetun(svc.gluetun, get) : Promise.resolve(null)])
  let vpn = gluetun
  if (!vpn && svc.qbittorrent?.url) {
    // No VPN control panel to ask: say what the apps suggest.
    const q = apps.find((a) => a.id === 'qbittorrent')
    const clues = apps.flatMap((a) => a.problems).filter((p) => VPN_HINT.test(p) && DOWN_HINT.test(p))
    if (q?.ok === false || clues.length)
      vpn = { ok: null, summary: 'Torrents can’t get through. If qBittorrent runs behind a VPN, the VPN may be down: check it’s connected, then test the download client again.', source: 'inferred' }
  }
  return { checkedAt: new Date().toISOString(), apps, vpn }
}
