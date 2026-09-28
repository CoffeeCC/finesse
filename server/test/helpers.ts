// Test fixtures: a fake Jellyfin, a fake GitHub releases API, release
// tarballs (good and malicious), and a way to boot either invite-service
// implementation (the Python original or the Node port) against them.

import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const ADMIN_TOKEN = 'admin-token-1'
export const USER_TOKEN = 'user-token-1'
export const API_KEY = 'service-api-key-1'

export function tmp(prefix = 'finesse-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function tokenOf(req: IncomingMessage): string | null {
  const direct = req.headers['x-emby-token']
  if (typeof direct === 'string') return direct
  const auth = String(req.headers.authorization ?? req.headers['x-emby-authorization'] ?? '')
  const m = /Token="([^"]+)"/.exec(auth)
  return m ? m[1]! : null
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString()
  return raw ? JSON.parse(raw) : {}
}

export interface FakeJellyfin {
  url: string
  server: Server
  users: Map<string, { Id: string; Name: string; Password?: string; Policy: Record<string, unknown> }>
  calls: string[]
  close(): Promise<void>
}

/** Just enough Jellyfin for invites + auth. */
export async function fakeJellyfin(): Promise<FakeJellyfin> {
  const users = new Map<string, { Id: string; Name: string; Password?: string; Policy: Record<string, unknown> }>()
  users.set('admin-id', { Id: 'admin-id', Name: 'Admin', Policy: { IsAdministrator: true } })
  users.set('user-id', { Id: 'user-id', Name: 'Viewer', Policy: { IsAdministrator: false } })
  const tokens: Record<string, string> = { [ADMIN_TOKEN]: 'admin-id', [USER_TOKEN]: 'user-id', [API_KEY]: 'admin-id' }
  const calls: string[] = []
  const send = (res: ServerResponse, status: number, data?: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(data === undefined ? '' : JSON.stringify(data))
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const p = url.pathname
    calls.push(`${req.method} ${p}`)
    const tok = tokenOf(req)
    const me = tok ? users.get(tokens[tok] ?? '') : undefined
    if (p === '/System/Info/Public') return send(res, 200, { ServerName: 'Fake', Version: '10.10.0', Id: 'fake' })
    if (!me) return send(res, 401, { error: 'unauthorized' })
    if (p === '/Users/Me') return send(res, 200, me)
    if (p === '/Library/MediaFolders') return send(res, 200, { Items: [{ Id: 'lib-movies', Name: 'Movies' }, { Id: 'lib-shows', Name: 'Shows' }] })
    if (p === '/Users/New' && req.method === 'POST') {
      const b = await body(req)
      const name = String(b.Name)
      if ([...users.values()].some((u) => u.Name.toLowerCase() === name.toLowerCase())) return send(res, 400, 'User exists')
      const u = { Id: randomUUID().replace(/-/g, ''), Name: name, Policy: { IsAdministrator: false, IsHidden: true, EnableAllFolders: true } }
      users.set(u.Id, u)
      return send(res, 200, u)
    }
    let m = /^\/Users\/([^/]+)\/Password$/.exec(p)
    if (m && req.method === 'POST') {
      const u = users.get(m[1]!)
      if (!u) return send(res, 404)
      u.Password = String((await body(req)).NewPw)
      return send(res, 204)
    }
    m = /^\/Users\/([^/]+)\/Policy$/.exec(p)
    if (m && req.method === 'POST') {
      const u = users.get(m[1]!)
      if (!u) return send(res, 404)
      u.Policy = await body(req)
      return send(res, 204)
    }
    m = /^\/Users\/([^/]+)$/.exec(p)
    if (m) {
      const u = users.get(m[1]!)
      if (!u) return send(res, 404)
      if (req.method === 'DELETE') {
        users.delete(u.Id)
        return send(res, 204)
      }
      return send(res, 200, u)
    }
    send(res, 404, { error: `fake jellyfin: ${p}` })
  })
  const url = await listen(server)
  return { url, server, users, calls, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()) }) }
}

