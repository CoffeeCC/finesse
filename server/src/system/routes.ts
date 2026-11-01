// /api/system — the System page's backend (administrators only): app health,
// VPN, disk, backups, restarting or pausing an app, reading its logs, and
// applying app updates. Also starts the self-maintenance loop.

import { wolfRunDir } from '../stack/catalog.ts'
import { streamingCheck } from '../stack/wolf.ts'
import type { AppDeps, Plugin } from '../app.ts'
import { sendMail, type SmtpConfig } from '../email.ts'
import { ApiError, readJson, sendJson } from '../http/core.ts'
import { safeFile, sendFile } from '../http/static.ts'
import { VERSION } from '../jellyfin.ts'
import type { SetupRunner } from '../setup/apply.ts'
import { CATALOG, type StackServiceId } from '../stack/catalog.ts'
import { dockerOf, Orchestrator } from '../stack/orchestrator.ts'
import { ClipMaker, clipsWait } from '../stack/clips.ts'
import { GamesNudger } from '../stack/games.ts'
import { LibraryNudger } from '../stack/libraries.ts'
import { BACKUP_FILE, describeParts, isPart } from '../stack/backup.ts'
import { Maintainer } from '../stack/maintain.ts'
import { builtOf } from '../stack/graphicsManager.ts'
import { planKey } from '../stack/graphics.ts'
import { randomBytes } from 'node:crypto'
import { imageFor, selfContainer, startSelfUpdate } from '../stack/selfupdate.ts'
import { windowsUpdater } from '../stack/winupdate.ts'

export interface StackRef {
  runner?: SetupRunner
  maintainer?: Maintainer
}

const stackId = (id: string): StackServiceId => {
  if (!(id in CATALOG)) throw new ApiError(404, `Unknown app "${id}"`)
  return id as StackServiceId
}

