// What a backup can hold, how big each part is, and putting it all back.
//
// Every backup has Finesse's own settings and invites. On a server Finesse set
// up, it can also hold each app's settings files and, when asked, the apps'
// databases: Jellyfin's (users, watch history), Sonarr/Radarr/Lidarr/Prowlarr's
// (everything followed and downloaded) and RomM's (the games library, with saves
// and states from its assets folder).
//
// Databases are copied with SQLite's VACUUM INTO, which gives a consistent copy
// while the app keeps running. Restoring stops the app, puts the file back and
// starts it again, so it works the same on a new machine where the apps don't
// exist yet (Finesse creates them with the restored files). RomM's MariaDB dump
// is the exception: it's imported once its database is running.

import { chownSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { Settings } from '../config.ts'
import { readTarGz, type TarEntry } from '../tar.ts'
import { containerName } from './catalog.ts'
import type { Docker } from './docker.ts'

export type BackupPart = 'settings' | 'apps' | 'watch' | 'requests' | 'games'

export const BACKUP_PARTS: { id: BackupPart; label: string; detail: string }[] = [
  { id: 'settings', label: 'Finesse settings & invites', detail: 'Always included.' },
  { id: 'apps', label: 'App settings', detail: 'Keys, download clients, indexers and quality profiles for each app, and devices paired for game streaming.' },
  { id: 'watch', label: 'Watch history & accounts', detail: 'Jellyfin’s database: everyone’s accounts, what they watched and where they stopped.' },
  { id: 'requests', label: 'Requests & download history', detail: 'Every show, movie and artist Sonarr, Radarr and Lidarr follow, plus Prowlarr’s indexers.' },
  { id: 'games', label: 'Games library & saves', detail: 'RomM’s library, collections, save games and save states.' },
]

/** What nightly backups and a plain "back up" hold. */
export const DEFAULT_PARTS: BackupPart[] = ['settings', 'apps']
/** Parts that can make a backup big; only the newest few such backups are kept. */
export const BIG_PARTS: BackupPart[] = ['watch', 'requests', 'games']

const ARR_DBS = ['sonarr', 'radarr', 'lidarr', 'prowlarr'] as const
const JELLYFIN_DB = 'jellyfin/data/jellyfin.db'

export const isPart = (x: unknown): x is BackupPart => BACKUP_PARTS.some((p) => p.id === x)

/** finesse-backup-<stamp>.tar.gz holds the defaults; _watch_games etc. name anything else. */
export function backupName(stamp: string, parts: BackupPart[]): string {
  const set = new Set(parts)
  const isDefault = set.size === DEFAULT_PARTS.length && DEFAULT_PARTS.every((p) => set.has(p))
  const extra = BACKUP_PARTS.map((p) => p.id).filter((p) => p !== 'settings' && set.has(p))
  return `finesse-backup-${stamp}${isDefault ? '' : `_${extra.join('_') || 'settings'}`}.tar.gz`
}

export const BACKUP_FILE = /^finesse-backup-[\dT-]+(_[a-z]+)*\.tar\.gz$/

export function partsOf(name: string): BackupPart[] {
  const m = /^finesse-backup-[\dT-]+((?:_[a-z]+)*)\.tar\.gz$/.exec(name)
  if (!m) return []
  if (!m[1]) return [...DEFAULT_PARTS]
  const extra = m[1].slice(1).split('_').filter((p): p is BackupPart => isPart(p) && p !== 'settings')
  return ['settings', ...extra]
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/** Total size of the files in a folder (no links followed), capped so a huge folder doesn't stall. */
function folderSize(dir: string, budget = { files: 20000 }): number {
  let total = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    if (budget.files-- <= 0) break
    const p = join(dir, e.name)
    if (e.isDirectory()) total += folderSize(p, budget)
    else if (e.isFile()) total += sizeOf(p)
  }
  return total
}

function filesUnder(dir: string, base = dir, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) filesUnder(p, base, out)
    else if (e.isFile()) out.push(p.slice(base.length + 1))
  }
  return out
}

function newestIn(dir: string, re: RegExp): string | null {
  try {
    const n = readdirSync(dir).filter((f) => re.test(f)).sort().pop()
    return n ? join(dir, n) : null
  } catch {
    return null
  }
}

export interface PartInfo {
  id: BackupPart
  label: string
  detail: string
  available: boolean
  /** Roughly how much it adds (databases shrink a little when copied). */
  bytes: number
  why?: string
}

