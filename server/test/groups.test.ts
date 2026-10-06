import { gzipSync } from 'node:zlib'
// Groups: two Finesse servers, each with its own Jellyfin, pair with a code and
// one watches the other's shared libraries. Checks what gets through, that the
// sharing server's Jellyfin tokens never leave it, and that unpairing sticks.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { listen, tmp, webBuild } from './helpers.ts'

type User = { Id: string; Name: string; Password?: string; Policy: Record<string, unknown> }

/** A Jellyfin with users, sign-in, libraries, items, playback info and an HLS playlist. */
async function fakeJellyfin(serverName: string, people: { name: string; token: string; admin: boolean }[], serviceKey: string) {
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
    send(404)
  })
  const url = await listen(server)
  return { url, server, users, calls, libs, movie, failing, opts }
}

async function finesse(name: string, jf: { url: string }, serviceKey: string, publicUrl?: string) {
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

const H = (token?: string) => ({ 'Content-Type': 'application/json', Authorization: `MediaBrowser Client="test", Device="t", DeviceId="t", Version="1"${token ? `, Token="${token}"` : ''}` })

let jfA: Awaited<ReturnType<typeof fakeJellyfin>>
let jfB: Awaited<ReturnType<typeof fakeJellyfin>>
let A: Awaited<ReturnType<typeof finesse>>
let B: Awaited<ReturnType<typeof finesse>>
const servers: Server[] = []

before(async () => {
  jfA = await fakeJellyfin('Alex’s server', [{ name: 'alex', token: 'a-admin', admin: true }, { name: 'robin', token: 'a-robin', admin: false }], 'a-service')
  jfB = await fakeJellyfin('Sam’s server', [{ name: 'sam', token: 'b-admin', admin: true }, { name: 'kim', token: 'b-kim', admin: false }], 'b-service')
  B = await finesse('b', jfB, 'b-service')
  A = await finesse('a', jfA, 'a-service')
  servers.push(jfA.server, jfB.server, A.app, B.app)
})
after(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

const call = async (base: string, method: string, path: string, token?: string, body?: unknown) => {
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

const robinId = () => [...jfA.users.values()].find((u) => u.Name === 'robin')!.Id

test('pairing: Sam shares Movies with a code, Alex adds Sam’s server', async () => {
  // Only admins make codes and see the settings.
  assert.equal((await call(B.url, 'POST', '/api/groups/codes', 'b-kim', { libraries: [jfB.libs[0]!.Id] })).status, 403)
  const code = await call(B.url, 'POST', '/api/groups/codes', 'b-admin', { libraries: [jfB.libs[0]!.Id] })
  assert.equal(code.status, 201)
  assert.match(String(code.data.code), /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)

  const wrong = await call(A.url, 'POST', '/api/groups/friends', 'a-admin', { url: B.url, code: 'AAAA-BBBB-CCCC' })
  assert.equal(wrong.status, 404)
  assert.match(String(wrong.data.error), /code didn’t work/)

  const added = await call(A.url, 'POST', '/api/groups/friends', 'a-admin', { url: `${B.url}/finesse/`, code: String(code.data.code).toLowerCase() })
  assert.equal(added.status, 201, JSON.stringify(added.data))
  assert.equal(added.data.name, 'Sam’s server')
  // A code works once.
  assert.equal((await call(A.url, 'POST', '/api/groups/friends', 'a-admin', { url: B.url, code: code.data.code })).status, 404)

  const overview = await call(B.url, 'GET', '/api/groups', 'b-admin')
  const links = overview.data.links as { name: string; libraries: string[] }[]
  assert.equal(links.length, 1)
  assert.equal(links[0]!.name, 'Alex’s server')
  assert.deepEqual(links[0]!.libraries, [jfB.libs[0]!.Id])
  assert.doesNotMatch(overview.text, /secret/i)
  // Films, shows and music are offered; playlists (per person) aren't, and can't be shared by id either.
  assert.deepEqual((overview.data.libraries as { name: string }[]).map((l) => l.name), ['Movies', 'Shows', 'Private', 'Music'])
  assert.equal((await call(B.url, 'POST', '/api/groups/codes', 'b-admin', { libraries: ['f'.repeat(32)] })).status, 400)
  assert.equal((await call(B.url, 'POST', '/api/groups/codes', 'b-admin', { libraries: ['e'.repeat(32)] })).status, 201)
})

test('Robin browses Sam’s shared library through Alex’s server, and only that', async () => {
  const friends = await call(A.url, 'GET', '/api/groups/friends', 'a-robin')
  const f = (friends.data.friends as { id: string; name: string }[])[0]!
  assert.equal(f.name, 'Sam’s server')
  assert.doesNotMatch(friends.text, /secret|linkId/)
  const base = `/api/groups/friends/${f.id}/jellyfin`

  const views = await call(A.url, 'GET', `${base}/Users/${robinId()}/Views`, 'a-robin')
  assert.equal(views.status, 200, views.text)
  assert.deepEqual((views.data.Items as { Name: string }[]).map((v) => v.Name), ['Movies'])

  // Sam's Jellyfin now has a hidden, locked-down user for Robin.
  const viewer = [...jfB.users.values()].find((u) => u.Name.startsWith('robin @'))!
  assert.equal(viewer.Name, "robin @ Alex's server")
  assert.equal(viewer.Policy.IsHidden, true)
  assert.equal(viewer.Policy.IsAdministrator, false)
  assert.equal(viewer.Policy.EnableContentDownloading, false)
  assert.deepEqual(viewer.Policy.EnabledFolders, [jfB.libs[0]!.Id])

  // Whatever user id the app sends, Sam's server answers as Robin's viewer.
  const kimId = [...jfB.users.values()].find((u) => u.Name === 'kim')!.Id
  const asKim = await call(A.url, 'GET', `${base}/Users/${kimId}/Items?ParentId=${jfB.libs[0]!.Id}`, 'a-robin')
  assert.equal(asKim.status, 200)
  assert.equal(jfB.calls.at(-1)!.user, "robin @ Alex's server")
  // Where Sam keeps his files stays on Sam's server.
  assert.equal((asKim.data.Items as { Name: string }[])[0]!.Name, 'Sintel')
  assert.doesNotMatch(asKim.text, /sams-nas/)
  assert.match(jfB.calls.at(-1)!.path, new RegExp(viewer.Id))

  // Admin things, other endpoints and path tricks are refused.
  for (const [method, path] of [
    ['GET', '/Library/VirtualFolders'],
    ['POST', `/Users/${viewer.Id}/Policy`],
    ['GET', '/System/Configuration'],
    ['DELETE', `/Items/${jfB.movie}`],
    ['GET', `/Items/${jfB.movie}/../../Library/VirtualFolders`],
  ] as const) {
    const r = await call(A.url, method, `${base}${path}`, 'a-robin', method === 'POST' ? {} : undefined)
    assert.ok(r.status === 403 || r.status === 404, `${method} ${path} → ${r.status}`)
  }
  // Not signed in at Alex's: nothing.
  assert.equal((await call(A.url, 'GET', `${base}/Users/x/Views`)).status, 401)
})

test('playing: Sam’s Jellyfin token never reaches Robin; her own sign-in stands in', async () => {
  const f = ((await call(A.url, 'GET', '/api/groups/friends', 'a-robin')).data.friends as { id: string }[])[0]!
  const base = `/api/groups/friends/${f.id}/jellyfin`
  const info = await call(A.url, 'POST', `${base}/Items/${jfB.movie}/PlaybackInfo?UserId=x`, 'a-robin', {})
  assert.equal(info.status, 200, info.text)
  const turl = (info.data.MediaSources as { TranscodingUrl: string }[])[0]!.TranscodingUrl
  assert.match(turl, /ApiKey=a-robin$/)
  assert.doesNotMatch(info.text, /tok-/)
  // The playlist, fetched the way a browser does (token in the URL).
  const m3u8 = await fetch(`${A.url}${base}${turl}`)
  assert.equal(m3u8.status, 200)
  const text = await m3u8.text()
  assert.match(text, /main\.m3u8\?ApiKey=a-robin/)
  assert.doesNotMatch(text, /tok-/)
  // Binary media passes straight through.
  const video = await fetch(`${A.url}${base}/Videos/${jfB.movie}/stream.mp4?static=true&ApiKey=a-robin`)
  assert.equal(await video.text(), 'binary-video')
})

test('a compressed reply still has the token swapped out, never passed on', async () => {
  const f = ((await call(A.url, 'GET', '/api/groups/friends', 'a-robin')).data.friends as { id: string }[])[0]!
  jfB.opts.gzip = true
  try {
    const info = await call(A.url, 'POST', `/api/groups/friends/${f.id}/jellyfin/Items/${jfB.movie}/PlaybackInfo?UserId=x`, 'a-robin', {})
    assert.doesNotMatch(info.text, /tok-/)
    if (info.status === 200) assert.match(info.text, /ApiKey=a-robin/)
  } finally {
    jfB.opts.gzip = false
  }
})

test('a friend’s viewer can’t sign in to Sam’s own server as a household member', async () => {
  const viewer = [...jfB.users.values()].find((u) => u.Name.startsWith('robin @'))!
  // Even if its token were known, Sam's Finesse refuses it.
  const r = await fetch(`${jfB.url}/Users/AuthenticateByName`, { method: 'POST', headers: H(), body: JSON.stringify({ Username: viewer.Name, Pw: viewer.Password }) })
  const token = ((await r.json()) as { AccessToken: string }).AccessToken
  const me = await call(B.url, 'GET', '/api/groups/friends', token)
  assert.equal(me.status, 403)
  assert.match(String(me.data.error), /friend’s server/)
})

test('Sam changes what’s shared, then Alex offers to share back and Sam accepts', async () => {
  const links = (await call(B.url, 'GET', '/api/groups', 'b-admin')).data.links as { id: string }[]
  const upd = await call(B.url, 'PUT', `/api/groups/links/${links[0]!.id}`, 'b-admin', { libraries: [jfB.libs[0]!.Id, jfB.libs[1]!.Id] })
  assert.equal(upd.status, 200)
  const viewer = [...jfB.users.values()].find((u) => u.Name.startsWith('robin @'))!
  assert.deepEqual(viewer.Policy.EnabledFolders, [jfB.libs[0]!.Id, jfB.libs[1]!.Id])

  const f = ((await call(A.url, 'GET', '/api/groups', 'a-admin')).data.friends as { id: string }[])[0]!
  // Share-back needs Alex's public address, so Sam's server can reach Alex's.
  const noUrl = await call(A.url, 'POST', `/api/groups/friends/${f.id}/offer`, 'a-admin', { libraries: [jfA.libs[1]!.Id] })
  assert.equal(noUrl.status, 400)
  A.settings.update((s) => void (s.publicUrl = A.url))
  const offer = await call(A.url, 'POST', `/api/groups/friends/${f.id}/offer`, 'a-admin', { libraries: [jfA.libs[1]!.Id] })
  assert.equal(offer.status, 200, offer.text)
  const offers = (await call(B.url, 'GET', '/api/groups', 'b-admin')).data.offers as { id: string; name: string }[]
  assert.equal(offers[0]!.name, 'Alex’s server')
  const accepted = await call(B.url, 'POST', `/api/groups/offers/${offers[0]!.id}/accept`, 'b-admin')
  assert.equal(accepted.status, 201, accepted.text)
  assert.equal(accepted.data.name, 'Alex’s server')
  // Kim (on Sam's server) now sees Alex's Shows.
  const bf = ((await call(B.url, 'GET', '/api/groups/friends', 'b-kim')).data.friends as { id: string }[])[0]!
  const views = await call(B.url, 'GET', `/api/groups/friends/${bf.id}/jellyfin/Users/x/Views`, 'b-kim')
  assert.deepEqual((views.data.Items as { Name: string }[]).map((v) => v.Name), ['Shows'])
})

test('narrowing during a Jellyfin outage never leaves the old access in place', async () => {
  const links = (await call(B.url, 'GET', '/api/groups', 'b-admin')).data.links as { id: string }[]
  const f = ((await call(A.url, 'GET', '/api/groups/friends', 'a-robin')).data.friends as { id: string }[])[0]!
  // Robin has a viewer on Sam's server that sees Movies + Shows (the test above).
  const before = [...jfB.users.values()].find((u) => u.Name.startsWith('robin @'))!
  // Policy changes fail, but deleting works: the viewer is deleted instead; made again with today's list.
  jfB.failing.push(/^POST \/Users\/[^/]+\/Policy$/)
  const upd = await call(B.url, 'PUT', `/api/groups/links/${links[0]!.id}`, 'b-admin', { libraries: [jfB.libs[0]!.Id] })
  assert.equal(upd.status, 200, upd.text)
  assert.equal(jfB.users.has(before.Id), false)
  // Both fail: Sam is told, and Robin gets nothing until it's sorted.
  jfB.failing.length = 0
  await call(A.url, 'GET', `/api/groups/friends/${f.id}/jellyfin/Users/x/Views`, 'a-robin') // a fresh viewer
  jfB.failing.push(/^POST \/Users\/[^/]+\/Policy$/, /^DELETE \/Users\//)
  const bad = await call(B.url, 'PUT', `/api/groups/links/${links[0]!.id}`, 'b-admin', { libraries: [] })
  assert.equal(bad.status, 502)
  assert.match(String(bad.data.error), /can’t watch anything until it does/)
  const blocked = await call(A.url, 'GET', `/api/groups/friends/${f.id}/jellyfin/Users/x/Views`, 'a-robin')
  assert.notEqual(blocked.status, 200)
  // Jellyfin back: sharing Movies again un-pauses, and the leftover account is cleaned up.
  jfB.failing.length = 0
  assert.equal((await call(B.url, 'PUT', `/api/groups/links/${links[0]!.id}`, 'b-admin', { libraries: [jfB.libs[0]!.Id] })).status, 200)
  const views = await call(A.url, 'GET', `/api/groups/friends/${f.id}/jellyfin/Users/x/Views`, 'a-robin')
  assert.deepEqual((views.data.Items as { Name: string }[]).map((v) => v.Name), ['Movies'])
})

test('a request the allow-list refuses creates nothing on the friend’s server', async () => {
  const f = ((await call(A.url, 'GET', '/api/groups/friends', 'a-robin')).data.friends as { id: string }[])[0]!
  const count = jfB.users.size
  const r = await call(A.url, 'GET', `/api/groups/friends/${f.id}/jellyfin/System/Configuration`, 'a-kim-nobody')
  assert.notEqual(r.status, 200)
  const denied = await call(A.url, 'GET', `/api/groups/friends/${f.id}/jellyfin/System/Configuration`, 'a-robin')
  assert.equal(denied.status, 403)
  assert.equal(jfB.users.size, count)
})

test('unpairing: Sam stops sharing, Robin’s viewer is gone and access stops at once', async () => {
  const links = (await call(B.url, 'GET', '/api/groups', 'b-admin')).data.links as { id: string }[]
  const f = ((await call(A.url, 'GET', '/api/groups/friends', 'a-robin')).data.friends as { id: string }[])[0]!
  assert.equal((await call(B.url, 'DELETE', `/api/groups/links/${links[0]!.id}`, 'b-admin')).status, 200)
  assert.equal([...jfB.users.values()].some((u) => u.Name.startsWith('robin @')), false)
  const r = await call(A.url, 'GET', `/api/groups/friends/${f.id}/jellyfin/Users/x/Views`, 'a-robin')
  assert.equal(r.status, 401)
  assert.match(String(r.data.error), /isn’t shared with you/)
})

test('the allow-list: what the player needs, with every user id pinned', async () => {
  const { peerRequest } = await import('../src/groups.ts')
  const me = 'e'.repeat(32)
  const id = 'd'.repeat(32)
  const q = (s: string) => new URLSearchParams(s)
  const ok = (m: string, p: string, query = '') => peerRequest(m, p, q(query), me)
  for (const [m, p] of [
    ['GET', `Videos/${id}/hls1/main/0.ts`],
    ['GET', `videos/${id}/main.m3u8`],
    ['GET', `Videos/${id}/${id}/Subtitles/2/0/Stream.vtt`],
    ['GET', `Videos/${id}/${id}/Subtitles/2/subtitles.m3u8`],
    ['GET', `Videos/${id}/Trickplay/320/0.jpg`],
    ['GET', `Audio/${id}/universal`],
    ['GET', `Audio/${id}/Lyrics`],
    ['GET', `Audio/${id}/stream.mp3`],
    ['GET', `Items/${id}/Images/Primary`],
    ['GET', `Items/${id}/Images/Backdrop/0`],
    ['GET', `Shows/${id}/Episodes`],
    ['GET', `MediaSegments/${id}`],
    ['POST', `Items/${id}/PlaybackInfo`],
    ['POST', 'Sessions/Playing/Progress'],
    ['DELETE', 'Videos/ActiveEncodings'],
    ['POST', `Users/${id}/PlayedItems/${id}`],
    ['POST', `UserItems/${id}/UserData`],
  ] as const) assert.ok(ok(m, p), `${m} ${p} should be allowed`)
  for (const [m, p] of [
    ['GET', 'Library/VirtualFolders'],
    ['GET', 'Users'],
    ['POST', `Users/${id}/Policy`],
    ['POST', `Items/${id}`],
    ['DELETE', `Items/${id}`],
    ['GET', 'System/Logs'],
    ['GET', `Items/${id}/Download`],
    ['GET', `Items/%2e%2e/Library/VirtualFolders`],
    ['GET', 'Plugins'],
  ] as const) assert.equal(ok(m, p), null, `${m} ${p} should be refused`)
  // User ids in the path and query become the viewer's; the caller's own key is dropped.
  const r = ok('GET', `Users/${id}/Items`, `ParentId=${id}&userId=${id}&ApiKey=secret&api_key=secret`)!
  assert.equal(r.path, `Users/${me}/Items`)
  assert.equal(r.query.get('userId'), me)
  assert.equal(r.query.get('ApiKey'), null)
  assert.equal(r.query.get('api_key'), null)
})

test('a friend’s address over plain http only at home; across the internet it must be https', async () => {
  const { normalizeServerUrl } = await import('../src/groups.ts')
  assert.equal(normalizeServerUrl('sam.example.com'), 'https://sam.example.com')
  assert.equal(normalizeServerUrl('http://192.168.1.50:8080/finesse/'), 'http://192.168.1.50:8080')
  assert.equal(normalizeServerUrl('http://100.101.102.103:8080'), 'http://100.101.102.103:8080')
  assert.equal(normalizeServerUrl('http://nas.local:8080'), 'http://nas.local:8080')
  assert.throws(() => normalizeServerUrl('http://sam.example.com'), /https/)
  assert.throws(() => normalizeServerUrl('http://203.0.113.9:8080'), /https/)
})
