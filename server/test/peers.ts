// Two Finesse servers, each with its own (fake) Jellyfin: shared by the Groups and Moments tests.

import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { listen, tmp, webBuild } from './helpers.ts'

type User = { Id: string; Name: string; Password?: string; Policy: Record<string, unknown> }

/** A Jellyfin with users, sign-in, libraries, items, playback info and an HLS playlist. */
export async function fakeJellyfin(serverName: string, people: { name: string; token: string; admin: boolean }[], serviceKey: string) {
  const users = new Map<string, User>()
  const tokens = new Map<string, string>()
  const calls: { method: string; path: string; user: string }[] = []
  for (const p of people) {
    const id = randomUUID().replace(/-/g, '')
    users.set(id, { Id: id, Name: p.name, Policy: { IsAdministrator: p.admin } })
    tokens.set(p.token, id)
  }
  const adminId = [...users.values()].find((u) => u.Policy.IsAdministrator)!.Id
  tokens.set(serviceKey, adminId)
  const libs = [
    { Id: 'a'.repeat(32), Name: 'Movies', CollectionType: 'movies' },
    { Id: 'b'.repeat(32), Name: 'Shows', CollectionType: 'tvshows' },
    { Id: 'c'.repeat(32), Name: 'Private', CollectionType: 'movies' },
    { Id: 'e'.repeat(32), Name: 'Music', CollectionType: 'music' },
    { Id: 'f'.repeat(32), Name: 'Playlists', CollectionType: 'playlists' },
  ]
  const movie = 'd'.repeat(32)
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const t = Buffer.concat(chunks).toString()
    return t ? JSON.parse(t) : {}
  }
  // Like Jellyfin 12: the Authorization header or ApiKey in the URL, nothing legacy (X-Emby-Token, api_key).
  const tokenOf = (req: IncomingMessage, url: URL) => /Token="([^"]+)"/.exec(String(req.headers.authorization ?? ''))?.[1] || url.searchParams.get('ApiKey') || ''
  /** Calls that fail with 503 ("METHOD /path" patterns), to play out a Jellyfin outage. */
  const failing: RegExp[] = []
  const opts = { gzip: false }
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const p = url.pathname
    if (failing.some((f) => f.test(`${req.method} ${p}`))) {
      res.writeHead(503)
      return void res.end()
    }
    const send = (status: number, data?: unknown, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type })
      res.end(data === undefined ? '' : typeof data === 'string' && type !== 'application/json' ? data : JSON.stringify(data))
    }
    if (p === '/System/Info/Public') return send(200, { ServerName: serverName, Version: '12.1.0' })
    if (p === '/Users/AuthenticateByName' && req.method === 'POST') {
      const b = await read(req)
      const u = [...users.values()].find((x) => x.Name === b.Username && x.Password && x.Password === b.Pw)
      if (!u) return send(401)
      const t = `tok-${randomUUID()}`
      tokens.set(t, u.Id)
      return send(200, { AccessToken: t, User: u })
    }
    const tok = tokenOf(req, url)
    const me = users.get(tokens.get(tok) ?? '')
    calls.push({ method: req.method ?? '', path: p, user: me?.Name ?? '-' })
    if (!me) return send(401)
    if (p === '/Users/Me') return send(200, me)
    const admin = me.Policy.IsAdministrator === true
    if (p === '/Library/MediaFolders') return send(200, { Items: libs })
    if (p === '/Library/VirtualFolders') return admin ? send(200, libs) : send(403)
    if (p === '/Users/New' && req.method === 'POST') {
      if (!admin) return send(403)
      const b = await read(req)
      // Jellyfin's own rule for user names.
      if (!/^(?!\s)[\w \-'._@+]+(?<!\s)$/.test(String(b.Name))) return send(400, 'Usernames can contain letters, numbers, spaces and -\'._@+')
      if ([...users.values()].some((u) => u.Name === b.Name)) return send(400, 'exists')
      const u: User = { Id: randomUUID().replace(/-/g, ''), Name: String(b.Name), Policy: { IsAdministrator: false } }
      users.set(u.Id, u)
      return send(200, u)
    }
    let m = /^\/Users\/([0-9a-f]{32})(\/Password|\/Policy|\/Views|\/Items)?$/.exec(p)
    if (m) {
      const u = users.get(m[1]!)
      if (!u) return send(404)
      if (m[2] === '/Password' && admin) return (u.Password = (await read(req)).NewPw), send(204)
      if (m[2] === '/Policy' && admin) return (u.Policy = await read(req)), send(204)
      if (m[2] === '/Views' || m[2] === '/Items') {
        if (me.Id !== u.Id && !admin) return send(403)
        const allowed = u.Policy.EnableAllFolders === false ? (u.Policy.EnabledFolders as string[]) : libs.map((l) => l.Id)
        if (m[2] === '/Views') return send(200, { Items: libs.filter((l) => allowed.includes(l.Id)) })
        const parent = url.searchParams.get('ParentId')
        if (parent && !allowed.includes(parent)) return send(200, { Items: [], TotalRecordCount: 0 })
        return send(200, { Items: [{ Id: movie, Name: 'Sintel', ParentId: libs[0]!.Id, Type: 'Movie', Path: '/mnt/sams-nas/movies/Sintel.mkv', MediaSources: [{ Id: movie, Path: '/mnt/sams-nas/movies/Sintel.mkv' }] }], TotalRecordCount: 1 })
      }
      if (!m[2] && req.method === 'DELETE' && admin) return users.delete(u.Id), send(204)
      if (!m[2]) return send(200, u)
      return send(403)
    }
    if (p === `/Items/${movie}/PlaybackInfo` && req.method === 'POST' && opts.gzip) {
      // A server that compresses anyway, whatever Finesse asked for.
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
      return void res.end(gzipSync(JSON.stringify({ MediaSources: [{ Id: movie, TranscodingUrl: `/videos/${movie}/master.m3u8?ApiKey=${tok}` }] })))
    }
    if (p === `/Items/${movie}/PlaybackInfo` && req.method === 'POST') {
      return send(200, { MediaSources: [{ Id: movie, TranscodingUrl: `/videos/${movie}/master.m3u8?MediaSourceId=${movie}&ApiKey=${tok}` }], PlaySessionId: 'ps1' })
    }
    if (p === `/videos/${movie}/master.m3u8`) return send(200, `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmain.m3u8?ApiKey=${tok}\n`, 'application/vnd.apple.mpegurl')
    if (p === `/Videos/${movie}/stream.mp4`) return send(200, 'binary-video', 'video/mp4')
    // For Moments: people, a title's details and the library it's in.
    if (p === '/Users' && req.method === 'GET') return admin ? send(200, [...users.values()]) : send(403)
    // Like Jellyfin: /Items/{id} wants a user; list queries (Ids, ParentId) work with the server's key.
    if (p === '/Items' && req.method === 'GET') {
      const ids = (url.searchParams.get('Ids') ?? '').split(',')
      const parent = url.searchParams.get('ParentId')
      const hit = ids.includes(movie) && (!parent || parent === libs[0]!.Id)
      return send(200, { Items: hit ? [{ Id: movie, Name: 'Sintel', Type: 'Movie', ProductionYear: 2010 }] : [], TotalRecordCount: hit ? 1 : 0 })
    }
    send(404)
  })
  const url = await listen(server)
  return { url, server, users, calls, libs, movie, failing, opts }
}

