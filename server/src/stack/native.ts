// The native Windows host: the stack's apps as plain Windows programs, with
// Finesse itself keeping them running (no Docker, no WSL). Each app is the
// project's own Windows build at a pinned, hash-checked version, unpacked into
// <root>\apps\<app>\<version> and started hidden with its settings in
// <root>\config\<app> (the same folders the Docker install uses, so seeding,
// wiring and backups are shared). Every app answers on 127.0.0.1 except
// Jellyfin, which TVs and phones reach directly.
//
// Supervision: a crashed app is started again with a growing pause (1 s up to a
// minute); one stopped on purpose stays stopped. Finesse runs inside the
// Finesse service's job object, so if Finesse goes, its apps go with it; and a
// leftover app from a hard crash is recognised by its process id and replaced.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { createServer } from 'node:net'
import { EOL, constants as osConstants, setPriority } from 'node:os'
import { basename, join } from 'node:path'
import { logger } from '../log.ts'
import { CATALOG, proxyFor, type StackContext, type StackServiceId } from './catalog.ts'
import { NotOnThisHost, type AppState, type ManagedApp, type ProgressSink, type StackHost } from './host.ts'

const log = logger('native')

export interface NativeApp {
  version: string
  url: string
  sha256: string
  /** zip: unpacked as is. nsis: the project's installer, run silently into the app folder. */
  kind: 'zip' | 'nsis'
  /** The program, relative to the app folder. */
  exe: string
  /** Where it answers unless that port is taken. */
  port: number
  /** Only Finesse talks to it (127.0.0.1), or the whole network (Jellyfin). */
  lan?: boolean
  args(o: { cfg: string; dir: string; port: number }): string[]
}

/** Pinned Windows builds: the same versions as the Docker images where the projects publish both. Bumping one is a release decision. */
export const NATIVE_APPS: Partial<Record<StackServiceId, NativeApp>> = {
  jellyfin: {
    version: '12.1',
    url: 'https://repo.jellyfin.org/files/server/windows/stable/v12.1/amd64/jellyfin_12.1-amd64.zip',
    sha256: 'e6290748a8674885865eb1f307161f8c455ae12a5cb5f9696e42a0162e182085',
    kind: 'zip',
    exe: 'jellyfin/jellyfin.exe',
    port: 8096,
    lan: true,
    // The same layout as the container (data in the config folder, settings in config\config), so seedJellyfin fits both.
    args: ({ cfg, dir }) => ['--datadir', cfg, '--configdir', join(cfg, 'config'), '--cachedir', join(cfg, 'cache'), '--logdir', join(cfg, 'log'), '--ffmpeg', join(dir, 'jellyfin', 'ffmpeg.exe')],
  },
  prowlarr: {
    version: '2.6.5.5623',
    url: 'https://github.com/Prowlarr/Prowlarr/releases/download/v2.6.5.5623/Prowlarr.master.2.6.5.5623.windows-core-x64.zip',
    sha256: '7d8dfc745ab784fa3d9cd56522b29f2a6b53a2b72701adc295fe148f9d466699',
    kind: 'zip',
    exe: 'Prowlarr/Prowlarr.Console.exe',
    port: 9696,
    args: ({ cfg }) => ['/nobrowser', '/nosingleinstancecheck', `/data=${cfg}`],
  },
  sonarr: {
    version: '4.0.20.3014',
    url: 'https://github.com/Sonarr/Sonarr/releases/download/v4.0.20.3014/Sonarr.main.4.0.20.3014.win-x64.zip',
    sha256: '40ffa15710d791e71ab787e152610602e4e0d9ce4c2316e3b618c3c3d265d2af',
    kind: 'zip',
    exe: 'Sonarr/Sonarr.Console.exe',
    port: 8989,
    args: ({ cfg }) => ['/nobrowser', '/nosingleinstancecheck', `/data=${cfg}`],
  },
  radarr: {
    version: '6.4.4.10685',
    url: 'https://github.com/Radarr/Radarr/releases/download/v6.4.4.10685/Radarr.master.6.4.4.10685.windows-core-x64.zip',
    sha256: '316c3c7e5edaab75f5497d919bc556da259d966f9497a465d484cd49df28afe9',
    kind: 'zip',
    exe: 'Radarr/Radarr.Console.exe',
    port: 7878,
    args: ({ cfg }) => ['/nobrowser', '/nosingleinstancecheck', `/data=${cfg}`],
  },
  lidarr: {
    version: '3.1.0.4875',
    url: 'https://github.com/Lidarr/Lidarr/releases/download/v3.1.0.4875/Lidarr.master.3.1.0.4875.windows-core-x64.zip',
    sha256: '26f6da02a579aa84f49f2ececc27ad0d3a82760d3cd3b13fa4d99df7c6c12443',
    kind: 'zip',
    exe: 'Lidarr/Lidarr.Console.exe',
    port: 8686,
    args: ({ cfg }) => ['/nobrowser', '/nosingleinstancecheck', `/data=${cfg}`],
  },
  sabnzbd: {
    version: '5.1.3',
    url: 'https://github.com/sabnzbd/sabnzbd/releases/download/5.1.3/SABnzbd-5.1.3-win64-bin.zip',
    sha256: '62733e427534a1afec6a64b89dd06253f1a3cf51cb189d980f4e759c04f8d7eb',
    kind: 'zip',
    exe: 'SABnzbd/SABnzbd-console.exe',
    // Not 8080: that's Finesse's own.
    port: 8085,
    args: ({ cfg, port }) => ['-f', join(cfg, 'sabnzbd.ini'), '-s', `127.0.0.1:${port}`, '-b', '0'],
  },
  qbittorrent: {
    version: '5.2.3',
    // qBittorrent ships no portable build for Windows: its installer, run silently into Finesse's folder.
    url: 'https://downloads.sourceforge.net/project/qbittorrent/qbittorrent-win32/qbittorrent-5.2.3/qbittorrent_5.2.3_x64_setup.exe',
    sha256: 'ff508e2f912d59c9eabaf03633ebacfd45c2049f38dcac027b8a7d7ad867ab2f',
    kind: 'nsis',
    exe: 'qbittorrent.exe',
    port: 8090,
    args: ({ cfg, port }) => [`--profile=${cfg}`, `--webui-port=${port}`, '--confirm-legal-notice'],
  },
}

