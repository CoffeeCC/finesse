// Game streaming on Windows: Sunshine (LizardByte's Moonlight host) in place of Wolf. Finesse
// installs the project's own installer silently (it brings its Windows service, firewall rules
// and virtual gamepads), gives it an account only Finesse knows, keeps its web page to this PC,
// and talks to it over its local API: Moonlight devices waiting to pair, pairing with the PIN
// they show, the paired devices, and the apps Moonlight lists.

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:https'
import { join } from 'node:path'
import { logger } from '../log.ts'
import type { StreamingCheck, StreamingCheckItem } from './wolf.ts'

const log = logger('sunshine')

/** The tested release, checked by its SHA-256 before it runs. */
export const SUNSHINE = {
  version: '2026.914.233613',
  url: 'https://github.com/LizardByte/Sunshine/releases/download/v2026.914.233613/Sunshine-Windows-AMD64-installer.msi',
  sha256: 'PIN-ME',
}

export const SUNSHINE_SERVICE = 'SunshineService'
const API = { host: '127.0.0.1', port: 47990 }

export interface SunshineLogin {
  username: string
  password: string
}

export interface SunshineDeps {
  /** Where Sunshine installs (Program Files\Sunshine). */
  dir?: string
  fetchTo: (url: string, file: string, progress: (got: number, total: number) => void) => Promise<void>
  /** Runs a program to its end. */
  run: (exe: string, args: string[], timeoutMs?: number) => { code: number; out: string }
  /** Sunshine's local API (tests swap it out). */
  api?: SunshineApi
  sleep?: (ms: number) => Promise<void>
}

export class SunshineError extends Error {}

const sys32 = (exe: string) => join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe)

export class Sunshine {
  readonly dir: string
  private readonly root: string
  private readonly deps: Required<SunshineDeps>

