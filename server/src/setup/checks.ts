// Live checks the wizard runs while you type — each returns a plain-English
// verdict. They work before the stack exists: Usenet is tested by speaking
// NNTP directly, indexers with a real query, and the VPN by starting a
// throwaway Gluetun and asking it which public IP the world would see.

import { mkdirSync, rmSync, statfsSync, accessSync, constants } from 'node:fs'
import { connect as netConnect, type Socket } from 'node:net'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { connect as tlsConnect } from 'node:tls'
import { CATALOG } from '../stack/catalog.ts'
import type { Docker } from '../stack/docker.ts'
import { newKey, seedGluetunAuth } from '../stack/seed.ts'
import type { IndexerInput, UsenetServer } from '../stack/wire.ts'
import { vpnConfig, type VpnDoc } from './doc.ts'
import { logger } from '../log.ts'

const log = logger('checks')

export interface Verdict {
  ok: boolean
  message: string
  detail?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export async function checkSystem(
  docker: Docker,
  paths: { root: string; data: string },
  hostDevices: () => Promise<string[]>,
  portFree?: (p: number) => Promise<boolean>,
): Promise<{ ok: boolean; items: (Verdict & { id: string; title: string })[] }> {
  const items: (Verdict & { id: string; title: string })[] = []
  const reachable = await docker.ping()
  const v = reachable ? await docker.version().catch(() => null) : null
  items.push({
    id: 'docker',
    title: 'Docker',
    ok: Boolean(v),
    message: v ? `Docker ${v.Version} (${v.Os}/${v.Arch})` : 'Finesse can’t reach Docker — was it started with /var/run/docker.sock mounted?',
  })
  for (const [id, title, dir] of [
    ['data', 'Media & downloads folder', paths.data],
    ['root', 'Config folder', paths.root],
  ] as const) {
    try {
      mkdirSync(dir, { recursive: true })
      accessSync(dir, constants.W_OK)
      const s = statfsSync(dir)
      const free = s.bavail * s.bsize
      const total = s.blocks * s.bsize
      const gb = (n: number) => `${(n / 1e9).toFixed(n > 1e11 ? 0 : 1)} GB`
      const low = id === 'data' ? free < 50e9 : free < 5e9
      items.push({ id, title, ok: true, message: `${dir} — ${gb(free)} free of ${gb(total)}${low ? ' (that’s tight — movies are big)' : ''}`, detail: { free, total, path: dir, low } })
    } catch (e) {
      items.push({ id, title, ok: false, message: `${dir} isn’t writable (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})` })
    }
  }
  const devices = reachable ? await hostDevices().catch(() => [] as string[]) : []
  const tun = devices.includes('/dev/net/tun')
  items.push({ id: 'tun', title: 'VPN support', ok: tun, message: tun ? 'The host can run VPN tunnels (/dev/net/tun)' : 'No /dev/net/tun — torrents need it for the VPN (Usenet works without)' })
  const gpu = devices.includes('/dev/dri')
  items.push({ id: 'gpu', title: 'Hardware transcoding', ok: true, message: gpu ? 'Graphics chip found (/dev/dri) — Jellyfin can transcode in hardware' : 'No graphics chip found — Jellyfin will transcode in software (fine for direct play)' })
  if (reachable && portFree) {
    const free = await portFree(8096).catch(() => true)
    items.push({
      id: 'ports',
      title: 'Jellyfin port',
      ok: true,
      message: free ? 'Port 8096 is free for native Jellyfin apps' : 'Port 8096 is already in use (another Jellyfin?) — Finesse will use the next free port',
    })
  }
  const info = reachable ? await docker.info().catch(() => null) : null
  items.push({
    id: 'machine',
    title: 'This machine',
    ok: true,
    message: `${info?.NCPU ?? cpus().length} CPU cores, ${Math.round((info?.MemTotal ?? totalmem()) / 1e9)} GB memory${info?.OperatingSystem ? `, ${info.OperatingSystem}` : ''}`,
  })
  return { ok: items.filter((i) => ['docker', 'data', 'root'].includes(i.id)).every((i) => i.ok), items }
}

// ---------------------------------------------------------------------------
// Usenet (NNTP)
// ---------------------------------------------------------------------------

function nntpLines(sock: Socket) {
  let buf = ''
  const waiters: ((l: string) => void)[] = []
  const queue: string[] = []
  sock.on('data', (d) => {
    buf += d.toString('latin1')
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '')
      buf = buf.slice(i + 1)
      const w = waiters.shift()
      if (w) w(line)
      else queue.push(line)
    }
  })
  return () =>
    new Promise<string>((resolve) => {
      const q = queue.shift()
      if (q !== undefined) resolve(q)
      else waiters.push(resolve)
    })
}

