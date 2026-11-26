// Retro Games API routes (/api/retro/*): catalog, live Prowlarr console search,
// direct ROM downloads, admin source management, NAS import preview/run, and RomM scan.

import type { Auth } from '../auth.ts'
import type { SettingsStore } from '../config.ts'
import { ApiError, readJson, sendJson, type Router } from '../http/core.ts'
import {
  cleanRetroSourceConfig,
  liveSearchRetro,
  previewRomImport,
  RetroEngine,
  romsRoot,
  runRomImport,
  triggerRommScan,
} from './retroStore.ts'

export interface RetroDeps {
  settings: SettingsStore
  auth: Auth
  engine?: RetroEngine
  fetch?: typeof fetch
}

export function registerRetro(router: Router, deps: RetroDeps): RetroEngine {
  const { settings, auth } = deps
  const engine = deps.engine ?? new RetroEngine({ fetch: deps.fetch })

  // 1. Browse curated showcase + synced sources + opt-in homebrew catalog
  router.get('/api/retro/catalog', async ({ req, res, url }) => {
    await auth.requirePerson(req)
    const q = url.searchParams.get('q') ?? ''
    const consoleFilter = url.searchParams.get('console') ?? ''
    sendJson(res, 200, engine.catalog(settings.get(), { q, console: consoleFilter }))
  })

  // 2. Live search via Prowlarr (category 1000 Console)
  router.get('/api/retro/live-search', async ({ req, res, url }) => {
    await auth.requirePerson(req)
    const q = url.searchParams.get('q') ?? ''
    const consoleFilter = url.searchParams.get('console') ?? undefined
    const result = await liveSearchRetro(q, {
      console: consoleFilter || undefined,
      prowlarr: settings.get().services.prowlarr,
      fetch: deps.fetch,
    })
    sendJson(res, 200, result)
  })

  // 3. Direct HTTPS / LAN ROM download into RomM library
  router.post('/api/retro/download', async ({ req, res }) => {
    const person = await auth.requirePerson(req)
    const s = settings.get()
    const limit = s.parental?.[person.id]
    if (!person.admin && limit && !limit.requests) {
      throw new ApiError(403, 'Downloads are off for this profile. Ask whoever runs the server.')
    }
    const body = await readJson<{ title?: unknown; console?: unknown; fileName?: unknown; url?: unknown }>(req)
    const job = engine.startDownload(s, body)
    sendJson(res, 201, job)
  })

  // 4. Active + recent 25 downloads
  router.get('/api/retro/downloads', async ({ req, res }) => {
    await auth.requirePerson(req)
    sendJson(res, 200, { downloads: engine.downloads() })
  })

  // 5. List configured ROM sources + status (admin)
  router.get('/api/retro/sources', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const s = settings.get()
    const sources = (s.retro?.sources ?? []).map((src) => ({
      ...src,
      status: engine.statusOf(src.id),
    }))
    sendJson(res, 200, {
      homebrew: s.retro?.homebrew === true,
      romsDir: romsRoot(s),
      sources,
    })
  })

  // 6. Add a ROM source and sync immediately (admin)
  router.post('/api/retro/sources', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const existing = settings.get().retro?.sources ?? []
    if (existing.length >= 30) {
      throw new ApiError(400, 'Maximum of 30 retro sources reached. Remove one first.')
    }
    const cfg = cleanRetroSourceConfig(await readJson(req), existing.map((s) => s.id))
    settings.update((x) => {
      x.retro = { ...(x.retro ?? {}), sources: [...(x.retro?.sources ?? []), cfg] }
    })
    const status = await engine.syncSource(cfg)
    sendJson(res, 201, { source: cfg, status })
  })

  // 7. Remove a ROM source (admin)
  router.delete('/api/retro/sources/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    const id = params.id ?? ''
    const existing = settings.get().retro?.sources ?? []
    if (!existing.some((s) => s.id === id)) {
      throw new ApiError(404, 'Source not found.')
    }
    settings.update((x) => {
      x.retro = { ...(x.retro ?? {}), sources: (x.retro?.sources ?? []).filter((s) => s.id !== id) }
    })
    engine.removeSource(id)
    sendJson(res, 200, { ok: true })
  })

  // 8. Re-index all configured sources (admin)
  router.post('/api/retro/sources/sync', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const sources = settings.get().retro?.sources ?? []
    const statuses = await engine.syncAll(sources)
    sendJson(res, 200, { statuses })
  })

  // 9. Toggle opt-in homebrew starter shelf (admin)
  router.put('/api/retro/settings', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ homebrew?: unknown }>(req)
    if (body.homebrew !== undefined && typeof body.homebrew !== 'boolean') {
      throw new ApiError(400, 'homebrew must be true or false.')
    }
    const next = body.homebrew ?? (settings.get().retro?.homebrew === true)
    settings.update((x) => {
      x.retro = { ...(x.retro ?? {}), homebrew: next }
    })
    sendJson(res, 200, { homebrew: next })
  })

  // 10. Preview NAS / local folder ROM import (admin)
  router.post('/api/retro/import/preview', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ folder?: unknown }>(req)
    if (typeof body.folder !== 'string') throw new ApiError(400, 'Specify a folder path.')
    sendJson(res, 200, previewRomImport(body.folder))
  })

  // 11. Run NAS / local folder ROM import (admin)
  router.post('/api/retro/import/run', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ folder?: unknown }>(req)
    if (typeof body.folder !== 'string') throw new ApiError(400, 'Specify a folder path.')
    const result = await runRomImport(body.folder, settings.get(), { fetch: deps.fetch })
    sendJson(res, 200, result)
  })

  // 12. Trigger RomM scan on demand (admin)
  router.post('/api/retro/scan', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const result = await triggerRommScan(settings.get(), { fetch: deps.fetch })
    sendJson(res, 200, result)
  })

  return engine
}