export async function finesse(name: string, jf: { url: string }, serviceKey: string, publicUrl?: string) {
  const dir = tmp()
  const config = join(dir, 'config')
  mkdirSync(config, { recursive: true })
  for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
    mkdirSync(join(dir, 'web', rel, '..'), { recursive: true })
    writeFileSync(join(dir, 'web', rel), c)
  }
  writeFileSync(
    join(config, 'finesse.json'),
    JSON.stringify({ version: 1, instanceId: `${name}-${randomUUID()}`, mode: 'adopt', setup: { state: 'ready' }, jellyfin: { url: jf.url, apiKey: serviceKey, basePath: '' }, ...(publicUrl ? { publicUrl } : {}) }),
  )
  const paths = { configDir: config, settingsFile: join(config, 'finesse.json'), invitesDb: join(config, 'invites.db'), bakedWeb: join(dir, 'web'), updatedWeb: join(config, 'web'), previews: join(config, 'previews'), backups: join(config, 'backups') }
  const { createApp } = await import('../src/app.ts')
  const app = createApp({ paths })
  return { app: app.server, settings: app.deps.settings, url: await listen(app.server) }
}

export const H = (token?: string) => ({ 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="test", Device="t", DeviceId="t", Version="1"${token ? `, Token="${token}"` : ''}` })


export const call = async (base: string, method: string, path: string, token?: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { method, headers: H(token), body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let data: unknown = text
  try {
    data = JSON.parse(text)
  } catch {
    /* text */
  }
  return { status: r.status, data: data as Record<string, unknown> & { error?: string }, text, type: r.headers.get('content-type') ?? '' }
}
