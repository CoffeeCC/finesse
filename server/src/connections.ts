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
}

export interface ConnReport {
  checkedAt: string
  apps: ConnCheck[]
  vpn: { ok: ConnOk; summary: string; source: 'gluetun' | 'inferred' } | null
}

/** GET/POST returning parsed JSON, or throwing an Error whose message is a plain reason. */
export type ConnFetch = (url: string | URL, init: { method?: string; headers?: Record<string, string> }) => Promise<{ status: number; json: unknown }>

const liveFetch: ConnFetch = async (url, init) => {
  const r = await fetch(url, { method: init.method ?? 'GET', headers: init.headers, signal: AbortSignal.timeout(10000) })
  const text = await r.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: r.status, json }
}

const ARRS = [
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

async function checkArr(def: (typeof ARRS)[number], svc: Endpoint, get: ConnFetch): Promise<ConnCheck> {
  const headers = { 'x-api-key': svc.apiKey ?? '' }
  const url = (p: string) => joinUrl(svc.url!, `${def.api}/${p}`)
  const out: ConnCheck = { id: def.id, name: def.name, ok: true, summary: 'Working', problems: [] }
  let status: Awaited<ReturnType<ConnFetch>>
  try {
    status = await get(url('system/status'), { headers })
  } catch (e) {
    return { ...out, ok: false, summary: unreachable(def.name, e) }
  }
  if (status.status === 401 || status.status === 403) return { ...out, ok: false, summary: `${def.name} turned down Finesse’s API key. Copy the key from ${def.name} (Settings → General) into Finesse again.` }
  if (status.status >= 400) return { ...out, ok: false, summary: `${def.name} answered with an error (${status.status}). Check its logs.` }

  // Its own health list: errors break things, warnings are worth a look.
  try {
    const h = await get(url('health'), { headers })
    for (const item of Array.isArray(h.json) ? (h.json as ArrHealthItem[]) : []) {
      if (!item?.message) continue
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
    }
  } catch {
    /* the list itself was checked above; a failing test call isn't a verdict */
  }
  if (out.problems.length) out.summary = out.ok === false ? `${out.problems.length} problem${out.problems.length > 1 ? 's' : ''}: open ${def.name} to fix ${out.problems.length > 1 ? 'them' : 'it'}` : 'Working, with warnings'
  return out
}

async function checkSab(svc: Endpoint, get: ConnFetch): Promise<ConnCheck> {
  const out: ConnCheck = { id: 'sabnzbd', name: 'SABnzbd', ok: true, summary: 'Working', problems: [] }
  const q = (mode: string) => joinUrl(svc.url!, '/api', `?mode=${mode}&output=json&apikey=${encodeURIComponent(svc.apiKey ?? '')}`)
  let r: Awaited<ReturnType<ConnFetch>>
  try {
    r = await get(q('queue'), {})
  } catch (e) {
    return { ...out, ok: false, summary: unreachable('SABnzbd', e) }
  }
  const j = (r.json ?? {}) as { error?: string; queue?: { paused?: boolean; status?: string } }
  if (r.status >= 400 || j.error) {
    const key = /api key/i.test(j.error ?? '')
    return { ...out, ok: false, summary: key ? 'SABnzbd turned down Finesse’s API key. Copy it from SABnzbd (Config → General) into Finesse again.' : `SABnzbd answered with an error${j.error ? `: ${j.error}` : ` (${r.status})`}.` }
  }
  if (j.queue?.paused) {
    out.ok = null
    out.summary = 'Downloads are paused'
    out.problems.push('SABnzbd is paused: nothing downloads until it’s resumed (Requests → Downloads, or SABnzbd itself).')
  }
  return out
}

async function checkQbit(svc: Endpoint, get: ConnFetch): Promise<ConnCheck> {
  const out: ConnCheck = { id: 'qbittorrent', name: 'qBittorrent', ok: true, summary: 'Answering', problems: [] }
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

/** Every connected app, checked. */
export async function checkConnections(s: Settings, get: ConnFetch = liveFetch): Promise<ConnReport> {
  const svc = s.services
  const jobs: Promise<ConnCheck>[] = []
  for (const def of ARRS) {
    const e = svc[def.id]
    if (e?.url && e.apiKey) jobs.push(checkArr(def, e, get))
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
