// The first movie, show or album on a new server. When Jellyfin scans a library
// whose folder is empty, it skips the folder ("inaccessible or empty") and never
// records it. Until a scan has seen something there, neither Jellyfin's file
// watcher nor Radarr/Sonarr/Lidarr's "new file" call can add anything to that
// library: both look for the folder the new file belongs to and find none. So
// the first request would only appear after Jellyfin's scheduled scan, up to 12
// hours later.
//
// Once a minute, while a library is still empty in Jellyfin, Finesse looks at its
// folder. When something new has arrived there, it asks Jellyfin to scan. After
// that Jellyfin knows the folder and picks up new files by itself.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SettingsStore } from '../config.ts'
import { logger } from '../log.ts'

const log = logger('libraries')
/** Jellyfin sees the media folder here (see the catalog's Jellyfin mounts). */
const JF_MEDIA = '/data/media'

export interface JellyfinLibrary {
  id: string
  name: string
  /** Folders as Jellyfin sees them (/data/media/movies). */
  locations: string[]
}

export interface JellyfinLibraries {
  list(base: string, apiKey: string): Promise<JellyfinLibrary[]>
  /** How many items Jellyfin has in a library. */
  count(base: string, apiKey: string, id: string): Promise<number>
  scan(base: string, apiKey: string): Promise<void>
}

const auth = (apiKey: string) => ({ Authorization: `MediaBrowser Client="Finesse", Device="Finesse server", DeviceId="finesse-server", Version="1", Token="${apiKey}"` })

async function getJson<T>(url: string, apiKey: string): Promise<T> {
  const r = await fetch(url, { headers: auth(apiKey), signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`Jellyfin answered ${r.status}`)
  return (await r.json()) as T
}

export const jellyfinLibraries: JellyfinLibraries = {
  async list(base, apiKey) {
    const folders = await getJson<{ Name: string; ItemId: string; Locations?: string[] }[]>(`${base}/Library/VirtualFolders`, apiKey)
    return folders.map((f) => ({ id: f.ItemId, name: f.Name, locations: f.Locations ?? [] }))
  },
  async count(base, apiKey, id) {
    return (await getJson<{ TotalRecordCount: number }>(`${base}/Items?ParentId=${encodeURIComponent(id)}&Recursive=true&Limit=0`, apiKey)).TotalRecordCount
  },
  async scan(base, apiKey) {
    const r = await fetch(`${base}/Library/Refresh`, { method: 'POST', headers: auth(apiKey), signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error(`Jellyfin answered ${r.status}`)
  },
}

/** What's in a library folder, two levels deep (Movie/, Show/Season, Artist/Album); '' when empty. */
export function folderSignature(dir: string): string {
  const names: string[] = []
  const visible = (d: string) => {
    try {
      return readdirSync(d, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'))
    } catch {
      return []
    }
  }
  for (const e of visible(dir)) {
    names.push(e.name)
    if (e.isDirectory()) for (const c of visible(join(dir, e.name))) names.push(`${e.name}/${c.name}`)
    if (names.length > 500) break
  }
  return names.sort().join('\n')
}

export class LibraryNudger {
  private readonly settings: SettingsStore
  private readonly api: JellyfinLibraries
  private busy = false
  /** Libraries Jellyfin has items in: nothing more to do for them. */
  private readonly filled = new Set<string>()
  /** What a library's folders held when Finesse last asked for a scan. */
  private readonly scannedFor = new Map<string, string>()

  constructor(settings: SettingsStore, api: JellyfinLibraries = jellyfinLibraries) {
    this.settings = settings
    this.api = api
  }

  /** Call about once a minute. */
  async tick() {
    const s = this.settings.get()
    const jf = s.jellyfin
    if (s.mode !== 'bundle' || !s.stack || s.setup.state !== 'ready' || !jf.url || !jf.apiKey || this.busy) return
    const base = `${jf.url}${jf.basePath ?? ''}`
    this.busy = true
    try {
      const reasons: string[] = []
      for (const lib of await this.api.list(base, jf.apiKey)) {
        if (this.filled.has(lib.id)) continue
        // Only folders inside the media folder, read where Finesse sees them.
        const dirs = lib.locations
          .filter((p) => (p === JF_MEDIA || p.startsWith(`${JF_MEDIA}/`)) && !p.split('/').includes('..'))
          .map((p) => join(s.stack!.hostData, p.slice('/data'.length)))
        const sig = dirs.map(folderSignature).join('\n')
        if (!sig.trim() || this.scannedFor.get(lib.id) === sig) continue
        if ((await this.api.count(base, jf.apiKey, lib.id)) > 0) {
          this.filled.add(lib.id)
          continue
        }
        this.scannedFor.set(lib.id, sig)
        reasons.push(lib.name)
      }
      if (reasons.length) {
        log.info(`new files in an empty library (${reasons.join(', ')}): asking Jellyfin to scan`)
        await this.api.scan(base, jf.apiKey)
      }
    } catch (e) {
      log.debug(`couldn’t check the libraries: ${(e as Error).message}`)
    } finally {
      this.busy = false
    }
  }
}