  /** root: Finesse's data folder (ProgramData\Finesse); the installer is kept there for uninstalling. */
  constructor(root: string, deps: SunshineDeps) {
    this.root = root
    this.dir = deps.dir ?? join(process.env.ProgramFiles || 'C:\\Program Files', 'Sunshine')
    this.deps = { ...deps, dir: this.dir, api: deps.api ?? httpsApi, sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))) }
  }

  get exe() {
    return join(this.dir, 'sunshine.exe')
  }

  private get msi() {
    return join(this.root, 'apps', 'sunshine', `Sunshine-${SUNSHINE.version}.msi`)
  }

  installed(): boolean {
    return existsSync(this.exe)
  }

  /** Sunshine is here, but not from Finesse (someone's own): Finesse leaves it alone. */
  foreign(): boolean {
    return this.installed() && !existsSync(this.msi)
  }

  /** Downloads the installer (checked) and runs it silently. Nothing to do when this version is in. */
  async install(say: (m: string) => void): Promise<void> {
    if (this.installed() && existsSync(this.msi)) return
    // Someone's own Sunshine: taking it over would change its account and lock them out of it.
    if (this.foreign())
      throw new SunshineError('Sunshine is already installed on this PC. Moonlight can keep using it as it is; for Finesse to set up and manage streaming, uninstall Sunshine first (Settings → Apps), then turn this on again.')
    mkdirSync(join(this.root, 'apps', 'sunshine'), { recursive: true })
    const part = `${this.msi}.download`
    say(`Downloading Sunshine ${SUNSHINE.version}…`)
    let shown = 0
    await this.deps
      .fetchTo(SUNSHINE.url, part, (got, total) => {
        const pct = total ? Math.floor((got / total) * 100) : 0
        if (pct >= shown + 10) {
          shown = pct
          say(`Downloading Sunshine… ${pct}%`)
        }
      })
      .catch((e) => {
        rmSync(part, { force: true })
        throw new SunshineError(`Couldn’t download Sunshine (${(e as Error).message}) — check this PC’s internet connection and try again`)
      })
    const sum = await sha256(part)
    if (sum !== SUNSHINE.sha256) {
      rmSync(part, { force: true })
      log.warn(`Sunshine's installer had SHA-256 ${sum}, not the tested ${SUNSHINE.sha256}`)
      throw new SunshineError('Sunshine’s download didn’t match the version Finesse was tested with, so it wasn’t used. Try again; if it keeps happening, update Finesse.')
    }
    renameSync(part, this.msi)
    say('Installing Sunshine (its service, firewall rules and gamepad drivers)…')
    mkdirSync(join(this.root, 'logs'), { recursive: true })
    const r = this.deps.run(sys32('msiexec.exe'), ['/i', this.msi, '/qn', '/norestart', '/l*v', join(this.root, 'logs', 'sunshine-install.log')], 15 * 60000)
    // 3010: installed, a restart finishes it (a gamepad driver). It streams before that.
    if (r.code !== 0 && r.code !== 3010) throw new SunshineError(`Sunshine’s installer stopped (code ${r.code}). Its log is logs\\sunshine-install.log in Finesse’s folder.`)
    if (!this.installed()) throw new SunshineError('Sunshine’s installer finished, but Sunshine isn’t in Program Files')
  }

  /** Finesse's own account, Sunshine's web page on this PC only, and the PC's name in Moonlight. Restarts Sunshine. */
  async configure(login: SunshineLogin, name: string): Promise<void> {
    this.sc(['stop', SUNSHINE_SERVICE])
    const r = this.deps.run(this.exe, ['--creds', login.username, login.password], 60000)
    if (r.code !== 0) throw new SunshineError(`Couldn’t give Sunshine Finesse’s account (code ${r.code})`)
    const conf = join(this.dir, 'config', 'sunshine.conf')
    mkdirSync(join(this.dir, 'config'), { recursive: true })
    writeFileSync(conf, setConf(existsSync(conf) ? readFileSync(conf, 'utf8') : '', { origin_web_ui_allowed: 'pc', sunshine_name: name.replace(/[\r\n=]/g, ' ').trim() || 'Finesse' }))
    this.sc(['config', SUNSHINE_SERVICE, 'start=', 'auto'])
    this.sc(['start', SUNSHINE_SERVICE])
    await this.waitReady(login)
  }

  /** Until its API answers with Finesse's account. */
  async waitReady(login: SunshineLogin, ms = 90000): Promise<void> {
    const until = Date.now() + ms
    let last = ''
    while (Date.now() < until) {
      try {
        const r = await this.deps.api('GET', '/api/apps', login, undefined, 5000)
        if (r.status === 200) return
        last = `answered ${r.status}`
      } catch (e) {
        last = (e as Error).message
      }
      await this.deps.sleep(2000)
    }
    throw new SunshineError(`Sunshine didn’t start (${last}). Its log is in Program Files\\Sunshine\\config\\sunshine.log`)
  }

  private sc(args: string[]) {
    return this.deps.run(sys32('sc.exe'), args, 60000)
  }

  /** Streaming off: Sunshine stops and stays stopped (its pairings are kept for next time). */
  stop(): void {
    this.sc(['stop', SUNSHINE_SERVICE])
    this.sc(['config', SUNSHINE_SERVICE, 'start=', 'demand'])
  }

  /** Removes Sunshine with its own installer (its service, rules and drivers go with it). */
  uninstall(): void {
    if (!existsSync(this.msi)) return
    this.sc(['stop', SUNSHINE_SERVICE])
    const r = this.deps.run(sys32('msiexec.exe'), ['/x', this.msi, '/qn', '/norestart'], 10 * 60000)
    if (r.code !== 0 && r.code !== 3010 && r.code !== 1605) throw new SunshineError(`Sunshine’s uninstaller stopped (code ${r.code})`)
    rmSync(this.msi, { force: true })
  }
}

export type SunshineApi = (method: string, path: string, login: SunshineLogin, body?: unknown, timeoutMs?: number) => Promise<{ status: number; json: unknown }>

/** Sunshine's local API with Finesse's account: pairing, devices and Moonlight's app list. */
export class SunshineClient {
  private readonly login: SunshineLogin
  private readonly api: SunshineApi

  constructor(login: SunshineLogin, api: SunshineApi = httpsApi) {
    this.login = login
    this.api = api
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 10000): Promise<T> {
    const r = await this.api(method, path, this.login, body, timeoutMs)
    if (r.status === 401) throw new SunshineError('Sunshine turned Finesse’s account away — turn game streaming off and on again in Settings → Server')
    if (r.status !== 200) throw new SunshineError(`Sunshine answered ${r.status}`)
    return r.json as T
  }

  /** Moonlight devices waiting for their PIN. */
  async pending(): Promise<{ id: string; name: string; address: string }[]> {
    const r = await this.call<{ pairings?: { id?: unknown; name?: unknown; address?: unknown }[] }>('GET', '/api/pin')
    return (r.pairings ?? []).filter((p) => typeof p.id === 'string' && /^[0-9a-f]{32}$/i.test(p.id)).map((p) => ({ id: p.id as string, name: String(p.name ?? ''), address: String(p.address ?? '') }))
  }

  /** Answers a device's request with the PIN it shows; true when it paired. (Sunshine waits for Moonlight to finish.) */
  async pair(id: string, pin: string, name: string): Promise<boolean> {
    const r = await this.call<{ status?: unknown }>('POST', '/api/pin', { pairing_id: id, pin, name }, 60000)
    return r.status === true
  }

