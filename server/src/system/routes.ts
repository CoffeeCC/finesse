// /api/system — the System page's backend (administrators only): app health,
// VPN, disk, backups, restarting or pausing an app, reading its logs, and
// applying app updates. Also starts the self-maintenance loop.

import type { AppDeps, Plugin } from '../app.ts'
import { sendMail, type SmtpConfig } from '../email.ts'
import { ApiError, readJson, sendJson } from '../http/core.ts'
import { safeFile, sendFile } from '../http/static.ts'
import { VERSION } from '../jellyfin.ts'
import type { SetupRunner } from '../setup/apply.ts'
import { CATALOG, containerName, type StackServiceId } from '../stack/catalog.ts'
import { ClipMaker } from '../stack/clips.ts'
import { GamesNudger } from '../stack/games.ts'
import { LibraryNudger } from '../stack/libraries.ts'
import { Maintainer } from '../stack/maintain.ts'
import { imageFor, selfContainer, startSelfUpdate } from '../stack/selfupdate.ts'

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
    const maint = new Maintainer(settings, orch, settings.paths, () => runner.status.state === 'running' || runner.gamesJob.state === 'working')
    ref.maintainer = maint
    const clips = new ClipMaker(settings, orch.docker, settings.paths, () => runner.status.state !== 'running' && !maint.isWorking)
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
    if (deps.updater) {
      deps.updater.image = {
        plan: async (version) => {
          const me = await selfContainer(orch.docker)
          return me ? imageFor(me.Config.Image, version) : null
        },
        run: async (image, onStep) => {
          onStep('backing up')
          await maint.backupNow('before-update').catch(() => {})
          await startSelfUpdate(orch.docker, image, onStep)
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
        setup: { state: s.setup.state, completedAt: s.setup.completedAt ?? null, running: runner.status.state === 'running' },
        stack: s.stack ? { root: s.stack.hostRoot, data: s.stack.hostData, services: s.stack.services, quality: s.stack.quality, paused: s.stack.paused ?? [], jellyfinPort: s.stack.exposeJellyfin ? s.stack.jellyfinPort : null } : null,
        updates: { auto: s.updates.auto, lastStackUpdate: s.maintenance?.lastStackUpdate ?? null },
        busy: maint.isWorking,
        previews: { enabled: s.previews?.enabled !== false, ...clips.status },
        games: { enabled: Boolean(s.stack?.services.includes('romm')), folder: s.stack ? `${s.stack.hostData}/media/games/roms` : null, job: runner.gamesJob },
        health: maint.health,
      })
    })

    router.post('/api/system/services/:id/restart', async ({ req, res, params }) => {
      await auth.requireAdmin(req)
      needStack()
      const id = stackId(params.id!)
      await orch.docker.restart(containerName(id), 30)
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
      await orch.docker.stop(containerName(id), 30)
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
      await orch.docker.start(containerName(id))
      maint.event('info', `${CATALOG[id].name} started by an administrator`)
      sendJson(res, 200, { ok: true })
    })

    router.get('/api/system/services/:id/logs', async ({ req, res, params, url }) => {
      await auth.requireAdmin(req)
      needStack()
      const id = stackId(params.id!)
      const tail = Math.min(2000, Math.max(10, Number(url.searchParams.get('tail')) || 300))
      const text = await orch.docker.logs(containerName(id), tail)
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

    // Preview clips: switch on/off, or make the missing ones now.
    router.put('/api/system/previews', async ({ req, res }) => {
      await auth.requireAdmin(req)
      const body = await readJson<{ enabled?: boolean }>(req)
      if (typeof body.enabled !== 'boolean') throw new ApiError(400, 'enabled must be true or false')
      settings.update((x) => {
        x.previews = { enabled: body.enabled! }
      })
      sendJson(res, 200, { enabled: body.enabled })
    })

    router.post('/api/system/previews', async ({ req, res }) => {
      await auth.requireAdmin(req)
      needStack()
      void clips.run(30 * 60000).catch(() => {})
      sendJson(res, 202, { started: true, ...clips.status })
    })

    router.get('/api/system/backups', async ({ req, res }) => {
      await auth.requireAdmin(req)
      sendJson(res, 200, { last: settings.get().maintenance?.lastBackup ?? null, files: maint.listBackups(), folder: settings.paths.backups })
    })

    router.post('/api/system/backups', async ({ req, res }) => {
      await auth.requireAdmin(req)
      sendJson(res, 201, await maint.backupNow('manual'))
    })

    router.get('/api/system/backups/:name', async ({ req, res, params }) => {
      await auth.requireAdmin(req)
      if (!/^finesse-backup-[\dT-]+\.tar\.gz$/.test(params.name!)) throw new ApiError(404, 'No such backup')
      const hit = safeFile(settings.paths.backups, params.name!)
      if (!hit) throw new ApiError(404, 'No such backup')
      res.setHeader('Content-Disposition', `attachment; filename="${params.name}"`)
      sendFile(req, res, hit.file, hit.stat, params.name!)
    })
  }
}
