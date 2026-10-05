// Keeps an installed stack healthy with nobody watching. Every minute:
//   • Finesse re-joins the stack network (after its own restart or update)
//   • a missing container is recreated, a stopped one started (unless an
//     administrator paused it), and qBittorrent is reconnected when Gluetun
//     restarts underneath it
//   • each app's health endpoint, the VPN tunnel and free disk space are
//     checked and kept for the System page
// Nightly: every app snapshots its database and Finesse archives its own
// state plus each app's key config file. With automatic updates on, apps
// whose pinned version changed (a Finesse update bumps them) are updated in
// the small hours.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'
import type { Paths, Settings, SettingsStore } from '../config.ts'
import { logger } from '../log.ts'
import { stackContext } from '../setup/apply.ts'
import { writeTarGz, type TarEntry } from '../tar.ts'
import { applyPendingRestore, BACKUP_FILE, backupName, BIG_PARTS, databaseEntries, DEFAULT_PARTS, heldApps, partsOf, type BackupPart } from './backup.ts'
import { CATALOG, containerName, orderServices, type StackContext, type StackServiceId } from './catalog.ts'
import { containerSpec, LABEL_MANAGED, LABEL_SPEC, Orchestrator, serviceUrl, specHash } from './orchestrator.ts'

const log = logger('maintain')

export type ServiceState = 'running' | 'starting' | 'restarting' | 'stopped' | 'paused' | 'missing' | 'unreachable'

export interface ServiceHealth {
  id: StackServiceId
  name: string
  role: string
  state: ServiceState
  detail?: string
  image: string
  /** Its container runs an older version/definition than this Finesse ships. */
  updatePending: boolean
  startedAt?: string
}

export interface VpnHealth {
  connected: boolean
  publicIp?: string
  country?: string
  city?: string
  error?: string
}

export interface SystemEvent {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export interface SystemHealth {
  checkedAt: string | null
  docker: boolean
  network: boolean
  services: ServiceHealth[]
  vpn: VpnHealth | null
  disks: { label: string; path: string; total: number; free: number }[]
  backups: { last: string | null; files: BackupFile[]; error?: string }
  events: SystemEvent[]
}

export interface BackupFile {
  name: string
  size: number
  at: string
  parts: BackupPart[]
}

export interface BackupJob {
  state: 'idle' | 'working' | 'done' | 'error'
  step?: string
  file?: BackupFile
  error?: string
}

const BACKUP_KEEP = 14
/** Of those, how many that hold databases or games (they can be big). */
const BIG_BACKUP_KEEP = 3
const APP_BACKUP_KEEP = 7
const STARTUP_GRACE_MS = 120000
const isStackId = (id: string): id is StackServiceId => id in CATALOG

/** Small config files worth keeping (relative to FINESSE_ROOT/config). */
const CONFIG_FILES = [
  'sonarr/config.xml',
  'radarr/config.xml',
  'lidarr/config.xml',
  'prowlarr/config.xml',
  'sabnzbd/sabnzbd.ini',
  'qbittorrent/qBittorrent/qBittorrent.conf',
  'gluetun/auth/config.toml',
  'tailscale/serve.json',
  // Game streaming: Wolf's apps and paired devices, and the certificate they paired with.
  'wolf/cfg/config.toml',
  'wolf/cfg/cert.pem',
  'wolf/cfg/key.pem',
  'romm/config/config.yml',
]

export class Maintainer {
  readonly settings: SettingsStore
  readonly orch: Orchestrator
  readonly paths: Paths
  /** True while setup runs — the loop never fights it. */
  private readonly busy: () => boolean
  backupJob: BackupJob = { state: 'idle' }
  health: SystemHealth = { checkedAt: null, docker: false, network: false, services: [], vpn: null, disks: [], backups: { last: null, files: [] }, events: [] }
  private timer: NodeJS.Timeout | null = null
  private ticking: Promise<SystemHealth> | null = null
  private working = false
  private vpnWasUp: boolean | null = null
  private dockerWasUp: boolean | null = null

