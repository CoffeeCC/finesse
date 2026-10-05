// Turns a validated setup document into a running, wired stack — in visible
// steps with live progress (the wizard's "Building your server" screen and
// `finesse setup status` both read this). Safe to re-run: every step checks
// what exists first, so "Try again" after a failure resumes where it broke.

import { existsSync } from 'node:fs'
import type { Settings, SettingsStore } from '../config.ts'
import { clearSetupCode } from '../auth.ts'
import { logger } from '../log.ts'
import { CATALOG, containerName, orderServices, wolfRunDir, wolfSocket, type GamesConfig, type StackContext, type StackServiceId } from '../stack/catalog.ts'
import { syncEmulators, wolfCall, wolfProblem } from '../streaming.ts'
import { wolfFolderProblem } from '../stack/wolf.ts'
import { Orchestrator, serviceUrl } from '../stack/orchestrator.ts'
import { newKey, seedArr, seedGluetunAuth, seedJellyfin, seedQbit, seedSab, seedTailscaleServe } from '../stack/seed.ts'
import { clearFinishedTcLog } from '../stack/games.ts'
import { Arr, jellyfinScan, wireArr, wireJellyfin, wireLanguages, wireProwlarr, wireQbit, wireRomm, wireSab } from '../stack/wire.ts'
import { qualityProfiles, redact, servicesFor, vpnConfig, type SetupDoc } from './doc.ts'

const log = logger('setup')

export type StepState = 'pending' | 'running' | 'done' | 'error' | 'skipped'
export interface Step {
  id: string
  title: string
  state: StepState
  detail?: string
  progress?: number
}
export interface RunStatus {
  state: 'idle' | 'running' | 'done' | 'error'
  steps: Step[]
  log: string[]
  startedAt?: string
  finishedAt?: string
  error?: string
  warnings: string[]
  services?: StackServiceId[]
}

/** Host paths and ids from the environment the installer started Finesse with. */
export function stackBase(): Omit<StackContext, 'timezone' | 'exposeJellyfin' | 'jellyfinPort' | 'vpn' | 'tailscale' | 'cloudflared'> & Pick<StackContext, 'proxy'> {
  const hostRoot = (process.env.FINESSE_ROOT || '/opt/finesse').replace(/\/+$/, '')
  return {
    hostRoot,
    hostData: (process.env.FINESSE_DATA || `${hostRoot}/data`).replace(/\/+$/, ''),
    puid: Number(process.env.PUID ?? 1000),
    pgid: Number(process.env.PGID ?? 1000),
    network: process.env.FINESSE_NETWORK || 'finesse',
    gpu: existsSync('/dev/dri'),
    proxy: appProxy(),
  }
}

/** FINESSE_APP_HTTP(S)_PROXY / _NO_PROXY / _CA_BUNDLE: an outbound proxy for the apps. */
function appProxy(): StackContext['proxy'] {
  const e = process.env
  const p = { http: e.FINESSE_APP_HTTP_PROXY || undefined, https: e.FINESSE_APP_HTTPS_PROXY || undefined, noProxy: e.FINESSE_APP_NO_PROXY || undefined, caBundle: e.FINESSE_APP_CA_BUNDLE || undefined }
  return p.http || p.https ? p : undefined
}

/** Waits for the Tailscale container to join the tailnet; returns its HTTPS address. */
async function tailscaleUrl(orch: Orchestrator, timeoutMs = 90000): Promise<{ url?: string; problem?: string }> {
  const until = Date.now() + timeoutMs
  let state = ''
  while (Date.now() < until) {
    const r = await orch.docker.exec(containerName('tailscale'), ['tailscale', 'status', '--json']).catch(() => null)
    if (r?.code === 0) {
      try {
        const st = JSON.parse(r.output.slice(r.output.indexOf('{'))) as { BackendState?: string; Self?: { DNSName?: string } }
        state = st.BackendState ?? ''
        if (state === 'Running' && st.Self?.DNSName) return { url: `https://${st.Self.DNSName.replace(/\.$/, '')}` }
        if (state === 'NeedsLogin') return { problem: 'the auth key was rejected — create a new one (Settings → Keys → Generate auth key) and run setup again' }
      } catch {
        /* not ready */
      }
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return { problem: `it didn’t connect within ${timeoutMs / 1000}s${state ? ` (state: ${state})` : ''} — check the auth key and that this machine can reach the internet` }
}

/** Null when the tunnel registered a connection with Cloudflare, else what went wrong. */
async function cloudflaredConnected(orch: Orchestrator, timeoutMs = 45000): Promise<string | null> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const logs = await orch.docker.logs(containerName('cloudflared'), 200).catch(() => '')
    if (/Registered tunnel connection/i.test(logs)) return null
    if (/Unauthorized|invalid token|Provided Tunnel token is not valid/i.test(logs)) return 'the tunnel token was rejected — copy it again from Zero Trust → Networks → Tunnels'
    await new Promise((r) => setTimeout(r, 2000))
  }
  return 'the tunnel didn’t connect yet — check the token, and that the public hostname points at http://finesse:8080'
}

