// In-app web update (port of the Python service's /v1/update): installs the
// latest GitHub release's web build. Files are copied INTO the served dir —
// hashed assets first, index.html / version.json swapped atomically last — so
// no browser ever loads a page whose assets aren't there yet, and tabs on the
// previous build can still lazy-load their old chunks.

import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Auth } from './auth.ts'
import type { SettingsStore } from './config.ts'
import { ApiError, sendJson, type Router } from './http/core.ts'
import { cmpVersion, type WebRoot } from './http/static.ts'
import { logger } from './log.ts'
import { readTar, TarError } from './tar.ts'

const log = logger('update')

const WEB_ASSET_RE = /^finesse-web-(\d+(?:\.\d+){1,3})\.tar\.gz$/
const MAX_WEB_BUNDLE = 200 * 1024 * 1024
const MAX_WEB_UNPACKED = 1024 * 1024 * 1024
const RELEASE_TTL = 300_000

export interface ReleaseAsset {
  name: string
  version: string
  apiUrl?: string
  downloadUrl?: string
  size: number
  digest?: string
}
export interface ReleaseInfo {
  version: string
  notes: string
  publishedAt: string | null
  asset: ReleaseAsset | null
  /** Every asset on the release, by name (the stack updater reads more of them). */
  assets: { name: string; apiUrl?: string; downloadUrl?: string; size: number; digest?: string }[]
}

/** Whole-app updates (bundle mode in Docker): a new Finesse image instead of just a web build. */
export interface ImageUpdater {
  /** The image to switch to for `version`, or null when this install can't update its image. */
  plan(version: string): Promise<string | null>
  run(image: string, onStep: (step: string) => void): Promise<void>
}

interface Job {
  state: 'idle' | 'running' | 'restarting' | 'done' | 'error'
  step: string | null
  message: string
  version: string | null
  finishedAt: string | null
}

export class GitHubReleases {
  private cache: { at: number; data: ReleaseInfo | null } = { at: 0, data: null }
  private settings: SettingsStore

  constructor(settings: SettingsStore) {
    this.settings = settings
  }

  private api(): string {
    return (process.env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, '')
  }

  headers(accept = 'application/vnd.github+json'): Record<string, string> {
    const h: Record<string, string> = { Accept: accept, 'User-Agent': 'finesse-updater' }
    const token = process.env.FINESSE_GITHUB_TOKEN?.trim()
    if (token) h.Authorization = `Bearer ${token}`
    return h
  }

  invalidate() {
    this.cache = { at: 0, data: null }
  }

  async latest(force = false): Promise<ReleaseInfo> {
    const now = Date.now()
    if (!force && this.cache.data && now - this.cache.at < RELEASE_TTL) return this.cache.data
    const repo = this.settings.get().updates.repo
    let res: Response
    try {
      res = await fetch(`${this.api()}/repos/${repo}/releases/latest`, { headers: this.headers(), signal: AbortSignal.timeout(20000) })
    } catch {
      throw new ApiError(502, "Couldn't reach GitHub")
    }
    if (!res.ok) throw new ApiError(502, `GitHub responded ${res.status}`)
    let rel: { tag_name?: string; body?: string; published_at?: string; assets?: { name: string; url?: string; browser_download_url?: string; size?: number; digest?: string }[] }
    try {
      rel = (await res.json()) as typeof rel
    } catch {
      throw new ApiError(502, "Couldn't reach GitHub")
    }
    const assets = (rel.assets ?? []).map((a) => ({ name: a.name, apiUrl: a.url, downloadUrl: a.browser_download_url, size: a.size ?? 0, digest: a.digest }))
    let asset: ReleaseAsset | null = null
    for (const a of assets) {
      const m = WEB_ASSET_RE.exec(a.name)
      if (m) {
        asset = { ...a, version: m[1]! }
        break
      }
    }
    const data: ReleaseInfo = {
      version: String(rel.tag_name ?? '').replace(/^v/, ''),
      notes: rel.body ?? '',
      publishedAt: rel.published_at ?? null,
      asset,
      assets,
    }
    this.cache = { at: now, data }
    return data
  }

  /** Downloads a release asset (size-capped, digest-checked) into memory. */
  async download(a: { apiUrl?: string; downloadUrl?: string; size: number; digest?: string }, maxBytes: number): Promise<Buffer> {
    const token = process.env.FINESSE_GITHUB_TOKEN?.trim()
    const url = token && a.apiUrl ? a.apiUrl : a.downloadUrl
    if (!url) throw new ApiError(502, 'Release asset has no download link')
    let res: Response
    try {
      res = await fetch(url, { headers: this.headers('application/octet-stream'), redirect: 'follow', signal: AbortSignal.timeout(600000) })
    } catch {
      throw new ApiError(502, "Download failed (couldn't reach GitHub)")
    }
    if (!res.ok || !res.body) throw new ApiError(502, `Download failed (GitHub responded ${res.status})`)
    const sha = createHash('sha256')
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length
      if (total > maxBytes) throw new ApiError(413, 'Release download is unexpectedly large')
      sha.update(chunk)
      chunks.push(Buffer.from(chunk))
    }
    if (a.size && total !== a.size) throw new ApiError(502, 'Download was incomplete')
    if (a.digest?.startsWith('sha256:') && a.digest.slice(7).toLowerCase() !== sha.digest('hex')) {
      throw new ApiError(502, "Download didn't match the release checksum")
    }
    return Buffer.concat(chunks)
  }
}