export function describeParts(s: Settings, paths: { settingsFile: string; invitesDb: string }): PartInfo[] {
  const root = s.mode === 'bundle' && s.stack ? join(s.stack.hostRoot, 'config') : null
  const services = new Set(s.stack?.services ?? [])
  const notManaged = 'Only on servers Finesse set up; your apps keep their own backups.'
  return BACKUP_PARTS.map((p) => {
    const base = { ...p, available: true, bytes: 0 }
    if (p.id === 'settings') return { ...base, bytes: sizeOf(paths.settingsFile) + sizeOf(paths.invitesDb) }
    if (!root) return { ...base, available: false, why: notManaged }
    if (p.id === 'apps') return { ...base, bytes: folderSize(join(root, 'jellyfin', 'config')) + 64 * 1024 }
    if (p.id === 'watch') return { ...base, bytes: sizeOf(join(root, JELLYFIN_DB)) }
    if (p.id === 'requests') {
      const have = ARR_DBS.filter((a) => services.has(a))
      if (!have.length) return { ...base, available: false, why: 'Downloads aren’t set up on this server.' }
      return { ...base, bytes: have.reduce((n, a) => n + sizeOf(join(root, a, `${a}.db`)), 0) }
    }
    // games
    if (!services.has('romm')) return { ...base, available: false, why: 'Games is off.' }
    const dump = newestIn(join(root, 'romm', 'backups'), /^romm-.*\.sql\.gz$/)
    return { ...base, bytes: (dump ? sizeOf(dump) : 0) + folderSize(join(root, 'romm', 'assets')) }
  })
}

/** A consistent copy of a live SQLite database (the app can keep running). */
export function copyDatabase(src: string, dest: string) {
  rmSync(dest, { force: true })
  mkdirSync(dirname(dest), { recursive: true })
  const db = new DatabaseSync(src, { readOnly: true })
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
  } finally {
    db.close()
  }
}

/**
 * The archive entries for the database parts. Copies go in `scratch` (delete it
 * afterwards). Problems are returned, not thrown: a backup still gets written.
 */
export function databaseEntries(s: Settings, parts: BackupPart[], scratch: string): { entries: TarEntry[]; problems: string[] } {
  const entries: TarEntry[] = []
  const problems: string[] = []
  if (s.mode !== 'bundle' || !s.stack) return { entries, problems }
  const root = join(s.stack.hostRoot, 'config')
  const services = new Set(s.stack.services)
  const copy = (label: string, src: string, archivePath: string) => {
    if (!existsSync(src)) return problems.push(`${label} (no database yet)`)
    const dest = join(scratch, archivePath)
    try {
      copyDatabase(src, dest)
      entries.push({ path: archivePath, file: dest })
    } catch (e) {
      problems.push(`${label} (${(e as Error).message})`)
    }
  }
  if (parts.includes('watch')) copy('Jellyfin', join(root, JELLYFIN_DB), 'db/jellyfin/jellyfin.db')
  if (parts.includes('requests')) for (const a of ARR_DBS) if (services.has(a)) copy(a[0]!.toUpperCase() + a.slice(1), join(root, a, `${a}.db`), `db/${a}/${a}.db`)
  if (parts.includes('games') && services.has('romm')) {
    const dump = newestIn(join(root, 'romm', 'backups'), /^romm-.*\.sql\.gz$/)
    if (dump) entries.push({ path: 'db/romm/romm.sql.gz', file: dump })
    else problems.push('RomM (no database dump yet)')
    const assets = join(root, 'romm', 'assets')
    for (const rel of filesUnder(assets)) entries.push({ path: `games/assets/${rel}`, file: join(assets, rel) })
  }
  return { entries, problems }
}

// ---------- restore ----------

export interface RestoreOptions {
  configDir: string
  /** FINESSE_ROOT (bundle mode); without it only Finesse's own files come back. */
  root: string | null
  uid: number
  gid: number
  docker: Docker | null
  only?: BackupPart[]
  say?: (m: string) => void
}

export interface RestoreResult {
  files: number
  /** Finesse's or the apps' settings came back: restart Finesse to use them. */
  settings: boolean
  databases: string[]
  /** Set when RomM's database is waiting to be imported (Finesse does it once RomM's database runs). */
  rommPending: boolean
}

const partOfPath = (p: string): BackupPart | null =>
  p.startsWith('finesse/') ? 'settings' : p.startsWith('apps/') ? 'apps' : p.startsWith('db/jellyfin/') ? 'watch' : p.startsWith('db/romm/') || p.startsWith('games/') ? 'games' : p.startsWith('db/') ? 'requests' : null

/**
 * Apps a restore has stopped: Finesse's minute loop leaves them alone instead of
 * starting them again halfway. Expires on its own if a restore dies midway.
 */
export const holdFile = (configDir: string) => join(configDir, 'restore-hold.json')
const HOLD_MS = 10 * 60000

export function heldApps(configDir: string, now = Date.now()): string[] {
  try {
    const h = JSON.parse(readFileSync(holdFile(configDir), 'utf8')) as { apps?: unknown; until?: unknown }
    return typeof h.until === 'number' && h.until > now && Array.isArray(h.apps) ? h.apps.filter((a): a is string => typeof a === 'string') : []
  } catch {
    return []
  }
}

/** Where Finesse keeps a pending RomM import (see applyPendingRestore). */
export const rommRestoreFile = (root: string) => join(root, 'config', 'romm-db', 'finesse-restore.sql.gz')

