// Settings → Server → Game streaming → Consoles (and setup's games step): which
// consoles play here, with the emulators Finesse downloads (emucatalog.ts),
// and, for each, plainly what's still missing and the folder to drop it in.
//
// Adding a console makes its emulator app (the same one Moonlight and browser
// play use), fills in the folders on a server Finesse set up, and downloads its
// emulator in the background. A download that fails says why and never stops
// anything else. A program in your own emulators folder always wins.

import { chownSync, existsSync, mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import type { Auth } from './auth.ts'
import type { Settings, SettingsStore } from './config.ts'
import { EMULATOR_PINS, INSTALL_IDS, pinFor, type InstallId } from './emucatalog.ts'
import { EmulatorDownloads, type DownloadStatus } from './emudownload.ts'
import { emulatorCatalog, folderFor, hasOwnProgram, readiness, type EmulatorId, type EmulatorSettings } from './emulators.ts'
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

/**
 * Settings with these consoles added (and removed): their apps, Finesse's downloads, and default
 * folders where Finesse knows them.
 * - A console whose emulator is already in your own emulators folder gets its app, and no download.
 * - Removing takes the app out of the games list too (your own file stays where it is).
 * - The Switch emulator only becomes Eden when none was chosen.
 */
export function withConsoles(s: Settings, add: InstallId[], remove: InstallId[], managedDir: string | undefined): EmulatorSettings {
  const cur: EmulatorSettings = s.emulators ? JSON.parse(JSON.stringify(s.emulators)) : { apps: [], paths: {} }
  const paths = { ...(defaultFolders(s) ?? {}), ...cur.paths }
  const install = new Set(cur.install ?? [])
  const apps = new Set(cur.apps)
  const switchEmulator = cur.switchEmulator ?? (add.includes('eden') ? 'eden' : undefined)
  for (const id of add) {
    apps.add(appOf(id))
    if (!hasOwnProgram({ ...cur, paths, switchEmulator }, appOf(id))) install.add(id)
  }
  for (const id of remove) {
    install.delete(id)
    apps.delete(appOf(id))
  }
  const next: EmulatorSettings = { ...cur, apps: [...apps], paths, install: INSTALL_IDS.filter((id) => install.has(id)) }
  if (switchEmulator) next.switchEmulator = switchEmulator
  if (managedDir) next.managedDir = managedDir
  else delete next.managedDir
  if (!next.install!.length) delete next.install
  return next
}

/**
 * Makes the folders there's nothing in yet: saves, and the firmware and keys folders each emulator
 * reads (so there's a place to drop files), when Finesse can see them. Only folders that are
 * missing are made, and only those are given to the apps' user; the top of the saves folder and
 * your own firmware and keys folders are never touched. Returns what didn't work, in plain words.
 */
export function makeFolders(e: EmulatorSettings, owner: { uid: number; gid: number }): string[] {
  const notes: string[] = []
  const cat = emulatorCatalog(e.switchEmulator)
  const make = (dir: string, give: boolean) => {
    const made: string[] = []
    for (let d = dir; !existsSync(d) && d !== dirname(d); d = dirname(d)) made.unshift(d)
    try {
      for (const d of made) mkdirSync(d)
    } catch {
      return /* Finesse can't see it; the status says so */
    }
    if (!give) return
    for (const d of made)
      try {
        chownSync(d, owner.uid, owner.gid)
      } catch {
        notes.push(`Finesse made ${d} but couldn’t give it to the apps’ user (${owner.uid}:${owner.gid}). Change its owner on the server, or the emulators can’t use it.`)
        return
      }
  }
  if (e.paths.saves) make(e.paths.saves, false)
  for (const id of e.apps)
    for (const what of ['firmware', 'keys'] as const) {
      if (!cat[id].needs.some((n) => n.what === what)) continue
      if (e.folders?.[id]?.[what]) continue // your own folder: yours as it is
      const dir = folderFor(e, id, what)
      if (dir) make(dir, true)
    }
  return notes
}

/** A folder inside Finesse's container as Docker sees it (Finesse's own mounts); itself outside Docker; null when no mount holds it. */
export async function hostPathOf(docker: Docker | null, local: string): Promise<string | null> {
  const me = docker ? await docker.inspect(process.env.FINESSE_CONTAINER || hostname()).catch(() => null) : null
  if (!me) return local
  let best: { Source: string; Destination: string } | null = null
  for (const m of me.Mounts ?? []) {
    const d = m.Destination.replace(/\/+$/, '')
    if ((local === d || local.startsWith(`${d}/`)) && (!best || d.length > best.Destination.length)) best = { Source: m.Source, Destination: d }
  }
  return best ? `${best.Source}${local.slice(best.Destination.length)}` : null
}

/** A folder as people find it on the machine itself: Docker Desktop's data folder by its own name (FINESSE_DATA_LABEL, "D:\\Finesse"). */
export function folderLabel(s: Settings, dir: string): string {
  const label = process.env.FINESSE_DATA_LABEL
  const data = s.stack?.hostData?.replace(/\/+$/, '')
  if (!label || !data || !(dir === data || dir.startsWith(`${data}/`))) return dir
  const rest = dir.slice(data.length)
  return `${label.replace(/[\\/]+$/, '')}${label.includes('\\') ? rest.replace(/\//g, '\\') : rest}`
}

/** The same, for the folders named in a sentence. */
const folderLabelIn = (s: Settings, text: string) => {
  const label = process.env.FINESSE_DATA_LABEL
  const data = s.stack?.hostData?.replace(/\/+$/, '')
  return label && data ? text.split(data).join(label.replace(/[\\/]+$/, '')) : text
}

/** What Settings → Consoles says about the whole list (not one console). */
export function consoleNotes(s: Settings): string[] {
  const e = s.emulators
  return e?.install?.length && !e.managedDir
    ? ['Finesse can’t tell where its emulators folder is on the server (its config folder isn’t one of its Docker folders), so the games can’t use its downloads yet. Reinstall Finesse with its config folder mounted, or put the emulators in your own emulators folder.']
    : []
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
        return { label: i.label, required: i.required, ok: i.state === 'ok', folder: need && e ? (folderLabel(s, folderFor(e, p.app, need.what) ?? '') || null) : null, detail: folderLabelIn(s, i.detail) }
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
    const folders = s.emulators?.paths ?? defaultFolders(s) ?? {}
    sendJson(res, 200, { consoles: consoleViews(s, downloads), folders: Object.fromEntries(Object.entries(folders).map(([k, v]) => [k, v && folderLabel(s, v)])), notes: consoleNotes(s) })
  })

  router.post('/api/emulators/consoles', async ({ req, res }) => {
    await auth.requireAdmin(req)
    const body = await readJson<{ add?: unknown; remove?: unknown; update?: unknown }>(req)
    const list = (x: unknown): InstallId[] => (Array.isArray(x) ? x.filter((v): v is InstallId => INSTALL_IDS.includes(v as InstallId)) : [])
    const add = list(body.add)
    const remove = list(body.remove)
    const update = list(body.update)
    if (!add.length && !remove.length && !update.length) throw new ApiError(400, 'Which console?')
    // All or nothing: none is removed while one of them is still downloading or being checked.
    const busy = remove.map((id) => downloads.busy(id)).find(Boolean)
    if (busy) throw new ApiError(409, busy)
    for (const id of remove) downloads.remove(id)
    const { next, notes } = await applyConsoles(settings, deps.docker, downloads, add, remove, owner())
    if (deps.sync) await deps.sync(next).catch((e) => log.warn(`emulators: ${(e as Error).message}`))
    // Only what Finesse downloads (not your own copies); an older version stays until someone asks to update it.
    void downloads.ensure(add.filter((id) => next.install?.includes(id)))
    if (update.length) void downloads.ensure(update.filter((id) => next.install?.includes(id)), { update: true })
    log.info(`consoles: ${add.length ? `added ${add.join(', ')}` : ''}${remove.length ? ` removed ${remove.join(', ')}` : ''}${update.length ? ` updating ${update.join(', ')}` : ''}`)
    const s = settings.get()
    sendJson(res, 200, { consoles: consoleViews(s, downloads), notes: [...notes, ...consoleNotes(s)] })
  })
}