/** Where qBittorrent keeps its settings when started with --profile (seedQbit writes it before the first start). */
export const nativeQbitConfig = (cfg: string) => join(cfg, 'qBittorrent', 'config', 'qBittorrent.ini')

interface Spec {
  version: string
  exe: string
  args: string[]
  env: Record<string, string>
  cwd: string
  hash: string
}

interface Saved {
  ports: Partial<Record<StackServiceId, number>>
  apps: Partial<Record<StackServiceId, Spec & { pid?: number }>>
}

interface Proc {
  child: ChildProcess | null
  startedAt: number
  exitCode: number
  /** Started on purpose and not stopped since: a crash brings it back. */
  wanted: boolean
  restartTimer: NodeJS.Timeout | null
  failures: number
  lines: { at: number; text: string }[]
}

export interface NativeDeps {
  apps?: Partial<Record<StackServiceId, NativeApp>>
  fetch?: typeof fetch
  /** Unpacks a zip into a folder (Windows' own tar.exe by default). */
  unzip?: (file: string, dest: string) => void
  /** Runs an NSIS installer silently into a folder. */
  install?: (file: string, dest: string) => void
  /** Ends a process and its children: gently (false when Windows wouldn't ask it), or at once. */
  kill?: (pid: number, force: boolean) => boolean
  /** Asks the app itself to shut down through its API (its databases close cleanly); false when it couldn't be asked. */
  askToStop?: (id: StackServiceId, url: string) => Promise<boolean>
  /** The program name a process id belongs to now, if any (to tell our leftover from a reused id). */
  imageOf?: (pid: number) => string | null
}

const LOG_LINES = 2000
const sys32 = (exe: string) => join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe)

export class NativeHost implements StackHost {
  readonly kind = 'native'
  readonly root: string
  private readonly apps: Partial<Record<StackServiceId, NativeApp>>
  private readonly deps: Required<Omit<NativeDeps, 'apps'>>
  private readonly procs = new Map<StackServiceId, Proc>()
  private saved: Saved
  private adopted = false

  constructor(root: string, deps: NativeDeps = {}) {
    this.root = root
    this.apps = deps.apps ?? NATIVE_APPS
    this.deps = {
      fetch: deps.fetch ?? fetch,
      unzip: deps.unzip ?? ((file, dest) => run(sys32('tar.exe'), ['-xf', file, '-C', dest])),
      // NSIS: /S silent, /D= the folder (must come last, unquoted).
      install: deps.install ?? ((file, dest) => run(file, ['/S', `/D=${dest}`])),
      kill: deps.kill ?? defaultKill,
      imageOf: deps.imageOf ?? defaultImageOf,
      askToStop: deps.askToStop ?? (async () => false),
    }
    this.saved = this.load()
  }

