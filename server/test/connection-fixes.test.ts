// One-click repairs for Connected apps (server/src/connectionFixes.ts), on fakes
// shaped like a real NAS: Lidarr from TrueNAS sees the pool at /data, qBittorrent
// runs inside Gluetun and sees pool/data at /data, and SABnzbd checks hostnames.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Settings } from '../src/config.ts'
import { checkConnections, type ConnFetch } from '../src/connections.ts'
import { findContainer, mapThroughMounts, runConnectionFix } from '../src/connectionFixes.ts'

const settings = (services: Settings['services'], mode: Settings['mode'] = 'adopt') => ({ services, mode }) as Settings

type Answer = unknown | ((body: unknown) => { status: number; json: unknown; text?: string })
function fake(routes: Record<string, Answer>, seen: string[] = []): ConnFetch {
  return async (url, init) => {
    const u = new URL(url)
    const key = `${init.method ?? 'GET'} ${u.host}${u.pathname}`
    seen.push(`${key}${u.search}`)
    const r = routes[key]
    if (r === undefined) return { status: 404, json: null }
    if (typeof r === 'function') return (r as (b: unknown) => { status: number; json: unknown })(init.body)
    return { status: 200, json: r }
  }
}

const LIDARR_HEALTH = [
  { source: 'UpdateCheck', type: 'warning', message: 'New update is available: v3.2.1.5196' },
  { source: 'RemotePathMappingCheck', type: 'error', message: 'You are using docker; download client qBittorrent places downloads in /data/Torrents but this directory does not appear to exist inside the container.  Review your remote path mappings and container volume settings.' },
]

test('the folder both containers share becomes the mapping', () => {
  const qbit = [{ Source: '/mnt/HDDs/Downloads/qbittorrent', Destination: '/config' }, { Source: '/mnt/HDDs/data', Destination: '/data' }]
  const lidarr = [{ Source: '/mnt/.ix-apps/app_mounts/lidarr/config', Destination: '/config' }, { Source: '/mnt/HDDs', Destination: '/data' }]
  assert.deepEqual(mapThroughMounts('/data/Torrents', qbit, lidarr), { remotePath: '/data/', localPath: '/data/data/' })
  // The app's folder is the narrower one: map from there.
  assert.deepEqual(mapThroughMounts('/downloads/complete/music', [{ Source: '/mnt/pool', Destination: '/downloads' }], [{ Source: '/mnt/pool/complete', Destination: '/done' }]), {
    remotePath: '/downloads/complete/',
    localPath: '/done/',
  })
  // Same name on both sides: a mapping won't help. Not shared at all: nothing to map.
  assert.equal(mapThroughMounts('/data/t', [{ Source: '/a', Destination: '/data' }], [{ Source: '/a', Destination: '/data' }]), null)
  assert.equal(mapThroughMounts('/data/t', [{ Source: '/a', Destination: '/data' }], [{ Source: '/b', Destination: '/data' }]), null)
})

test('a client inside a VPN container is found through the VPN’s published port', () => {
  const list = [
    { Id: 'g1', Names: ['/gluetun'], Image: 'qmcgaw/gluetun', Ports: [{ PrivatePort: 8080, PublicPort: 8081 }] },
    { Id: 'q1', Names: ['/qbittorrent'], Image: 'lscr.io/linuxserver/qbittorrent', HostConfig: { NetworkMode: 'container:g1' } },
    { Id: 'l1', Names: ['/ix-lidarr-lidarr-1'], Image: 'lidarr', Ports: [{ PrivatePort: 30071, PublicPort: 30071 }] },
  ]
  assert.equal(findContainer(list, '192.168.8.120', 8081, 'QBittorrent')?.Id, 'q1')
  assert.equal(findContainer(list, 'host.docker.internal', 30071, 'lidarr')?.Id, 'l1')
  assert.equal(findContainer(list, 'ix-lidarr-lidarr-1', 1, 'lidarr')?.Id, 'l1')
  assert.equal(findContainer(list, 'nowhere', 9999, 'sonarr'), null)
})

test('Lidarr: update notices are a quiet note, the missing folder offers a fix', async () => {
  const r = await checkConnections(
    settings({ lidarr: { url: 'http://lidarr:8686', apiKey: 'lk' } }),
    fake({
      'GET lidarr:8686/api/v1/system/status': {},
      'GET lidarr:8686/api/v1/health': LIDARR_HEALTH,
      'GET lidarr:8686/api/v1/downloadclient': [],
      'POST lidarr:8686/api/v1/downloadclient/testall': [],
    }),
  )
  const l = r.apps[0]!
  assert.equal(l.ok, false)
  assert.equal(l.problems.length, 1)
  assert.match(l.summary, /Finesse can fix it/)
  assert.deepEqual(l.fixes?.map((f) => f.id), ['remote-paths'])
  assert.match(l.notes?.[0] ?? '', /newer version is out: v3\.2\.1/)
  // On a server Finesse set up, Finesse brings the updates: no note at all.
  const b = await checkConnections(settings({ lidarr: { url: 'http://lidarr:8686', apiKey: 'lk' } }, 'bundle'), fake({ 'GET lidarr:8686/api/v1/system/status': {}, 'GET lidarr:8686/api/v1/health': [LIDARR_HEALTH[0]] }))
  assert.equal(b.apps[0]!.ok, true)
  assert.equal(b.apps[0]!.notes, undefined)
})