export function systemPlugin(ref: StackRef): Plugin {
  return (deps: AppDeps) => {
    const { router, settings, auth } = deps
    const runner = ref.runner
    if (!runner) throw new Error('systemPlugin needs setupPlugin first')
    const orch = runner.orch
    // Hands off while setup or the Games switch is changing which apps exist.
    const maint = new Maintainer(settings, orch, settings.paths, () => runner.status.state === 'running' || runner.gamesJob.state === 'working' || runner.streamingJob.state === 'working')
    ref.maintainer = maint
    // Docker: someone's own Jellyfin in a container can make clips too (clips.ts).
    const docker = orch instanceof Orchestrator ? orch.docker : null
    const clips = new ClipMaker(settings, orch, settings.paths, () => runner.status.state !== 'running' && !maint.isWorking, {
      docker,
      self: async () => (docker ? (await selfContainer(docker))?.Id : undefined),
      // No graphics card: clips only at night (graphics.ts clipsNightOnly).
      waitFor: () => clipsWait(settings.get()),
    })
    // Helpers this Finesse left running when it stopped (a probe, a card test, a clip): its own only.
    if (docker) void docker.sweepHelpers().catch(() => 0)
    if (process.env.FINESSE_MAINTENANCE !== 'off') {
      maint.start()
      clips.start()
      const games = new GamesNudger(settings)
      const libraries = new LibraryNudger(settings)
      setInterval(() => {
        void games.tick()
        void libraries.tick()
      }, 60000).unref()
    }

    // Whole-app updates: whenever Finesse runs from a registry image in Docker
    // (bundle or adopt); otherwise the web-only updater stays in charge.
    // Windows: a new Windows build next to this one, and the Finesse service restarts on it.
    if (deps.updater && orch.kind === 'native' && process.env.FINESSE_INSTALL_DIR) {
      deps.updater.image = windowsUpdater(deps.releases, process.env.FINESSE_INSTALL_DIR, () => maint.backupNow('before-update').then(() => {}))
    }
    if (deps.updater && orch instanceof Orchestrator) {
      const docker = orch.docker
      deps.updater.image = {
        plan: async (version) => {
          const me = await selfContainer(docker)
          return me ? imageFor(me.Config.Image, version) : null
        },
        run: async (image, onStep) => {
          onStep('backing up')
          await maint.backupNow('before-update').catch(() => {})
          await startSelfUpdate(docker, image, onStep)
        },
      }
    }

    const needStack = () => {
      const s = settings.get()
      if (s.mode !== 'bundle' || !s.stack) throw new ApiError(409, 'Finesse isn’t managing a stack on this server')
      return s
    }

    router.get('/api/system/status', async ({ req, res, url }) => {
      await auth.requireAdmin(req)
      const s = settings.get()
      const stale = !maint.health.checkedAt || Date.now() - Date.parse(maint.health.checkedAt) > 90000
      if (url.searchParams.has('refresh') || stale) await maint.tick()
      sendJson(res, 200, {
        version: VERSION,
        web: deps.web.current().version,
        mode: s.mode,
        host: orch.kind,
        setup: { state: s.setup.state, completedAt: s.setup.completedAt ?? null, running: runner.status.state === 'running' },
        stack: s.stack ? { root: s.stack.hostRoot, data: s.stack.hostData, services: s.stack.services, quality: s.stack.quality, paused: s.stack.paused ?? [], jellyfinPort: s.stack.exposeJellyfin ? s.stack.jellyfinPort : null } : null,
        updates: { auto: s.updates.auto, lastStackUpdate: s.maintenance?.lastStackUpdate ?? null },
        busy: maint.isWorking,
        previews: { ...clips.status, enabled: s.previews?.enabled !== false },
        // Docker only for now: Windows installs show neither switch.
        ...(orch.kind === 'docker'
          ? {
              games: { enabled: Boolean(s.stack?.services.includes('romm')), folder: s.stack ? `${s.stack.hostData}/media/games/roms` : null, job: runner.gamesJob },
              streaming: { enabled: Boolean(s.stack?.services.includes('wolf')), job: runner.streamingJob },
            }
          : {}),
        backup: { job: maint.backupJob },
        health: maint.health,
      })
    })

    router.post('/api/system/services/:id/restart', async ({ req, res, params }) => {
      await auth.requireAdmin(req)
      needStack()
      const id = stackId(params.id!)
      await orch.restart(id, 30)
      maint.event('info', `${CATALOG[id].name} restarted by an administrator`)
      if (id === 'gluetun') void maint.tick()
      sendJson(res, 200, { ok: true })
    })

    router.post('/api/system/services/:id/stop', async ({ req, res, params }) => {
      await auth.requireAdmin(req)
      needStack()
      const id = stackId(params.id!)
      if (id === 'jellyfin') throw new ApiError(400, 'Jellyfin can’t be paused — Finesse needs it')
      settings.update((x) => {
        x.stack!.paused = [...new Set([...(x.stack!.paused ?? []), id])]
      })
      await orch.stop(id, 30)
      maint.event('info', `${CATALOG[id].name} paused by an administrator`)
      sendJson(res, 200, { ok: true })
    })

    router.post('/api/system/services/:id/start', async ({ req, res, params }) => {
      await auth.requireAdmin(req)
      needStack()
      const id = stackId(params.id!)
      settings.update((x) => {
        x.stack!.paused = (x.stack!.paused ?? []).filter((p) => p !== id)
      })
      await orch.start(id)
      maint.event('info', `${CATALOG[id].name} started by an administrator`)
      sendJson(res, 200, { ok: true })
    })

    router.get('/api/system/services/:id/logs', async ({ req, res, params, url }) => {
      await auth.requireAdmin(req)
      needStack()
      const id = stackId(params.id!)
      const tail = Math.min(2000, Math.max(10, Number(url.searchParams.get('tail')) || 300))
      const text = await orch.logs(id, tail)
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(text)
    })

    router.post('/api/system/update-apps', async ({ req, res }) => {
      await auth.requireAdmin(req)
      needStack()
      const body = await readJson<{ services?: string[] }>(req).catch(() => ({}) as { services?: string[] })
      const ids = body.services?.map(stackId)
      await maint.backupNow('before-update').catch(() => {})
      const done = await maint.updateStack(ids).catch((e) => {
        throw new ApiError(409, (e as Error).message)
      })
      sendJson(res, 200, { updated: done })
    })

    router.put('/api/system/updates', async ({ req, res }) => {
      await auth.requireAdmin(req)
      const body = await readJson<{ auto?: boolean }>(req)
      if (typeof body.auto !== 'boolean') throw new ApiError(400, 'auto must be true or false')
      settings.update((x) => {
        x.updates.auto = body.auto!
      })
      sendJson(res, 200, { auto: body.auto })
    })

    // ---------- email (invites) + public address ----------

    router.get('/api/system/email', async ({ req, res }) => {
      await auth.requireAdmin(req)
      const e = settings.get().email
      sendJson(res, 200, { email: e ? { ...e, password: undefined, hasPassword: Boolean(e.password) } : null, publicUrl: settings.get().publicUrl ?? null })
    })

    router.put('/api/system/email', async ({ req, res }) => {
      await auth.requireAdmin(req)
      const body = await readJson<{ email?: (Partial<SmtpConfig> & { keepPassword?: boolean }) | null; publicUrl?: string | null }>(req)
      if (body.publicUrl !== undefined) {
        const u = body.publicUrl?.trim().replace(/\/+$/, '') || null
        if (u && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(u)) throw new ApiError(400, 'Enter a full address, e.g. https://media.example.com')
        settings.update((x) => {
          if (u) x.publicUrl = u
          else delete x.publicUrl
        })
      }
      if (body.email === null) settings.update((x) => void delete x.email)
      else if (body.email) {
        const e = body.email
        const port = Number(e.port)
        if (!e.host?.trim()) throw new ApiError(400, 'SMTP host is required')
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ApiError(400, 'SMTP port is required (587 or 465)')
        if (!e.from?.includes('@')) throw new ApiError(400, 'From address is required')
        settings.update((x) => {
          const password = e.keepPassword ? x.email?.password : e.password || undefined
          x.email = { host: e.host!.trim(), port, secure: e.secure ?? port === 465, username: e.username?.trim() || undefined, password, from: e.from!.trim() }
        })
      }
      const e = settings.get().email
      sendJson(res, 200, { email: e ? { ...e, password: undefined, hasPassword: Boolean(e.password) } : null, publicUrl: settings.get().publicUrl ?? null })
    })

    router.post('/api/system/email/test', async ({ req, res }) => {
      const me = await auth.requireAdmin(req)
      const e = settings.get().email
      if (!e) throw new ApiError(409, 'Save your email settings first')
      const { to } = await readJson<{ to?: string }>(req)
      if (!to || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new ApiError(400, 'Enter a valid email address')
      try {
        await sendMail(e, { to, subject: 'Finesse can send email 🎉', text: `Hi ${me.Name ?? ''}! Invites from Finesse will arrive like this one.` })
      } catch (err) {
        throw new ApiError(502, (err as Error).message)
      }
      sendJson(res, 200, { ok: true })
    })

    // Games (RomM): add or remove on a finished install. Files are always kept.
    router.put('/api/system/games', async ({ req, res }) => {
      await auth.requireAdmin(req)
      needStack()
      const body = await readJson<{ enabled?: boolean; steamGridDbKey?: string }>(req)
      if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'enabled must be true or false')
      const key = body.steamGridDbKey?.trim()
      if (key && !/^[A-Za-z0-9]{16,64}$/.test(key)) throw new ApiError(400, 'That SteamGridDB key doesn’t look right — copy it from steamgriddb.com → Preferences → API')
      try {
        runner.setGames(body.enabled, key ? { steamGridDbKey: key } : {})
      } catch (e) {
        throw new ApiError(409, (e as Error).message)
      }
      maint.event('info', body.enabled ? 'Games is being added by an administrator' : 'Games was removed by an administrator (files kept)')
      sendJson(res, 202, { job: runner.gamesJob })
    })

    // Game streaming (Wolf): what this machine has, and turning it on or off.
    router.get('/api/system/streaming/check', async ({ req, res }) => {
      await auth.requireAdmin(req)
      needStack()
      sendJson(res, 200, streamingCheck(await dockerOf(orch, 'Game streaming').streamingProbe(), { runDir: wolfRunDir(settings.get().stack!) }))
    })

    router.put('/api/system/streaming', async ({ req, res }) => {
      await auth.requireAdmin(req)
      needStack()
      const body = await readJson<{ enabled?: boolean }>(req)
      if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'enabled must be true or false')
      try {
        runner.setStreaming(body.enabled)
      } catch (e) {
        throw new ApiError(409, (e as Error).message)
      }
      maint.event('info', body.enabled ? 'Game streaming is being turned on by an administrator' : 'Game streaming was turned off by an administrator (Wolf’s settings kept)')
      sendJson(res, 202, { job: runner.streamingJob })
    })

    // Preview clips: switch on/off, or make the missing ones now.
    router.put('/api/system/previews', async ({ req, res }) => {
      await auth.requireAdmin(req)
      const body = await readJson<{ enabled?: boolean }>(req)
      if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'enabled must be true or false')
      settings.update((x) => {
        x.previews = { enabled: body.enabled! }
      })
      if (body.enabled) void clips.run().catch(() => {})
      else clips.status = { ...clips.status, enabled: false, state: 'off', reason: null }
      sendJson(res, 200, { enabled: body.enabled })
    })

    // Bundle and adopt alike: someone's own Jellyfin in Docker makes clips too.
    router.get('/api/system/previews', async ({ req, res }) => {
      await auth.requireAdmin(req)
      sendJson(res, 200, { ...clips.status, enabled: settings.get().previews?.enabled !== false })
    })

    router.post('/api/system/previews', async ({ req, res }) => {
      await auth.requireAdmin(req)
      void clips.run(30 * 60000).catch(() => {})
      sendJson(res, 202, { started: true, ...clips.status })
    })

    // ---------- graphics (stack/graphics.ts, graphicsManager.ts) ----------

    // Someone's own Jellyfin: a Connected-apps row when it converts on the CPU beside a card, or on a broken one.
    deps.connectionChecks = [...(deps.connectionChecks ?? []), async (refresh) => (settings.get().mode === 'adopt' ? (await maint.graphics.adoptCheck(refresh)).check : null)]

    router.get('/api/system/graphics', async ({ req, res, url }) => {
      await auth.requireAdmin(req)
      const s = settings.get()
      const refresh = url.searchParams.has('refresh')
      if (s.mode === 'bundle' && s.stack) {
        const stored = s.stack.graphics
        // A look that didn't finish says nothing about the cards: what was last found stands.
        const looked = refresh || !stored?.inventory ? await maint.graphics.inventory(refresh).catch(() => null) : null
        const fresh = looked && looked.complete !== false ? maint.graphics.settle(looked) : null
        const inventory = fresh ?? stored?.inventory ?? null
        const plan = fresh ? maint.graphics.plan(fresh) : (stored?.plan ?? null)
        const built = builtOf(stored)
        sendJson(res, 200, {
          mode: 'bundle',
          inventory,
          plan,
          // The plan the apps run with now, and whether a new one is waiting for tonight (or a click).
          applied: stored && built.jellyfin && built.wolf ? { at: stored.at, key: planKey(built), plan: { ...stored.plan, jellyfin: built.jellyfin, wolf: built.wolf } } : null,
          pending: Boolean(plan && planKey(plan) !== planKey(built)) || Boolean(stored?.pending),
          waiting: stored?.pending?.why ?? null,
          unknown: Boolean(looked && looked.complete === false),
          override: s.graphicsOverride ?? {},
          note: stored?.note ?? null,
          offer: Boolean(stored?.offer),
          streaming: s.stack.services.includes('wolf'),
          working: maint.graphics.isWorking,
        })
        return
      }
      const a = await maint.graphics.adoptCheck(refresh)
      sendJson(res, 200, { mode: 'adopt', inventory: a.inventory, check: a.check, jellyfin: a.jellyfin ? { name: a.jellyfin.name, encoding: a.jellyfin.encoding ?? null } : null, reason: a.reason ?? null })
    })

    // An administrator's choice of card (servers Finesse set up). Applied right away: Jellyfin and Wolf restart if their card changes.
    router.put('/api/system/graphics', async ({ req, res }) => {
      await auth.requireAdmin(req)
      needStack()
      const body = await readJson<{ jellyfin?: string | null; wolf?: string | null; apply?: boolean }>(req)
      const inv = await maint.graphics.inventory().catch(() => null)
      const known = new Set([...(inv?.complete !== false ? (inv?.gpus ?? []) : []), ...(settings.get().stack?.graphics?.inventory?.gpus ?? [])].map((g) => g.id))
      for (const [who, v] of [['jellyfin', body.jellyfin], ['wolf', body.wolf]] as const) {
        if (v === undefined || v === null || v === 'auto') continue
        if (!(known.has(v) || (who === 'jellyfin' && v === 'cpu'))) throw new ApiError(400, 'That card isn’t on this server. Check again, then pick one from the list.')
      }
      settings.update((x) => {
        const o = { ...x.graphicsOverride }
        for (const who of ['jellyfin', 'wolf'] as const) {
          const v = body[who]
          if (v === undefined) continue
          if (v === null || v === 'auto') delete o[who]
          else o[who] = v
        }
        if (Object.keys(o).length) x.graphicsOverride = o
        else delete x.graphicsOverride
      })
      void maint.graphics.apply('chosen by an administrator').catch((e) => maint.event('error', `Setting the graphics cards failed: ${(e as Error).message}`))
      sendJson(res, 202, { override: settings.get().graphicsOverride ?? {} })
    })

    // Servers Finesse set up: Finesse's video settings in Jellyfin, over the ones Jellyfin had (an administrator's click).
    router.post('/api/system/graphics/encoding', async ({ req, res }) => {
      await auth.requireAdmin(req)
      needStack()
      try {
        await maint.graphics.useOurEncoding()
      } catch (e) {
        throw new ApiError(409, (e as Error).message)
      }
      sendJson(res, 200, { ok: true })
    })

    // Someone's own Jellyfin: set its encoding settings for a card its container can already use.
    router.post('/api/system/graphics/jellyfin', async ({ req, res }) => {
      await auth.requireAdmin(req)
      if (settings.get().mode !== 'adopt') throw new ApiError(409, 'Finesse sets Jellyfin’s card itself on this server')
      const { gpu } = await readJson<{ gpu?: string }>(req)
      if (!gpu) throw new ApiError(400, 'Pick a card')
      try {
        sendJson(res, 200, { card: await maint.graphics.adoptFix(gpu) })
      } catch (e) {
        throw new ApiError(409, (e as Error).message)
      }
    })

    router.get('/api/system/backups', async ({ req, res }) => {
      await auth.requireAdmin(req)
      sendJson(res, 200, { last: settings.get().maintenance?.lastBackup ?? null, files: maint.listBackups(), folder: settings.paths.backups })
    })

    // What a backup can hold, with sizes (Settings → Server → Back up now).
    router.get('/api/system/backups/parts', async ({ req, res }) => {
      await auth.requireAdmin(req)
      sendJson(res, 200, { parts: describeParts(settings.get(), settings.paths) })
    })

    // No body: back up the usual parts and answer when done (the CLI). With
    // { parts }: run in the background; follow it at /api/system/status.
    router.post('/api/system/backups', async ({ req, res }) => {
      await auth.requireAdmin(req)
      const body = ((await readJson(req).catch(() => null)) ?? {}) as { parts?: unknown }
      if (body.parts === undefined) return sendJson(res, 201, await maint.backupNow('manual'))
      if (!Array.isArray(body.parts) || !body.parts.every(isPart)) throw new ApiError(400, 'Unknown backup part')
      const available = new Set(describeParts(settings.get(), settings.paths).filter((p) => p.available).map((p) => p.id))
      const missing = body.parts.filter((p) => !available.has(p))
      if (missing.length) throw new ApiError(400, `Can’t back up ${missing.join(', ')} on this server`)
      try {
        sendJson(res, 202, { job: maint.startBackup(body.parts) })
      } catch (e) {
        throw new ApiError(409, (e as Error).message)
      }
    })

    // Big backups download through a one-time link (no sign-in token in the URL):
    // the app asks for a ticket, then lets the browser fetch the file directly.
    const tickets = new Map<string, { name: string; until: number }>()
    router.post('/api/system/backups/:name/link', async ({ req, res, params }) => {
      await auth.requireAdmin(req)
      if (!BACKUP_FILE.test(params.name!) || !safeFile(settings.paths.backups, params.name!)) throw new ApiError(404, 'No such backup')
      for (const [k, t] of tickets) if (t.until < Date.now()) tickets.delete(k)
      const ticket = randomBytes(24).toString('base64url')
      tickets.set(ticket, { name: params.name!, until: Date.now() + 60000 })
      sendJson(res, 200, { url: `/api/system/backups/${encodeURIComponent(params.name!)}?ticket=${ticket}` })
    })

    router.get('/api/system/backups/:name', async ({ req, res, params, url }) => {
      const ticket = url.searchParams.get('ticket')
      const t = ticket ? tickets.get(ticket) : undefined
      if (t) tickets.delete(ticket!)
      if (!t || t.until < Date.now() || t.name !== params.name) await auth.requireAdmin(req)
      if (!BACKUP_FILE.test(params.name!)) throw new ApiError(404, 'No such backup')
      const hit = safeFile(settings.paths.backups, params.name!)
      if (!hit) throw new ApiError(404, 'No such backup')
      res.setHeader('Content-Disposition', `attachment; filename="${params.name}"`)
      sendFile(req, res, hit.file, hit.stat, params.name!)
    })
  }
}