/** Why a Usenet server said 502 to the password, in plain words (the server's own reason stays in brackets). */
export function refusal(reason: string): string {
  const why = reason ? ` (the server said: ${reason})` : ''
  if (/connection|too many|max(imum)?\b|limit|simultaneous/i.test(reason))
    return `The server refused: too many connections${why}. Close other downloaders using this account, or lower Connections.`
  if (/expire|inactive|suspend|disabled|subscription|no (active )?plan|renew|block/i.test(reason))
    return `The server refused: the account isn’t active${why}. Check the subscription on the provider’s site.`
  return `The server refused the sign-in${why}. Check the username and password (many providers want the account username, not your email), that no other downloader is using this account, and that the subscription is active.`
}

export async function checkUsenet(s: UsenetServer, timeoutMs = 20000): Promise<Verdict> {
  return new Promise<Verdict>((resolve) => {
    let done = false
    const finish = (v: Verdict) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        sock.write('QUIT\r\n')
      } catch {
        /* closed */
      }
      sock.destroy()
      resolve(v)
    }
    const sock: Socket = s.ssl ? tlsConnect({ host: s.host, port: s.port, servername: s.host }) : netConnect({ host: s.host, port: s.port })
    const timer = setTimeout(() => finish({ ok: false, message: `No answer from ${s.host}:${s.port} within ${timeoutMs / 1000}s — check the address and port${s.ssl ? ' (SSL is usually 563)' : ''}` }), timeoutMs)
    sock.on('error', (e: NodeJS.ErrnoException) => {
      const code = e.code ?? ''
      const msg =
        code === 'ENOTFOUND' || code === 'EAI_AGAIN'
          ? `Can’t find “${s.host}” — check the server address`
          : code === 'ECONNREFUSED'
            ? `${s.host} refused port ${s.port} — check the port${s.ssl ? ' (SSL is usually 563)' : ' (plain is usually 119)'}`
            : /certificate|SSL|TLS|wrong version/i.test(e.message)
              ? `SSL failed on ${s.host}:${s.port} (${e.message}) — is SSL right for this port?`
              : `Couldn’t connect to ${s.host}:${s.port} (${e.message})`
      finish({ ok: false, message: msg })
    })
    const next = nntpLines(sock)
    const run = async () => {
      const greet = await next()
      if (/^HTTP\//.test(greet)) return finish({ ok: false, message: `${s.host}:${s.port} is a web server, not a Usenet server — use your provider’s news server address` })
      if (!/^20[01]/.test(greet)) return finish({ ok: false, message: `Unexpected greeting from the server: ${greet.slice(0, 120)}` })
      sock.write(`AUTHINFO USER ${s.username}\r\n`)
      const u = await next()
      if (/^281/.test(u)) return finish({ ok: true, message: `Connected to ${s.host} — signed in`, detail: { greeting: greet.slice(4, 120) } })
      if (!/^381/.test(u)) return finish({ ok: false, message: `The server rejected the username (${u.slice(0, 100)})` })
      sock.write(`AUTHINFO PASS ${s.password}\r\n`)
      const pw = await next()
      if (/^281/.test(pw)) return finish({ ok: true, message: `Connected to ${s.host} — signed in`, detail: { greeting: greet.slice(4, 120) } })
      if (/^48[12]/.test(pw)) return finish({ ok: false, message: 'Wrong username or password for this Usenet server' })
      // 502 means "no", for more reasons than one: many providers (Newshosting, Eweka…) send it for a wrong password too.
      if (/^502/.test(pw)) return finish({ ok: false, message: refusal(pw.slice(4, 120).trim()) })
      finish({ ok: false, message: `Sign-in failed: ${pw.slice(0, 120)}` })
    }
    sock.once(s.ssl ? 'secureConnect' : 'connect', () => void run().catch((e) => finish({ ok: false, message: String(e) })))
  })
}

// ---------------------------------------------------------------------------
// Indexers (Newznab / Torznab)
// ---------------------------------------------------------------------------

export async function checkIndexer(ix: IndexerInput): Promise<Verdict> {
  if (!ix.url) return { ok: true, message: `${ix.name} is one of Prowlarr’s own sites — there’s nothing to enter` }
  const base = ix.url.replace(/\/+$/, '').replace(/\/api$/, '')
  const q = new URLSearchParams({ t: 'search', q: 'test', limit: '1', ...(ix.apiKey ? { apikey: ix.apiKey } : {}) })
  let res: Response
  try {
    res = await fetch(`${base}/api?${q}`, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Finesse' } })
  } catch (e) {
    return { ok: false, message: `Couldn’t reach ${new URL(base).host} (${(e as Error).message})` }
  }
  const text = await res.text()
  const err = /<error[^>]*code="(\d+)"[^>]*description="([^"]*)"/i.exec(text)
  if (err) {
    const code = err[1]
    const hint = code === '100' ? 'The API key is wrong' : code === '101' || code === '102' ? 'This account can’t use the API — is it active?' : code === '429' || /limit/i.test(err[2]!) ? 'You’ve hit this indexer’s daily limit' : err[2]
    return { ok: false, message: `${ix.name}: ${hint}` }
  }
  if (!res.ok) return { ok: false, message: `${ix.name} answered HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' — check the API key' : ''}` }
  if (/<rss|<caps/i.test(text)) {
    const items = (text.match(/<item>/g) ?? []).length
    return { ok: true, message: `${ix.name} works${items ? ' — search returned results' : ''}` }
  }
  return { ok: false, message: `${ix.name} didn’t answer like a ${ix.kind === 'torznab' ? 'Torznab' : 'Newznab'} indexer — check the address` }
}