/** Unpacks + validates a web build; returns its files (index.html + version.json required). */
export function unpackWebBuild(bundle: Buffer, version: string) {
  let files
  try {
    files = readTar(bundle, { maxUnpacked: MAX_WEB_UNPACKED })
  } catch (e) {
    if (e instanceof TarError) throw new ApiError(/large/.test(e.message) ? 413 : 422, e.message)
    throw e
  }
  const byPath = new Map(files.map((f) => [f.path, f.data]))
  if (!byPath.has('index.html') || !byPath.has('version.json')) throw new ApiError(422, "The release's web build is missing index.html or version.json")
  let built: unknown
  try {
    built = JSON.parse(byPath.get('version.json')!.toString('utf8')).version
  } catch {
    throw new ApiError(422, "The release's version.json is unreadable")
  }
  if (built !== version) throw new ApiError(422, `The release says ${version} but its build is ${String(built)}`)
  return files
}

/** Copies a build into `dest`: assets first, entry points atomically last. */
export function installWebBuild(files: { path: string; data: Buffer }[], dest: string) {
  mkdirSync(dest, { recursive: true })
  const stage = mkdtempSync(join(tmpdir(), 'finesse-web-'))
  try {
    const last = new Set(['index.html', 'version.json'])
    const ordered = [...files.filter((f) => !last.has(f.path)), ...files.filter((f) => last.has(f.path))]
    for (const f of ordered) {
      const target = join(dest, ...f.path.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      if (last.has(f.path)) {
        const tmp = join(dirname(target), `.${f.path}.new`)
        writeFileSync(tmp, f.data)
        renameSync(tmp, target)
      } else {
        // Content-only copy via a staged file (NFSv4 ACL datasets refuse chmod).
        const staged = join(stage, 'f')
        writeFileSync(staged, f.data)
        copyFileSync(staged, target)
      }
    }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

export class WebUpdater {
  private job: Job = { state: 'idle', step: null, message: '', version: null, finishedAt: null }
  private web: WebRoot
  private gh: GitHubReleases
  image: ImageUpdater | null = null
  private serverVersion: string

  constructor(web: WebRoot, gh: GitHubReleases, serverVersion = '0.0.0') {
    this.web = web
    this.gh = gh
    this.serverVersion = serverVersion
  }

  /** `check`: ask GitHub now instead of answering from the 5-minute cache (an admin pressed Check). */
  async status(check = false) {
    const current = this.web.current().version
    const out: Record<string, unknown> = { current, server: this.serverVersion, kind: 'web', ...this.job }
    try {
      const rel = await this.gh.latest(check)
      out.latest = rel.version
      out.notes = rel.notes
      out.publishedAt = rel.publishedAt
      const image = rel.version && this.image ? await this.image.plan(rel.version).catch(() => null) : null
      if (image) {
        // The whole app (server + web + app versions) moves together.
        out.kind = 'app'
        out.available = cmpVersion(rel.version, this.serverVersion) > 0 || (current !== null && cmpVersion(rel.version, current) > 0)
      } else {
        out.available = Boolean(rel.asset) && (current === null || cmpVersion(rel.asset!.version, current) > 0)
      }
    } catch (e) {
      out.latest = null
      out.available = false
      out.error = e instanceof ApiError ? e.message : String(e)
    }
    return out
  }

  start() {
    if (this.job.state === 'running' || this.job.state === 'restarting') throw new ApiError(409, 'An update is already running')
    this.job = { state: 'running', step: 'checking', message: '', version: null, finishedAt: null }
    void this.run()
    return { state: 'running' }
  }

  private async run() {
    try {
      const rel = await this.gh.latest(true)
      const image = rel.version && this.image ? await this.image.plan(rel.version) : null
      if (image) {
        this.job.version = rel.version
        await this.image!.run(image, (step) => (this.job.step = step))
        this.job = { state: 'restarting', step: 'restarting', message: `Finesse is restarting on ${rel.version}…`, version: rel.version, finishedAt: null }
        return
      }
      const asset = rel.asset
      if (!asset) throw new ApiError(404, `Release ${rel.version || '(none)'} has no web build to install`)
      this.job.step = 'downloading'
      this.job.version = asset.version
      const bundle = await this.gh.download(asset, MAX_WEB_BUNDLE)
      this.job.step = 'verifying'
      const files = unpackWebBuild(bundle, asset.version)
      this.job.step = 'installing'
      installWebBuild(files, this.web.installDir())
      this.web.refresh()
      this.gh.invalidate()
      this.job = { state: 'done', step: null, message: `Finesse ${asset.version} is live`, version: asset.version, finishedAt: new Date().toISOString() }
      log.info(`installed web build ${asset.version} into ${this.web.installDir()}`)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : `${(e as Error).name}: ${(e as Error).message}`
      if (!(e instanceof ApiError)) log.error('web update failed', e)
      this.job = { ...this.job, state: 'error', step: null, message: msg, finishedAt: new Date().toISOString() }
    }
  }
}

export function registerWebUpdate(router: Router, deps: { auth: Auth; updater: WebUpdater }) {
  const { auth, updater } = deps
  router.get('/invite-api/v1/update', async ({ req, res, url }) => {
    await auth.requireAdmin(req)
    sendJson(res, 200, await updater.status(url.searchParams.has('check')))
  })
  router.post('/invite-api/v1/update', async ({ req, res }) => {
    await auth.requireAdmin(req)
    sendJson(res, 202, updater.start())
  })
}
