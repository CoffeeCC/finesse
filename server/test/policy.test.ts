// Household members (signed in, not administrators) get what the app's screens
// do through the /arr and /games proxies, and nothing else: the proxies call
// those apps with the admin key, so settings, keys, deleting files and scripts
// stay with administrators.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { addAllowed, arrVerdict, cleanPath, commandAllowed, hasFiles, rommAllowed, sabAllowed } from '../src/policy.ts'
import { ADMIN_TOKEN, API_KEY, USER_TOKEN, auth, fakeJellyfin, listen, tmp, webBuild, type FakeJellyfin } from './helpers.ts'

const q = (s = '') => new URLSearchParams(s)

describe('the rules', () => {
  test('paths that climb out of the API are refused, encoded or not', () => {
    assert.equal(cleanPath('movie/lookup'), 'movie/lookup')
    assert.equal(cleanPath('movie//./1'), 'movie/1')
    for (const bad of ['../initialize.js', 'movie/../../config', '%2e%2e/x', '..%2Fx', 'a%5c..', 'x%00'])
      assert.equal(cleanPath(bad), null, bad)
  })

  test('Radarr/Sonarr/Lidarr: search, request, follow downloads — nothing else', () => {
    for (const [m, p] of [
      ['GET', 'movie/lookup'], ['GET', 'series/lookup'], ['GET', 'artist/lookup'], ['GET', 'qualityprofile'],
      ['GET', 'rootfolder'], ['GET', 'queue'], ['GET', 'wanted/missing'], ['GET', 'series'], ['GET', 'movie/12'],
      ['GET', 'release'], ['GET', 'episodefile'], ['GET', 'mediacover/12/poster-250.jpg'], ['GET', 'mediacover/artist/3/poster.jpg'],
      ['POST', 'movie'], ['POST', 'release'], ['POST', 'command'], ['DELETE', 'queue/bulk'],
    ] as const)
      assert.equal(arrVerdict(m, p, q()).ok, true, `${m} ${p}`)
    for (const [m, p] of [
      ['GET', 'config/host'], ['GET', 'downloadclient'], ['GET', 'indexer'], ['GET', 'notification'], ['GET', 'system/backup'],
      ['GET', 'log/file'], ['PUT', 'movie/12'], ['PUT', 'config/host'], ['POST', 'notification'], ['POST', 'downloadclient'],
      ['POST', 'customformat'], ['DELETE', 'rootfolder/1'], ['DELETE', 'moviefile/3'],
      ['GET', 'mediacover/12/config.xml'], ['GET', 'mediacover/x/poster.jpg'], ['DELETE', 'mediacover/12/poster.jpg'],
    ] as const)
      assert.equal(arrVerdict(m, p, q()).ok, false, `${m} ${p}`)
  })

  test('taking back a request never deletes files, and needs the item to have none', () => {
    assert.deepEqual(arrVerdict('DELETE', 'movie/7', q('deleteFiles=false')), { ok: true, needsNoFiles: { kind: 'movie', id: 7 } })
    assert.equal(arrVerdict('DELETE', 'movie/7', q('deleteFiles=true')).ok, false)
    assert.equal(hasFiles({ hasFile: true }), true)
    assert.equal(hasFiles({ statistics: { episodeFileCount: 3 } }), true)
    assert.equal(hasFiles({ statistics: { trackFileCount: 0, sizeOnDisk: 0 } }), false)
  })

  test('commands: searches only', () => {
    for (const name of ['MoviesSearch', 'SeriesSearch', 'ArtistSearch']) assert.equal(commandAllowed({ name, movieIds: [1] }), true)
    for (const name of ['ApplicationUpdate', 'Backup', 'DeleteLogFiles', 'RenameFiles', 'RescanMovie']) assert.equal(commandAllowed({ name }), false)
    assert.equal(commandAllowed('MoviesSearch'), false)
  })

  test('adds go into a library folder, nowhere else', () => {
    const roots = ['/data/media/movies/']
    assert.equal(addAllowed({ rootFolderPath: '/data/media/movies', tmdbId: 1 }, roots), true)
    assert.equal(addAllowed({ rootFolderPath: '/data/media/movies', path: '/data/media/movies/Film (2020)' }, roots), true)
    assert.equal(addAllowed({ rootFolderPath: '/config' }, roots), false)
    assert.equal(addAllowed({ rootFolderPath: '/data/media/movies', path: '/config/x' }, roots), false)
    assert.equal(addAllowed({ rootFolderPath: '/data/media/movies', path: '/data/media/movies/../../config' }, roots), false)
  })

  test('SABnzbd: the queue and its controls, never its settings', () => {
    for (const s of ['mode=queue', 'mode=queue&name=pause&value=x', 'mode=queue&name=resume&value=x', 'mode=pause', 'mode=resume', 'mode=config&name=speedlimit&value=5M'])
      assert.equal(sabAllowed(q(s)), true, s)
    for (const s of ['mode=get_config', 'mode=set_config&section=misc', 'mode=config&name=set_apikey', 'mode=shutdown', 'mode=restart', 'mode=queue&name=delete&value=all', 'mode=addurl&name=http://x', 'mode=history&name=delete'])
      assert.equal(sabAllowed(q(s)), false, s)
  })

  test('RomM: browse and play, never change', () => {
    for (const p of ['platforms', 'roms', 'roms/5', 'roms/5/content/Game%20(USA).zip', 'platforms/3', 'firmware/7/content/scph5501.bin']) assert.equal(rommAllowed('GET', p), true, p)
    assert.equal(rommAllowed('DELETE', 'roms/5'), false)
    assert.equal(rommAllowed('POST', 'firmware'), false)
    assert.equal(rommAllowed('POST', 'firmware/delete'), false)
    assert.equal(rommAllowed('GET', 'firmware'), false)
    assert.equal(rommAllowed('POST', 'roms'), false)
    assert.equal(rommAllowed('GET', 'users'), false)
    assert.equal(rommAllowed('GET', 'config'), false)
  })
})