// ---------------------------------------------------------------------------
// VPN — a throwaway Gluetun, then ask it for its public IP
// ---------------------------------------------------------------------------

export async function checkVpn(docker: Docker, vpn: VpnDoc, ctx: { hostRoot: string; network: string; timezone: string; hostDevices: string[] }, timeoutMs = 90000): Promise<Verdict> {
  if (!ctx.hostDevices.includes('/dev/net/tun')) return { ok: false, message: 'This machine can’t run VPN tunnels (no /dev/net/tun)' }
  const name = 'finesse-vpn-check'
  const dir = join(ctx.hostRoot, 'config', 'vpn-check')
  const key = newKey()
  mkdirSync(dir, { recursive: true })
  seedGluetunAuth(dir, key)
  const def = CATALOG.gluetun
  const env = def.env({ hostRoot: ctx.hostRoot, hostData: '', puid: 0, pgid: 0, timezone: ctx.timezone, network: ctx.network, exposeJellyfin: false, jellyfinPort: 8096, gpu: false, vpn: vpnConfig(vpn) })
  await docker.remove(name, { force: true })
  try {
    if (!(await docker.imageExists(def.image))) await docker.pull(def.image)
    await docker.create(name, {
      Image: def.image,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      Labels: { 'finesse.managed': 'true', 'finesse.service': 'vpn-check' },
      HostConfig: { Binds: [`${dir}:/gluetun`], CapAdd: ['NET_ADMIN'], Devices: [{ PathOnHost: '/dev/net/tun', PathInContainer: '/dev/net/tun', CgroupPermissions: 'rwm' }], NetworkMode: ctx.network, AutoRemove: false, SecurityOpt: ['label=disable'] },
      NetworkingConfig: { EndpointsConfig: { [ctx.network]: { Aliases: ['vpn-check'] } } },
    })
    await docker.start(name)
    // Our own public IP, to prove the tunnel changes it.
    const hostIp = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json() as Promise<{ ip: string }>)
      .then((j) => j.ip)
      .catch(() => null)
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 3000))
      const c = await docker.inspect(name)
      if (c && !c.State.Running) {
        const logs = await docker.logs(name, 20).catch(() => '')
        return { ok: false, message: explainGluetun(logs) ?? 'The VPN container stopped — check the provider and credentials' }
      }
      try {
        const r = await fetch('http://vpn-check:8000/v1/publicip/ip', { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(4000) })
        const j = (await r.json()) as { public_ip?: string; country?: string; city?: string; organization?: string }
        if (j.public_ip) {
          if (hostIp && j.public_ip === hostIp) return { ok: false, message: 'The tunnel is up but your public IP didn’t change — refusing to use it for torrents' }
          const where = [j.city, j.country].filter(Boolean).join(', ')
          return { ok: true, message: `VPN works — torrents will appear as ${j.public_ip}${where ? ` (${where})` : ''}`, detail: { vpnIp: j.public_ip, hostIp, country: j.country, organization: j.organization } }
        }
      } catch {
        /* not up yet */
      }
    }
    const logs = await docker.logs(name, 40).catch(() => '')
    return { ok: false, message: explainGluetun(logs) ?? 'The VPN didn’t connect within 90 seconds — check the credentials and server country' }
  } catch (e) {
    log.warn('vpn check failed', e)
    return { ok: false, message: `Couldn’t start the VPN check (${(e as Error).message})` }
  } finally {
    await docker.remove(name, { force: true }).catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Turns Gluetun's log into a one-line human explanation, when it says something recognisable. */
export function explainGluetun(logs: string): string | null {
  if (/AUTH_FAILED|auth.*failed|authentication failed/i.test(logs)) return 'The VPN rejected the username or password'
  if (/private key is not valid|wireguard private key|invalid key/i.test(logs)) return 'The WireGuard private key isn’t valid'
  if (/no server found|no server matching/i.test(logs)) return 'No VPN server matches those settings (try another country)'
  if (/WIREGUARD_ADDRESSES|address.*not valid/i.test(logs)) return 'The WireGuard address isn’t valid (it looks like 10.64.222.21/32)'
  if (/i\/o timeout|handshake/i.test(logs)) return 'The VPN server isn’t answering — the key may not be registered with your account yet'
  const err = /ERROR \[?[^\]]*\]? ?(.+)/.exec(logs)
  return err ? `VPN error: ${err[1]!.slice(0, 160)}` : null
}

