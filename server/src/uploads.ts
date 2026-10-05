// Add media from the browser: files (or whole folders) dropped on the app go straight into the
// library folders, then Jellyfin is asked to scan. Anything the person's computer can open works
// (its own disks, a USB drive, a network share): the browser reads it, Finesse writes it.
//
// Uploads are resumable chunks, so a 50 GB film survives a dropped Wi-Fi or a closed lid:
//   POST   /api/media/uploads        {kind, path, size}  → {id, offset}   (same file again → same id, its offset)
//   PUT    /api/media/uploads/:id?offset=N  raw bytes    → {offset, done, path}
//   DELETE /api/media/uploads/:id                         → cancel
// Parts wait in <media>/.finesse-uploads (same disk as the libraries, outside every library) and
// are renamed into place when complete, so Jellyfin never sees half a file.

import { createHash } from 'node:crypto'
import { chownSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, readJson, sendJson, type Router } from './http/core.ts'
import { logger } from './log.ts'
import { jellyfinLibraries, type JellyfinLibraries } from './stack/libraries.ts'

const log = logger('uploads')

/** Where each kind goes, under the media folder (the stack's layout: see the catalog). */
export const KINDS = { movies: 'media/movies', tv: 'media/tv', music: 'media/music', games: 'media/games/roms' } as const
export type Kind = keyof typeof KINDS
const STAGING = 'media/.finesse-uploads'
/** Biggest single chunk accepted (the app sends 16 MB). */
export const CHUNK_MAX = 64 << 20
/** Room left over after an upload, so the disk never fills to the brim. */
const HEADROOM = 512 << 20
/** Unfinished uploads are forgotten after a week. */
const STALE_MS = 7 * 24 * 3600e3

interface Meta {
  kind: Kind
  path: string
  size: number
  at: number
}

/** A relative path made safe: no "..", no hidden parts, no characters Windows or SMB shares refuse. */
export function cleanPath(rel: unknown): string | null {
  if (typeof rel !== 'string') return null
  const raw = rel.replace(/\\/g, '/').split('/')
  if (raw.some((p) => p.trim() === '..' || p.trim() === '.')) return null
  const parts = raw
    .map((p) => p.replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/[. ]+$/, '').trim())
    .filter((p) => p.length > 0)
  if (!parts.length || parts.length > 8) return null
  if (parts.some((p) => p === '.' || p === '..' || p.startsWith('.') || Buffer.byteLength(p) > 240)) return null
  return parts.join('/')
}

/** "The Office (US) (2005)" and "the office us" are the same folder; returns the year too. */
function folderKey(name: string): { key: string; year?: string } {
  const year = /\((\d{4})\)\s*$/.exec(name)?.[1]
  return { key: name.replace(/\(\d{4}\)\s*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, ''), year }
}

/** A show, artist or movie that's already on disk under a slightly different name: use its folder,
 *  so Jellyfin doesn't list it twice ("Pioneer One" next to "Pioneer One (2010)"). */