/** Saves the consoles in the settings (and makes their folders); the downloads start separately. */
export async function applyConsoles(settings: SettingsStore, docker: Docker | null, downloads: EmulatorDownloads, add: InstallId[], remove: InstallId[], owner: { uid: number; gid: number }): Promise<{ next: EmulatorSettings; notes: string[] }> {
  const managed = await hostPathOf(docker, downloads.dir)
  const next = withConsoles(settings.get(), add, remove, managed ?? undefined)
  settings.update((x) => {
    x.emulators = next
    // The setup document a re-run starts from keeps the same consoles as Settings → Consoles.
    const last = x.setup?.lastDoc as { emulators?: EmulatorSettings } | undefined
    if (last?.emulators) last.emulators.install = next.install ?? []
  })
  const notes = makeFolders(next, owner)
  for (const n of notes) log.warn(n)
  return { next, notes }
}

/** The setup wizard's `emulators`: only the consoles to download (`install`), nothing of its own. */
export const installOnly = (e: EmulatorSettings) =>
  !e.apps?.length && !Object.values(e.paths ?? {}).some(Boolean) && !e.folders && !e.profiles && !e.switchEmulator && !e.managedDir

/**
 * Setup's consoles. The wizard's document (only `install`) is applied onto the current settings:
 * consoles added or removed since, nothing else (folders, profiles, ES-DE and the Switch
 * emulator stay as Settings has them). A full `emulators` (the CLI's) replaces the settings.
 * Returns the consoles to download.
 */
export async function setupConsoles(settings: SettingsStore, docker: Docker | null, downloads: EmulatorDownloads, doc: EmulatorSettings, owner: { uid: number; gid: number }): Promise<{ download: InstallId[]; notes: string[] }> {
  const want = INSTALL_IDS.filter((id) => doc.install?.includes(id))
  let notes: string[] = []
  if (!installOnly(doc)) {
    settings.update((x) => void (x.emulators = structuredClone(doc)))
    if (want.length) notes = (await applyConsoles(settings, docker, downloads, want, [], owner)).notes
  } else {
    const have = settings.get().emulators?.install ?? []
    const add = want.filter((id) => !have.includes(id))
    // One still downloading stays (Settings can remove it once it's done).
    const remove = have.filter((id) => !want.includes(id) && !downloads.busy(id))
    if (add.length || remove.length) {
      for (const id of remove) downloads.remove(id)
      notes = (await applyConsoles(settings, docker, downloads, add, remove, owner)).notes
    }
  }
  // Only what's missing (a failed one tries again); an older version is never updated by setup.
  const now = settings.get().emulators?.install ?? []
  return { download: want.filter((id) => now.includes(id)), notes: [...notes, ...consoleNotes(settings.get())] }
}

const instances = new Map<string, EmulatorDownloads>()
/** The one downloader for a Finesse's config folder (its downloads run in the background). */
export function downloadsFor(configDir: string): EmulatorDownloads {
  const dir = join(configDir, 'emulators')
  let d = instances.get(dir)
  if (!d) instances.set(dir, (d = new EmulatorDownloads(dir)))
  return d
}
