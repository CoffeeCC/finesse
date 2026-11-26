import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { artistAlbums, lidarrCaller, requestAlbum, type LidarrCall } from '../src/albumRequests.ts'
import { createApp } from '../src/app.ts'
import { ApiError } from '../src/http/core.ts'
import { actionBody, addAllowed, arrVerdict, commandAllowed, sabAllowed } from '../src/policy.ts'
import { requestAppJson, requestConfig, validateDefault } from '../src/requestDefaults.ts'
import { ADMIN_TOKEN, USER_TOKEN, fakeJellyfin, listen, tmp } from './helpers.ts'

const ROOT = '/media/movies'
const ARTIST = 'aaaaaaaa-0000-4000-8000-000000000001'
const ALBUM = 'bbbbbbbb-0000-4000-8000-000000000001'
const hasStatus = (status: number) => (e: unknown) => e instanceof ApiError && e.status === status

function stop(server: Server) {
  return new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

async function upstream(t: TestContext, listener: RequestListener) {
  const server = createServer(listener)
  const url = await listen(server)
  t.after(() => stop(server))
  return url
}

async function app(t: TestContext) {
  const dir = tmp()
  const jf = await fakeJellyfin()
  const { server, deps } = createApp({ paths: {
    configDir: dir, settingsFile: join(dir, 'finesse.json'), invitesDb: join(dir, 'invites.db'),
    bakedWeb: dir, updatedWeb: dir, previews: dir, backups: dir,
  } })
  deps.settings.update((s) => { s.jellyfin = { url: jf.url, basePath: '' } })
  const url = await listen(server)
  t.after(async () => {
    await stop(server)
    await jf.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return {
    settings: deps.settings,
    call(path: string, method = 'GET', body?: unknown, token = USER_TOKEN, headers: Record<string, string> = {}) {
      return fetch(url + path, {
        method, headers: { ...(token ? { 'X-Emby-Token': token } : {}), ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    },
  }
}

async function read(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
}

test('unreachable *arr preflights, history and SAB return a clean gateway error', async (t) => {
  const server = createServer()
  const closedUrl = await listen(server)
  await stop(server)
  const { settings, call } = await app(t)
  settings.update((s) => {
    for (const key of ['radarr', 'sonarr', 'lidarr', 'prowlarr', 'sabnzbd'] as const) s.services[key] = { url: closedUrl, apiKey: 'fixture-key' }
  })
  for (const [path, method, body, token] of [
    ['/arr/radarr/movie', 'POST', { tmdbId: 2, rootFolderPath: ROOT }, USER_TOKEN],
    ['/arr/sonarr/series/12', 'DELETE', undefined, USER_TOKEN],
    ['/arr/lidarr/history/since?eventType=4', 'GET', undefined, USER_TOKEN],
    ['/arr/prowlarr/indexer', 'GET', undefined, ADMIN_TOKEN],
    ['/arr/sab?mode=queue', 'GET', undefined, USER_TOKEN],
  ] as const) {
    const response = await call(path, method, body, token)
    assert.equal(response.status, 502, path)
    assert.match((await response.json() as { error: string }).error, /reach/i)
  }
})

test('internal JSON requests handle malformed and aborted replies, and refuse redirects with service credentials', async (t) => {
  const url = await upstream(t, (req, res) => {
    if (req.url === '/api/malformed') return void res.end('{')
    if (req.url === '/api/aborted') {
      res.setHeader('Content-Length', '500')
      res.write('{')
      return void setImmediate(() => res.destroy())
    }
    res.writeHead(302, { Location: '/api/malformed' }).end()
  })
  for (const path of ['malformed', 'aborted', 'redirect']) {
    await assert.rejects(requestAppJson({ url, apiKey: 'fixture-key' }, 'Radarr', '/api', path), hasStatus(502))
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('cancelled', 'AbortError') })
  await assert.rejects(requestAppJson({ url }, 'Radarr', '/api', 'timeout'), hasStatus(502))
})

test('covers cache privately only on successful image replies and keep conditional request support', async (t) => {
  const calls: { url: string; headers: IncomingMessage['headers'] }[] = []
  const url = await upstream(t, (req, res) => {
    calls.push({ url: req.url!, headers: req.headers })
    if (req.headers['if-none-match'] === '"cover"') return void res.writeHead(304, { ETag: '"cover"' }).end()
    const status = req.url?.includes('missing') ? 404 : 200
    res.writeHead(status, { 'Content-Type': 'image/jpeg', 'Set-Cookie': 'upstream=1', 'Content-Length': '3', ETag: '"cover"' }).end('pic')
  })
  const { settings, call } = await app(t)
  settings.update((s) => { s.services.radarr = { url, apiKey: 'arr-key' } })
  const address = '/arr/radarr/mediacover/3/poster-250.jpg'
  for (const method of ['GET', 'HEAD']) {
    const response = await call(`${address}?ApiKey=${USER_TOKEN}&APIKEY=ignored`, method, undefined, '', { Cookie: 'finesse=viewer' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'private, max-age=86400')
    assert.match(response.headers.get('vary')!, /X-Emby-Token/)
    assert.equal(response.headers.get('content-length'), '3')
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(await response.text(), method === 'HEAD' ? '' : 'pic')
  }
  assert.equal(calls[0]?.url, '/api/v3/mediacover/3/poster-250.jpg')
  assert.equal(calls[0]?.headers['x-api-key'], 'arr-key')
  assert.equal(calls[0]?.headers.cookie, undefined)
  assert.equal((await call(address, 'GET', undefined, USER_TOKEN, { 'If-None-Match': '"cover"' })).status, 304)
  const missing = await call('/arr/radarr/mediacover/3/missing.jpg')
  assert.equal(missing.status, 404)
  assert.equal(missing.headers.get('cache-control'), 'no-store')
  await missing.text()
})

test('rootfolder validation shares a read, expires at 60 seconds, and rejects paths outside the chosen root', async (t) => {
  let reads = 0
  let adds = 0
  let roots: unknown = { wrong: true }
  const url = await upstream(t, async (req, res) => {
    if (req.url === '/api/v3/rootfolder' && req.method === 'GET') {
      reads++
      res.end(JSON.stringify(roots))
    } else if (req.url === '/api/v3/movie') {
      await read(req)
      adds++
      res.end('{}')
    } else {
      res.end('{}')
    }
  })
  const { settings, call } = await app(t)
  settings.update((s) => { s.services.radarr = { url, apiKey: 'arr-key' } })
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const add = (folder: string, path?: string) => call('/arr/radarr/movie', 'POST', { tmdbId: 2, rootFolderPath: folder, path })
  assert.equal((await add(ROOT)).status, 502)
  roots = [null, { path: ROOT }, { path: '/other' }, { path: 42 }]
  const burst = await Promise.all([add(ROOT), add(ROOT), add(ROOT)])
  assert.deepEqual(burst.map((r) => r.status), [200, 200, 200])
  await Promise.all(burst.map((r) => r.text()))
  assert.equal(reads, 2)
  assert.equal((await add(ROOT, '/other/title')).status, 403)
  assert.equal((await add('/unlisted')).status, 403)
  assert.equal(adds, 3)
  assert.equal(reads, 2)
  roots = [{ path: '/new' }]
  now += 60000
  assert.equal((await add(ROOT)).status, 403)
  assert.equal((await add('/new')).status, 200)
  assert.equal(reads, 3)
  assert.equal((await call('/arr/radarr/rootfolder/4', 'DELETE', undefined, ADMIN_TOKEN)).status, 200)
  assert.equal((await add('/new')).status, 200)
  assert.equal(reads, 4)
  settings.update((s) => { s.services.radarr!.apiKey = 'new-arr-key' })
  assert.equal((await add('/new')).status, 200)
  assert.equal(reads, 5)
})

test('household actions use validated fields and keep release download details server-side', async (t) => {
  const incoming: { url: string; body: unknown }[] = []
  const upstreamGuid = 'https://example.invalid/download?token=fixture-secret'
  const url = await upstream(t, async (req, res) => {
    const body = await read(req)
    incoming.push({ url: req.url!, body })
    if (req.url?.startsWith('/api/v3/release') && req.method === 'GET') {
      return void res.end(JSON.stringify([{ guid: upstreamGuid, indexerId: 4, title: 'Edition', downloadUrl: upstreamGuid }]))
    }
    if (req.url === '/api/v3/movie/9') return void res.end(JSON.stringify({ id: 9 }))
    res.end(JSON.stringify(body ?? {}))
  })
  const { settings, call } = await app(t)
  settings.update((s) => { s.services.radarr = { url, apiKey: 'arr-key' } })
  assert.equal((await call('/arr/radarr/movie/9', 'DELETE')).status, 502)
  const command = await call('/arr/radarr/command', 'POST', { name: 'MoviesSearch', movieIds: [9], priority: 'high' })
  assert.equal(command.status, 200)
  const queue = await call('/arr/radarr/queue/bulk?removeFromClient=true&blocklist=true&other=true', 'DELETE', { ids: [9], other: true })
  assert.equal(queue.status, 200)
  const releases = await call('/arr/radarr/release?movieId=9&apiKey=browser-key')
  assert.equal(releases.status, 200)
  const text = await releases.text()
  assert.doesNotMatch(text, /fixture-secret|downloadUrl/)
  const [release] = JSON.parse(text)
  assert.equal(release.title, 'Edition')
  const grabbed = await call('/arr/radarr/release', 'POST', { ...release, shouldOverride: true, downloadClientId: 12 })
  assert.equal(grabbed.status, 200)
  assert.doesNotMatch(await grabbed.text(), /fixture-secret/)
  assert.equal((await call('/arr/radarr/release', 'POST', { guid: 'unlisted', indexerId: 4 })).status, 400)
  assert.deepEqual(incoming, [
    { url: '/api/v3/movie/9', body: undefined },
    { url: '/api/v3/command', body: { name: 'MoviesSearch', movieIds: [9] } },
    { url: '/api/v3/queue/bulk?removeFromClient=true&blocklist=true', body: { ids: [9] } },
    { url: '/api/v3/release?movieId=9', body: undefined },
    { url: '/api/v3/release', body: { guid: upstreamGuid, indexerId: 4 } },
  ])
})

test('SAB keeps pause/resume working and drops client auth, service keys and callback parameters', async (t) => {
  const calls: { url: URL; headers: IncomingMessage['headers'] }[] = []
  const url = await upstream(t, (req, res) => {
    calls.push({ url: new URL(req.url!, 'http://example.invalid'), headers: req.headers })
    res.setHeader('Set-Cookie', 'sab=upstream')
    res.end('{}')
  })
  const { settings, call } = await app(t)
  settings.update((s) => { s.services.sabnzbd = { url, apiKey: 'sab-key' } })
  for (const mode of ['pause', 'resume']) {
    assert.equal((await call(`/arr/sab?mode=queue&name=${mode}&value=job&callback=callback&APIKey=other`, 'GET', undefined, USER_TOKEN, {
      'X-API-Key': 'other', 'X-NZB-Key': 'other', Cookie: 'finesse=viewer',
    })).status, 200)
  }
  assert.equal((await call('/arr/sab?mode=queue&mode=get_config')).status, 403)
  assert.equal((await call('/arr/sab?mode=queue', 'POST', {})).status, 403)
  for (const { url, headers } of calls) {
    assert.equal(url.searchParams.get('apikey'), 'sab-key')
    assert.equal(url.searchParams.get('output'), 'json')
    assert.equal(url.searchParams.has('callback'), false)
    assert.equal(url.searchParams.has('APIKey'), false)
    for (const header of ['x-api-key', 'x-nzb-key', 'x-emby-token', 'cookie']) assert.equal(headers[header], undefined)
  }
  assert.equal(calls.length, 2)
})

test('policy allows lookups and intended controls and refuses malformed action inputs', () => {
  for (const path of ['episode', 'episode/9', 'episodefile/3', 'album', 'album/9', 'album/lookup']) {
    assert.equal(arrVerdict('GET', path, new URLSearchParams()).ok, true)
    assert.equal(arrVerdict('POST', path, new URLSearchParams()).ok, false)
  }
  assert.equal(arrVerdict('DELETE', 'queue/9', new URLSearchParams()).ok, true)
  assert.equal(arrVerdict('DELETE', 'queue/bulk', new URLSearchParams('blocklist=false&blocklist=true')).ok, false)
  assert.equal(arrVerdict('GET', 'history/since', new URLSearchParams('eventType=4&EventType=2')).ok, false)
  assert.equal(commandAllowed({ name: ['MoviesSearch'] }), false)
  assert.equal(actionBody('command', { name: 'SeriesSearch', seriesId: 0 }), null)
  assert.equal(actionBody('queue', { ids: [1, '2'] }), null)
  assert.equal(addAllowed({ rootFolderPath: ROOT, Path: '/other' }, [ROOT]), false)
  assert.equal(addAllowed({ rootFolderPath: ROOT, path: ROOT + '-else' }, [ROOT]), false)
  assert.equal(addAllowed({ rootFolderPath: 'C:/Media', path: 'C:/Media/Show' }, ['c:/media/']), true)
  assert.equal(addAllowed({ rootFolderPath: 'C:/Media', path: 'C:/Media/.. /Other' }, ['c:/media/']), false)
  assert.equal(sabAllowed(new URLSearchParams('mode=queue&name=pause&Name=delete')), false)
})

test('default validation skips an unused root lookup and tolerates blank rows, but rejects unexpected collection shapes', async () => {
  const service = { url: 'http://Radarr.example/Base' }
  const calls: string[] = []
  assert.equal((await validateDefault('radarr', service, { profileId: 1 }, async (_svc, _api, path) => {
    calls.push(path)
    return [null, { id: 1, name: false }]
  })).profileName, 'Profile 1')
  assert.deepEqual(calls, ['qualityprofile'])
  await assert.rejects(validateDefault('radarr', service, { profileId: 1 }, async () => ({ id: 1 })), hasStatus(502))
  assert.equal((await validateDefault('radarr', service, { profileId: 1, rootFolder: ROOT }, async (_svc, _api, path) =>
    path === 'qualityprofile' ? [{ id: 1, name: 'HD' }] : [null, { path: ROOT }],
  )).rootFolder, ROOT)
  const s = { services: { radarr: service }, requests: { profiles: {}, defaults: { radarr: { profileId: 1, profileName: 'HD', serviceUrl: 'http://radarr.example/base' } } } }
  assert.equal(requestConfig(s as Parameters<typeof requestConfig>[0])[0]?.stale, true)
})

test('album requests reject bad upstream data, normalize IDs, and leave an already downloaded album alone', async (t) => {
  const url = await upstream(t, (req, res) => {
    if (req.url?.includes('/album/lookup')) return void res.end('invalid JSON')
    res.end('[]')
  })
  const { settings, call } = await app(t)
  settings.update((s) => { s.services.lidarr = { url, apiKey: 'arr-key' } })
  assert.equal((await call(`/api/requests/artist-albums?artist=${ARTIST}&name=Artist`)).status, 502)
  assert.equal((await call('/api/requests/album', 'POST', null)).status, 400)
  assert.equal((await call('/api/requests/album', 'POST', { foreignAlbumId: ALBUM, artistName: 'Artist', qualityProfileId: -1, rootFolderPath: ROOT })).status, 400)
  await assert.rejects(lidarrCaller({ url, apiKey: 'arr-key' })('GET', '/album/lookup'), hasStatus(502))

  const fake: LidarrCall = async <T>(method: string, path: string): Promise<T> => {
    assert.equal(method, 'GET')
    const albums = [null, { id: 3, foreignAlbumId: ALBUM, monitored: true, statistics: { trackFileCount: 9 }, releaseDate: 2030 }]
    const value = path === '/artist' ? [null, { id: 2, foreignArtistId: ARTIST, metadataProfileId: 1 }] :
      path.startsWith('/album/lookup') ? [null, { foreignAlbumId: ALBUM.toUpperCase(), artist: { foreignArtistId: ARTIST }, title: 'Album' }] :
      path === '/album?artistId=2' ? albums : path === '/qualityprofile' ? [{ id: 1 }] :
      path === '/rootfolder' ? [{ path: ROOT }] : [{ id: 1, name: 'Standard', primaryAlbumTypes: null }]
    return value as T
  }
  const rows = await artistAlbums(fake, ARTIST.toUpperCase(), 'Artist')
  assert.deepEqual(rows, [{ foreignAlbumId: ALBUM, title: 'Album', type: 'Album', inLidarr: true, monitored: true, downloaded: true }])
  const result = await requestAlbum(fake, { foreignAlbumId: ALBUM, artistName: 'Artist', qualityProfileId: 1, rootFolderPath: ROOT })
  assert.equal(result.state, 'have')
  assert.equal(result.profileChanged, false)
})
