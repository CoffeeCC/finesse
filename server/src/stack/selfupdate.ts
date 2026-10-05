// Updating Finesse itself. A container can't replace itself, so Finesse pulls
// the new image and starts a short-lived helper FROM that image (with the
// Docker socket) that runs `finesse swap`: stop the old container, keep it
// aside, create the new one with exactly the same settings, wait until it's
// healthy, then delete the old one — or put the old one back if anything
// goes wrong. Config, media and every app are untouched.

import { hostname } from 'node:os'
import { logger } from '../log.ts'
import { Docker, DockerError, type ContainerInspect } from './docker.ts'
import { LABEL_MANAGED, LABEL_SERVICE } from './orchestrator.ts'

const log = logger('self-update')

/** The container Finesse runs in (null when not in Docker). */
export async function selfContainer(docker: Docker): Promise<ContainerInspect | null> {
  if (!process.env.FINESSE_IN_DOCKER) return null
  return docker.inspect(process.env.FINESSE_CONTAINER || hostname()).catch(() => null)
}

/** "ghcr.io/coffeecc/finesse:1.0.0" → same repository at `version`; null for local builds. */
export function imageFor(current: string, version: string): string | null {
  const override = process.env.FINESSE_IMAGE_REPO
  if (override) return `${override}:${version}`
  const at = current.indexOf('@')
  const ref = at >= 0 ? current.slice(0, at) : current
  const colon = ref.lastIndexOf(':')
  const repo = colon > ref.lastIndexOf('/') ? ref.slice(0, colon) : ref
  // Only registry images can be updated this way (a local "finesse:dev" can't be pulled).
  if (!repo.includes('/')) return null
  return `${repo}:${version}`
}

/** Pulls `image` and hands over to a helper that swaps the running container. */
export async function startSelfUpdate(docker: Docker, image: string, onStep: (step: string) => void): Promise<void> {
  const me = await selfContainer(docker)
  if (!me) throw new Error('Finesse isn’t running in Docker, so it can’t update itself')
  onStep('downloading')
  await docker.pull(image)
  onStep('restarting')
  const name = `finesse-updater-${Date.now().toString(36)}`
  await docker.create(name, {
    Image: image,
    Entrypoint: [],
    Cmd: ['node', '--disable-warning=ExperimentalWarning', '/app/server/finesse.mjs', 'swap', me.Id, image],
    Labels: { [LABEL_MANAGED]: 'true', [LABEL_SERVICE]: 'updater' },
    HostConfig: { Binds: ['/var/run/docker.sock:/var/run/docker.sock'], AutoRemove: true, NetworkMode: 'none', SecurityOpt: ['label=disable'] },
  })
  await docker.start(name)
  log.info(`handed over to ${name} to switch to ${image}`)
}

interface FullInspect extends ContainerInspect {
  Config: ContainerInspect['Config'] & { Hostname?: string; ExposedPorts?: Record<string, object>; Cmd?: string[] | null; Entrypoint?: string[] | null; Healthcheck?: unknown; WorkingDir?: string; User?: string }
  NetworkSettings: { Networks: Record<string, { IPAddress: string; Aliases?: string[] | null; NetworkID?: string }> }
}

const minus = (list: string[] | null | undefined, drop: string[] | null | undefined) => (list ?? []).filter((x) => !(drop ?? []).includes(x))

