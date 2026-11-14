// Game downloads from an https address a feed gives (a studio's own download page, say).
// Straight to a folder per request; a part-finished file carries on from where it stopped,
// after a pause or a restart. No torrent, so nothing is shared back.

import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Downloader, DownloadStatus } from './types.ts'

interface Job {
  url: string
  total: number
  got: number
  state: 'downloading' | 'paused' | 'done' | 'error'
  reason?: string
  stop?: AbortController
  /** For the speed: bytes and time at the last look. */
  mark: { at: number; got: number }
  speed: number
}

const PART = '.part'

export function fileNameFrom(url: string): string {
  const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
  const safe = last.replace(/[^\w.+ ()\-]/g, '_').replace(/^\.+/, '').slice(0, 150)
  return safe || 'download'
}

export class DirectDownloader implements Downloader {
  private readonly jobs = new Map<string, Job>()
  private readonly dir: string
  private readonly get: typeof fetch

  /** `dir` holds one folder per request. */
  constructor(dir: string, get: typeof fetch = fetch) {
    this.dir = dir
    this.get = get
  }

  folder(id: string) {
    return join(this.dir, id.replace(/[^\w-]/g, '_'))
  }

  async available(): Promise<{ ok: true }> {
    return { ok: true }
  }

  async add(job: { id: string; magnet?: string; url?: string; sizeBytes: number }): Promise<void> {
    if (!job.url || !/^https:\/\//.test(job.url)) throw new Error('This downloader only takes https addresses.')
    const now = this.jobs.get(job.id)
    if (now && now.state !== 'error' && now.state !== 'paused') return
    const folder = this.folder(job.id)
    await mkdir(folder, { recursive: true })
    const name = fileNameFrom(job.url)
    if (await stat(join(folder, name)).catch(() => null)) {
      this.jobs.set(job.id, { url: job.url, total: job.sizeBytes, got: job.sizeBytes, state: 'done', mark: { at: Date.now(), got: 0 }, speed: 0 })
      return
    }
    const part = join(folder, name + PART)
    const have = (await stat(part).catch(() => null))?.size ?? 0
    const j: Job = { url: job.url, total: job.sizeBytes, got: have, state: 'downloading', stop: new AbortController(), mark: { at: Date.now(), got: have }, speed: 0 }
    this.jobs.set(job.id, j)
    void this.run(j, part, join(folder, name), have)
  }

  private async run(j: Job, part: string, done: string, have: number) {
    try {
      const r = await this.get(j.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: j.stop!.signal, redirect: 'follow' })
      if (r.url && !r.url.startsWith('https://')) throw new Error('The download was sent somewhere that isn’t https, so Finesse stopped it.')
      if (!r.ok || !r.body) throw new Error(r.status === 404 ? 'The file isn’t at that address any more.' : `The download’s server answered ${r.status}.`)
      // A server that ignores "carry on from here" starts over.
      const carryOn = have > 0 && r.status === 206
      if (!carryOn) j.got = 0
      const length = Number(r.headers.get('content-length'))
      if (Number.isFinite(length) && length > 0) j.total = length + (carryOn ? have : 0)
      const out = createWriteStream(part, { flags: carryOn ? 'a' : 'w' })
      try {
        for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
          j.got += chunk.length
          if (!out.write(chunk)) await new Promise<void>((ok) => out.once('drain', ok))
        }
      } finally {
        await new Promise<void>((ok) => out.end(ok))
      }
      await rename(part, done)
      j.state = 'done'
    } catch (e) {
      if (j.state === 'paused') return
      j.state = 'error'
      j.reason = e instanceof Error && !/abort|terminated|fetch failed/i.test(e.message) ? e.message : 'The download was cut off. Try again: it carries on from where it stopped.'
    }
  }

  async status(id: string): Promise<DownloadStatus> {
    const j = this.jobs.get(id)
    const folder = this.folder(id)
    if (!j) {
      // After a restart: what's on disk says where it was.
      const names = await readdir(folder).catch(() => [] as string[])
      if (!names.length) return { state: 'missing', progress: 0 }
      return names.some((n) => n.endsWith(PART)) ? { state: 'paused', progress: 0 } : { state: 'done', progress: 100, folder }
    }
    const progress = j.total > 0 ? Math.min(100, Math.round((j.got / j.total) * 1000) / 10) : 0
    if (j.state === 'done') return { state: 'done', progress: 100, folder }
    if (j.state === 'error') return { state: 'error', progress, reason: j.reason }
    if (j.state === 'paused') return { state: 'paused', progress }
    const now = Date.now()
    if (now - j.mark.at >= 1000) {
      j.speed = Math.round(((j.got - j.mark.got) * 1000) / (now - j.mark.at))
      j.mark = { at: now, got: j.got }
    }
    return { state: 'downloading', progress, bytesPerSecond: j.speed, ...(j.speed > 0 && j.total > j.got ? { etaSeconds: Math.round((j.total - j.got) / j.speed) } : {}) }
  }

  async pause(id: string): Promise<void> {
    const j = this.jobs.get(id)
    if (!j || j.state !== 'downloading') return
    j.state = 'paused'
    j.stop?.abort()
  }

  async resume(id: string): Promise<void> {
    const j = this.jobs.get(id)
    if (j && (j.state === 'paused' || j.state === 'error')) await this.add({ id, url: j.url, sizeBytes: j.total })
  }

  async remove(id: string, opts: { files: boolean }): Promise<void> {
    const j = this.jobs.get(id)
    if (j) {
      j.state = 'paused'
      j.stop?.abort()
      this.jobs.delete(id)
    }
    if (opts.files) await rm(this.folder(id), { recursive: true, force: true })
  }
}