export function sameFolder(libraryDir: string, rel: string): string {
  const [first, ...rest] = rel.split('/')
  if (!rest.length || !first) return rel
  let names: string[]
  try {
    names = readdirSync(libraryDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  } catch {
    return rel
  }
  if (names.includes(first)) return rel
  const want = folderKey(first)
  if (!want.key) return rel
  const hit = names.find((n) => {
    const k = folderKey(n)
    return k.key === want.key && !(k.year && want.year && k.year !== want.year)
  })
  return hit ? [hit, ...rest].join('/') : rel
}

/** "Film.mkv" → "Film (2).mkv", until the name is free. */
function freeName(file: string): string {
  if (!existsSync(file)) return file
  const ext = extname(file)
  const stem = file.slice(0, file.length - ext.length)
  for (let n = 2; n < 1000; n++) {
    const next = `${stem} (${n})${ext}`
    if (!existsSync(next)) return next
  }
  throw new ApiError(409, 'There are already too many files with that name')
}

export class Uploads {
  private readonly settings: SettingsStore
  private readonly api: JellyfinLibraries
  private scanTimer: NodeJS.Timeout | null = null
  /** One write at a time per upload (a retried chunk can arrive while the first is still flowing). */
  private readonly writing = new Set<string>()

  constructor(settings: SettingsStore, api: JellyfinLibraries = jellyfinLibraries) {
    this.settings = settings
    this.api = api
  }

  /** The media folder, where Finesse sees it; null when Finesse didn't install the stack (nothing to add to). */
  root(): string | null {
    const s = this.settings.get()
    return s.mode === 'bundle' && s.stack && s.setup.state === 'ready' ? s.stack.hostData : null
  }

  private need(): string {
    const r = this.root()
    if (!r) throw new ApiError(409, 'Adding media works on servers Finesse set up. Copy files into your media folders instead.')
    return r
  }

  private staging(root: string) {
    const dir = join(root, STAGING)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  private owner(): { uid: number; gid: number } {
    const st = this.settings.get().stack
    return { uid: st?.puid ?? 1000, gid: st?.pgid ?? 1000 }
  }

  /** Hands what Finesse (root) created to the apps' user, so Sonarr & co. can tidy it later. */
  private own(root: string, file: string) {
    const { uid, gid } = this.owner()
    let p = file
    while (p.length > root.length) {
      try {
        chownSync(p, uid, gid)
      } catch {
        /* not root, or a disk that doesn't do owners (Windows drives) */
      }
      p = dirname(p)
    }
  }

  info() {
    const root = this.root()
    if (!root) return { available: false }
    let free: number | null = null
    try {
      const f = statfsSync(root)
      free = f.bavail * f.bsize
    } catch {
      /* unknown */
    }
    const s = this.settings.get()
    return {
      available: true,
      free,
      // What people should look for on the machine itself (the installer can say "D:\Finesse\Media").
      folder: process.env.FINESSE_DATA_LABEL || root,
      games: Boolean(s.services.romm?.url),
      folders: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v])),
    }
  }

  private id(kind: Kind, path: string, size: number) {
    return createHash('sha256').update(`${kind}\0${path}\0${size}`).digest('hex').slice(0, 24)
  }

  private metaFile(root: string, id: string) {
    return join(this.staging(root), `${id}.json`)
  }

  private partFile(root: string, id: string) {
    return join(this.staging(root), `${id}.part`)
  }

  private readMeta(root: string, id: string): Meta {
    if (!/^[0-9a-f]{24}$/.test(id)) throw new ApiError(404, 'No such upload')
    try {
      return JSON.parse(readFileSync(this.metaFile(root, id), 'utf8')) as Meta
    } catch {
      throw new ApiError(404, 'That upload isn’t here any more. Add the file again.')
    }
  }

  private sizeOf(file: string) {
    try {
      return statSync(file).size
    } catch {
      return 0
    }
  }

  /** Starts an upload, or finds the one already under way for the same file. */
  begin(body: { kind?: unknown; path?: unknown; size?: unknown }) {
    const root = this.need()
    const kind = body.kind as Kind
    if (!(kind in KINDS)) throw new ApiError(400, 'Choose Movies, TV shows, Music or Games for this file')
    if (kind === 'games' && !this.settings.get().services.romm?.url) throw new ApiError(400, 'Games isn’t switched on (Settings → Server)')
    const clean = cleanPath(body.path)
    if (!clean) throw new ApiError(400, 'That file name can’t be used')
    const path = kind === 'games' ? clean : sameFolder(join(root, KINDS[kind]), clean)
    if (kind === 'games' && !path.includes('/')) throw new ApiError(400, 'Choose which console this game is for')
    const size = Number(body.size)
    if (!Number.isSafeInteger(size) || size < 0) throw new ApiError(400, 'Unknown file size')

    const target = join(root, KINDS[kind], path)
    // Already in the library (same name, same size): nothing to send.
    if (existsSync(target) && this.sizeOf(target) === size) return { id: null, offset: size, done: true, skipped: true, path }

    const id = this.id(kind, path, size)
    const part = this.partFile(root, id)
    const offset = existsSync(this.metaFile(root, id)) ? this.sizeOf(part) : 0
    if (!existsSync(this.metaFile(root, id))) {
      try {
        const f = statfsSync(root)
        if (f.bavail * f.bsize < size - offset + HEADROOM) throw new ApiError(507, `Not enough room on the server’s disk for ${path.split('/').pop()}`)
      } catch (e) {
        if (e instanceof ApiError) throw e
      }
      writeFileSync(this.metaFile(root, id), JSON.stringify({ kind, path, size, at: Date.now() } satisfies Meta))
      writeFileSync(part, '')
    }
    if (size === 0) return { id, ...this.finish(root, id, this.readMeta(root, id)) }
    return { id, offset, done: false, path }
  }

  /** Appends one chunk at `offset` (must be where the file ends now). */
  async write(id: string, offset: number, length: number, body: NodeJS.ReadableStream) {
    const root = this.need()
    const meta = this.readMeta(root, id)
    const part = this.partFile(root, id)
    if (this.writing.has(id)) throw new ApiError(409, 'This file is already uploading', { offset: this.sizeOf(part) })
    const have = this.sizeOf(part)
    if (offset !== have) throw new ApiError(409, 'Out of step', { offset: have })
    if (!Number.isSafeInteger(length) || length <= 0 || length > CHUNK_MAX) throw new ApiError(400, 'Chunks are sent at most 64 MB at a time')
    if (have + length > meta.size) throw new ApiError(400, 'That’s more than the file’s size')
    this.writing.add(id)
    try {
      let seen = 0
      const limit = new Transform({
        transform(chunk: Buffer, _enc, done) {
          seen += chunk.length
          if (seen > length) return done(new ApiError(400, 'The chunk was bigger than it said'))
          done(null, chunk)
        },
      })
      await pipeline(body, limit, createWriteStream(part, { flags: 'a' }))
    } finally {
      this.writing.delete(id)
    }
    const now = this.sizeOf(part)
    if (now < meta.size) return { offset: now, done: false, path: meta.path }
    if (now > meta.size) {
      // Shouldn't happen; start that file over rather than keep a wrong one.
      this.cancel(id)
      throw new ApiError(409, 'The file came out the wrong size. Add it again.')
    }
    return this.finish(root, id, meta)
  }

  private finish(root: string, id: string, meta: Meta) {
    const want = join(root, KINDS[meta.kind], meta.path)
    mkdirSync(dirname(want), { recursive: true })
    const target = freeName(want)
    renameSync(this.partFile(root, id), target)
    rmSync(this.metaFile(root, id), { force: true })
    this.own(join(root, KINDS[meta.kind]), target)
    const placed = target.slice(join(root, KINDS[meta.kind]).length + 1)
    log.info(`added ${meta.kind}: ${placed} (${Math.round(meta.size / 1e6)} MB)`)
    if (meta.kind !== 'games') this.scanSoon() // RomM: the games nudger registers new console folders by itself
    return { offset: meta.size, done: true, path: placed }
  }

  cancel(id: string) {
    const root = this.need()
    if (!/^[0-9a-f]{24}$/.test(id)) throw new ApiError(404, 'No such upload')
    rmSync(this.partFile(root, id), { force: true })
    rmSync(this.metaFile(root, id), { force: true })
  }

  /** A few seconds after the last file lands, one Jellyfin scan for all of them. */
  private scanSoon() {
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      const jf = this.settings.get().jellyfin
      if (!jf.url || !jf.apiKey) return
      this.api.scan(`${jf.url}${jf.basePath ?? ''}`, jf.apiKey).catch((e) => log.warn(`couldn’t ask Jellyfin to scan: ${(e as Error).message}`))
    }, 8000)
    this.scanTimer.unref?.()
  }

  /** Forgets uploads nobody came back for. */
  sweep(now = Date.now()) {
    const root = this.root()
    if (!root) return
    const dir = join(root, STAGING)
    if (!existsSync(dir)) return
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      const id = f.slice(0, -5)
      try {
        const meta = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Meta
        if (now - meta.at > STALE_MS) this.cancel(id)
      } catch {
        rmSync(join(dir, f), { force: true })
      }
    }
  }
}

export function registerUploads(router: Router, deps: { uploads: Uploads; auth: Auth }) {
  const { uploads, auth } = deps
  router.get('/api/media/info', async ({ req, res }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, uploads.info())
  })
  router.post('/api/media/uploads', async ({ req, res }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, uploads.begin(await readJson(req)))
  })
  router.put('/api/media/uploads/:id', async ({ req, res, params, url }) => {
    await auth.requireAdmin(req)
    const offset = Number(url.searchParams.get('offset'))
    const length = Number(req.headers['content-length'])
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError(400, 'Missing offset')
    sendJson(res, 200, await uploads.write(params.id!, offset, length, req))
  })
  router.delete('/api/media/uploads/:id', async ({ req, res, params }) => {
    await auth.requireAdmin(req)
    uploads.cancel(params.id!)
    sendJson(res, 200, { ok: true })
  })
}
