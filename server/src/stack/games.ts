// Games (RomM): new games show up within minutes. RomM's file watcher runs a
// quick scan when files change in a system folder it already knows, but it
// ignores folders it hasn't registered yet — a new folder (roms/snes, say), or
// every folder when RomM starts fresh on a games folder that already has games.
// So once a minute Finesse asks RomM which folders on disk it doesn't know,
// registers them, and briefly touches a file in each: RomM's watcher sees the
// change and scans that system properly.
//
// It also keeps RomM's database able to start (see clearFinishedTcLog).

import { closeSync, openSync, readSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsStore } from '../config.ts'
import { logger } from '../log.ts'

const log = logger('games')
const MARKER = 'finesse-rescan.tmp'
/** A folder RomM wouldn't register is tried again after this long. */
const RETRY_MS = 30 * 60000

type Login = { url: string; username: string; password: string }

/** The two RomM calls the nudger needs (swapped for a fake in tests). */
export interface RommFolders {
  /** System folders on disk that RomM has no platform for yet. */
  unregistered(login: Login): Promise<string[]>
  register(login: Login, folder: string): Promise<void>
}

const rommFolders: RommFolders = {
  async unregistered(login) {
    const list = (await romm(login, 'GET', '/api/platforms/filesystem')) as { fs_slug?: string }[]
    return list.map((p) => p.fs_slug).filter((x): x is string => typeof x === 'string')
  },
  async register(login, folder) {
    await romm(login, 'POST', '/api/platforms', { fs_slug: folder })
  },
}

async function romm(login: Login, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${login.url}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${login.username}:${login.password}`).toString('base64')}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`RomM answered ${res.status} to ${method} ${path}`)
  return res.json()
}

export class GamesNudger {
  private readonly settings: SettingsStore
  private readonly api: RommFolders
  private busy = false
  private readonly retryAt = new Map<string, number>()

  constructor(settings: SettingsStore, api: RommFolders = rommFolders) {
    this.settings = settings
    this.api = api
  }

  /** Call about once a minute. */
  async tick(now = Date.now()) {
    const s = this.settings.get()
    if (!s.stack?.services.includes('romm')) return
    clearFinishedTcLog(s.stack.hostRoot)
    const r = s.services.romm
    if (!r?.url || !r.username || !r.password || this.busy) return
    const login = { url: r.url, username: r.username, password: r.password }
    const roms = join(s.stack.hostData, 'media', 'games', 'roms')
    this.busy = true
    try {
      const fresh = await this.api.unregistered(login)
      if (!fresh.length) return
      // Only real folders in the games folder (never a path from elsewhere).
      const onDisk = new Set(readdirSync(roms, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name))
      for (const folder of fresh) {
        if (!onDisk.has(folder) || (this.retryAt.get(folder) ?? 0) > now) continue
        try {
          await this.api.register(login, folder)
          nudge(join(roms, folder))
          log.info(`found a new games folder, ${folder}: RomM will add its games in a couple of minutes`)
        } catch (e) {
          this.retryAt.set(folder, now + RETRY_MS)
          log.warn(`RomM couldn’t add the games folder ${folder} (${(e as Error).message}); trying again in 30 minutes`)
        }
      }
    } catch (e) {
      log.debug(`couldn’t ask RomM about new folders: ${(e as Error).message}`)
    } finally {
      this.busy = false
    }
  }
}

function nudge(dir: string) {
  const f = join(dir, MARKER)
  try {
    writeFileSync(f, '')
    setTimeout(() => rmSync(f, { force: true }), 3000).unref()
  } catch (e) {
    log.debug(`couldn’t nudge ${dir}: ${(e as Error).message}`)
  }
}

/**
 * MariaDB keeps a small transaction log, tc.log, while it runs. On a clean
 * shutdown it overwrites the file's first byte with an "A" (its "finished" mark)
 * and then deletes it. If the delete doesn't happen, every later start fails
 * with "Bad magic header in tc log" and the games database never comes back.
 * A log with that mark has nothing left to recover, so it's safe to remove.
 * Logs from a real crash keep their header and are left for MariaDB to recover.
 */
export function clearFinishedTcLog(hostRoot: string): boolean {
  const f = join(hostRoot, 'config', 'romm-db', 'tc.log')
  let first: number
  try {
    const fd = openSync(f, 'r')
    try {
      const b = Buffer.alloc(1)
      if (readSync(fd, b, 0, 1, 0) !== 1) return false
      first = b[0]!
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
  if (first !== 0x41) return false
  try {
    rmSync(f, { force: true })
    log.info('removed a finished transaction log so the games database can start')
    return true
  } catch (e) {
    log.warn(`couldn’t remove ${f}: ${(e as Error).message}`)
    return false
  }
}