/** The create body that reproduces `old` on a new image (what the admin configured, not what the old image baked in). */
export async function recreateSpec(docker: Docker, old: FullInspect, image: string): Promise<{ body: Record<string, unknown>; extraNetworks: [string, string[]][] }> {
  const oldImage = await docker.imageInspect(old.Image).catch(() => null)
  const baked = (oldImage?.Config as { Env?: string[]; Labels?: Record<string, string> } | undefined) ?? {}
  const labels = { ...(old.Config.Labels ?? {}) }
  for (const [k, v] of Object.entries(baked.Labels ?? {})) if (labels[k] === v) delete labels[k]
  const networks = Object.entries(old.NetworkSettings.Networks ?? {})
  const hostMode = String(old.HostConfig.NetworkMode ?? 'default')
  const primaryName = hostMode === 'default' ? 'bridge' : hostMode
  const primary = networks.find(([n]) => n === primaryName)
  const shortId = old.Id.slice(0, 12)
  const aliases = (a: string[] | null | undefined) => (a ?? []).filter((x) => x !== shortId && x !== old.Id && !x.startsWith(shortId))
  const body: Record<string, unknown> = {
    Image: image,
    Env: minus(old.Config.Env, baked.Env),
    Labels: labels,
    ExposedPorts: old.Config.ExposedPorts ?? {},
    HostConfig: old.HostConfig,
  }
  if (old.Config.Hostname && !old.Id.startsWith(old.Config.Hostname)) body.Hostname = old.Config.Hostname
  if (primary && primary[0] !== 'bridge') {
    body.NetworkingConfig = { EndpointsConfig: { [primary[0]]: { Aliases: aliases(primary[1].Aliases) } } }
  }
  const extraNetworks = networks.filter((n) => n !== primary && !['host', 'none'].includes(n[0])).map(([n, v]) => [n, aliases(v.Aliases)] as [string, string[]])
  return { body, extraNetworks }
}

async function waitHealthy(docker: Docker, id: string, timeoutMs: number): Promise<{ ok: boolean; why: string }> {
  const until = Date.now() + timeoutMs
  let runningSince = 0
  while (Date.now() < until) {
    const c = await docker.inspect(id)
    if (!c) return { ok: false, why: 'the new container disappeared' }
    if (!c.State.Running && !c.State.Restarting) return { ok: false, why: `it exited with code ${c.State.ExitCode}` }
    const health = c.State.Health?.Status
    if (health === 'healthy') return { ok: true, why: '' }
    if (health === 'unhealthy') return { ok: false, why: 'its health check failed' }
    if (!health && c.State.Running) {
      runningSince ||= Date.now()
      if (Date.now() - runningSince > 20000) return { ok: true, why: '' }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return { ok: false, why: `it didn’t become healthy within ${Math.round(timeoutMs / 1000)}s` }
}

/** Run by the helper container: swap `oldId` for a container on `image`, rolling back on failure. */
export async function swap(docker: Docker, oldId: string, image: string, say: (m: string) => void = (m) => log.info(m)): Promise<boolean> {
  const old = (await docker.inspect(oldId)) as FullInspect | null
  if (!old) throw new DockerError(404, `Container ${oldId} not found`)
  const name = old.Name.replace(/^\//, '')
  const { body, extraNetworks } = await recreateSpec(docker, old, image)
  const aside = `${name}-previous`
  await docker.remove(aside, { force: true }).catch(() => {})
  say(`stopping ${name}`)
  await docker.stop(old.Id, 30)
  await docker.rename(old.Id, aside)
  let newId: string | null = null
  try {
    newId = await docker.create(name, body)
    for (const [net, aliases] of extraNetworks) {
      await docker.call('POST', `/networks/${encodeURIComponent(net)}/connect`, { Container: newId, EndpointConfig: { Aliases: aliases } })
    }
    await docker.start(newId)
    say(`started ${name} on ${image}; waiting for it to be healthy`)
    const h = await waitHealthy(docker, newId, 180000)
    if (!h.ok) throw new Error(h.why)
    await docker.remove(old.Id, { force: true })
    say(`${name} is running ${image}`)
    return true
  } catch (e) {
    say(`update failed (${(e as Error).message}) — restoring the previous version`)
    if (newId) {
      const logs = await docker.logs(newId, 40).catch(() => '')
      if (logs) say(`new container said:\n${logs.trim()}`)
      await docker.remove(newId, { force: true }).catch(() => {})
    }
    await docker.rename(old.Id, name)
    await docker.start(old.Id)
    return false
  }
}
