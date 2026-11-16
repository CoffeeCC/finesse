// The Linux install sandbox (WS4 in docs/agents/game-store-plan.md): one container per install,
// from the pinned installer image (docker/installer/), driven by `finesse-sandbox` over docker exec.
//
// What the container gets, and nothing more:
//   - no network at all (NetworkMode none), so nothing it runs can reach anywhere;
//   - no Docker socket, no added capabilities, no new privileges, a plain user's id;
//   - memory, CPU and process limits;
//   - the download at /job/download, read-only, and the request's own install folder at
//     /job/install, the only place it can write;
//   - labels finesse.managed=true and finesse.job=install, so a Finesse that restarts mid-install
//     finds and removes it (sweep()).
// It's removed when the install ends, except while it waits for a person ("Needs you"): then its
// screen is carried to their browser through Finesse's signed-in websocket (screen()).
//
// The engine (install.ts) decides what to do; DockerSandbox only does it. DockerInstaller is what
// the request pipeline calls (pipeline.ts: Installer).

import { mkdir, rm, chown } from 'node:fs/promises'
import { availableParallelism, totalmem } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { sniffFile } from '../installerSniff.ts'
import { demuxExec, type Docker } from '../stack/docker.ts'
import type { StoredRequest } from './db.ts'
import { finishAfterPerson, install, type InstallJob } from './install.ts'
import type { Installer } from './pipeline.ts'
import type { InstallOutcome, JobFile, LaunchResult, RunResult, SandboxRunner, UnpackTool, WindowInfo } from './types.ts'

/** Where installed store games live, under the data folder. One folder per request. */
export const GAMES_PC = 'media/games/pc'
export const JOB_LABEL = 'finesse.job'

const MIB = 1024 * 1024

/** The newest Inno Setup the image's innoextract reads (its label, else what it was built with). */
const INNO_MAX_DEFAULT = '6.4.999'

/** What a sandbox needs from Docker: the client's own methods, so tests can stand in for it. */
export type SandboxDocker = Pick<Docker, 'execAttach' | 'execExitCode' | 'create' | 'start' | 'remove' | 'list' | 'imageExists' | 'pull' | 'imageInspect'> & Partial<Pick<Docker, 'inspect'>>

const GIB = 1024 * MIB

export interface SandboxLimits {
  cpus: number
  memoryGb: number
}

/** What this server has to share. */
export const hostResources = (): SandboxLimits => ({ cpus: availableParallelism(), memoryGb: Math.floor(totalmem() / GIB) })

/**
 * The install sandbox's share of the server: what an administrator chose (Settings → Games), else
 * automatic: half the cores (at least 2) and half the memory, from 4 to 16 GB. Never more than
 * the server has. Cores mostly speed up unpacking (7-Zip uses them all); memory decides whether a
 * big installer finishes at all.
 */
export function sandboxLimits(chosen: Partial<SandboxLimits> | undefined, host: SandboxLimits): SandboxLimits & { auto: SandboxLimits } {
  const auto = {
    cpus: Math.max(1, Math.min(host.cpus, Math.max(2, Math.floor(host.cpus / 2)))),
    memoryGb: Math.max(1, Math.min(host.memoryGb, Math.min(16, Math.max(4, Math.floor(host.memoryGb / 2))))),
  }
  const pick = (v: number | undefined, fallback: number, max: number) => (v && v > 0 ? Math.min(Math.floor(v), Math.max(1, max)) : fallback)
  return { cpus: pick(chosen?.cpus, auto.cpus, host.cpus), memoryGb: pick(chosen?.memoryGb, auto.memoryGb, host.memoryGb), auto }
}

const OUT_OF_MEMORY = (gb: number) => `The installer ran out of memory (the install sandbox has ${gb} GB). Give it more in Settings → Games → Install sandbox, then try again.`

interface Ran {
  /** Every line that wasn't progress or the result. */
  lines: string[]
  result: Record<string, unknown> | null
}

/** One job's container, driven step by step. Paths are the job's: download/… and install/…. */
export class DockerSandbox implements SandboxRunner {
  readonly host = 'linux' as const
  private readonly docker: SandboxDocker
  readonly container: string
  private readonly innoMax: string

  constructor(docker: SandboxDocker, container: string, innoMax = INNO_MAX_DEFAULT) {
    this.docker = docker
    this.container = container
    this.innoMax = innoMax
  }