describe('through the server', () => {
  let base = ''
  let jf: FakeJellyfin
  let app: Server
  const seen: string[] = []
  const servers: Server[] = []

  before(async () => {
    jf = await fakeJellyfin()
    const fake = (name: string, answer: (method: string, path: string) => unknown) =>
      listen(
        ((s) => (servers.push(s), s))(
          createServer((req, res) => {
            let body = ''
            req.on('data', (c) => (body += c))
            req.on('end', () => {
              const path = (req.url ?? '').split('?')[0]!
              seen.push(`${name} ${req.method} ${req.url}${body ? ` ${body}` : ''}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(answer(req.method ?? 'GET', path) ?? { ok: true }))
            })
          }),
        ),
      )
    const radarr = await fake('radarr', (m, p) => {
      if (p === '/api/v3/rootfolder') return [{ path: '/data/media/movies' }]
      if (p === '/api/v3/movie/1' && m === 'GET') return { id: 1, hasFile: true }
      if (p === '/api/v3/movie/2' && m === 'GET') return { id: 2, hasFile: false }
    })
    const sab = await fake('sab', () => ({ status: true }))
    const romm = await fake('romm', () => [])
    const work = tmp()
    mkdirSync(join(work, 'baked'), { recursive: true })
    for (const [rel, c] of Object.entries(webBuild('1.0.0'))) {
      mkdirSync(join(work, 'baked', rel, '..'), { recursive: true })
      writeFileSync(join(work, 'baked', rel), c)
    }
    Object.assign(process.env, {
      FINESSE_CONFIG_DIR: join(work, 'config'),
      FINESSE_WEB_DIR: join(work, 'baked'),
      JELLYFIN_URL: jf.url,
      JELLYFIN_API_KEY: API_KEY,
      RADARR_URL: radarr,
      RADARR_API_KEY: 'radarr-secret',
      SAB_URL: sab,
      SAB_API_KEY: 'sab-secret',
      ROMM_URL: romm,
      ROMM_USERNAME: 'finesse',
      ROMM_PASSWORD: 'romm-secret',
    })
    const { createApp } = await import('../src/app.ts')
    app = createApp().server
    base = await listen(app)
  })
  after(() => {
    for (const s of [app, jf?.server, ...servers]) {
      s?.closeAllConnections()
      s?.close()
    }
  })

  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const before = seen.length
    const r = await fetch(`${base}/finesse${path}`, { method, headers: { ...auth(token), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    await r.arrayBuffer()
    return { status: r.status, upstream: seen.slice(before) }
  }

  test('a household member can search, request and search again', async () => {
    assert.equal((await call('GET', '/arr/radarr/movie/lookup?term=x', USER_TOKEN)).status, 200)
    const add = await call('POST', '/arr/radarr/movie', USER_TOKEN, { tmdbId: 5, rootFolderPath: '/data/media/movies' })
    assert.equal(add.status, 200)
    assert.ok(add.upstream.some((l) => l.startsWith('radarr POST /api/v3/movie ') && l.includes('"tmdbId":5')), 'the checked body reaches Radarr intact')
    assert.equal((await call('POST', '/arr/radarr/command', USER_TOKEN, { name: 'MoviesSearch', movieIds: [5] })).status, 200)
  })

  test('posters load with the sign-in in their address, and it stops here', async () => {
    const pic = async (path: string) => {
      const before = seen.length
      const r = await fetch(`${base}/finesse${path}`)
      await r.arrayBuffer()
      return { status: r.status, upstream: seen.slice(before) }
    }
    const ok = await pic(`/arr/radarr/mediacover/1/poster-250.jpg?ApiKey=${USER_TOKEN}&api_key=${USER_TOKEN}`)
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.upstream, ['radarr GET /api/v3/mediacover/1/poster-250.jpg'])
    assert.equal((await pic('/arr/radarr/mediacover/1/poster-250.jpg')).status, 401)
    // Only pictures: anything else still needs the sign-in in a header.
    assert.equal((await pic(`/arr/radarr/movie/lookup?term=x&ApiKey=${USER_TOKEN}`)).status, 401)
  })

  test('…but not settings, keys, other commands or other folders', async () => {
    for (const [m, p, b] of [
      ['GET', '/arr/radarr/config/host'],
      ['GET', '/arr/radarr/downloadclient'],
      ['POST', '/arr/radarr/notification', { implementation: 'CustomScript' }],
      ['POST', '/arr/radarr/command', { name: 'ApplicationUpdate' }],
      ['POST', '/arr/radarr/movie', { tmdbId: 6, rootFolderPath: '/config' }],
      ['DELETE', '/arr/radarr/movie/2?deleteFiles=true'],
    ] as [string, string, unknown?][]) {
      const r = await call(m, p, USER_TOKEN, b)
      assert.equal(r.status, 403, `${m} ${p}`)
      assert.ok(!r.upstream.some((l) => !l.startsWith('radarr GET /api/v3/rootfolder')), `${m} ${p} never reached Radarr`)
    }
  })

  test('taking back: only while nothing is on disk', async () => {
    assert.equal((await call('DELETE', '/arr/radarr/movie/1?deleteFiles=false', USER_TOKEN)).status, 403)
    const ok = await call('DELETE', '/arr/radarr/movie/2?deleteFiles=false', USER_TOKEN)
    assert.equal(ok.status, 200)
    assert.ok(ok.upstream.some((l) => l.startsWith('radarr DELETE /api/v3/movie/2')))
  })

  test('an administrator still has the whole API', async () => {
    assert.equal((await call('GET', '/arr/radarr/config/host', ADMIN_TOKEN)).status, 200)
    assert.equal((await call('POST', '/arr/radarr/command', ADMIN_TOKEN, { name: 'RenameFiles' })).status, 200)
    assert.equal((await call('GET', '/arr/sab?mode=get_config', ADMIN_TOKEN)).status, 200)
  })

  test('climbing out of the API prefix never reaches the app, for anyone', async () => {
    const u = new URL(base)
    // "..%2F" survives URL parsing and is refused; "%2e%2e/" is collapsed by the
    // parser before routing, so it lands on the web app instead. Either way,
    // Radarr sees nothing.
    for (const [path, expect] of [['/finesse/arr/radarr/..%2F..%2Finitialize.js', 400], ['/finesse/arr/radarr/%2e%2e/%2e%2e/feed', 200]] as const) {
      const before = seen.length
      const status = await new Promise<number>((resolve) =>
        request({ host: u.hostname, port: u.port, path, headers: auth(ADMIN_TOKEN) }, (res) => (res.resume(), resolve(res.statusCode ?? 0))).end(),
      )
      assert.equal(status, expect, path)
      assert.deepEqual(seen.slice(before), [], `${path} reached an app`)
    }
  })

  test('SABnzbd: never its settings (they hold your Usenet password)', async () => {
    assert.equal((await call('GET', '/arr/sab?mode=queue&output=json', USER_TOKEN)).status, 200)
    assert.equal((await call('GET', '/arr/sab?mode=config&name=speedlimit&value=5M', USER_TOKEN)).status, 200)
    for (const qs of ['mode=get_config', 'mode=set_config&section=servers', 'mode=shutdown']) assert.equal((await call('GET', `/arr/sab?${qs}`, USER_TOKEN)).status, 403, qs)
  })

  test('RomM: browse and play, never change', async () => {
    assert.equal((await call('GET', '/games/api/platforms', USER_TOKEN)).status, 200)
    assert.equal((await call('DELETE', '/games/api/roms/5', USER_TOKEN)).status, 403)
    assert.equal((await call('GET', '/games/api/users', USER_TOKEN)).status, 403)
    assert.equal((await call('POST', '/games/assets/x', USER_TOKEN)).status, 403)
  })
})