  constructor(settings: SettingsStore, orch: Orchestrator, paths: Paths, busy: () => boolean = () => false) {
    this.settings = settings
    this.orch = orch
    this.paths = paths
    this.busy = busy
    this.health.backups = { last: settings.get().maintenance?.lastBackup ?? null, files: this.listBackups() }
  }

  get isWorking() {
    return this.working
  }

  event(level: SystemEvent['level'], message: string) {
    this.health.events.unshift({ at: new Date().toISOString(), level, message })
    this.health.events.length = Math.min(this.health.events.length, 100)
    log[level](message)
  }

  start(intervalMs = 60000) {
    if (this.timer) return
    const loop = () => void this.tick().catch((e) => log.warn('maintenance check failed', e))
    setTimeout(loop, 1500).unref()
    this.timer = setInterval(loop, intervalMs)
    this.timer.unref()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One pass of checks + repairs. Concurrent callers share the same pass. */
  tick(): Promise<SystemHealth> {
    this.ticking ??= this.pass().finally(() => (this.ticking = null))
    return this.ticking
  }

  private async pass(): Promise<SystemHealth> {
    const s = this.settings.get()
    if (s.mode !== 'bundle' || !s.stack) {
      this.health.checkedAt = new Date().toISOString()
      return this.health
    }
    const docker = this.orch.docker
    this.health.docker = await docker.ping()
    if (this.health.docker !== this.dockerWasUp) {
      if (!this.health.docker) this.event('error', 'Finesse can’t reach Docker — the apps can’t be checked or repaired')
      else if (this.dockerWasUp === false) this.event('info', 'Docker is reachable again')
      this.dockerWasUp = this.health.docker
    }
    if (!this.health.docker) {
      this.health.checkedAt = new Date().toISOString()
      return this.health
    }
    const ctx = stackContext(s, await this.orch.hostDevices().catch(() => []))!
    try {
      await this.orch.prepareNetwork(ctx)
      this.health.network = true
    } catch (e) {
      this.health.network = false
      this.event('error', `Couldn’t join the stack network: ${(e as Error).message}`)
    }
    const ids = orderServices(s.stack.services.filter(isStackId))
    if (!this.busy() && !this.working) await this.repair(ctx, ids, s).catch((e) => this.event('error', `Repair failed: ${(e as Error).message}`))
    this.health.services = await this.inspect(ctx, ids, s)
    this.health.vpn = ids.includes('gluetun') ? await this.checkVpn(s) : null
    this.health.disks = this.disks(ctx)
    this.health.checkedAt = new Date().toISOString()
    if (existsSync(join(this.paths.configDir, 'restore-pending.json')) && s.stack) {
      await applyPendingRestore(this.paths.configDir, s.stack.hostRoot, this.orch.docker, (level, m) => this.event(level, m)).catch(() => {})
    }
    if (!this.busy() && !this.working) await this.scheduled(s)
    return this.health
  }

  // ---------- repair ----------

  private async repair(ctx: StackContext, ids: StackServiceId[], s: Settings) {
    const docker = this.orch.docker
    // Paused by an administrator, or held while a restore swaps a database in.
    const paused = new Set([...(s.stack?.paused ?? []), ...heldApps(this.paths.configDir)])
    let gluetunStarted = 0
    for (const id of ids) {
      const name = containerName(id)
      const def = CATALOG[id]
      if (paused.has(id)) continue
      const c = await docker.inspect(name)
      if (!c) {
        this.event('warn', `${def.name} was missing — recreating it`)
        await this.orch.ensureService(id, ctx)
        if (id === 'gluetun') gluetunStarted = Date.now()
        continue
      }
      if (c.Config.Labels?.[LABEL_MANAGED] !== 'true') continue
      if (!c.State.Running && !c.State.Restarting) {
        this.event('warn', `${def.name} had stopped (exit code ${c.State.ExitCode}) — starting it again`)
        await docker.start(name)
      }
      const started = Date.parse(c.State.StartedAt) || 0
      if (id === 'gluetun') gluetunStarted = Math.max(gluetunStarted, started)
      // qBittorrent lives in Gluetun's network: when Gluetun restarts, it's cut off until it restarts too.
      if (id === 'qbittorrent' && gluetunStarted && started < gluetunStarted - 2000) {
        this.event('info', 'The VPN restarted — reconnecting qBittorrent through it')
        await docker.restart(name).catch(async () => {
          await this.orch.ensureService('qbittorrent', ctx, undefined, { forceRecreate: true })
        })
      }
    }
  }

  // ---------- inspect ----------

  private async probe(id: StackServiceId): Promise<{ ok: boolean; detail?: string }> {
    const def = CATALOG[id]
    if (!def.port || !def.healthPath) return { ok: true }
    try {
      const r = await fetch(serviceUrl(id) + def.healthPath, { signal: AbortSignal.timeout(5000), redirect: 'manual' })
      r.body?.cancel().catch(() => {})
      if ((r.status >= 200 && r.status < 300) || r.status === 401 || r.status === 403) return { ok: true }
      return { ok: false, detail: `answers HTTP ${r.status}` }
    } catch (e) {
      return { ok: false, detail: (e as Error).name === 'TimeoutError' ? 'not answering' : (e as Error).message }
    }
  }

  private async inspect(ctx: StackContext, ids: StackServiceId[], s: Settings): Promise<ServiceHealth[]> {
    const docker = this.orch.docker
    ctx.selinux ??= await this.orch.hostSelinux()
    const paused = new Set(s.stack?.paused ?? [])
    return Promise.all(
      ids.map(async (id): Promise<ServiceHealth> => {
        const def = CATALOG[id]
        const base = { id, name: def.name, role: def.role, image: def.image }
        const c = await docker.inspect(containerName(id)).catch(() => null)
        if (!c) return { ...base, state: 'missing', updatePending: false }
        const want = specHash(containerSpec(def, ctx))
        const updatePending = c.Config.Labels?.[LABEL_SPEC] !== want
        const out: ServiceHealth = { ...base, image: c.Config.Image, updatePending, state: 'running', startedAt: c.State.StartedAt }
        if (c.State.Restarting) {
          const logs = await docker.logs(containerName(id), 5).catch(() => '')
          return { ...out, state: 'restarting', detail: logs.trim().split('\n').pop()?.slice(0, 300) }
        }
        if (!c.State.Running) return { ...out, state: paused.has(id) ? 'paused' : 'stopped', detail: paused.has(id) ? 'Stopped by an administrator' : `Exited with code ${c.State.ExitCode}` }
        const p = await this.probe(id)
        if (!p.ok) {
          const young = Date.now() - (Date.parse(c.State.StartedAt) || 0) < STARTUP_GRACE_MS
          return { ...out, state: young ? 'starting' : 'unreachable', detail: p.detail }
        }
        return out
      }),
    )
  }

  private async checkVpn(s: Settings): Promise<VpnHealth> {
    const key = s.services.gluetun?.apiKey
    const url = s.services.gluetun?.url ?? 'http://gluetun:8000'
    const headers = key ? { 'X-API-Key': key } : undefined
    let vpn: VpnHealth
    try {
      const st = (await fetch(`${url}/v1/vpn/status`, { headers, signal: AbortSignal.timeout(5000) }).then((r) => r.json())) as { status?: string }
      if (st.status !== 'running') vpn = { connected: false, error: `The tunnel is ${st.status ?? 'down'}` }
      else {
        const ip = (await fetch(`${url}/v1/publicip/ip`, { headers, signal: AbortSignal.timeout(5000) }).then((r) => r.json())) as { public_ip?: string; country?: string; city?: string }
        vpn = ip.public_ip ? { connected: true, publicIp: ip.public_ip, country: ip.country, city: ip.city } : { connected: false, error: 'Connecting…' }
      }
    } catch (e) {
      vpn = { connected: false, error: `The VPN container isn’t answering (${(e as Error).message})` }
    }
    if (vpn.connected !== this.vpnWasUp) {
      if (vpn.connected) this.event('info', `VPN connected${vpn.country ? ` (${vpn.country})` : ''} — torrents are flowing through it`)
      else if (this.vpnWasUp !== null) this.event('warn', 'VPN disconnected — torrents are paused until it reconnects (nothing leaks outside the tunnel)')
      this.vpnWasUp = vpn.connected
    }
    return vpn
  }

  private disks(ctx: StackContext) {
    const out: SystemHealth['disks'] = []
    const seen = new Set<number>()
    for (const [label, path] of [
      ['Media & downloads', ctx.hostData],
      ['App settings', ctx.hostRoot],
    ] as const) {
      try {
        const dev = statSync(path).dev
        if (seen.has(dev)) continue
        seen.add(dev)
        const f = statfsSync(path)
        out.push({ label, path, total: f.blocks * f.bsize, free: f.bavail * f.bsize })
      } catch {
        /* not mounted here (dev) */
      }
    }
    return out
  }

  // ---------- nightly jobs ----------

  private async scheduled(s: Settings) {
    // Backups and updates only on a settled stack (not mid-repair or mid-start).
    if (this.health.services.some((x) => x.state !== 'running' && x.state !== 'paused')) return
    const now = new Date()
    const last = Date.parse(s.maintenance?.lastBackup ?? '') || 0
    const age = now.getTime() - last
    const quietHours = now.getHours() >= 3 && now.getHours() < 6
    if ((quietHours && age > 20 * 3600e3) || age > 36 * 3600e3) {
      await this.backupNow('nightly').catch(() => {})
    }
    const pending = this.health.services.filter((x) => x.updatePending && x.state !== 'missing').map((x) => x.id)
    if (s.updates.auto && pending.length && quietHours) {
      await this.updateStack(pending).catch((e) => this.event('error', `Updating apps failed: ${(e as Error).message}`))
    }
  }

  /** Recreates services whose definition changed (new pinned versions), in dependency order. */
  async updateStack(ids?: StackServiceId[]): Promise<StackServiceId[]> {
    if (this.working) throw new Error('Maintenance is already running')
    if (this.busy()) throw new Error('Setup is running')
    const s = this.settings.get()
    if (!s.stack) throw new Error('There is no stack to update')
    this.working = true
    try {
      const ctx = stackContext(s, await this.orch.hostDevices())!
      const pending = ids ?? (await this.inspect(ctx, orderServices(s.stack.services.filter(isStackId)), s)).filter((x) => x.updatePending).map((x) => x.id)
      const done: StackServiceId[] = []
      let gluetunNew = false
      for (const id of orderServices(pending)) {
        this.event('info', `Updating ${CATALOG[id].name}…`)
        const created = await this.orch.ensureService(id, ctx, undefined, { forceRecreate: id === 'qbittorrent' && gluetunNew })
        if (id === 'gluetun') gluetunNew = created
        if (CATALOG[id].healthPath) await this.orch.waitReady(id, undefined, 300000)
        done.push(id)
      }
      // qBittorrent must follow a recreated Gluetun even if its own definition didn't change.
      if (gluetunNew && !done.includes('qbittorrent') && s.stack.services.includes('qbittorrent')) {
        await this.orch.ensureService('qbittorrent', ctx, undefined, { forceRecreate: true })
        done.push('qbittorrent')
      }
      if (done.length) this.event('info', `Updated ${done.map((id) => CATALOG[id].name).join(', ')}`)
      this.settings.update((x) => {
        x.maintenance = { ...x.maintenance, lastStackUpdate: new Date().toISOString() }
      })
      return done
    } finally {
      this.working = false
      void this.tick()
    }
  }

  // ---------- backups ----------

  listBackups(): BackupFile[] {
    try {
      return readdirSync(this.paths.backups)
        .filter((n) => BACKUP_FILE.test(n))
        .map((name) => {
          const st = statSync(join(this.paths.backups, name))
          return { name, size: st.size, at: st.mtime.toISOString(), parts: partsOf(name) }
        })
        .sort((a, b) => b.at.localeCompare(a.at))
    } catch {
      return []
    }
  }

  /** Asks each app for a database snapshot, then archives Finesse's state + app configs. */
  async backupNow(reason: 'nightly' | 'manual' | 'before-update' = 'manual', wanted: BackupPart[] = DEFAULT_PARTS, onStep: (step: string) => void = () => {}): Promise<BackupFile> {
    const parts: BackupPart[] = ['settings', ...wanted.filter((p) => p !== 'settings')]
    const s = this.settings.get()
    const snapshotErrors: string[] = []
    // 1. Apps snapshot their own databases into their config folders.
    onStep('Asking the apps for snapshots…')
    if (s.jellyfin.url && s.jellyfin.apiKey && s.mode === 'bundle') {
      await fetch(`${s.jellyfin.url.replace(/\/+$/, '')}${s.jellyfin.basePath}/Backup/Create`, {
        method: 'POST',
        headers: { Authorization: `MediaBrowser Token="${s.jellyfin.apiKey}"`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Database: true, Metadata: false, Trickplay: false, Subtitles: false }),
        signal: AbortSignal.timeout(300000),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
        })
        .catch((e) => snapshotErrors.push(`Jellyfin (${(e as Error).message})`))
    }
    for (const [app, api] of [
      ['sonarr', 'v3'],
      ['radarr', 'v3'],
      ['lidarr', 'v1'],
      ['prowlarr', 'v1'],
    ] as const) {
      const svc = s.services[app]
      if (!svc?.url || !svc.apiKey) continue
      await fetch(`${svc.url.replace(/\/+$/, '')}/api/${api}/command`, {
        method: 'POST',
        headers: { 'X-Api-Key': svc.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Backup' }),
        signal: AbortSignal.timeout(15000),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
        })
        .catch((e) => snapshotErrors.push(`${CATALOG[app].name} (${(e as Error).message})`))
    }

    // RomM keeps its library, collections and play history in MariaDB: dump it
    // next to RomM's config (last 7 kept). Saves and states are files in config/romm/assets.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    if (s.stack?.services.includes('romm-db')) {
      const r = await this.orch.docker
        .exec(containerName('romm-db'), ['sh', '-c', 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --quick romm 2>/dev/null'])
        .catch((e) => ({ code: -1, output: String(e) }))
      if (r.code === 0 && r.output.includes('CREATE TABLE')) {
        const dir = join(s.stack.hostRoot, 'config', 'romm', 'backups')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `romm-${stamp}.sql.gz`), gzipSync(r.output), { mode: 0o600 })
        const old = readdirSync(dir).filter((n) => /^romm-.*\.sql\.gz$/.test(n)).sort()
        for (const n of old.slice(0, Math.max(0, old.length - 7))) rmSync(join(dir, n), { force: true })
      } else snapshotErrors.push('RomM (its database didn’t answer)')
    }

    // 2. Finesse's own archive, with the parts asked for.
    onStep('Collecting…')
    const entries: TarEntry[] = []
    const scratch = join(this.paths.backups, `.scratch-${process.pid}-${Date.now()}`)
    mkdirSync(this.paths.backups, { recursive: true })
    if (existsSync(this.paths.settingsFile)) entries.push({ path: 'finesse/finesse.json', data: readFileSync(this.paths.settingsFile) })
    if (existsSync(this.paths.invitesDb)) {
      const tmp = join(this.paths.backups, `.invites-${process.pid}.db`)
      rmSync(tmp, { force: true })
      try {
        const db = new DatabaseSync(this.paths.invitesDb)
        db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
        db.close()
        entries.push({ path: 'finesse/invites.db', data: readFileSync(tmp) })
      } catch (e) {
        snapshotErrors.push(`invites (${(e as Error).message})`)
      } finally {
        rmSync(tmp, { force: true })
      }
    }
    const root = s.stack ? `${s.stack.hostRoot}/config` : null
    if (root && parts.includes('apps')) {
      for (const rel of CONFIG_FILES) {
        const f = join(root, rel)
        if (existsSync(f)) entries.push({ path: `apps/${rel}`, data: readFileSync(f) })
      }
      const jfConf = join(root, 'jellyfin', 'config')
      if (existsSync(jfConf)) {
        for (const n of readdirSync(jfConf)) if (n.endsWith('.xml')) entries.push({ path: `apps/jellyfin/config/${n}`, data: readFileSync(join(jfConf, n)) })
      }
    }
    if (parts.some((p) => BIG_PARTS.includes(p))) onStep('Copying databases…')
    const dbs = databaseEntries(s, parts, scratch)
    entries.push(...dbs.entries)
    snapshotErrors.push(...dbs.problems)
    const manifest = {
      finesse: s.version,
      createdAt: new Date().toISOString(),
      reason,
      instanceId: s.instanceId,
      parts,
      files: entries.map((f) => f.path),
      note: 'Restore with: docker exec finesse finesse restore <this file>. Each app also keeps database snapshots in its own config folder.',
    }
    entries.unshift({ path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) })
    const name = backupName(stamp, parts)
    const file = join(this.paths.backups, name)
    onStep('Writing the backup…')
    try {
      await writeTarGz(`${file}.partial`, entries)
      renameSync(`${file}.partial`, file)
    } finally {
      rmSync(`${file}.partial`, { force: true })
      rmSync(scratch, { recursive: true, force: true })
    }