  /** Runs `finesse-sandbox <args>` in the container; progress lines go to onProgress as they come. */
  async run(args: string[], onProgress?: (bytes: number) => void): Promise<Ran> {
    const { stream } = await this.docker.execAttach(this.container, ['finesse-sandbox', ...args])
    return new Promise((resolve, reject) => {
      const lines: string[] = []
      let result: Record<string, unknown> | null = null
      let partial = ''
      demuxExec(stream, (b) => {
        partial += b.toString('utf8')
        let nl: number
        while ((nl = partial.indexOf('\n')) >= 0) {
          const line = partial.slice(0, nl).replace(/\r$/, '')
          partial = partial.slice(nl + 1)
          if (line.startsWith('@progress ')) {
            const n = Number(line.slice(10))
            if (Number.isFinite(n)) onProgress?.(n)
          } else if (line.startsWith('@result ')) {
            try {
              result = JSON.parse(line.slice(8)) as Record<string, unknown>
            } catch {
              result = null
            }
          } else if (line.trim()) lines.push(line)
        }
      })
      stream.on('end', () => resolve({ lines: partial.trim() ? [...lines, partial] : lines, result }))
      stream.on('close', () => resolve({ lines, result }))
      stream.on('error', reject)
    })
  }

  private static runResult(r: Ran): RunResult {
    const exit = r.result?.exit
    return {
      exit: typeof exit === 'number' ? exit : null,
      hung: r.result?.hung === true,
      log: r.lines.slice(-40).join('\n'),
      ...(typeof r.result?.dir === 'string' ? { dir: r.result.dir } : {}),
    }
  }

  supports(tool: UnpackTool): { maxVersion?: string } {
    return tool === 'innoextract' ? { maxVersion: this.innoMax } : {}
  }

  async list(tool: UnpackTool, file: string): Promise<string[]> {
    return (await this.run(['list', tool, file])).lines
  }

  async unpack(tool: UnpackTool | 'copy', file: string, into: string, onProgress?: (bytes: number) => void): Promise<RunResult> {
    const r = await this.run(['unpack', tool, file, into], onProgress)
    // No result line: the command itself didn't finish (the container went away).
    return r.result ? DockerSandbox.runResult(r) : { exit: null, hung: false, log: r.lines.join('\n') || 'The sandbox stopped.' }
  }

  async install(command: string[], opts: { hangAfterMs?: number; shown?: boolean; onProgress?: (bytes: number) => void }): Promise<RunResult> {
    const hang = opts.hangAfterMs ? Math.max(3, Math.ceil(opts.hangAfterMs / 1000)) : 0
    const r = await this.run(['install', String(hang), '--', ...command], opts.onProgress)
    return r.result ? DockerSandbox.runResult(r) : { exit: null, hung: false, log: r.lines.join('\n') || 'The sandbox stopped.' }
  }

  async files(dir: string): Promise<JobFile[]> {
    const out: JobFile[] = []
    for (const line of (await this.run(['files', dir])).lines) {
      const [path, size, mode] = line.split('\t')
      if (!path || size === undefined) continue
      out.push({ path, size: Number(size), ...(mode && (parseInt(mode, 8) & 0o111) !== 0 ? { executable: true } : {}) })
    }
    return out
  }

  async clear(dir: string): Promise<void> {
    await this.run(['clear', dir])
  }

  async launch(program: string, opts: { waitMs: number }): Promise<LaunchResult> {
    const r = await this.run(['launch', program, String(Math.max(4, Math.ceil(opts.waitMs / 1000)))])
    const res = r.result ?? {}
    return {
      windows: toWindows(res.windows),
      ...(typeof res.screenshot === 'string' ? { screenshot: res.screenshot } : {}),
      ...(typeof res.exited === 'number' ? { exited: res.exited } : {}),
      log: r.lines.slice(-20).join('\n'),
    }
  }

  async windows(): Promise<WindowInfo[]> {
    return toWindows((await this.run(['windows'])).result?.windows)
  }

  async click(window: WindowInfo, button: string): Promise<boolean> {
    if (!window.hwnd) return false
    return (await this.run(['click', window.hwnd, button])).result?.ok === true
  }

  async stop(): Promise<void> {
    await this.run(['stop']).catch(() => {})
  }

  /** The screen as VNC: write the browser's bytes in, read the sandbox's out (framed: demuxExec). */
  async screen(): Promise<Duplex> {
    return (await this.docker.execAttach(this.container, ['finesse-sandbox', 'screen'], { stdin: true })).stream
  }
}

/** winhelper's windows (hwnd, pid, title, class, text, buttons, wantsInput, …) as the engine reads them. */
function toWindows(v: unknown): WindowInfo[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((w): w is Record<string, unknown> => Boolean(w) && typeof w === 'object')
    .map((w) => ({
      title: String(w.title ?? ''),
      class: String(w.class ?? ''),
      text: String(w.text ?? ''),
      buttons: Array.isArray(w.buttons) ? w.buttons.map(String) : [],
      wantsInput: w.wantsInput === true,
      ...(w.hwnd !== undefined && w.hwnd !== null ? { hwnd: String(w.hwnd) } : {}),
    }))
}