  // ---------- where things are ----------

  private stateFile() {
    return join(this.root, 'apps', 'state.json')
  }

  private load(): Saved {
    try {
      const s = JSON.parse(readFileSync(this.stateFile(), 'utf8')) as Saved
      return { ports: s.ports ?? {}, apps: s.apps ?? {} }
    } catch {
      return { ports: {}, apps: {} }
    }
  }

  private save() {
    mkdirSync(join(this.root, 'apps'), { recursive: true })
    const tmp = `${this.stateFile()}.tmp`
    writeFileSync(tmp, JSON.stringify(this.saved, null, 2))
    renameSync(tmp, this.stateFile())
  }

  private app(id: StackServiceId): NativeApp {
    const a = this.apps[id]
    if (!a) throw new NotOnThisHost(CATALOG[id]?.name ?? id)
    return a
  }

  private appDir(id: StackServiceId) {
    return join(this.root, 'apps', id, this.app(id).version)
  }

  private cfg(ctx: { hostRoot: string }, id: StackServiceId) {
    return join(ctx.hostRoot, 'config', id)
  }

  private port(id: StackServiceId): number {
    return this.saved.ports[id] ?? this.app(id).port
  }

  supports(id: StackServiceId): boolean {
    return Boolean(this.apps[id])
  }

  url(id: StackServiceId): string {
    return `http://127.0.0.1:${this.port(id)}`
  }

  peer(id: StackServiceId): { host: string; port: number } {
    return { host: '127.0.0.1', port: this.port(id) }
  }

  appPath(ctx: { hostData: string }, rel: string): string {
    return join(ctx.hostData, ...rel.split('/'))
  }

  async ping(): Promise<boolean> {
    return true
  }

  async hostDevices(): Promise<string[]> {
    return []
  }

  /** Nothing to join on Windows: this picks each app's port once (the first free one from its usual port), before anything is configured with it. */
  async prepareNetwork(_ctx: StackContext): Promise<void> {
    const taken = new Set(Object.values(this.saved.ports))
    let changed = false
    for (const id of Object.keys(this.apps) as StackServiceId[]) {
      if (this.saved.ports[id]) continue
      let p = this.app(id).port
      while (taken.has(p) || !(await this.hostPortFree(p))) {
        p++
        if (p > this.app(id).port + 50) throw new Error(`No free port near ${this.app(id).port} for ${CATALOG[id].name}`)
      }
      this.saved.ports[id] = p
      taken.add(p)
      changed = true
    }
    if (changed) this.save()
  }

  ensureDirs(ctx: StackContext, ids: StackServiceId[]): void {
    const dirs = new Set<string>([join(ctx.hostData, 'media')])
    for (const id of ids) {
      dirs.add(this.cfg(ctx, id))
      for (const d of CATALOG[id].dataDirs ?? []) dirs.add(this.appPath(ctx, d))
    }
    for (const d of dirs) mkdirSync(d, { recursive: true })
  }

  // ---------- getting the apps ----------

