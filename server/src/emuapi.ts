// Settings → Server → Game streaming → Consoles (and setup's games step): which
// consoles play here, with the emulators Finesse downloads (emucatalog.ts),
// and, for each, plainly what's still missing and the folder to drop it in.
//
// Adding a console makes its emulator app (the same one Moonlight and browser
// play use), fills in the folders on a server Finesse set up, and downloads its
// emulator in the background. A download that fails says why and never stops
// anything else. A program in your own emulators folder always wins.

import { chmodSync, chownSync, mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { Auth } from './auth.ts'
import type { Settings, SettingsStore } from './config.ts'
import { EMULATOR_PINS, INSTALL_IDS, pinFor, type InstallId } from './emucatalog.ts'
import { EmulatorDownloads, type DownloadStatus } from './emudownload.ts'
import { emulatorCatalog, folderFor, readiness, type EmulatorId, type EmulatorSettings } from './emulators.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { logger } from './log.ts'
import type { Docker } from './stack/docker.ts'

const log = logger('emulators')

export interface ConsoleNeed {
  label: string
  required: boolean
  ok: boolean
  /** What it is and what to do, in plain words. */
  detail: string
  /** Where to put it (a folder on the server), when it's a file you add. */
  folder: string | null
}

export interface ConsoleView {
  id: InstallId
  name: string
  consoles: string
  version: string
  size: number
  official: boolean
  source: string
  license: string
  added: boolean
  download: DownloadStatus
  /** Your own copy in your emulators folder (Finesse doesn't download it then). */
  own: boolean
  ready: boolean
  needs: ConsoleNeed[]
}

const appOf = (id: InstallId): EmulatorId => pinFor(id).app

/** The folders a server Finesse set up uses for games: RomM's library, and firmware, keys and saves beside it. */
export function defaultFolders(s: Settings): EmulatorSettings['paths'] | null {
  const data = s.mode === 'bundle' ? s.stack?.hostData : undefined
  if (!data) return null
  return { roms: `${data}/media/games`, firmware: `${data}/games/firmware`, keys: `${data}/games/keys`, saves: `${data}/games/saves` }
}

/** Settings with these consoles added (and removed): their apps, Finesse's downloads, and default folders where Finesse knows them. */
export function withConsoles(s: Settings, add: InstallId[], remove: InstallId[], managedDir: string): EmulatorSettings {
  const cur: EmulatorSettings = s.emulators ? JSON.parse(JSON.stringify(s.emulators)) : { apps: [], paths: {} }
  const paths = { ...(defaultFolders(s) ?? {}), ...cur.paths }
  const install = new Set(cur.install ?? [])
  const apps = new Set(cur.apps)
  for (const id of add) {
    install.add(id)
    apps.add(appOf(id))
  }
  for (const id of remove) {
    install.delete(id)
    // Your own copy keeps the console; without one the app goes too.
    if (!cur.paths.emulators) apps.delete(appOf(id))
  }
  const next: EmulatorSettings = { ...cur, apps: [...apps], paths, install: INSTALL_IDS.filter((id) => install.has(id)), managedDir }
  if (add.includes('eden')) next.switchEmulator = 'eden'
  if (!next.install!.length) delete next.install
  return next
}

/** Makes the firmware and keys folders each emulator reads (so there's a place to drop files), when Finesse can see them. */
export function makeFolders(e: EmulatorSettings, owner: { uid: number; gid: number }) {
  const cat = emulatorCatalog(e.switchEmulator)
  const own = (dir: string) => {
    try {
      mkdirSync(dir, { recursive: true })
      try {
        chownSync(dir, owner.uid, owner.gid)
      } catch {
        chmodSync(dir, 0o777)
      }
    } catch {
      /* Finesse can't see it; the status says so */
    }
  }
  if (e.paths.saves) own(e.paths.saves)
  for (const id of e.apps)
    for (const what of ['firmware', 'keys'] as const) {
      if (!cat[id].needs.some((n) => n.what === what)) continue
      const dir = folderFor(e, id, what)
      if (!dir) continue
      try {
        mkdirSync(dir, { recursive: true })
        try {
          chownSync(dir, owner.uid, owner.gid)
        } catch {
          chmodSync(dir, 0o777)
        }
      } catch {
        /* Finesse can't see it; the status says so */
      }
    }
}

/** A folder inside Finesse's container as Docker sees it (Finesse's own mounts), or itself outside Docker. */
export async function hostPathOf(docker: Docker | null, local: string): Promise<string> {
  const me = docker ? await docker.inspect(hostname()).catch(() => null) : null
  let best: { Source: string; Destination: string } | null = null
  for (const m of me?.Mounts ?? []) {
    const d = m.Destination.replace(/\/+$/, '')
    if ((local === d || local.startsWith(`${d}/`)) && (!best || d.length > best.Destination.length)) best = { Source: m.Source, Destination: d }
  }
  return best ? `${best.Source}${local.slice(best.Destination.length)}` : local
}

export function consoleViews(s: Settings, downloads: EmulatorDownloads): ConsoleView[] {
  const e = s.emulators
  const ready = e ? readiness(e, downloads.dir) : []
  return EMULATOR_PINS.map((p) => {
    const added = Boolean(e?.install?.includes(p.id)) || Boolean(e?.apps.includes(p.app) && (p.id !== 'eden' || e.switchEmulator !== 'ryujinx'))
    const r = ready.find((x) => x.id === p.app)
    const prog = r?.items.find((i) => i.label === p.name)
    const own = Boolean(prog && prog.state === 'ok' && !/Finesse/.test(prog.detail))
    const needs: ConsoleNeed[] = (r?.items ?? [])
      .filter((i) => i !== prog && i.label !== 'Games')
      .map((i) => {
        const need = emulatorCatalog(e?.switchEmulator)[p.app].needs.find((n) => n.label === i.label)
        return { label: i.label, required: i.required, ok: i.state === 'ok', detail: i.detail, folder: need && e ? (folderFor(e, p.app, need.what) ?? null) : null }
      })
    const download = downloads.status(p.id)
    const programOk = own || download.state === 'ready' || (prog?.state === 'ok')
    return {
      id: p.id,
      name: p.name,
      consoles: p.consoles,
      version: p.version,
      size: p.size,
      official: p.official,
      source: p.source,
      license: p.license,
      added,
      download,
      own,
      ready: added && programOk && needs.every((n) => n.ok || !n.required),
      needs,
    }
  })
}

export function registerConsoles(router: Router, deps: { settings: SettingsStore; auth: Auth; docker: Docker | null; downloads: EmulatorDownloads; sync?: (e: EmulatorSettings) => Promise<unknown> }) {
  const { settings, auth, downloads } = deps
  const owner = () => ({ uid: settings.get().stack?.puid ?? 1000, gid: settings.get().stack?.pgid ?? 1000 })

  // What's left half-done from before a restart: Finesse picks it up (still only what someone asked for).
  const wanted = settings.get().emulators?.install ?? []
  if (wanted.some((id) => downloads.status(id).state === 'missing')) void downloads.ensure(wanted.filter((id) => downloads.status(id).state === 'missing'))

  router.get('/api/emulators/consoles', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const s = settings.get()
    sendJson(res, 200, { consoles: consoleViews(s, downloads), folders: s.emulators?.paths ?? defaultFolders(s) ?? {} })
  })

  router.post('/api/emulators/consoles', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ add?: unknown; remove?: unknown; update?: unknown }>(req)
    const list = (x: unknown): InstallId[] => (Array.isArray(x) ? x.filter((v): v is InstallId => INSTALL_IDS.includes(v as InstallId)) : [])
    const add = list(body.add)
    const remove = list(body.remove)
    const update = list(body.update)
    if (!add.length && !remove.length && !update.length) throw new ApiError(400, 'Which console?')
    for (const id of remove) {
      try {
        downloads.remove(id)
      } catch (e) {
        throw new ApiError(409, (e as Error).message)
      }
    }
    const next = await applyConsoles(settings, deps.docker, downloads, add, remove, owner())
    if (deps.sync) await deps.sync(next).catch((e) => log.warn(`emulators: ${(e as Error).message}`))
    // Updates are only ever on request: a newer pin's file, fetched now.
    void downloads.ensure([...add, ...update])
    log.info(`consoles: ${add.length ? `added ${add.join(', ')}` : ''}${remove.length ? ` removed ${remove.join(', ')}` : ''}${update.length ? ` updating ${update.join(', ')}` : ''}`)
    sendJson(res, 200, { consoles: consoleViews(settings.get(), downloads) })
  })
}

/** Saves the consoles in the settings (and makes their folders); the downloads start separately. */
export async function applyConsoles(settings: SettingsStore, docker: Docker | null, downloads: EmulatorDownloads, add: InstallId[], remove: InstallId[], owner: { uid: number; gid: number }): Promise<EmulatorSettings> {
  const managed = await hostPathOf(docker, downloads.dir)
  const next = withConsoles(settings.get(), add, remove, managed)
  settings.update((x) => void (x.emulators = next))
  makeFolders(next, owner)
  return next
}

const instances = new Map<string, EmulatorDownloads>()
/** The one downloader for a Finesse's config folder (its downloads run in the background). */
export function downloadsFor(configDir: string): EmulatorDownloads {
  const dir = join(configDir, 'emulators')
  let d = instances.get(dir)
  if (!d) instances.set(dir, (d = new EmulatorDownloads(dir)))
  return d
}
