// Brings stack services to their desired state through the Docker API:
// pull → create (or recreate when the definition changed) → start → wait
// until the app answers. Idempotent: running it again changes nothing unless
// something drifted. Every container is labelled so Finesse only ever touches
// its own.

import { createHash } from 'node:crypto'
import { chownSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { logger } from '../log.ts'
import { CATALOG, containerName, proxyFor, type ServiceDef, type StackContext, type StackServiceId } from './catalog.ts'
import { Docker, DockerError } from './docker.ts'
import type { StreamingProbe } from './wolf.ts'

const log = logger('stack')

export const LABEL_MANAGED = 'finesse.managed'
export const LABEL_SERVICE = 'finesse.service'
export const LABEL_SPEC = 'finesse.spec'

export interface ProgressSink {
  (event: { service: StackServiceId; phase: 'pull' | 'create' | 'start' | 'wait' | 'ready' | 'skip'; detail?: string; fraction?: number }): void
}

export function serviceUrl(id: StackServiceId): string {
  const def = CATALOG[id]
  // qBittorrent answers on Gluetun's address (it shares Gluetun's network).
  return `http://${def.alias}:${def.port}`
}

/** The Docker create body for a service (deterministic → hashable). */
export function containerSpec(def: ServiceDef, ctx: StackContext): Record<string, unknown> {
  const proxy = proxyFor(def.id, ctx)
  const env = Object.entries({ ...def.env(ctx), ...proxy.env })
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .sort()
  const ports = def.ports?.(ctx) ?? []
  const portBindings: Record<string, { HostPort: string }[]> = {}
  const exposed: Record<string, object> = {}
  for (const p of ports) {
    const key = `${p.container}/${p.proto ?? 'tcp'}`
    portBindings[key] = [{ HostPort: String(p.host) }]
    exposed[key] = {}
  }
  const present = (p: string) => (ctx.hostDevices ? ctx.hostDevices.includes(p) : existsSync(p))
  const devices = (def.devices?.(ctx) ?? []).filter((d) => present(d.split(':')[0]!)).map((d) => {
    const [host, cont] = d.split(':')
    return { PathOnHost: host, PathInContainer: cont ?? host, CgroupPermissions: 'rwm' }
  })
  const networkMode = def.hostNetwork ? 'host' : def.networkOf ? `container:${containerName(def.networkOf)}` : ctx.network
  const spec: Record<string, unknown> = {
    Image: def.image,
    Env: env,
    Labels: { [LABEL_MANAGED]: 'true', [LABEL_SERVICE]: def.id, 'org.opencontainers.image.title': def.name },
    ExposedPorts: exposed,
    HostConfig: {
      Binds: [...def.binds(ctx), ...proxy.binds],
      RestartPolicy: { Name: 'unless-stopped' },
      PortBindings: portBindings,
      CapAdd: def.capAdd ?? [],
      Devices: devices,
      NetworkMode: networkMode,
      GroupAdd: def.groupAdd?.(ctx) ?? [],
      Sysctls: def.sysctls ?? {},
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      // Only for apps that ask, so no other app's spec (and hash) changes.
      ...(def.deviceCgroupRules ? { DeviceCgroupRules: def.deviceCgroupRules } : {}),
      ...(def.nvidia?.(ctx) ? { DeviceRequests: [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu']] }] } : {}),
    },
  }
  const user = def.user?.(ctx)
  if (user) spec.User = user
  if (!def.networkOf && !def.hostNetwork) {
    spec.NetworkingConfig = { EndpointsConfig: { [ctx.network]: { Aliases: [def.alias, ...(def.extraAliases ?? []), containerName(def.id)] } } }
  }
  return spec
}

export function specHash(spec: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 16)
}

export class Orchestrator {
  readonly docker: Docker

  constructor(docker = new Docker()) {
    this.docker = docker
  }

  private hostProbe: { at: number; devices: string[]; gpuGroups: string[] } | null = null

  /** The image Finesse itself runs from (for throwaway probe containers). */
  async selfImage(): Promise<string> {
    const me = await this.docker.inspect(process.env.FINESSE_CONTAINER || hostname()).catch(() => null)
    return me?.Config.Image ?? process.env.FINESSE_IMAGE ?? 'node:22-alpine'
  }

  /** Which of the devices the stack cares about exist on the HOST (cached a minute). */
  async hostDevices(): Promise<string[]> {
    if (this.hostProbe && Date.now() - this.hostProbe.at < 60000) return this.hostProbe.devices
    const want = ['/dev/net/tun', '/dev/dri', '/dev/uinput', '/dev/uhid', '/dev/nvidia0']
    let devices: string[]
    let gpuGroups: string[] = []
    if (!process.env.FINESSE_IN_DOCKER) {
      devices = want.filter((p) => existsSync(p))
      try {
        gpuGroups = [...new Set(readdirSync('/dev/dri').filter((f) => /^(card|renderD)\d+$/.test(f)).map((f) => String(statSync(`/dev/dri/${f}`).gid)))]
      } catch {
        /* no graphics */
      }
    } else {
      // The group numbers too: images don't all have a "render" group by name, and Docker refuses unknown names.
      const script = want.map((p) => `[ -e /host${p} ] && echo ${p}`).join('; ') + '; for f in /host/dev/dri/card* /host/dev/dri/renderD*; do [ -e "$f" ] && echo "gid:$(stat -c %g "$f")"; done; true'
      const r = await this.docker.runOnce(await this.selfImage(), ['sh', '-c', script], ['/dev:/host/dev:ro'])
      const words = r.output.split(/\s+/)
      devices = want.filter((p) => words.includes(p))
      gpuGroups = [...new Set(words.filter((w) => /^gid:\d+$/.test(w)).map((w) => w.slice(4)))]
    }
    this.hostProbe = { at: Date.now(), devices, gpuGroups }
    return devices
  }

  /** The host's group numbers for its graphics devices (for apps that use the GPU). */
  async hostGpuGroups(): Promise<string[]> {
    await this.hostDevices()
    return this.hostProbe?.gpuGroups ?? []
  }

  /** What game streaming needs from this machine, checked fresh (someone may just have loaded a module). */
  async streamingProbe(): Promise<StreamingProbe> {
    this.hostProbe = null
    const devices = await this.hostDevices()
    const info = (await this.docker.info().catch(() => null)) as { Runtimes?: Record<string, unknown> } | null
    const nvidiaRuntime = Boolean(info?.Runtimes && 'nvidia' in info.Runtimes)
    let nvidiaModeset: boolean | null = null
    if (devices.includes('/dev/nvidia0')) {
      const path = '/sys/module/nvidia_drm/parameters/modeset'
      if (!process.env.FINESSE_IN_DOCKER) {
        nvidiaModeset = existsSync(path) && readFileSync(path, 'utf8').trim() === 'Y'
      } else {
        const r = await this.docker.runOnce(await this.selfImage(), ['sh', '-c', 'cat /host/sys/module/nvidia_drm/parameters/modeset 2>/dev/null; true'], ['/sys/module:/host/sys/module:ro']).catch(() => null)
        nvidiaModeset = r ? r.output.trim().startsWith('Y') : null
      }
    }
    return { devices, nvidiaRuntime, nvidiaModeset }
  }

  /** Whether a TCP port is free on the host (a probe container on the host network tries to bind it). */
  async hostPortFree(port: number): Promise<boolean> {
    if (!process.env.FINESSE_IN_DOCKER) {
      const { createServer } = await import('node:net')
      return new Promise((resolve) => {
        const srv = createServer()
        srv.once('error', () => resolve(false))
        srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)))
      })
    }
    const js = `require('net').createServer().once('error',()=>process.exit(1)).listen(${port},'0.0.0.0',()=>process.exit(0))`
    const r = await this.docker.runOnce(await this.selfImage(), ['node', '-e', js], [], 'host')
    return r.code === 0
  }

  /** The first free port at or after `want` (up to +20), or null. */
  async freePortFrom(want: number): Promise<number | null> {
    for (let p = want; p < want + 20; p++) if (await this.hostPortFree(p)) return p
    return null
  }

  /** Makes sure the shared network exists and Finesse itself is on it (as "finesse"). */
  async prepareNetwork(ctx: StackContext) {
    await this.docker.ensureNetwork(ctx.network, { [LABEL_MANAGED]: 'true' })
    const self = process.env.FINESSE_CONTAINER || hostname()
    const me = await this.docker.inspect(self).catch(() => null)
    if (me && !me.NetworkSettings.Networks[ctx.network]) {
      await this.docker.call('POST', `/networks/${encodeURIComponent(ctx.network)}/connect`, {
        Container: me.Id,
        EndpointConfig: { Aliases: ['finesse'] },
      })
      log.info(`joined network ${ctx.network}`)
    }
  }

  /** Creates the config + data folders every selected service needs. */
  ensureDirs(ctx: StackContext, ids: StackServiceId[]) {
    const dirs = new Set<string>([`${ctx.hostData}/media`])
    for (const id of ids) {
      const def = CATALOG[id]
      dirs.add(`${ctx.hostRoot}/config/${id}`)
      for (const d of def.dataDirs ?? []) dirs.add(`${ctx.hostData}/${d}`)
      // Every folder a service mounts from our trees — otherwise Docker creates
      // it root-owned and an app running as PUID can't write there.
      for (const b of def.binds(ctx)) {
        const src = b.split(':')[0]!
        if (src.startsWith(ctx.hostRoot + '/') || src.startsWith(ctx.hostData + '/') || src === ctx.hostData) dirs.add(src)
      }
    }
    for (const d of dirs) {
      mkdirSync(d, { recursive: true })
      // Own every level we may have just created under the roots.
      for (const root of [ctx.hostData, `${ctx.hostRoot}/config`]) {
        if (!d.startsWith(root)) continue
        let p = d
        while (p.length >= root.length) {
          try {
            chownSync(p, ctx.puid, ctx.pgid)
          } catch {
            /* dev: not root */
          }
          p = p.slice(0, p.lastIndexOf('/'))
        }
      }
    }
  }

  async ensureImage(def: ServiceDef, onProgress?: ProgressSink) {
    if (await this.docker.imageExists(def.image)) return
    onProgress?.({ service: def.id, phase: 'pull', fraction: 0, detail: def.image })
    let last = 0
    await this.docker.pull(def.image, (fraction, status) => {
      if (fraction - last >= 0.02 || fraction === 1) {
        last = fraction
        onProgress?.({ service: def.id, phase: 'pull', fraction, detail: status })
      }
    })
  }

  /** Converges one service; returns true if its container was (re)created. */
  async ensureService(id: StackServiceId, ctx: StackContext, onProgress?: ProgressSink, opts: { forceRecreate?: boolean } = {}): Promise<boolean> {
    const def = CATALOG[id]
    const name = containerName(id)
    await this.ensureImage(def, onProgress)
    if (ctx.gpu && !ctx.gpuGroups) ctx.gpuGroups = await this.hostGpuGroups().catch(() => [])
    const spec = containerSpec(def, ctx)
    const hash = specHash(spec)
    ;(spec.Labels as Record<string, string>)[LABEL_SPEC] = hash
    const existing = await this.docker.inspect(name)
    if (existing && existing.Config.Labels?.[LABEL_MANAGED] !== 'true') {
      throw new DockerError(409, `A container named "${name}" already exists and isn't managed by Finesse — rename or remove it`)
    }
    let created = false
    if (!existing || opts.forceRecreate || existing.Config.Labels?.[LABEL_SPEC] !== hash) {
      if (existing) {
        onProgress?.({ service: id, phase: 'create', detail: 'updating' })
        await this.docker.stop(name, 30)
        await this.docker.remove(name, { force: true })
      } else {
        onProgress?.({ service: id, phase: 'create' })
      }
      await this.docker.create(name, spec)
      created = true
    }
    const state = created ? null : existing!.State
    if (created || !state?.Running) {
      onProgress?.({ service: id, phase: 'start' })
      await this.docker.start(name)
    }
    return created
  }

  /** Polls a service's health path until it answers (anything but 5xx / network error). */
  async waitReady(id: StackServiceId, onProgress?: ProgressSink, timeoutMs = 180000, paths?: string[]): Promise<void> {
    const def = CATALOG[id]
    const base = serviceUrl(id)
    const candidates = paths ?? [def.healthPath ?? '/']
    onProgress?.({ service: id, phase: 'wait' })
    const until = Date.now() + timeoutMs
    let lastErr = ''
    while (Date.now() < until) {
      for (const p of candidates) {
        try {
          const res = await fetch(base + p, { signal: AbortSignal.timeout(5000), redirect: 'manual' })
          // Real answers only: 2xx, or 401/403 from an app that wants a key.
          // (Redirects and 503 "starting up" pages don't count.)
          if ((res.status >= 200 && res.status < 300) || res.status === 401 || res.status === 403) {
            onProgress?.({ service: id, phase: 'ready' })
            return
          }
          lastErr = `HTTP ${res.status}`
        } catch (e) {
          lastErr = (e as Error).message
        }
      }
      const c = await this.docker.inspect(containerName(id))
      if (c && !c.State.Running && !c.State.Restarting) {
        const logs = await this.docker.logs(containerName(id), 30).catch(() => '')
        throw new DockerError(500, `${def.name} stopped unexpectedly (exit ${c.State.ExitCode}).\n${logs.trim().split('\n').slice(-8).join('\n')}`)
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    throw new DockerError(504, `${def.name} didn't come up within ${Math.round(timeoutMs / 1000)}s (${lastErr})`)
  }

  /** Waits for a line in the container's log since it last started (e.g. Jellyfin's "Startup complete"). */
  async waitLog(id: StackServiceId, pattern: RegExp, timeoutMs = 180000): Promise<boolean> {
    const name = containerName(id)
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      const c = await this.docker.inspect(name)
      if (!c) return false
      const since = (Date.parse(c.State.StartedAt) || Date.now()) / 1000 - 1
      const logs = await this.docker.logs(name, 2000, since).catch(() => '')
      if (pattern.test(logs)) return true
      await new Promise((r) => setTimeout(r, 1000))
    }
    return false
  }

  /** Every container Finesse manages, keyed by service id. */
  async managed(): Promise<Map<string, { id: string; state: string; status: string; image: string }>> {
    const list = await this.docker.list({ label: [`${LABEL_MANAGED}=true`] })
    const out = new Map<string, { id: string; state: string; status: string; image: string }>()
    for (const c of list) {
      const svc = c.Labels[LABEL_SERVICE]
      if (svc) out.set(svc, { id: c.Id, state: c.State, status: c.Status, image: c.Image })
    }
    return out
  }

  async removeService(id: StackServiceId) {
    await this.docker.stop(containerName(id), 30)
    await this.docker.remove(containerName(id), { force: true })
  }
}