test('remote-paths: works it out from Docker, checks Lidarr sees it, then adds the mapping', async () => {
  const seen: string[] = []
  let posted: unknown = null
  const get = fake(
    {
      'GET host.docker.internal:30071/api/v1/health': LIDARR_HEALTH,
      'GET host.docker.internal:30071/api/v1/downloadclient': [{ name: 'qBittorrent', implementation: 'QBittorrent', fields: [{ name: 'host', value: '192.168.8.120' }, { name: 'port', value: 8081 }] }],
      'GET host.docker.internal:30071/api/v1/remotepathmapping': [{ id: 1, host: '192.168.8.120', remotePath: '/downloads/', localPath: '/data/Downloads/' }],
      'GET host.docker.internal:30071/api/v1/filesystem': { directories: [{ path: '/data/data/Torrents/' }] },
      'POST host.docker.internal:30071/api/v1/remotepathmapping': (b: unknown) => ((posted = b), { status: 201, json: b }),
    },
    seen,
  )
  const docker = {
    call: async <T>(_m: string, path: string) =>
      (path === '/containers/json'
        ? [
            { Id: 'g1', Names: ['/gluetun'], Image: 'qmcgaw/gluetun', Ports: [{ PrivatePort: 8080, PublicPort: 8081 }] },
            { Id: 'q1', Names: ['/qbittorrent'], Image: 'linuxserver/qbittorrent', HostConfig: { NetworkMode: 'container:g1' } },
            { Id: 'l1', Names: ['/ix-lidarr-lidarr-1'], Image: 'lidarr', Ports: [{ PrivatePort: 30071, PublicPort: 30071 }] },
          ]
        : path === '/containers/q1/json'
          ? { Mounts: [{ Source: '/mnt/HDDs/data', Destination: '/data' }] }
          : { Mounts: [{ Source: '/mnt/HDDs', Destination: '/data' }] }) as T,
  }
  const msg = await runConnectionFix(settings({ lidarr: { url: 'http://host.docker.internal:30071', apiKey: 'lk' } }), 'lidarr', 'remote-paths', { get, docker })
  assert.equal(msg, 'Added to Lidarr: /data/ → /data/data/.')
  assert.deepEqual(posted, { host: '192.168.8.120', remotePath: '/data/', localPath: '/data/data/' })
  assert.ok(seen.some((s) => s.includes('filesystem?path=%2Fdata%2Fdata%2F')), 'checked Lidarr can see the folder first')
})

test('remote-paths: without Docker, borrows the mapping Radarr already uses — only when Lidarr sees that folder', async () => {
  const lidarr = (dirs: string[]) =>
    fake({
      'GET lidarr/api/v1/health': LIDARR_HEALTH,
      'GET lidarr/api/v1/downloadclient': [{ name: 'qBittorrent', fields: [{ name: 'host', value: 'nas' }] }],
      'GET lidarr/api/v1/remotepathmapping': [],
      'GET lidarr/api/v1/filesystem': { directories: dirs.map((path) => ({ path })) },
      'POST lidarr/api/v1/remotepathmapping': (b: unknown) => ({ status: 201, json: b }),
      'GET radarr/api/v3/remotepathmapping': [{ host: 'nas', remotePath: '/data/Torrents/', localPath: '/data/data/Torrents/' }],
    })
  const s = settings({ lidarr: { url: 'http://lidarr', apiKey: 'lk' }, radarr: { url: 'http://radarr', apiKey: 'rk' } })
  assert.equal(await runConnectionFix(s, 'lidarr', 'remote-paths', { get: lidarr(['/data/data/Torrents/']) }), 'Added to Lidarr: /data/Torrents/ → /data/data/Torrents/.')
  await assert.rejects(runConnectionFix(s, 'lidarr', 'remote-paths', { get: lidarr([]) }), /couldn’t work out where qBittorrent saves inside Lidarr/)
})

test('SABnzbd’s hostname check: reported plainly, and fixed by asking it by IP', async () => {
  const s = settings({ sabnzbd: { url: 'http://host.docker.internal:30055', apiKey: 'sk' } })
  let named = false
  const get = fake({
    'GET host.docker.internal:30055/api': () => (named ? { status: 200, json: { version: '5' } } : { status: 403, json: null, text: 'Access denied - Hostname verification failed: https://sabnzbd.org/hostname-check' }),
  })
  const r = await checkConnections(s, get)
  assert.equal(r.apps[0]!.ok, false)
  assert.match(r.apps[0]!.summary, /won’t answer to the name “host\.docker\.internal”/)
  assert.deepEqual(r.apps[0]!.fixes?.map((f) => f.id), ['sab-hostname'])

  const asked: string[] = []
  const byIp = async (url: string | URL) => {
    const u = new URL(url)
    asked.push(`${u.searchParams.get('mode')} ${u.searchParams.get('value') ?? ''}`)
    if (u.searchParams.get('mode') === 'set_config') named = true
    return { status: 200, json: u.searchParams.get('mode') === 'get_config' ? { config: { misc: { host_whitelist: ['2b4152ea8457'] } } } : { config: {} } }
  }
  assert.equal(await runConnectionFix(s, 'sabnzbd', 'sab-hostname', { get, byIp }), 'SABnzbd now answers to “host.docker.internal”.')
  assert.deepEqual(asked, ['get_config ', 'set_config 2b4152ea8457,host.docker.internal'])
})

test('an unknown fix is turned down plainly', async () => {
  await assert.rejects(runConnectionFix(settings({}), 'radarr', 'format-disk'), /doesn’t know that fix/)
})