export async function restoreBackup(file: string, o: RestoreOptions): Promise<RestoreResult> {
  const say = o.say ?? (() => {})
  const want = (p: BackupPart | null) => p !== null && (!o.only || o.only.includes(p))
  const result: RestoreResult = { files: 0, settings: false, databases: [], rommPending: false }
  const staged: { app: string; label: string; db: string; tmp: string }[] = []
  const own = (p: string) => {
    try {
      chownSync(p, o.uid, o.gid)
    } catch {
      /* not root */
    }
  }
  const write = async (dest: string, body: AsyncIterable<Buffer>, chown: boolean) => {
    mkdirSync(dirname(dest), { recursive: true })
    await pipeline(Readable.from(body), createWriteStream(dest, { mode: 0o600 }))
    if (chown) own(dest)
  }
  const cfg = o.root ? join(o.root, 'config') : null
  await readTarGz(file, async (path, _size, body) => {
    const part = partOfPath(path)
    if (!want(part)) return
    if (path.startsWith('finesse/')) {
      await write(join(o.configDir, path.slice('finesse/'.length)), body, false)
      result.files++
      result.settings = true
      return
    }
    if (!cfg) return
    if (path.startsWith('apps/')) {
      await write(join(cfg, path.slice('apps/'.length)), body, true)
      result.files++
      result.settings = true
    } else if (path === 'db/jellyfin/jellyfin.db') {
      const db = join(cfg, JELLYFIN_DB)
      staged.push({ app: 'jellyfin', label: 'Jellyfin', db, tmp: `${db}.restore` })
      await write(`${db}.restore`, body, true)
    } else if (/^db\/(sonarr|radarr|lidarr|prowlarr)\/\1\.db$/.test(path)) {
      const app = path.split('/')[1]!
      const db = join(cfg, app, `${app}.db`)
      staged.push({ app, label: app[0]!.toUpperCase() + app.slice(1), db, tmp: `${db}.restore` })
      await write(`${db}.restore`, body, true)
    } else if (path === 'db/romm/romm.sql.gz') {
      await write(rommRestoreFile(o.root!), body, false)
      result.rommPending = true
    } else if (path.startsWith('games/assets/')) {
      await write(join(cfg, 'romm', 'assets', path.slice('games/assets/'.length)), body, true)
      result.files++
    }
  })
  // Swap each database in with its app stopped (and held, so nothing restarts it midway).
  if (staged.length) writeFileSync(holdFile(o.configDir), JSON.stringify({ apps: staged.map((s) => s.app), until: Date.now() + HOLD_MS }))
  try {
    await swapDatabases(staged, o, result, own, say)
  } finally {
    rmSync(holdFile(o.configDir), { force: true })
  }
  if (result.rommPending) writeFileSync(join(o.configDir, 'restore-pending.json'), JSON.stringify({ romm: true, at: new Date().toISOString() }))
  return result
}

async function swapDatabases(
  staged: { app: string; label: string; db: string; tmp: string }[],
  o: RestoreOptions,
  result: RestoreResult,
  own: (p: string) => void,
  say: (m: string) => void,
) {
  for (const s of staged) {
    const name = containerName(s.app as never)
    const c = o.docker ? await o.docker.inspect(name).catch(() => null) : null
    const wasRunning = Boolean(c?.State.Running)
    if (wasRunning) {
      say(`Stopping ${s.label}…`)
      await o.docker!.stop(name, 30)
    }
    for (const ext of ['-wal', '-shm']) rmSync(`${s.db}${ext}`, { force: true })
    renameSync(s.tmp, s.db)
    own(s.db)
    if (wasRunning) {
      await o.docker!.start(name)
      say(`${s.label}: database restored, started again`)
    } else say(`${s.label}: database restored (it starts with it)`)
    result.databases.push(s.label)
  }
}

/** Imports a pending RomM dump once its database answers; true when done (or nothing to do). */
export async function applyPendingRestore(configDir: string, root: string, docker: Docker, say: (level: 'info' | 'error', m: string) => void): Promise<boolean> {
  const marker = join(configDir, 'restore-pending.json')
  if (!existsSync(marker)) return true
  const dump = rommRestoreFile(root)
  if (!existsSync(dump)) {
    rmSync(marker, { force: true })
    return true
  }
  const db = await docker.inspect(containerName('romm-db')).catch(() => null)
  if (!db?.State.Running) return false
  const r = await docker
    .exec(containerName('romm-db'), ['sh', '-c', 'zcat /var/lib/mysql/finesse-restore.sql.gz | mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" romm'])
    .catch((e) => ({ code: -1, output: String(e) }))
  if (r.code !== 0) {
    say('error', `Couldn’t import RomM’s database from the backup yet (${r.output.trim().split('\n').pop()?.slice(0, 160) || `exit ${r.code}`}); trying again in a minute`)
    return false
  }
  rmSync(dump, { force: true })
  rmSync(marker, { force: true })
  await docker.stop(containerName('romm'), 30).catch(() => {})
  await docker.start(containerName('romm')).catch(() => {})
  say('info', 'Restored RomM’s games library from the backup')
  return true
}