  async devices(): Promise<{ id: string; name: string }[]> {
    const r = await this.call<{ named_certs?: { uuid?: unknown; name?: unknown }[] }>('GET', '/api/clients/list')
    return (r.named_certs ?? []).filter((c) => typeof c.uuid === 'string' && c.uuid).map((c) => ({ id: c.uuid as string, name: String(c.name ?? '') }))
  }

  async unpair(id: string): Promise<boolean> {
    const r = await this.call<{ status?: unknown }>('POST', '/api/clients/unpair', { uuid: id })
    return r.status === true
  }

  /** What Moonlight lists (Desktop, Steam Big Picture, and anything added in Sunshine). */
  async apps(): Promise<{ index: number; name: string }[]> {
    const r = await this.call<{ apps?: { name?: unknown }[] }>('GET', '/api/apps')
    return (r.apps ?? []).map((a, index) => ({ index, name: typeof a.name === 'string' ? a.name : '' })).filter((a) => a.name)
  }
}

/** Sets keys in a sunshine.conf ("key = value" lines), keeping everything else as it was. */
export function setConf(text: string, values: Record<string, string>): string {
  const lines = text.split(/\r?\n/).filter((l, i, all) => l.trim() || i < all.length - 1)
  const left = new Map(Object.entries(values))
  const out = lines.map((l) => {
    const m = /^\s*([A-Za-z0-9_]+)\s*=/.exec(l)
    if (m && left.has(m[1]!)) {
      const v = left.get(m[1]!)!
      left.delete(m[1]!)
      return `${m[1]} = ${v}`
    }
    return l
  })
  for (const [k, v] of left) out.push(`${k} = ${v}`)
  return `${out.filter((l, i) => l.trim() || i < out.length - 1).join('\n')}\n`
}

/** Sunshine's API on this PC. Its certificate is its own (self-signed); the address is the loopback,
 *  so nothing on the network is trusted by skipping the check. */
function httpsApi(method: string, path: string, login: SunshineLogin, body?: unknown, timeoutMs = 10000): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
    const req = request(
      {
        ...API,
        method,
        path,
        rejectUnauthorized: false,
        headers: {
          authorization: `Basic ${Buffer.from(`${login.username}:${login.password}`).toString('base64')}`,
          ...(data ? { 'content-type': 'application/json', 'content-length': String(data.length) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > 4_000_000) req.destroy(new Error('Sunshine’s answer was too big'))
          else chunks.push(c)
        })
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json: unknown = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            /* not JSON (a login page): status says enough */
          }
          resolve({ status: res.statusCode ?? 0, json })
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Sunshine didn’t answer')))
    req.end(data)
  })
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

/** Settings → Server, before streaming is on: what this PC has for Sunshine. */
export function windowsStreamingCheck(gpus: string[], opts: { foreignSunshine: boolean }): StreamingCheck {
  const real = gpus.filter((g) => !/basic display|basic render|remote display|hyper-v|virtual|parsec|meta|dummy/i.test(g))
  const nvidia = real.find((g) => /nvidia/i.test(g))
  const other = real.find((g) => /amd|radeon|intel|arc/i.test(g))
  const card = nvidia ?? other ?? null
  const items: StreamingCheckItem[] = [
    card
      ? { id: 'gpu', ok: true, title: `Graphics: ${card}`, detail: 'Sunshine encodes the stream on it, so games keep their speed.' }
      : {
          id: 'gpu',
          ok: false,
          title: 'No graphics card to stream with',
          detail: gpus.length ? `Windows only has ${gpus.join(', ')}. Sunshine needs an NVIDIA, AMD or Intel graphics driver to encode the stream.` : 'Windows didn’t list a graphics card. Sunshine needs an NVIDIA, AMD or Intel graphics driver to encode the stream.',
          fix: ['Install the latest driver for your graphics card from NVIDIA, AMD or Intel, then check again.'],
        },
    {
      id: 'desktop',
      ok: true,
      title: 'Games play on this PC’s own screen',
      detail: 'Moonlight shows what this PC shows: Steam (Big Picture), your games or the desktop. It works best when nobody is using the PC at the same time.',
    },
  ]
  return {
    gpu: nvidia ? 'nvidia' : other ? 'intel-amd' : null,
    items,
    allGood: items.every((i) => i.ok),
    ...(opts.foreignSunshine ? { blocked: 'Sunshine is already installed on this PC. Moonlight can keep using it as it is; for Finesse to manage streaming, uninstall Sunshine first (Settings → Apps).' } : {}),
  }
}

/** The graphics adapters Windows lists. */
export function windowsGpus(run: (exe: string, args: string[], timeoutMs?: number) => { code: number; out: string }): string[] {
  const r = run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'], 30000)
  return r.code === 0 ? r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []
}
