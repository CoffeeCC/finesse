// Docker Engine API client over the unix socket (no SDK). Covers what the
// orchestrator needs: images, containers, networks, logs, stats.

import { request, type IncomingMessage } from 'node:http'
import { logger } from '../log.ts'

const log = logger('docker')

export class DockerError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface ContainerSummary {
  Id: string
  Names: string[]
  Image: string
  State: string
  Status: string
  Labels: Record<string, string>
}

export interface ContainerInspect {
  Id: string
  Name: string
  Image: string
  Config: { Image: string; Env: string[] | null; Labels: Record<string, string> | null }
  State: { Status: string; Running: boolean; Restarting: boolean; ExitCode: number; StartedAt: string; Health?: { Status: string } }
  HostConfig: Record<string, unknown>
  NetworkSettings: { Networks: Record<string, { IPAddress: string }> }
  Mounts: { Source: string; Destination: string }[]
}

export class Docker {
  readonly socketPath: string

  constructor(socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock') {
    this.socketPath = socketPath
  }

  private raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
      const req = request(
        {
          socketPath: this.socketPath,
          method,
          path,
          headers: { Host: 'docker', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': String(data.length) } : {}), ...headers },
        },
        resolve,
      )
      req.on('error', (e) => reject(new DockerError(0, `Docker isn't reachable (${(e as NodeJS.ErrnoException).code ?? e.message})`)))
      if (data) req.write(data)
      req.end()
    })
  }

  async call<T = unknown>(method: string, path: string, body?: unknown, opts: { allow404?: boolean } = {}): Promise<T | null> {
    const res = await this.raw(method, path, body)
    const chunks: Buffer[] = []
    for await (const c of res) chunks.push(c as Buffer)
    const text = Buffer.concat(chunks).toString('utf8')
    const status = res.statusCode ?? 0
    if (status === 404 && opts.allow404) return null
    if (status >= 400) {
      let msg = text
      try {
        msg = (JSON.parse(text) as { message?: string }).message ?? text
      } catch {
        /* plain text */
      }
      throw new DockerError(status, msg.trim() || `Docker responded ${status}`)
    }
    if (!text) return null
    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.raw('GET', '/_ping')
      res.resume()
      return res.statusCode === 200
    } catch {
      return false
    }
  }

  version() {
    return this.call<{ Version: string; ApiVersion: string; Os: string; Arch: string }>('GET', '/version')
  }

  info() {
    return this.call<{ NCPU: number; MemTotal: number; OperatingSystem: string; Architecture: string; DockerRootDir: string; Name: string }>('GET', '/info')
  }

  // ---------- images ----------

  async imageExists(ref: string): Promise<boolean> {
    return (await this.call('GET', `/images/${encodeURIComponent(ref)}/json`, undefined, { allow404: true })) !== null
  }

  imageInspect(ref: string) {
    return this.call<{ Id: string; RepoDigests: string[]; Config: { Env?: string[] } }>('GET', `/images/${encodeURIComponent(ref)}/json`, undefined, { allow404: true })
  }

  /** Pulls an image; `onProgress(fraction 0..1, status)` streams progress. */
  async pull(ref: string, onProgress?: (fraction: number, status: string) => void): Promise<void> {
    // Pinned by digest (repo@sha256:…): Docker takes it whole.
    const lastColon = ref.lastIndexOf(':')
    const hasTag = !ref.includes('@') && lastColon > ref.lastIndexOf('/')
    const image = hasTag ? ref.slice(0, lastColon) : ref
    const tag = ref.includes('@') ? '' : hasTag ? ref.slice(lastColon + 1) : 'latest'
    const res = await this.raw('POST', `/images/create?fromImage=${encodeURIComponent(image)}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`)
    if ((res.statusCode ?? 0) >= 400) {
      const chunks: Buffer[] = []
      for await (const c of res) chunks.push(c as Buffer)
      throw new DockerError(res.statusCode ?? 0, `Pulling ${ref} failed: ${Buffer.concat(chunks).toString().trim()}`)
    }
    const layers = new Map<string, { cur: number; total: number }>()
    let buf = ''
    let error: string | null = null
    for await (const chunk of res) {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line) as { id?: string; status?: string; error?: string; progressDetail?: { current?: number; total?: number } }
          if (ev.error) error = ev.error
          if (ev.id && ev.progressDetail?.total) layers.set(ev.id, { cur: ev.progressDetail.current ?? 0, total: ev.progressDetail.total })
          if (ev.id && /Pull complete|Already exists|Download complete/.test(ev.status ?? '')) {
            const l = layers.get(ev.id)
            if (l) l.cur = l.total
          }
          if (onProgress) {
            let cur = 0
            let total = 0
            for (const l of layers.values()) {
              cur += l.cur
              total += l.total
            }
            onProgress(total ? Math.min(1, cur / total) : 0, ev.status ?? '')
          }
        } catch {
          /* partial line */
        }
      }
    }
    if (error) throw new DockerError(500, `Pulling ${ref} failed: ${error}`)
    onProgress?.(1, 'done')
  }

  // ---------- networks ----------

  async ensureNetwork(name: string, labels: Record<string, string> = {}): Promise<void> {
    const existing = await this.call('GET', `/networks/${encodeURIComponent(name)}`, undefined, { allow404: true })
    if (existing) return
    await this.call('POST', '/networks/create', { Name: name, Driver: 'bridge', Labels: labels, CheckDuplicate: true })
    log.info(`created network ${name}`)
  }

  // ---------- containers ----------

  list(filters: Record<string, string[]> = {}, all = true) {
    const q = new URLSearchParams({ all: all ? '1' : '0', filters: JSON.stringify(filters) })
    return this.call<ContainerSummary[]>('GET', `/containers/json?${q}`).then((r) => r ?? [])
  }

  inspect(nameOrId: string) {
    return this.call<ContainerInspect>('GET', `/containers/${encodeURIComponent(nameOrId)}/json`, undefined, { allow404: true })
  }

  async create(name: string, config: Record<string, unknown>): Promise<string> {
    const r = await this.call<{ Id: string }>('POST', `/containers/create?name=${encodeURIComponent(name)}`, config)
    return r!.Id
  }

  async start(nameOrId: string) {
    await this.call('POST', `/containers/${encodeURIComponent(nameOrId)}/start`).catch((e) => {
      if (e instanceof DockerError && e.status === 304) return // already running
      throw e
    })
  }

  async stop(nameOrId: string, seconds = 20) {
    await this.call('POST', `/containers/${encodeURIComponent(nameOrId)}/stop?t=${seconds}`, undefined, { allow404: true }).catch((e) => {
      if (e instanceof DockerError && e.status === 304) return
      throw e
    })
  }

  async restart(nameOrId: string, seconds = 20) {
    await this.call('POST', `/containers/${encodeURIComponent(nameOrId)}/restart?t=${seconds}`)
  }

  async remove(nameOrId: string, opts: { force?: boolean; volumes?: boolean } = {}) {
    await this.call('DELETE', `/containers/${encodeURIComponent(nameOrId)}?force=${opts.force ? 1 : 0}&v=${opts.volumes ? 1 : 0}`, undefined, { allow404: true })
  }

  /** Puts files into a container (a tar, unpacked at `path`), before it starts. */
  async putArchive(nameOrId: string, path: string, tar: Buffer) {
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = request(
        { socketPath: this.socketPath, method: 'PUT', path: `/containers/${encodeURIComponent(nameOrId)}/archive?path=${encodeURIComponent(path)}`, headers: { Host: 'docker', 'Content-Type': 'application/x-tar', 'Content-Length': String(tar.length) } },
        resolve,
      )
      req.on('error', (e) => reject(new DockerError(0, `Docker isn't reachable (${(e as NodeJS.ErrnoException).code ?? e.message})`)))
      req.end(tar)
    })
    const chunks: Buffer[] = []
    for await (const c of res) chunks.push(c as Buffer)
    if ((res.statusCode ?? 0) >= 400) throw new DockerError(res.statusCode ?? 0, Buffer.concat(chunks).toString('utf8').trim() || 'Docker refused the files')
  }

  async rename(nameOrId: string, newName: string) {
    await this.call('POST', `/containers/${encodeURIComponent(nameOrId)}/rename?name=${encodeURIComponent(newName)}`)
  }

  /** Last `tail` log lines (stdout+stderr), de-multiplexed; `since` = unix seconds. */
  async logs(nameOrId: string, tail = 200, since?: number): Promise<string> {
    const res = await this.raw('GET', `/containers/${encodeURIComponent(nameOrId)}/logs?stdout=1&stderr=1&timestamps=0&tail=${tail}${since ? `&since=${Math.floor(since)}` : ''}`)
    const chunks: Buffer[] = []
    for await (const c of res) chunks.push(c as Buffer)
    const buf = Buffer.concat(chunks)
    if ((res.statusCode ?? 0) >= 400) throw new DockerError(res.statusCode ?? 0, buf.toString())
    // Non-TTY logs are framed: [stream(1) 0 0 0 size(4 BE)] payload
    const out: string[] = []
    let off = 0
    const framed = buf.length >= 8 && (buf[0] === 1 || buf[0] === 2) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0
    if (!framed) return buf.toString('utf8')
    while (off + 8 <= buf.length) {
      const size = buf.readUInt32BE(off + 4)
      out.push(buf.subarray(off + 8, off + 8 + size).toString('utf8'))
      off += 8 + size
    }
    return out.join('')
  }

  /** Runs a one-off container to completion; returns its exit code and output. */
  async runOnce(image: string, cmd: string[], binds: string[] = [], network = 'none'): Promise<{ code: number; output: string }> {
    const name = `finesse-probe-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const id = await this.create(name, { Image: image, Cmd: cmd, Entrypoint: [], Labels: { 'finesse.managed': 'true', 'finesse.service': 'probe' }, HostConfig: { Binds: binds, NetworkMode: network, SecurityOpt: ['label=disable'] } })
    try {
      await this.start(id)
      const waited = await this.call<{ StatusCode: number }>('POST', `/containers/${id}/wait`)
      const output = await this.logs(id, 100).catch(() => '')
      return { code: waited?.StatusCode ?? -1, output }
    } finally {
      await this.remove(id, { force: true }).catch(() => {})
    }
  }

  /** Runs a command inside a container; resolves with its combined output + exit code. */
  async exec(nameOrId: string, cmd: string[], opts: { user?: string } = {}): Promise<{ code: number; output: string }> {
    const ex = await this.call<{ Id: string }>('POST', `/containers/${encodeURIComponent(nameOrId)}/exec`, {
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      ...(opts.user ? { User: opts.user } : {}),
    })
    const res = await this.raw('POST', `/exec/${ex!.Id}/start`, { Detach: false, Tty: false })
    const chunks: Buffer[] = []
    for await (const c of res) chunks.push(c as Buffer)
    const buf = Buffer.concat(chunks)
    let output = ''
    let off = 0
    while (off + 8 <= buf.length) {
      const size = buf.readUInt32BE(off + 4)
      output += buf.subarray(off + 8, off + 8 + size).toString('utf8')
      off += 8 + size
    }
    const info = await this.call<{ ExitCode: number }>('GET', `/exec/${ex!.Id}/json`)
    return { code: info?.ExitCode ?? -1, output }
  }
}
