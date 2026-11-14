// Pictures for the store, served by Finesse. A feed names its covers and screenshots by address;
// if browsers loaded those directly, every visit would tell some outside server who's browsing
// what. So the app is given Finesse's own address for each picture (a hash of the original), and
// Finesse fetches it once, checks it really is a picture, and keeps it in the config folder.
// Only addresses that are in the catalogue can be asked for: this is not an open proxy.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'

const MAX_BYTES = 12 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']

export const artId = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 32)
/** The address the app is given for a picture. */
export const artPath = (url: string) => `/api/games/store/art/${artId(url)}`

/** Somewhere on this machine or this network: never fetched for a picture. */
function inside(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (isIP(h) === 4) return /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h)
  if (isIP(h) === 6) return h === '::1' || h === '::' || /^(f[cd]|fe[89ab])/.test(h) || h.startsWith('::ffff:')
  return false
}

export interface Picture {
  type: string
  body: Buffer
}

export class ArtCache {
  private readonly dir: string
  private readonly get: typeof fetch
  private readonly going = new Map<string, Promise<Picture | null>>()
  /** Addresses that failed, not asked again for a while. */
  private readonly failed = new Map<string, number>()

  constructor(dir: string, get: typeof fetch = fetch) {
    this.dir = dir
    this.get = get
  }

  /** The picture at this address: from disk, or fetched once. null when it can't be had. */
  picture(url: string): Promise<Picture | null> {
    const id = artId(url)
    const now = this.going.get(id)
    if (now) return now
    const p = this.load(id, url).finally(() => this.going.delete(id))
    this.going.set(id, p)
    return p
  }

  private async load(id: string, url: string): Promise<Picture | null> {
    const file = join(this.dir, id)
    try {
      const type = (await readFile(`${file}.type`, 'utf8')).trim()
      if (TYPES.includes(type)) return { type, body: await readFile(file) }
    } catch {
      /* not kept yet */
    }
    if ((this.failed.get(id) ?? 0) > Date.now()) return null
    const got = await this.fetch(url).catch(() => null)
    if (!got) {
      this.failed.set(id, Date.now() + 10 * 60_000)
      if (this.failed.size > 5000) this.failed.clear()
      return null
    }
    await mkdir(this.dir, { recursive: true })
    // Written beside and renamed, so a half-written picture is never served.
    await writeFile(`${file}.part`, got.body)
    await rename(`${file}.part`, file)
    await writeFile(`${file}.type`, got.type)
    return got
  }

  private async fetch(url: string): Promise<Picture | null> {
    const u = new URL(url)
    if (u.protocol !== 'https:' || inside(u.hostname)) return null
    const r = await this.get(url, { signal: AbortSignal.timeout(20_000), redirect: 'follow', headers: { Accept: TYPES.join(', ') } })
    const end = r.url ? new URL(r.url) : u
    if (!r.ok || end.protocol !== 'https:' || inside(end.hostname)) return null
    const type = (r.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!TYPES.includes(type) || Number(r.headers.get('content-length') ?? 0) > MAX_BYTES) return null
    const body = Buffer.from(await r.arrayBuffer())
    return body.length > 0 && body.length <= MAX_BYTES ? { type, body } : null
  }
}