/** Builds a web-release tarball from a map of files (real GNU tar). */
export function makeTarball(files: Record<string, string>, opts: { symlink?: [string, string]; transform?: string } = {}): Buffer {
  const dir = tmp('finesse-tar-')
  for (const [rel, content] of Object.entries(files)) {
    const f = join(dir, rel)
    mkdirSync(join(f, '..'), { recursive: true })
    writeFileSync(f, content)
  }
  if (opts.symlink) symlinkSync(opts.symlink[1], join(dir, opts.symlink[0]))
  const out = join(tmp('finesse-tarout-'), 'bundle.tar.gz')
  const args = ['-C', dir, '-czf', out]
  if (opts.transform) args.push(`--transform=${opts.transform}`)
  args.push('.')
  execFileSync('tar', args)
  return readFileSync(out)
}

export function webBuild(version: string): Record<string, string> {
  return {
    'index.html': `<!doctype html><title>Finesse ${version}</title><script src="/finesse/assets/app-${version}.js"></script>`,
    'version.json': JSON.stringify({ version }),
    [`assets/app-${version}.js`]: `console.log("finesse ${version}")`,
  }
}

export interface FakeGitHub {
  url: string
  /** Set what /releases/latest returns. */
  release(version: string, asset: Buffer | null, opts?: { digest?: string; assetVersion?: string }): void
  close(): Promise<void>
}

export async function fakeGitHub(): Promise<FakeGitHub> {
  let current: { version: string; asset: Buffer | null; digest?: string; assetVersion?: string } = { version: '0.0.0', asset: null }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname.endsWith('/releases/latest')) {
      const base = `http://${req.headers.host}`
      const name = `finesse-web-${current.assetVersion ?? current.version}.tar.gz`
      const assets = current.asset
        ? [
            {
              name,
              url: `${base}/asset/${name}`,
              browser_download_url: `${base}/download/${name}`,
              size: current.asset.length,
              digest: current.digest ?? `sha256:${createHash('sha256').update(current.asset).digest('hex')}`,
            },
          ]
        : []
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ tag_name: `v${current.version}`, body: `Notes for ${current.version}`, published_at: '2026-09-27T00:00:00Z', assets }))
    }
    if ((url.pathname.startsWith('/download/') || url.pathname.startsWith('/asset/')) && current.asset) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(current.asset.length) })
      return res.end(current.asset)
    }
    res.writeHead(404)
    res.end()
  })
  const url = await listen(server)
  return {
    url,
    release(version, asset, opts = {}) {
      current = { version, asset, ...opts }
    },
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()) }),
  }
}

export interface InviteTarget {
  kind: 'python' | 'node'
  /** Base for invite routes: …/v1/… */
  base: string
  dist: string
  stop(): Promise<void>
}

async function waitFor(url: string, ms = 10000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out waiting for ${url}`)
}

/** Boots the invite service under test (CONTRACT_TARGET=python|node). */
export async function startInviteTarget(jfUrl: string, ghUrl: string): Promise<InviteTarget> {
  const kind = (process.env.CONTRACT_TARGET === 'python' ? 'python' : 'node') as 'python' | 'node'
  const work = tmp()
  const dist = join(work, 'dist')
  mkdirSync(dist, { recursive: true })
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(dist, rel, '..'), { recursive: true })
    writeFileSync(join(dist, rel), c)
  }
  const env = {
    ...process.env,
    JELLYFIN_URL: jfUrl,
    JELLYFIN_API_KEY: API_KEY,
    INVITES_DB: join(work, 'invites.db'),
    FINESSE_DIST: dist,
    GITHUB_API: ghUrl,
    FINESSE_REPO: 'owner/finesse',
    FINESSE_CONFIG_DIR: join(work, 'config'),
    FINESSE_WEB_DIR: join(work, 'baked'),
  }
  if (kind === 'python') {
    const port = 30000 + Math.floor(Math.random() * 20000)
    const proc: ChildProcess = spawn('python3', ['deploy/invite-service/server.py'], {
      env: { ...env, INVITE_PORT: String(port), INVITE_LISTEN: '127.0.0.1' },
      stdio: 'ignore',
    })
    const base = `http://127.0.0.1:${port}`
    await waitFor(`${base}/health`)
    return { kind, base, dist, stop: async () => void proc.kill() }
  }
  // Node: in-process (each test file runs in its own process, so setting
  // the environment here doesn't leak between files).
  Object.assign(process.env, env)
  const { createApp } = await import('../src/app.ts')
  const { server } = createApp()
  const url = await listen(server)
  return { kind, base: `${url}/invite-api`, dist, stop: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()) }) }
}

export const auth = (token: string) => ({ Authorization: `MediaBrowser Client="test", Device="t", DeviceId="t", Version="1", Token="${token}"` })