/** Rebuilds the context the stack was installed with (for repairs + updates). */
export function stackContext(s: Settings, hostDevices: string[]): StackContext | null {
  const st = s.stack
  if (!st) return null
  return {
    ...stackBase(),
    hostRoot: st.hostRoot,
    hostData: st.hostData,
    puid: st.puid,
    pgid: st.pgid,
    timezone: st.timezone,
    exposeJellyfin: st.exposeJellyfin ?? true,
    jellyfinPort: st.jellyfinPort ?? 8096,
    hostDevices,
    gpu: hostDevices.includes('/dev/dri'),
    vpn: st.vpn,
    tailscale: st.remote?.tailscale,
    cloudflared: st.remote?.cloudflare,
    games: s.games,
    streaming: st.streaming,
  }
}

/** Games secrets: kept from the last run (the database was created with them), else new. */
function gamesConfig(doc: SetupDoc, prev?: GamesConfig): GamesConfig {
  const g = doc.games
  return {
    dbPassword: prev?.dbPassword || newKey(),
    dbRootPassword: prev?.dbRootPassword || newKey(),
    secretKey: prev?.secretKey || newKey() + newKey(),
    igdb: g?.igdb ?? prev?.igdb,
    steamGridDbKey: g?.steamGridDbKey ?? prev?.steamGridDbKey,
    screenscraper: g?.screenscraper ?? prev?.screenscraper,
    login: prev?.login,
  }
}

/** MariaDB's own readiness check (it accepts connections a moment before it's ready). */
async function waitDatabase(orch: Orchestrator, timeoutMs = 180000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const r = await orch.docker.exec(containerName('romm-db'), ['healthcheck.sh', '--connect', '--innodb_initialized']).catch(() => null)
    if (r?.code === 0) return
    await new Promise((res) => setTimeout(res, 2000))
  }
  throw new Error('The games database didn’t start within 3 minutes — check Settings → Server → Logs for “RomM database”')
}

/** Starts RomM + its database and signs Finesse in (shared by setup and Settings → Server). */
async function installGames(orch: Orchestrator, ctx: StackContext, settings: SettingsStore, say: (m: string) => void): Promise<{ username: string; password: string }> {
  // Without its passwords the database would never start; say why instead of waiting 3 minutes.
  if (!ctx.games) throw new Error('Games isn’t switched on, so there’s nothing to set up')
  clearFinishedTcLog(ctx.hostRoot)
  await orch.ensureService('romm-db', ctx)
  say('Waiting for the games database…')
  await waitDatabase(orch)
  say('Starting RomM…')
  await orch.ensureService('romm', ctx)
  try {
    await orch.waitReady('romm', undefined, 300000)
  } catch (e) {
    const logs = await orch.docker.logs(containerName('romm'), 200).catch(() => '')
    if (/Access denied for user/i.test(logs))
      throw new Error('RomM can’t sign in to its database — it was created with different settings. To start Games fresh, delete the config/romm-db folder and try again.')
    throw e
  }
  const s = settings.get()
  const old = s.services.romm
  const creds =
    s.games?.login ?? (old?.url === serviceUrl('romm') && old.username && old.password ? { username: old.username, password: old.password } : { username: 'finesse', password: newKey() })
  // Saved before RomM creates the account, so a retry signs in with the same password.
  settings.update((x) => void (x.games && (x.games.login = creds)))
  await wireRomm(serviceUrl('romm'), creds, say)
  return creds
}

export class SetupRunner {
  status: RunStatus = { state: 'idle', steps: [], log: [], warnings: [] }
  private settings: SettingsStore
  readonly orch: Orchestrator
  /** When the last run finished (the setup code stays valid for a while after). */
  finishedAt = 0