// ---------- the pipeline's installer ----------

export interface DockerInstallerDeps {
  docker: SandboxDocker
  /** The installer image (catalog.ts INSTALLER_IMAGE, or FINESSE_INSTALLER_IMAGE for a dev build). */
  image: string
  /** Where things are on this server; null when it isn't set up. */
  where(): { hostData: string; puid: number; pgid: number } | null
  /** This Finesse's id: stamped on its containers so it only ever removes its own. */
  instance?: string
  /** The container's share of the server, looked up for each install (Settings can change it). */
  limits?(): SandboxLimits
  log?(text: string): void
}

const NO_DOCKER = 'Finesse can’t reach Docker to start the install sandbox. Check Finesse still has the Docker socket (Settings → Health), then try again.'

/** Installs requests in DockerSandbox containers. */
export class DockerInstaller implements Installer {
  private readonly deps: DockerInstallerDeps
  /** Containers waiting on a person, by request. */
  private readonly waiting = new Map<string, DockerSandbox>()
  /** The share each request's sandbox got (to say so when it ran out). */
  private readonly gave = new Map<string, SandboxLimits>()

  constructor(deps: DockerInstallerDeps) {
    this.deps = deps
  }

  private name(r: { id: string }) {
    return `finesse-install-${r.id}`
  }

  private labels(r: { id: string }): Record<string, string> {
    return { 'finesse.managed': 'true', [JOB_LABEL]: 'install', 'finesse.request': r.id, ...(this.deps.instance ? { 'finesse.instance': this.deps.instance } : {}) }
  }

  /** The request's own folder on the server, as the host (and Finesse) names it. */
  installRoot(r: { id: string }): string | null {
    const w = this.deps.where()
    return w ? join(w.hostData, ...GAMES_PC.split('/'), r.id) : null
  }

  /** Removes install containers left over from before a restart (only this Finesse's). */
  async sweep(): Promise<number> {
    const list = await this.deps.docker.list({ label: [`${JOB_LABEL}=install`, 'finesse.managed=true'] }).catch(() => [])
    let n = 0
    for (const c of list) {
      if (this.deps.instance && c.Labels?.['finesse.instance'] && c.Labels['finesse.instance'] !== this.deps.instance) continue
      await this.deps.docker.remove(c.Id, { force: true, volumes: true }).then(() => n++, () => {})
    }
    this.waiting.clear()
    return n
  }

  /** Gets the image once (it's big), saying how far along it is. */
  private async image(say: (t: string) => void) {
    if (await this.deps.docker.imageExists(this.deps.image)) return
    say('Getting the install sandbox. This happens once and takes a few minutes.')
    let shown = -1
    await this.deps.docker.pull(this.deps.image, (fraction) => {
      const pct = Math.floor(fraction * 10) * 10
      if (pct > shown) {
        shown = pct
        if (pct > 0 && pct < 100) say(`Getting the install sandbox: ${pct}%.`)
      }
    })
  }

  private async innoMax(): Promise<string> {
    const info = (await this.deps.docker.imageInspect(this.deps.image).catch(() => null)) as { Config?: { Labels?: Record<string, string> } } | null
    return info?.Config?.Labels?.['finesse.innoextract.max'] ?? INNO_MAX_DEFAULT
  }

  /** A fresh container for the request: download read-only, its own folder writable, nothing else. */
  private async open(r: StoredRequest, downloadFolder: string | null, say: (t: string) => void): Promise<DockerSandbox> {
    const where = this.deps.where()
    const root = this.installRoot(r)
    if (!where || !root) throw new SandboxError('This server isn’t set up to install games yet.')
    await this.image(say)
    await this.close(r)
    await mkdir(root, { recursive: true })
    // Never root inside: the server's own user when it has one, else the image's.
    const uid = where.puid > 0 ? where.puid : 1000
    const gid = where.pgid > 0 ? where.pgid : 1000
    await chown(root, uid, gid).catch(() => {})
    const limits = this.deps.limits?.() ?? sandboxLimits(undefined, hostResources())
    this.gave.set(r.id, limits)
    const mounts = [
      ...(downloadFolder ? [{ Type: 'bind', Source: downloadFolder, Target: '/job/download', ReadOnly: true }] : []),
      { Type: 'bind', Source: root, Target: '/job/install', ReadOnly: false },
    ]
    const id = await this.deps.docker.create(this.name(r), {
      Image: this.deps.image,
      User: `${uid}:${gid}`,
      Env: ['HOME=/tmp/home', 'WINEPREFIX=/tmp/home/prefix'],
      Labels: this.labels(r),
      NetworkDisabled: true,
      HostConfig: {
        NetworkMode: 'none',
        Mounts: mounts,
        Memory: limits.memoryGb * GIB,
        MemorySwap: limits.memoryGb * GIB,
        NanoCpus: Math.round(limits.cpus * 1e9),
        PidsLimit: 1024,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges', 'label=disable'],
        ShmSize: 256 * MIB,
        Init: false,
      },
    })
    await this.deps.docker.start(id)
    return new DockerSandbox(this.deps.docker, id, await this.innoMax())
  }