  async download(id: StackServiceId, onProgress?: ProgressSink): Promise<void> {
    const app = this.app(id)
    const dir = this.appDir(id)
    if (existsSync(join(dir, '.finesse-ok'))) return
    const base = join(this.root, 'apps', id)
    mkdirSync(base, { recursive: true })
    const file = join(base, `${app.version}.download`)
    onProgress?.({ service: id, phase: 'pull', fraction: 0, detail: `${CATALOG[id].name} ${app.version}` })
    const res = await this.deps.fetch(app.url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60000) })
    if (!res.ok || !res.body) throw new Error(`Couldn’t download ${CATALOG[id].name} (HTTP ${res.status}) — check this PC’s internet connection and try again`)
    const total = Number(res.headers.get('content-length')) || 0
    let got = 0
    let last = 0
    // One reader, written as it arrives (a 'data' listener next to a pipe fights it over pausing).
    const out = await open(file, 'w')
    try {
      for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
        await out.write(c)
        got += c.length
        const f = total ? got / total : 0
        if (total && (f - last >= 0.02 || f === 1)) {
          last = f
          onProgress?.({ service: id, phase: 'pull', fraction: f, detail: `${CATALOG[id].name} ${app.version}` })
        }
      }
    } finally {
      await out.close()
    }
    const sum = await sha256(file)
    if (sum !== app.sha256) {
      rmSync(file, { force: true })
      throw new Error(`${CATALOG[id].name}’s download didn’t match the version Finesse was tested with, so it wasn’t used. Try again; if it keeps happening, update Finesse.`)
    }
    const tmp = `${dir}.unpacking`
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    try {
      if (app.kind === 'zip') this.deps.unzip(file, tmp)
      else this.deps.install(file, tmp)
      if (!existsSync(join(tmp, app.exe))) throw new Error(`${CATALOG[id].name} unpacked without ${app.exe}`)
      writeFileSync(join(tmp, '.finesse-ok'), `${app.version} ${app.sha256}\n`)
      rmSync(dir, { recursive: true, force: true })
      renameSync(tmp, dir)
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true })
      throw e
    } finally {
      rmSync(file, { force: true })
    }
    onProgress?.({ service: id, phase: 'pull', fraction: 1, detail: `${CATALOG[id].name} ${app.version}` })
  }

  // ---------- running them ----------

  private spec(id: StackServiceId, ctx: StackContext): Spec {
    const app = this.app(id)
    const dir = this.appDir(id)
    const port = this.port(id)
    const env = { ...proxyFor(id, ctx).env }
    const body = { version: app.version, exe: join(dir, app.exe), args: app.args({ cfg: this.cfg(ctx, id), dir, port }), env, cwd: join(dir, app.exe, '..') }
    return { ...body, hash: createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16) }
  }

  /** Once per start of Finesse: ends apps a hard crash left running, so they can be started under Finesse again. */
  private adopt() {
    if (this.adopted) return
    this.adopted = true
    for (const [id, a] of Object.entries(this.saved.apps) as [StackServiceId, Spec & { pid?: number }][]) {
      if (!a.pid || this.procs.get(id)?.child) continue
      const image = this.deps.imageOf(a.pid)
      if (image && image.toLowerCase() === basename(a.exe).toLowerCase()) {
        log.info(`ending ${CATALOG[id].name} left over from before (pid ${a.pid})`)
        try {
          this.deps.kill(a.pid, true)
        } catch {
          /* already gone */
        }
      }
    }
  }

  async ensureService(id: StackServiceId, ctx: StackContext, onProgress?: ProgressSink, opts: { forceRecreate?: boolean } = {}): Promise<boolean> {
    this.adopt()
    await this.download(id, onProgress)
    const want = this.spec(id, ctx)
    const had = this.saved.apps[id]
    const p = this.procs.get(id)
    const changed = !had || had.hash !== want.hash || Boolean(opts.forceRecreate)
    if (changed) {
      onProgress?.({ service: id, phase: 'create', detail: had ? 'updating' : undefined })
      if (p?.child) await this.stop(id)
      this.saved.apps[id] = { ...want }
      this.save()
    }
    if (changed || !p?.child) {
      onProgress?.({ service: id, phase: 'start' })
      await this.start(id)
    }
    return changed
  }

  async start(id: StackServiceId): Promise<void> {
    this.adopt()
    const spec = this.saved.apps[id]
    if (!spec) throw new Error(`${CATALOG[id].name} isn’t installed`)
    const p = this.proc(id)
    p.wanted = true
    if (p.restartTimer) clearTimeout(p.restartTimer)
    p.restartTimer = null
    if (p.child) return
    this.launch(id, spec, p)
  }

  private proc(id: StackServiceId): Proc {
    let p = this.procs.get(id)
    if (!p) {
      p = { child: null, startedAt: 0, exitCode: 0, wanted: false, restartTimer: null, failures: 0, lines: [] }
      this.procs.set(id, p)
    }
    return p
  }

  private logFile(id: StackServiceId): string {
    const dir = join(this.root, 'logs')
    const file = join(dir, `${id}.log`)
    try {
      mkdirSync(dir, { recursive: true })
      if (statSync(file).size > 5e6) renameSync(file, `${file}.1`)
    } catch {
      /* new */
    }
    return file
  }

  private launch(id: StackServiceId, spec: Spec, p: Proc) {
    const child = spawn(spec.exe, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    p.child = child
    p.startedAt = Date.now()
    // Also on disk (<root>\logs\<app>.log, about 10 MB kept), for when Finesse itself isn't answering.
    const logFile = this.logFile(id)
    const keep = (chunk: Buffer) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean)
      for (const text of lines) {
        p.lines.push({ at: Date.now(), text })
        if (p.lines.length > LOG_LINES) p.lines.splice(0, p.lines.length - LOG_LINES)
      }
      if (lines.length) {
        try {
          appendFileSync(logFile, lines.join(EOL) + EOL)
        } catch {
          /* the screen's copy is enough */
        }
      }
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.on('error', (e) => {
      keep(Buffer.from(`Finesse couldn’t start it: ${e.message}`))
    })
    child.on('exit', (code) => this.exited(id, p, child, code ?? -1))
    if (child.pid) {
      this.saved.apps[id] = { ...spec, pid: child.pid }
      this.save()
    }
    log.info(`started ${CATALOG[id].name} (pid ${child.pid ?? '?'})`)
  }

  private exited(id: StackServiceId, p: Proc, child: ChildProcess, code: number) {
    if (p.child !== child) return
    p.child = null
    p.exitCode = code
    if (!p.wanted) return
    // A crash: back after a pause that grows while it keeps failing (and resets once it stays up).
    p.failures = Date.now() - p.startedAt > 5 * 60000 ? 1 : p.failures + 1
    const wait = Math.min(60000, 1000 * 2 ** (p.failures - 1))
    log.warn(`${CATALOG[id].name} stopped (exit ${code}) — starting it again in ${Math.round(wait / 1000)}s`)
    p.restartTimer = setTimeout(() => {
      p.restartTimer = null
      const spec = this.saved.apps[id]
      if (p.wanted && !p.child && spec) this.launch(id, spec, p)
    }, wait)
    p.restartTimer.unref()
  }

  async stop(id: StackServiceId, seconds = 30): Promise<void> {
    const p = this.procs.get(id)
    if (!p) return
    p.wanted = false
    if (p.restartTimer) clearTimeout(p.restartTimer)
    p.restartTimer = null
    const child = p.child
    if (!child?.pid) return
    const gone = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    // The app's own shutdown first; then Windows' polite request. Console
    // programs refuse that one, so without either there's little to wait for.
    let asked = await this.deps.askToStop(id, this.url(id)).catch(() => false)
    if (!asked) {
      try {
        asked = this.deps.kill(child.pid, false)
      } catch {
        /* already gone */
      }
    }
    const grace = asked ? seconds : Math.min(seconds, 3)
    const timer = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), grace * 1000).unref())
    if ((await Promise.race([gone, timer])) === 'late') {
      try {
        this.deps.kill(child.pid, true)
      } catch {
        /* already gone */
      }
      await Promise.race([gone, new Promise((r) => setTimeout(r, 5000).unref())])
    }
  }

  async restart(id: StackServiceId, seconds = 30): Promise<void> {
    await this.stop(id, seconds)
    await this.start(id)
  }

  async isRunning(id: StackServiceId): Promise<boolean> {
    return Boolean(this.procs.get(id)?.child)
  }

  async state(id: StackServiceId, ctx: StackContext): Promise<AppState | null> {
    const spec = this.saved.apps[id]
    if (!spec) return null
    const p = this.procs.get(id)
    let updatePending = false
    try {
      updatePending = spec.hash !== this.spec(id, ctx).hash
    } catch {
      /* no longer something this host runs */
    }
    return {
      running: Boolean(p?.child),
      restarting: Boolean(p?.restartTimer),
      exitCode: p?.exitCode ?? 0,
      startedAt: p?.startedAt ? new Date(p.startedAt).toISOString() : '',
      image: `${CATALOG[id].name} ${spec.version}`,
      managed: true,
      updatePending,
    }
  }

  async logs(id: StackServiceId, tail = 200, since?: number): Promise<string> {
    const lines = this.procs.get(id)?.lines ?? []
    const from = since ? since * 1000 : 0
    return lines
      .filter((l) => l.at >= from)
      .slice(-tail)
      .map((l) => l.text)
      .join('\n')
  }

  async waitReady(id: StackServiceId, onProgress?: ProgressSink, timeoutMs = 180000, paths?: string[]): Promise<void> {
    const def = CATALOG[id]
    const candidates = paths ?? [def.healthPath ?? '/']
    onProgress?.({ service: id, phase: 'wait' })
    const until = Date.now() + timeoutMs
    let lastErr = ''
    while (Date.now() < until) {
      for (const path of candidates) {
        try {
          const res = await fetch(this.url(id) + path, { signal: AbortSignal.timeout(5000), redirect: 'manual' })
          res.body?.cancel().catch(() => {})
          if ((res.status >= 200 && res.status < 300) || res.status === 401 || res.status === 403) {
            onProgress?.({ service: id, phase: 'ready' })
            return
          }
          lastErr = `HTTP ${res.status}`
        } catch (e) {
          lastErr = (e as Error).message
        }
      }
      const p = this.procs.get(id)
      if (!p?.child && !p?.restartTimer) {
        const tail = (await this.logs(id, 8)).trim()
        throw new Error(`${def.name} stopped unexpectedly (exit ${p?.exitCode ?? '?'}).${tail ? `\n${tail}` : ''}`)
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    const tail = (await this.logs(id, 8)).trim()
    throw new Error(`${def.name} didn’t come up within ${Math.round(timeoutMs / 1000)}s (${lastErr})${tail ? `. It said:\n${tail}` : ''}`)
  }

  async waitLog(id: StackServiceId, pattern: RegExp, timeoutMs = 180000): Promise<boolean> {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      const p = this.procs.get(id)
      if (!p) return false
      if (p.lines.some((l) => l.at >= p.startedAt && pattern.test(l.text))) return true
      await new Promise((r) => setTimeout(r, 1000))
    }
    return false
  }

  async removeService(id: StackServiceId): Promise<void> {
    await this.stop(id)
    delete this.saved.apps[id]
    this.save()
  }

  async managed(): Promise<Map<string, ManagedApp>> {
    const out = new Map<string, ManagedApp>()
    for (const [id, spec] of Object.entries(this.saved.apps) as [StackServiceId, Spec][]) {
      const running = Boolean(this.procs.get(id)?.child)
      out.set(id, { id, state: running ? 'running' : 'exited', status: running ? 'Up' : 'Stopped', image: `${CATALOG[id].name} ${spec.version}` })
    }
    return out
  }

  /** Stops every app (Finesse is shutting down). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.procs.keys()].map((id) => this.stop(id, 20)))
  }

  hostPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const srv = createServer()
      srv.once('error', () => resolve(false))
      srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)))
    })
  }

  async freePortFrom(want: number): Promise<number | null> {
    for (let p = want; p < want + 20; p++) if (await this.hostPortFree(p)) return p
    return null
  }

  /** Jellyfin's own ffmpeg (shipped next to jellyfin.exe), at the lowest priority. */
  async ffmpeg(args: string[], out: string, hostRoot: string): Promise<{ file: string | null; output: string }> {
    const stage = join(hostRoot, 'config', 'jellyfin', 'finesse-previews')
    mkdirSync(stage, { recursive: true })
    const file = join(stage, out)
    const exe = join(this.appDir('jellyfin'), 'jellyfin', 'ffmpeg.exe')
    const r = await new Promise<{ code: number; output: string }>((resolve) => {
      const child = spawn(exe, [...args, file], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      if (child.pid) {
        try {
          setPriority(child.pid, osConstants.priority.PRIORITY_LOW)
        } catch {
          /* runs at normal priority */
        }
      }
      let output = ''
      child.stderr?.on('data', (c: Buffer) => (output = (output + c.toString()).slice(-4000)))
      child.on('error', (e) => resolve({ code: -1, output: e.message }))
      child.on('exit', (code) => resolve({ code: code ?? -1, output }))
    })
    if (r.code === 0 && existsSync(file) && statSync(file).size > 0) return { file, output: r.output }
    rmSync(file, { force: true })
    return { file: null, output: r.output }
  }
}

function run(exe: string, args: string[]) {
  const r = spawnSync(exe, args, { windowsHide: true, encoding: 'utf8', timeout: 10 * 60000 })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${basename(exe)} failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(-300)}`)
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

/** taskkill ends the whole tree (an app's own helpers too); without /F it asks first. */
function defaultKill(pid: number, force: boolean): boolean {
  if (process.platform !== 'win32') return process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
  const r = spawnSync(sys32('taskkill.exe'), ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true })
  return r.status === 0
}

function defaultImageOf(pid: number): string | null {
  if (process.platform !== 'win32') return null
  const r = spawnSync(sys32('tasklist.exe'), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' })
  const m = /^"([^"]+)"/.exec((r.stdout || '').trim())
  return m ? m[1]! : null
}