  constructor(settings: SettingsStore, orch = new Orchestrator()) {
    this.settings = settings
    this.orch = orch
  }

  private say(msg: string) {
    const line = `${new Date().toISOString().slice(11, 19)} ${msg}`
    this.status.log.push(line)
    if (this.status.log.length > 400) this.status.log.shift()
    log.info(msg)
  }

  private step(id: string): Step {
    return this.status.steps.find((s) => s.id === id)!
  }

  private async run(id: string, fn: (s: Step) => Promise<void>) {
    const s = this.step(id)
    // A step this setup doesn't need (Games left off, no downloads, no remote
    // access) never runs.
    if (!s || s.state === 'skipped') return
    s.state = 'running'
    this.say(`▶ ${s.title}`)
    try {
      await fn(s)
      if (s.state === 'running') s.state = 'done'
      s.progress = undefined
    } catch (e) {
      s.state = 'error'
      s.detail = (e as Error).message
      throw e
    }
  }

  start(doc: SetupDoc): RunStatus {
    if (this.status.state === 'running') throw new Error('Setup is already running')
    if (this.gamesJob.state === 'working' || this.streamingJob.state === 'working') throw new Error('Finesse is busy — try again in a minute')
    const services = orderServices(servicesFor(doc))
    const has = (id: StackServiceId) => services.includes(id)
    const downloads = has('prowlarr')
    const steps: [string, string, boolean][] = [
      ['check', 'Checking this machine', true],
      ['folders', 'Creating folders', true],
      ['download', 'Downloading apps', true],
      ['jellyfin', 'Starting Jellyfin', true],
      ['jellyfin-setup', 'Setting up your libraries', true],
      ['downloaders', 'Starting downloaders', has('sabnzbd') || has('qbittorrent')],
      ['managers', 'Starting Sonarr, Radarr & friends', downloads],
      ['connect', 'Connecting everything', downloads],
      ['games', 'Setting up Games', has('romm')],
      ['remote', 'Remote access', has('tailscale') || has('cloudflared')],
      ['finish', 'Finishing up', true],
    ]
    this.status = {
      state: 'running',
      steps: steps.map(([id, title, on]) => ({ id, title, state: on ? 'pending' : 'skipped' })),
      log: [],
      warnings: [],
      startedAt: new Date().toISOString(),
      services,
    }
    this.settings.update((s) => {
      // A re-run on a finished install is a repair: the server stays "ready"
      // (and administrators stay signed in) while it runs.
      if (!s.setup.completedAt) s.setup.state = 'applying'
      s.setup.startedAt = this.status.startedAt
      delete s.setup.lastError
    })
    this.say(`Setup started for: ${services.map((id) => CATALOG[id].name).join(', ')}`)
    log.info('setup document', redact(doc))
    void this.execute(doc, services).then(
      () => {
        this.status.state = 'done'
        this.status.finishedAt = new Date().toISOString()
        this.finishedAt = Date.now()
        this.say('✔ Your server is ready')
        // The code keeps working briefly so the wizard can read the final status.
        setTimeout(() => clearSetupCode(this.settings), 30 * 60 * 1000).unref()
      },
      (e) => {
        this.status.state = 'error'
        this.status.error = (e as Error).message
        this.status.finishedAt = new Date().toISOString()
        this.finishedAt = Date.now()
        this.settings.update((s) => {
          s.setup.state = s.setup.completedAt ? 'ready' : 'error'
          s.setup.lastError = (e as Error).message
        })
        this.say(`✖ ${(e as Error).message}`)
        log.error('setup failed', e)
      },
    )
    return this.status
  }

