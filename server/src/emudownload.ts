// Downloads the pinned emulators (emucatalog.ts) into a folder Finesse owns.
//
// - Resumable: a partial file stays as <file>.part and continues with a Range
//   request next time (a server that ignores Range starts it over).
// - Checked: the whole file's sha256 and size must match the pin, or it's deleted.
// - Idempotent: a file whose pin is already in the folder's manifest isn't
//   fetched again. A newer pin than the file there is "an update", fetched only
//   when someone asks (Settings, or setup).
// - Made executable, then moved into place, so the emulators never see half a file.

import { createHash } from 'node:crypto'
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { EMULATOR_PINS, pinFor, type InstallId, type PinnedEmulator } from './emucatalog.ts'
import { logger } from './log.ts'

const log = logger('emulators')

export type DownloadState = 'missing' | 'queued' | 'downloading' | 'checking' | 'ready' | 'update' | 'failed'

export interface DownloadStatus {
  id: InstallId
  state: DownloadState
  /** Bytes so far (downloading), and the whole file. */
  received: number
  size: number
  /** Plain words, when it failed. */
  error: string | null
  /** The version in the folder, when it's an older pin. */
  installed: string | null
}

interface Manifest {
  [id: string]: { file: string; sha256: string; version: string }
}

const MANIFEST = 'finesse-emulators.json'

export class EmulatorDownloads {
  readonly dir: string
  private readonly pins: PinnedEmulator[]
  private running = new Map<InstallId, { received: number; state: 'queued' | 'downloading' | 'checking' }>()
  private failed = new Map<InstallId, string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(dir: string, pins: PinnedEmulator[] = EMULATOR_PINS) {
    this.dir = dir
    this.pins = pins
  }

  private pin(id: InstallId) {
    return this.pins.find((p) => p.id === id) ?? pinFor(id)
  }

  private manifest(): Manifest {
    try {
      return JSON.parse(readFileSync(join(this.dir, MANIFEST), 'utf8')) as Manifest
    } catch {
      return {}
    }
  }

  private saveManifest(m: Manifest) {
    const tmp = join(this.dir, `.${MANIFEST}.tmp`)
    writeFileSync(tmp, JSON.stringify(m, null, 2))
    renameSync(tmp, join(this.dir, MANIFEST))
  }

  status(id: InstallId): DownloadStatus {
    const p = this.pin(id)
    const base = { id, size: p.size, received: 0, error: null, installed: null }
    const run = this.running.get(id)
    if (run) return { ...base, state: run.state, received: run.received }
    const m = this.manifest()[id]
    const here = m && existsSync(join(this.dir, m.file))
    if (here && m.sha256 === p.sha256) return { ...base, state: 'ready', received: p.size }
    const failed = this.failed.get(id)
    if (failed) return { ...base, state: 'failed', error: failed, installed: here ? m.version : null }
    if (here) return { ...base, state: 'update', installed: m.version }
    return { ...base, state: 'missing' }
  }

  all(): DownloadStatus[] {
    return this.pins.map((p) => this.status(p.id))
  }

  /**
   * Downloads these (one at a time) unless they're already here; resolves when all are done or
   * failed. Never throws. An older version counts as here: only `update` (someone asked) fetches
   * the newer pin.
   */
  ensure(ids: InstallId[], opts: { update?: boolean } = {}): Promise<void> {
    const todo = ids.filter((id) => {
      if (this.running.has(id)) return false
      const st = this.status(id)
      if (st.state === 'ready') return false
      if (st.state === 'update' || (st.state === 'failed' && st.installed)) return Boolean(opts.update)
      return true
    })
    for (const id of todo) {
      this.failed.delete(id)
      this.running.set(id, { received: 0, state: 'queued' })
    }
    const mine = todo.map((id) => (this.queue = this.queue.then(() => this.fetch(id))))
    return Promise.all(mine).then(() => undefined)
  }

  /** Why it can't be removed right now (it's downloading or being checked), or null. */
  busy(id: InstallId): string | null {
    const st = this.running.get(id)?.state
    if (st === 'downloading') return `${this.pin(id).name} is downloading; try again when it’s done`
    if (st === 'checking') return `Finesse is checking the ${this.pin(id).name} download; try again in a moment`
    return null
  }

  /** Deletes an emulator's files (any version, and a partial download). */
  remove(id: InstallId) {
    const busy = this.busy(id)
    if (busy) throw new Error(busy)
    this.running.delete(id)
    this.failed.delete(id)
    const m = this.manifest()
    const old = m[id]
    for (const f of [old?.file, this.pin(id).file, `${this.pin(id).file}.part`]) if (f) rmSync(join(this.dir, f), { force: true })
    if (old) {
      delete m[id]
      this.saveManifest(m)
    }
  }

  private async fetch(id: InstallId) {
    const p = this.pin(id)
    const run = this.running.get(id)
    if (!run) return
    try {
      mkdirSync(this.dir, { recursive: true })
      const part = join(this.dir, `${p.file}.part`)
      run.state = 'downloading'
      await download(p.url, part, p.size, (n) => (run.received = n))
      run.state = 'checking'
      const sum = await sha256(part)
      const size = statSync(part).size
      if (sum !== p.sha256 || size !== p.size) {
        rmSync(part, { force: true })
        throw new Error(`The download didn’t match ${p.name} ${p.version} (its checksum is wrong), so Finesse deleted it. Try again later.`)
      }
      chmodSync(part, 0o755)
      renameSync(part, join(this.dir, p.file))
      const m = this.manifest()
      const old = m[id]
      if (old && old.file !== p.file) rmSync(join(this.dir, old.file), { force: true })
      m[id] = { file: p.file, sha256: p.sha256, version: p.version }
      this.saveManifest(m)
      log.info(`${p.name} ${p.version} downloaded and checked`)
    } catch (e) {
      const why = plain(e as Error, p)
      this.failed.set(id, why)
      log.warn(`${p.name}: ${why}`)
    } finally {
      this.running.delete(id)
    }
  }
}

function plain(e: Error, p: PinnedEmulator): string {
  if (/checksum/.test(e.message)) return e.message
  const code = (e.cause as { code?: string } | undefined)?.code ?? (e as { code?: string }).code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Can’t reach ${new URL(p.url).host}. Check the server’s internet connection; the download picks up where it stopped.`
  if (code === 'ENOSPC') return 'The disk is full. Free some space, then try again.'
  if (/^HTTP \d+/.test(e.message)) return `${new URL(p.url).host} answered ${e.message.slice(5)}. Try again later; the download picks up where it stopped.`
  return `The download stopped (${e.message}). Try again; it picks up where it stopped.`
}

/** Fetches url into `part`, continuing a partial file with a Range request. */
export async function download(url: string, part: string, size: number, progress: (received: number) => void, timeoutMs = 30 * 60_000): Promise<void> {
  let have = existsSync(part) ? statSync(part).size : 0
  if (have > size) {
    rmSync(part, { force: true })
    have = 0
  }
  if (have === size) return progress(have)
  const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  if (res.status === 200) have = 0
  else if (res.status !== 206) throw new Error(`HTTP ${res.status}`)
  if (!res.body) throw new Error('no answer')
  progress(have)
  const count = new Transform({
    transform(chunk: Buffer, _enc, done) {
      have += chunk.length
      progress(have)
      done(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), count, createWriteStream(part, { flags: res.status === 206 ? 'a' : 'w' }))
}

export async function sha256(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}