  /**
   * Whether a failed install ran out of memory: Docker saw the kernel stop something for it, or the
   * installer said so. (Installers that unpack in memory often report it as "corrupted data".)
   */
  private async ranOutOfMemory(runner: DockerSandbox, out: Extract<InstallOutcome, { state: 'failed' }>): Promise<boolean> {
    const info = (await this.deps.docker.inspect?.(runner.container).catch(() => null)) as { State?: { OOMKilled?: boolean } } | null
    if (info?.State?.OOMKilled) return true
    return /out of memory|not enough memory|insufficient memory|cannot allocate memory|std::bad_alloc/i.test([out.reason, ...out.log].join('\n'))
  }

  /** Removes the request's container, if it has one. */
  private async close(r: { id: string }) {
    this.waiting.delete(r.id)
    await this.deps.docker.remove(this.name(r), { force: true, volumes: true }).catch(() => {})
  }

  private job(r: StoredRequest, runner: DockerSandbox, downloadFolder: string | null, files: JobFile[], onStep: (t: string) => void): InstallJob {
    return {
      runner,
      title: r.title,
      files,
      // Reading a file's first bytes runs nothing: that's done here, not in the sandbox.
      sniff: async (path) => {
        const root = path.startsWith('download/') ? downloadFolder : this.installRoot(r)
        const rel = path.startsWith('download/') ? path.slice('download/'.length) : path.replace(/^install\//, '')
        // A file Finesse can't read (gone, or not allowed) is simply not recognised.
        return sniffFile(join(root ?? '/nonexistent', ...rel.split('/'))).catch(() => ({ kind: 'unknown' as const, format: 'Unreadable file', notes: [] }))
      },
      platform: r.platform,
      ...(r.source?.installerHint ? { installerHint: r.source.installerHint } : {}),
      onStep,
    }
  }

  /** The outcome, with its folders said relative to the games folder (as the request keeps them). */
  private where(r: StoredRequest, out: InstallOutcome): InstallOutcome {
    if (out.state !== 'ready') return out
    const rel = (p: string) => (p.startsWith('install/') ? `${r.id}/${p.slice('install/'.length)}` : p)
    return { ...out, dir: rel(out.dir), ...(out.screenshot ? { screenshot: rel(out.screenshot) } : {}) }
  }

  async install(r: StoredRequest, folder: string, onStep: (text: string) => void): Promise<InstallOutcome> {
    let runner: DockerSandbox
    try {
      runner = await this.open(r, folder, onStep)
    } catch (e) {
      this.deps.log?.(`install sandbox for ${r.id}: ${(e as Error).message}`)
      return { state: 'failed', reason: e instanceof SandboxError ? e.message : NO_DOCKER, log: [] }
    }
    let keep = false
    try {
      const files = await runner.files('download')
      let out = await install(this.job(r, runner, folder, files, onStep))
      if (out.state === 'failed' && (await this.ranOutOfMemory(runner, out))) out = { ...out, reason: OUT_OF_MEMORY(this.gave.get(r.id)?.memoryGb ?? 4) }
      if (out.state === 'needs-you') {
        keep = true
        this.waiting.set(r.id, runner)
      }
      return this.where(r, out)
    } finally {
      if (!keep) await this.close(r)
    }
  }

  async finish(r: StoredRequest): Promise<InstallOutcome> {
    // After a restart the waiting container is gone; the files the person installed are not.
    let runner = this.waiting.get(r.id)
    try {
      runner ??= await this.open(r, r.folder ?? null, () => {})
    } catch (e) {
      return { state: 'failed', reason: e instanceof SandboxError ? e.message : NO_DOCKER, log: [] }
    }
    try {
      const out = await finishAfterPerson(this.job(r, runner, r.folder ?? null, [], () => {}))
      return this.where(r, out)
    } finally {
      await this.close(r)
    }
  }

  async remove(r: StoredRequest): Promise<void> {
    await this.close(r)
    const root = this.installRoot(r)
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {})
  }

  /** The installer's screen, for a request waiting on a person; null when there's none to show. */
  async screen(r: { id: string }): Promise<Duplex | null> {
    const runner = this.waiting.get(r.id)
    return runner ? runner.screen() : null
  }
}

export class SandboxError extends Error {}