  private async execute(doc: SetupDoc, services: StackServiceId[]) {
    const base = stackBase()
    const ctx: StackContext = {
      ...base,
      timezone: doc.server?.timezone || process.env.TZ || 'Etc/UTC',
      exposeJellyfin: doc.options?.exposeJellyfinPort ?? true,
      jellyfinPort: doc.options?.jellyfinPort ?? 8096,
      vpn: doc.downloads?.torrents?.vpn ? vpnConfig(doc.downloads.torrents.vpn) : undefined,
      tailscale: doc.remoteAccess?.method === 'tailscale' ? { authKey: doc.remoteAccess.tailscale!.authKey, hostname: doc.remoteAccess.tailscale!.hostname || 'finesse' } : undefined,
      cloudflared: doc.remoteAccess?.method === 'cloudflare' ? { token: doc.remoteAccess.cloudflare!.token } : undefined,
      games: services.includes('romm') ? gamesConfig(doc, this.settings.get().games) : undefined,
    }
    // Saved right away: a retry after a failure must reuse the database password.
    if (ctx.games) this.settings.update((x) => void (x.games = ctx.games))
    const has = (id: StackServiceId) => services.includes(id)
    const orch = this.orch
    const progress = (s: Step) => (e: { service: StackServiceId; phase: string; fraction?: number; detail?: string }) => {
      const name = CATALOG[e.service].name
      if (e.phase === 'pull') s.detail = `Downloading ${name}${e.fraction !== undefined ? ` — ${Math.round(e.fraction * 100)}%` : ''}`
      else if (e.phase === 'wait') s.detail = `Waiting for ${name} to start…`
      else if (e.phase === 'ready') this.say(`${name} is up`)
      else if (e.phase === 'create') this.say(`${e.detail === 'updating' ? 'Updating' : 'Creating'} ${name}`)
    }

    await this.run('check', async () => {
      if (!(await orch.docker.ping())) throw new Error('Finesse can’t reach Docker — start it with /var/run/docker.sock mounted')
      ctx.hostDevices = await orch.hostDevices()
      ctx.gpu = ctx.hostDevices.includes('/dev/dri')
      if ((has('gluetun') || has('tailscale')) && !ctx.hostDevices.includes('/dev/net/tun')) throw new Error('This machine has no /dev/net/tun, which the VPN needs')
      await orch.prepareNetwork(ctx)
    })

    // Keys we generate up front so every app starts pre-wired.
    const keys: Record<string, string> = {}
    let qbitCreds: { username: string; password: string } | null = null
    const prev = this.settings.get()
    const gluetunKey = prev.services.gluetun?.apiKey || newKey()
    await this.run('folders', async () => {
      orch.ensureDirs(ctx, services)
      if (has('jellyfin')) seedJellyfin(`${ctx.hostRoot}/config/jellyfin`, ctx.puid, ctx.pgid)
      for (const app of ['prowlarr', 'sonarr', 'radarr', 'lidarr'] as const) {
        if (has(app)) keys[app] = seedArr(`${ctx.hostRoot}/config/${app}`, app, ctx.puid, ctx.pgid)
      }
      if (has('sabnzbd')) keys.sabnzbd = seedSab(`${ctx.hostRoot}/config/sabnzbd`, ctx.puid, ctx.pgid)
      if (has('qbittorrent')) qbitCreds = seedQbit(`${ctx.hostRoot}/config/qbittorrent`, ctx.puid, ctx.pgid) ?? (prev.services.qbittorrent?.username ? { username: prev.services.qbittorrent.username, password: prev.services.qbittorrent.password ?? '' } : null)
      if (has('gluetun')) seedGluetunAuth(`${ctx.hostRoot}/config/gluetun`, gluetunKey)
      if (has('tailscale')) seedTailscaleServe(`${ctx.hostRoot}/config/tailscale`)
    })

    await this.run('download', async (s) => {
      let i = 0
      for (const id of services) {
        i++
        s.progress = (i - 1) / services.length
        await orch.ensureImage(CATALOG[id], (e) => {
          if (e.fraction !== undefined) s.progress = (i - 1 + e.fraction) / services.length
          s.detail = `${CATALOG[id].name} (${i} of ${services.length})`
        })
      }
      s.detail = `${services.length} apps ready`
    })

    let jf = { apiKey: prev.jellyfin.apiKey ?? '', basePath: '/jellyfin', adminId: '' }
    await this.run('jellyfin', async (s) => {
      // Jellyfin's own port is for native Jellyfin apps (Finesse reaches it
      // internally). If something already uses it, take the next free one.
      if (ctx.exposeJellyfin) {
        const running = await orch.docker.inspect(containerName('jellyfin'))
        const bindings = (running?.HostConfig.PortBindings ?? {}) as Record<string, { HostPort?: string }[] | undefined>
        const bound = Number(bindings['8096/tcp']?.[0]?.HostPort) || 0
        const asked = doc.options?.jellyfinPort
        if (running?.Config.Labels?.['finesse.managed'] === 'true' && bound && (asked === undefined || asked === bound)) {
          ctx.jellyfinPort = bound // keep the port it already has
        } else {
          const want = asked ?? prev.stack?.jellyfinPort ?? 8096
          const free = await orch.freePortFrom(want)
          if (free === null) {
            ctx.exposeJellyfin = false
            this.status.warnings.push(`Ports ${want}–${want + 19} are all taken, so Jellyfin’s own port isn’t published (the Finesse app is unaffected).`)
          } else {
            if (free !== want) {
              this.status.warnings.push(`Port ${want} was taken, so native Jellyfin apps connect on port ${free}.`)
              this.say(`Port ${want} is in use — publishing Jellyfin on ${free}`)
            }
            ctx.jellyfinPort = free
          }
        }
      }
      await orch.ensureService('jellyfin', ctx, progress(s))
      await orch.waitReady('jellyfin', progress(s), 300000, ['/jellyfin/System/Info/Public', '/System/Info/Public'])
      // Jellyfin answers a little before it has really finished starting (and
      // quietly drops what it gets meanwhile) — wait for its own all-clear.
      s.detail = 'Waiting for Jellyfin to finish starting…'
      await orch.waitLog('jellyfin', /Startup complete/, 180000)
    })
    await this.run('jellyfin-setup', async (s) => {
      jf = await wireJellyfin(
        {
          url: serviceUrl('jellyfin'),
          admin: doc.admin,
          serverName: doc.server?.name || 'Finesse',
          language: (doc.server?.language || 'en').split('-')[0]!,
          country: doc.server?.country || 'US',
          libraries: { movies: true, shows: true, music: true, ...doc.libraries },
          apiKey: prev.jellyfin.apiKey,
          restart: async () => {
            await orch.docker.restart(containerName('jellyfin'), 30)
            await orch.waitReady('jellyfin', progress(s), 300000, ['/jellyfin/System/Info/Public', '/System/Info/Public'])
            await orch.waitLog('jellyfin', /Startup complete/, 180000)
          },
        },
        (m) => {
          s.detail = m
          this.say(m)
        },
      )
      // Save Jellyfin now: from here on the app can sign in even if a later step fails.
      this.settings.update((x) => {
        x.mode = 'bundle'
        x.jellyfin = { url: serviceUrl('jellyfin'), apiKey: jf.apiKey, basePath: jf.basePath }
      })
    })

    await this.run('downloaders', async (s) => {
      if (has('sabnzbd')) {
        await orch.ensureService('sabnzbd', ctx, progress(s))
        await orch.waitReady('sabnzbd', progress(s))
      }
      if (has('gluetun')) {
        const recreated = await orch.ensureService('gluetun', ctx, progress(s))
        // qBittorrent lives in Gluetun's network namespace: a new Gluetun means a new qBittorrent.
        await orch.ensureService('qbittorrent', ctx, progress(s), { forceRecreate: recreated })
        await orch.waitReady('qbittorrent', progress(s), 180000)
      }
    })

    await this.run('managers', async (s) => {
      for (const id of ['prowlarr', 'sonarr', 'radarr', 'lidarr'] as const) {
        if (!has(id)) continue
        await orch.ensureService(id, ctx, progress(s))
      }
      for (const id of ['prowlarr', 'sonarr', 'radarr', 'lidarr'] as const) {
        if (has(id)) await orch.waitReady(id, progress(s))
      }
    })

    await this.run('connect', async (s) => {
      const say = (m: string) => {
        s.detail = m
        this.say(m)
      }
      if (has('sabnzbd')) await wireSab(serviceUrl('sabnzbd'), keys.sabnzbd!, doc.downloads?.usenet?.servers ?? [], say)
      if (has('qbittorrent')) {
        await wireQbit(serviceUrl('qbittorrent'), { radarr: '/data/torrents/movies', 'tv-sonarr': '/data/torrents/tv', lidarr: '/data/torrents/music' }, say)
      }
      const apiOf: Record<string, 'v1' | 'v3'> = { sonarr: 'v3', radarr: 'v3', lidarr: 'v1', prowlarr: 'v1' }
      const roots: Record<string, string> = { sonarr: '/data/media/tv', radarr: '/data/media/movies', lidarr: '/data/media/music' }
      const sabCat: Record<string, string> = { sonarr: 'tv', radarr: 'movies', lidarr: 'music' }
      const qbitCat: Record<string, string> = { sonarr: 'tv-sonarr', radarr: 'radarr', lidarr: 'lidarr' }
      for (const app of ['sonarr', 'radarr', 'lidarr'] as const) {
        if (!has(app)) continue
        const arr = new Arr(serviceUrl(app), keys[app]!, apiOf[app]!)
        await wireArr(
          {
            app,
            arr,
            rootFolder: roots[app]!,
            sab: has('sabnzbd') ? { host: 'sabnzbd', port: 8080, apiKey: keys.sabnzbd!, category: sabCat[app]! } : undefined,
            qbit: has('qbittorrent') && qbitCreds ? { host: 'qbittorrent', port: 8080, username: qbitCreds.username, password: qbitCreds.password, category: qbitCat[app]! } : undefined,
            jellyfin: { host: 'jellyfin', port: 8096, urlBase: '/jellyfin', apiKey: jf.apiKey },
          },
          say,
        )
        if (app !== 'lidarr') {
          try {
            await wireLanguages(arr, app, doc.server?.language || 'en', say)
          } catch (e) {
            // Downloads still work without it; say so rather than stop setup.
            this.status.warnings.push(`${app === 'sonarr' ? 'Sonarr' : 'Radarr'}: couldn’t set the language rule (${(e as Error).message}). Downloads may come in any language.`)
          }
        }
      }
      if (has('prowlarr')) {
        const { indexerErrors } = await wireProwlarr(
          new Arr(serviceUrl('prowlarr'), keys.prowlarr!, 'v1'),
          {
            selfUrl: serviceUrl('prowlarr'),
            apps: (['sonarr', 'radarr', 'lidarr'] as const).filter(has).map((app) => ({ app, url: serviceUrl(app), apiKey: keys[app]! })),
            indexers: doc.downloads?.indexers ?? [],
          },
          say,
        )
        for (const e of indexerErrors) this.status.warnings.push(`Indexer ${e.name}: ${e.error}`)
      }
    })

    let remoteUrl: string | undefined
    let rommCreds: { username: string; password: string } | null = null
    await this.run('games', async (s) => {
      rommCreds = await installGames(orch, ctx, this.settings, (m) => {
        s.detail = m
        this.say(m)
      })
      s.detail = `Put games in ${ctx.hostData}/media/games/roms/<system>`
    })

    await this.run('remote', async (s) => {
      if (has('tailscale')) {
        await orch.ensureService('tailscale', ctx, progress(s))
        s.detail = 'Joining your tailnet…'
        const r = await tailscaleUrl(orch)
        if (r.url) {
          remoteUrl = r.url
          this.say(`Tailscale: Finesse is at ${r.url}`)
        } else this.status.warnings.push(`Tailscale: ${r.problem}`)
      }
      if (has('cloudflared')) {
        await orch.ensureService('cloudflared', ctx, progress(s))
        s.detail = 'Connecting the tunnel…'
        const problem = await cloudflaredConnected(orch)
        if (problem) this.status.warnings.push(`Cloudflare Tunnel: ${problem}`)
        remoteUrl = doc.remoteAccess!.cloudflare!.publicUrl.replace(/\/+$/, '')
      }
    })

    await this.run('finish', async () => {
      jellyfinScan(`${serviceUrl('jellyfin')}${jf.basePath}`, jf.apiKey).catch(() => {})
      // Re-applied with less than before (downloads or Games left out): turn
      // those apps off. Their settings stay in their folders for next time.
      // Game streaming has its own switch (Settings → Server): a setup
      // document leaves it as it is.
      const streaming = Boolean(this.settings.get().stack?.services.includes('wolf'))
      for (const id of (await orch.managed()).keys()) {
        if (!(id in CATALOG) || services.includes(id as StackServiceId) || (id === 'wolf' && streaming)) continue
        await orch.removeService(id as StackServiceId)
        this.say(`Turned off ${CATALOG[id as StackServiceId].name} (not in this setup; its settings are kept)`)
      }
      const profiles = qualityProfiles(doc.quality?.preset)
      this.settings.update((x) => {
        x.mode = 'bundle'
        const svc = x.services
        for (const app of ['sonarr', 'radarr', 'lidarr', 'prowlarr', 'sabnzbd', 'qbittorrent', 'gluetun', 'romm'] as const) if (!has(app)) delete svc[app]
        if (!has('romm')) delete svc.steamgriddb
        for (const app of ['sonarr', 'radarr', 'lidarr', 'prowlarr'] as const) if (has(app)) svc[app] = { url: serviceUrl(app), apiKey: keys[app] }
        if (has('sabnzbd')) svc.sabnzbd = { url: serviceUrl('sabnzbd'), apiKey: keys.sabnzbd }
        if (has('qbittorrent') && qbitCreds) svc.qbittorrent = { url: serviceUrl('qbittorrent'), ...qbitCreds }
        if (has('gluetun')) svc.gluetun = { url: 'http://gluetun:8000', apiKey: gluetunKey }
        if (has('romm') && rommCreds) svc.romm = { url: serviceUrl('romm'), ...rommCreds }
        if (has('romm') && ctx.games?.steamGridDbKey) svc.steamgriddb = { apiKey: ctx.games.steamGridDbKey }
        x.stack = {
          hostRoot: ctx.hostRoot,
          hostData: ctx.hostData,
          timezone: ctx.timezone,
          puid: ctx.puid,
          pgid: ctx.pgid,
          services: streaming ? [...services, 'wolf'] : services,
          ...(x.stack?.streaming ? { streaming: x.stack.streaming } : {}),
          vpn: ctx.vpn,
          remote: doc.remoteAccess?.method && doc.remoteAccess.method !== 'none' ? { method: doc.remoteAccess.method, tailscale: ctx.tailscale, cloudflare: ctx.cloudflared } : undefined,
          exposeJellyfin: ctx.exposeJellyfin,
          jellyfinPort: ctx.jellyfinPort,
          quality: doc.quality?.preset ?? '1080p',
        }
        x.requests = { profiles }
        const publicUrl = doc.publicUrl?.replace(/\/+$/, '') || remoteUrl
        if (publicUrl) x.publicUrl = publicUrl
        if (doc.email) x.email = doc.email
        if (doc.emulators) x.emulators = doc.emulators
        x.setup.state = 'ready'
        x.setup.completedAt = new Date().toISOString()
        x.setup.lastDoc = structuredClone(doc)   // for "Change downloads or away-from-home access" later
        delete x.setup.lastError
      })
      // Emulators in the document: into Wolf now, if game streaming is on.
      const socket = this.settings.get().streaming?.socket
      if (doc.emulators && socket)
        await syncEmulators(socket, doc.emulators, { uid: ctx.puid, gid: ctx.pgid }).catch((e) => this.status.warnings.push(`Emulators: ${(e as Error).message}`))
    })
  }