    // 3. Retention: the newest 14, of which at most 3 big ones.
    let big = 0
    for (const [i, b] of this.listBackups().entries()) {
      const isBig = b.parts.some((p) => BIG_PARTS.includes(p))
      if (isBig) big++
      if (i >= BACKUP_KEEP || (isBig && big > BIG_BACKUP_KEEP)) rmSync(join(this.paths.backups, b.name), { force: true })
    }
    if (root) this.pruneAppBackups(root)

    const at = new Date().toISOString()
    this.settings.update((x) => {
      x.maintenance = { ...x.maintenance, lastBackup: at }
    })
    this.health.backups = {
      last: at,
      files: this.listBackups(),
      error: snapshotErrors.length ? `Some parts couldn’t be backed up: ${snapshotErrors.join(', ')}` : undefined,
    }
    if (snapshotErrors.length) this.event('warn', this.health.backups.error!)
    this.event('info', `Backed up (${reason}${parts.length > 2 || !parts.includes('apps') ? `: ${parts.join(', ')}` : ''})`)
    const st = statSync(file)
    return { name, size: st.size, at: st.mtime.toISOString(), parts }
  }

  /** Runs a backup in the background (the Settings page follows backupJob). */
  startBackup(parts: BackupPart[]): BackupJob {
    if (this.backupJob.state === 'working') throw new Error('A backup is already running')
    this.backupJob = { state: 'working', step: 'Starting…' }
    this.backupNow('manual', parts, (step) => {
      this.backupJob.step = step
    }).then(
      (file) => (this.backupJob = { state: 'done', file }),
      (e) => (this.backupJob = { state: 'error', error: (e as Error).message }),
    )
    return this.backupJob
  }

  /** Apps keep manual backups forever; trim them to the newest few. */
  private pruneAppBackups(root: string) {
    const dirs = [
      ...['sonarr', 'radarr', 'lidarr', 'prowlarr'].map((a) => join(root, a, 'Backups', 'manual')),
      join(root, 'jellyfin', 'data', 'backups'),
    ]
    for (const dir of dirs) {
      try {
        const zips = readdirSync(dir)
          .filter((n) => n.endsWith('.zip'))
          .map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs }))
          .sort((a, b) => b.t - a.t)
        for (const z of zips.slice(APP_BACKUP_KEEP)) rmSync(join(dir, z.n), { force: true })
      } catch {
        /* no backups yet */
      }
    }
  }
}
