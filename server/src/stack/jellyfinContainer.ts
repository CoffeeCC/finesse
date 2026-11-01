// Which Docker container is the Jellyfin Finesse talks to, on installs where
// Finesse uses someone's own apps ("adopt"). Read-only: Finesse only inspects
// it (its image, folders and graphics cards), and never changes, starts or
// stops a container it didn't make.
//
// Matched, best first: the container setup connected to by name; the
// container named in Jellyfin's address; the one publishing the address's
// port (host.docker.internal:8096, the NAS's own IP…); the one with that
// address on a Docker network; and, failing those, the only Jellyfin image
// running.

import type { Settings } from '../config.ts'
import type { ContainerInspect, ContainerSummary, Docker } from './docker.ts'

export interface JellyfinContainer {
  id: string
  name: string
  image: string
  info: ContainerInspect
  /** How it was matched, in words (for status lines). */
  how: string
}

const strip = (n: string) => n.replace(/^\//, '')

/** The address's host and port (Jellyfin's default port when none is given). */
export function addressOf(url: string): { host: string; port: number } | null {
  try {
    const u = new URL(url)
    return { host: u.hostname.toLowerCase().replace(/^\[|\]$/g, ''), port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) }
  } catch {
    return null
  }
}

/**
 * Picks Jellyfin's container out of a container list (pure, for tests).
 * `ips` gives each container's addresses on its Docker networks.
 */
export function pickJellyfin(
  list: (ContainerSummary & { ips?: string[] })[],
  url: string | undefined,
  opts: { known?: string; self?: string; instance?: string } = {},
): { id: string; how: string } | { reason: string } {
  const running = list.filter((c) => c.State === 'running' && c.Id !== opts.self)
  // Our own stack's Jellyfin is Finesse's in bundle mode, never "someone's own".
  const theirs = running.filter((c) => !(c.Labels?.['finesse.managed'] === 'true' && (!opts.instance || c.Labels['finesse.instance'] === opts.instance)))
  const named = (n: string) => theirs.find((c) => c.Names.some((x) => strip(x).toLowerCase() === n.toLowerCase()))
  if (opts.known) {
    const c = named(opts.known)
    if (c) return { id: c.Id, how: `the container “${opts.known}”` }
  }
  const addr = url ? addressOf(url) : null
  if (addr) {
    const byName = named(addr.host)
    if (byName) return { id: byName.Id, how: `the container “${addr.host}”` }
    const publishing = theirs.filter((c) => (c.Ports ?? []).some((p) => p.PublicPort === addr.port))
    if (publishing.length === 1) return { id: publishing[0]!.Id, how: `the container publishing port ${addr.port}` }
    const byIp = theirs.filter((c) => c.ips?.includes(addr.host))
    if (byIp.length === 1) return { id: byIp[0]!.Id, how: `the container at ${addr.host}` }
    if (publishing.length > 1) {
      const jf = publishing.filter((c) => /jellyfin/i.test(c.Image))
      if (jf.length === 1) return { id: jf[0]!.Id, how: `the container publishing port ${addr.port}` }
    }
  }
  const images = theirs.filter((c) => /jellyfin/i.test(c.Image))
  if (images.length === 1) return { id: images[0]!.Id, how: 'the only Jellyfin container running' }
  if (images.length > 1) return { reason: `More than one Jellyfin container is running here, and Finesse can’t tell which one it uses (${images.map((c) => strip(c.Names[0] ?? c.Id)).join(', ')}).` }
  return { reason: 'Finesse can’t find Jellyfin’s container on this server. Jellyfin may run on another computer, or outside Docker.' }
}

/** Finds Jellyfin's container through the Docker API (read-only). */
export async function findJellyfin(docker: Docker, s: Settings, self?: string): Promise<JellyfinContainer | { reason: string }> {
  if (!(await docker.ping())) return { reason: 'Finesse can’t reach Docker here, so it can’t see Jellyfin’s container. Mount /var/run/docker.sock into Finesse’s container.' }
  const list = await docker.list({}, false).catch(() => [] as ContainerSummary[])
  const addr = s.jellyfin.url ? addressOf(s.jellyfin.url) : null
  // Network addresses only matter for an address that's an IP on a Docker network.
  const withIps: (ContainerSummary & { ips?: string[] })[] = list
  if (addr && /^[\d.]+$/.test(addr.host)) {
    for (const c of withIps) {
      const info = await docker.inspect(c.Id).catch(() => null)
      c.ips = Object.values(info?.NetworkSettings.Networks ?? {}).map((n) => n.IPAddress).filter(Boolean)
    }
  }
  const picked = pickJellyfin(withIps, s.jellyfin.url, { known: s.existing?.apps.jellyfin?.container, self, instance: s.instanceId })
  if ('reason' in picked) return picked
  const info = await docker.inspect(picked.id).catch(() => null)
  if (!info) return { reason: 'Jellyfin’s container went away while Finesse looked at it. Try again in a minute.' }
  return { id: info.Id, name: strip(info.Name), image: info.Config.Image, info, how: picked.how }
}