  /** Settings → Server: turn Games on or off on a finished install (files are always kept). */
  gamesJob: { state: 'idle' | 'working' | 'done' | 'error'; detail?: string; error?: string } = { state: 'idle' }

  setGames(on: boolean, keys: { steamGridDbKey?: string; igdb?: { clientId: string; clientSecret: string } } = {}) {
    const s = this.settings.get()
    if (s.mode !== 'bundle' || !s.stack) throw new Error('Finesse isn’t managing a stack on this server')
    if (this.status.state === 'running' || this.gamesJob.state === 'working') throw new Error('Finesse is busy — try again in a minute')
    this.gamesJob = { state: 'working', detail: on ? 'Getting RomM…' : 'Removing Games…' }
    const say = (m: string) => {
      this.gamesJob.detail = m
      this.say(m)
    }
    void (async () => {
      if (!on) {
        // Settings first, so nothing sees RomM as a missing app to bring back.
        this.settings.update((x) => {
          delete x.services.romm
          x.stack!.services = x.stack!.services.filter((id) => id !== 'romm' && id !== 'romm-db')
        })
        for (const id of ['romm', 'romm-db'] as const) await this.orch.removeService(id)
        return
      }
      const prev = this.settings.get()
      const games = gamesConfig({ admin: { username: '', password: '' }, games: keys }, prev.games)
      this.settings.update((x) => void (x.games = games))
      const ctx = stackContext(this.settings.get(), await this.orch.hostDevices())!
      this.orch.ensureDirs(ctx, ['romm-db', 'romm'])
      for (const id of ['romm-db', 'romm'] as const) {
        say(`Downloading ${CATALOG[id].name}…`)
        await this.orch.ensureImage(CATALOG[id])
      }
      const creds = await installGames(this.orch, ctx, this.settings, say)
      this.settings.update((x) => {
        x.services.romm = { url: serviceUrl('romm'), ...creds }
        if (games.steamGridDbKey) x.services.steamgriddb = { apiKey: games.steamGridDbKey }
        x.stack!.services = [...new Set([...x.stack!.services, 'romm-db', 'romm'])]
      })
    })().then(
      () => (this.gamesJob = { state: 'done' }),
      (e) => {
        this.gamesJob = { state: 'error', error: (e as Error).message }
        log.error('games', e)
      },
    )
  }

  /** Settings → Server: turn game streaming (Wolf) on or off. Wolf's settings and pairings are kept. */
  streamingJob: { state: 'idle' | 'working' | 'done' | 'error'; detail?: string; error?: string } = { state: 'idle' }

  setStreaming(on: boolean) {
    const s = this.settings.get()
    if (s.mode !== 'bundle' || !s.stack) throw new Error('Finesse isn’t managing a stack on this server')
    if (this.status.state === 'running' || this.gamesJob.state === 'working' || this.streamingJob.state === 'working') throw new Error('Finesse is busy — try again in a minute')
    const folder = on ? wolfFolderProblem(wolfRunDir(s.stack)) : null
    if (folder) throw new Error(folder)
    this.streamingJob = { state: 'working', detail: on ? 'Checking this machine…' : 'Turning off game streaming…' }
    const say = (m: string) => {
      this.streamingJob.detail = m
      this.say(m)
    }
    void (async () => {
      if (!on) {
        // Settings first, so the health loop doesn't bring Wolf back.
        this.settings.update((x) => {
          x.stack!.services = x.stack!.services.filter((id) => id !== 'wolf')
          if (x.streaming) delete x.streaming.socket
        })
        await this.orch.removeService('wolf')
        return
      }
      const probe = await this.orch.streamingProbe()
      const nvidia = probe.devices.includes('/dev/nvidia0') && probe.nvidiaRuntime
      this.settings.update((x) => void (x.stack!.streaming = { nvidia }))
      const ctx = stackContext(this.settings.get(), probe.devices)!
      this.orch.ensureDirs(ctx, ['wolf'])
      say('Downloading Wolf…')
      await this.orch.ensureImage(CATALOG.wolf, (e) => {
        if (e.phase === 'pull' && e.fraction !== undefined) this.streamingJob.detail = `Downloading Wolf — ${Math.round(e.fraction * 100)}%`
      })
      say('Starting Wolf…')
      await this.orch.ensureService('wolf', ctx)
      // Wolf's API socket answers once it's up.
      const socket = wolfSocket(ctx)
      const until = Date.now() + 120000
      let last: unknown = null
      for (;;) {
        const r = await wolfCall(socket, 'GET', '/api/v1/apps').catch((e) => ((last = e), null))
        if (r?.status === 200) break
        const c = await this.orch.docker.inspect(containerName('wolf'))
        if (c && !c.State.Running && !c.State.Restarting) {
          const logs = await this.orch.docker.logs(containerName('wolf'), 30).catch(() => '')
          throw new Error(`Wolf stopped right after starting (exit ${c.State.ExitCode}).\n${logs.trim().split('\n').slice(-6).join('\n')}`)
        }
        if (Date.now() > until) throw new Error(`Wolf didn’t answer within two minutes: ${wolfProblem(last, socket)}`)
        await new Promise((r) => setTimeout(r, 1500))
      }
      this.settings.update((x) => {
        x.stack!.services = [...new Set([...x.stack!.services, 'wolf' as const])]
        x.streaming = { ...x.streaming, socket }
      })
      const emu = this.settings.get().emulators
      if (emu?.apps.length) {
        say('Adding the emulator apps…')
        await syncEmulators(socket, emu, { uid: ctx.puid, gid: ctx.pgid }).catch((e) => this.say(`Emulators: ${(e as Error).message}`))
      }
      say('Game streaming is on')
    })().then(
      () => (this.streamingJob = { state: 'done' }),
      (e) => {
        this.streamingJob = { state: 'error', error: (e as Error).message }
        log.error('streaming', e)
      },
    )
  }

  /** Stops and removes every managed container (keeps config + media). */
  async teardown() {
    const managed = await this.orch.managed()
    for (const id of managed.keys()) {
      if (id in CATALOG) await this.orch.removeService(id as StackServiceId)
      else await this.orch.docker.remove(containerName(id as StackServiceId), { force: true })
    }
  }
}
