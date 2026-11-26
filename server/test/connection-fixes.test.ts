// One-click repairs for Connected apps (server/src/connectionFixes.ts), on fakes
// shaped like a real NAS: Lidarr from TrueNAS sees the pool at /data, qBittorrent
// runs inside Gluetun and sees pool/data at /data, and SABnzbd checks hostnames.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Settings, SettingsStore } from '../src/config.ts'
import { browserUrl, checkConnections, type ConnFetch } from '../src/connections.ts'
import { ConnectionRepairLoop, REPAIR_COOLDOWN_MS, findContainer, mapThroughMounts, runConnectionFix } from '../src/connectionFixes.ts'

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
  assert.equal(mapThroughMounts('/data/t', [{ Source: '/a', Destination: '/data' }], [
    { Source: '/a', Destination: '/files' }, { Source: '/other', Destination: '/files/t' },
  ]), null, 'a nested mount shadows the apparent match')
  assert.deepEqual(mapThroughMounts('/t', [{ Source: '/a', Destination: '/' }], [{ Source: '/a', Destination: '/files' }]), {
    remotePath: '/', localPath: '/files/',
  })
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
  await assert.rejects(runConnectionFix(s, 'lidarr', 'remote-paths', { get: lidarr([]) }), /couldn’t find qBittorrent’s downloads folder inside Lidarr/)
})

test('remote-paths: handles Lidarr quoted "is placing downloads in" wording and auto-fixes case mismatches without Docker', async () => {
  let posted: unknown = null
  const get = fake({
    'GET 192.168.8.120:30071/api/v1/system/status': {},
    'GET 192.168.8.120:30071/api/v1/health': [
      { source: 'RemotePathMappingCheck', type: 'error', message: 'You are using docker; download client qBittorrent is placing downloads in "/data/Torrents/" but this directory does not appear to exist inside the container.' },
    ],
    'GET 192.168.8.120:30071/api/v1/downloadclient': [{ name: 'qBittorrent', fields: [{ name: 'host', value: '192.168.8.120' }] }],
    'POST 192.168.8.120:30071/api/v1/downloadclient/testall': [],
    'GET 192.168.8.120:30071/api/v1/remotepathmapping': [],
    'GET 192.168.8.120:30071/api/v1/filesystem': { directories: [{ path: '/data/torrents/' }] },
    'POST 192.168.8.120:30071/api/v1/remotepathmapping': (b: unknown) => ((posted = b), { status: 201, json: b }),
  })
  const s = settings({ lidarr: { url: 'http://192.168.8.120:30071', apiKey: 'lk' } })
  const report = await checkConnections(s, get)
  assert.equal(report.apps[0]!.openUrl, 'http://192.168.8.120:30071')
  assert.deepEqual(report.apps[0]!.fixes?.map((f) => f.id), ['remote-paths'])
  assert.equal(browserUrl('http://lidarr:8686'), undefined)
  assert.equal(browserUrl('http://host.docker.internal:30071'), undefined)
  assert.equal(await runConnectionFix(s, 'lidarr', 'remote-paths', { get }), 'Added to Lidarr: /data/Torrents/ → /data/torrents/.')
  assert.deepEqual(posted, { host: '192.168.8.120', remotePath: '/data/Torrents/', localPath: '/data/torrents/' })
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

test('automatic repairs record successes and retry failures only after cooldown', async (t) => {
  const s = settings({
    sabnzbd: { url: 'http://sab.local', apiKey: 'fixture' },
    lidarr: { url: 'http://music.local', apiKey: 'fixture' },
  })
  const store = { get: () => s } as SettingsStore
  let now = Date.UTC(2026, 0, 1)
  let sabRepaired = false
  let lidarrChecks = 0
  const loop = new ConnectionRepairLoop(store, {
    now: () => now,
    get: async (url) => {
      const u = new URL(url)
      if (u.hostname === 'sab.local') {
        if (sabRepaired) return { status: 200, json: { version: '1' } }
        return { status: 403, json: null, text: 'Hostname verification' }
      }
      if (u.pathname.endsWith('/health')) return { status: 200, json: LIDARR_HEALTH }
      if (u.pathname.endsWith('/downloadclient')) lidarrChecks++
      return { status: 503, json: null }
    },
    byIp: async (url) => {
      const mode = new URL(url).searchParams.get('mode')
      if (mode === 'set_config') {
        sabRepaired = true
        return { status: 200, json: { status: true } }
      }
      return { status: 200, json: { config: { misc: { host_whitelist: ['other.local'] } } } }
    },
  })
  t.after(() => loop.stop())
  // Run through the actual startup scheduler.
  loop.start(60_000, 0)
  for (let i = 0; i < 20 && loop.autoFixed.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  await loop.tick()
  assert.deepEqual(loop.autoFixed, [{ app: 'sabnzbd', fix: 'sab-hostname', at: new Date(now).toISOString(), message: 'SABnzbd now answers to “sab.local”.' }])
  assert.equal(lidarrChecks, 1)
  now += REPAIR_COOLDOWN_MS - 1
  await loop.tick()
  assert.equal(lidarrChecks, 1)
  await assert.rejects(loop.fix('lidarr', 'remote-paths'))
  assert.equal(lidarrChecks, 2, 'manual repair bypasses cooldown')
  now++
  await loop.tick()
  assert.equal(lidarrChecks, 3)
})

test('remote-paths: discovers TrueNAS nested /data/data/Torrents/ via filesystem API without Docker', async () => {
  let posted: unknown = null
  const seen: string[] = []
  const get: ConnFetch = async (url, init) => {
    const u = new URL(url)
    seen.push(`${init.method ?? 'GET'} ${u.pathname}${u.search}`)
    if (u.pathname.endsWith('/health')) {
      return { status: 200, json: [{ source: 'RemotePathMappingCheck', type: 'error', message: 'You are using docker; download client qBittorrent is placing downloads in "/data/Torrents/" but this directory does not appear to exist inside the container.' }] }
    }
    if (u.pathname.endsWith('/downloadclient')) {
      return { status: 200, json: [{ name: 'qBittorrent', fields: [{ name: 'host', value: '192.168.8.120' }] }] }
    }
    if (u.pathname.endsWith('/remotepathmapping') && (init.method ?? 'GET') === 'GET') {
      return { status: 200, json: [] }
    }
    if (u.pathname.endsWith('/filesystem')) {
      const p = u.searchParams.get('path')
      if (p === '/data/') return { status: 200, json: { directories: [{ path: '/data/Movies/' }, { path: '/data/data/' }] } }
      if (p === '/data/data/') return { status: 200, json: { directories: [{ path: '/data/data/Torrents/' }] } }
      return { status: 200, json: { directories: [] } }
    }
    if (u.pathname.endsWith('/remotepathmapping') && init.method === 'POST') {
      posted = init.body
      return { status: 201, json: init.body }
    }
    if (u.pathname.endsWith('/command') && init.method === 'POST') {
      return { status: 201, json: {} }
    }
    return { status: 404, json: null }
  }
  const s = settings({ lidarr: { url: 'http://192.168.8.120:30071', apiKey: 'lk' } })
  const msg = await runConnectionFix(s, 'lidarr', 'remote-paths', { get })
  assert.equal(msg, 'Added to Lidarr: /data/Torrents/ → /data/data/Torrents/.')
  assert.deepEqual(posted, { host: '192.168.8.120', remotePath: '/data/Torrents/', localPath: '/data/data/Torrents/' })
  assert.ok(seen.some((x) => x.startsWith('POST /api/v1/command')), 'triggered CheckHealth immediately')
})

test('one-click fixes: sab-resume, prowlarr-sync, arr-rootfolder, and arr-refresh', async () => {
  const seen: string[] = []
  const get = fake(
    {
      'GET sab:8080/api': { queue: { paused: true } },
      'GET radarr:7878/api/v3/system/status': {},
      'GET radarr:7878/api/v3/health': [
        { source: 'IndexerStatusCheck', type: 'warning', message: 'All indexers are unavailable due to failures' },
        { source: 'RootFolderCheck', type: 'error', message: 'Missing root folder: /old/movies' },
      ],
      'GET radarr:7878/api/v3/downloadclient': [],
      'POST radarr:7878/api/v3/downloadclient/testall': [],
      'GET radarr:7878/api/v3/rootfolder': [
        { id: 1, path: '/old/movies', accessible: false },
        { id: 2, path: '/data/media/movies', accessible: true },
      ],
      'DELETE radarr:7878/api/v3/rootfolder/1': {},
      'POST radarr:7878/api/v3/command': {},
      'GET prowlarr:9696/api/v1/system/status': {},
      'GET prowlarr:9696/api/v1/health': [],
      'GET prowlarr:9696/api/v1/indexer': [],
      'POST prowlarr:9696/api/v1/indexer/testall': [],
      'POST prowlarr:9696/api/v1/command': {},
    },
    seen,
  )
  const s = settings({
    sabnzbd: { url: 'http://sab:8080', apiKey: 'sk' },
    radarr: { url: 'http://radarr:7878', apiKey: 'rk' },
    prowlarr: { url: 'http://prowlarr:9696', apiKey: 'pk' },
  })
  const report = await checkConnections(s, get)
  const sabCheck = report.apps.find((a) => a.id === 'sabnzbd')!
  assert.deepEqual(sabCheck.fixes?.map((f) => f.id), ['sab-resume'])
  const radarrCheck = report.apps.find((a) => a.id === 'radarr')!
  assert.deepEqual(radarrCheck.fixes?.map((f) => f.id), ['prowlarr-sync', 'arr-rootfolder'])

  seen.length = 0
  assert.match(await runConnectionFix(s, 'sabnzbd', 'sab-resume', { get }), /Resumed SABnzbd/)
  assert.ok(seen.some((x) => x.includes('mode=resume')))

  seen.length = 0
  assert.match(await runConnectionFix(s, 'radarr', 'prowlarr-sync', { get }), /Synced indexers from Prowlarr into Radarr/)
  assert.ok(seen.includes('POST prowlarr:9696/api/v1/command'))

  seen.length = 0
  assert.match(await runConnectionFix(s, 'radarr', 'arr-rootfolder', { get }), /removed dead folder \/old\/movies/)
  assert.ok(seen.includes('DELETE radarr:7878/api/v3/rootfolder/1'))

  seen.length = 0
  assert.match(await runConnectionFix(s, 'radarr', 'arr-refresh', { get }), /refreshed Radarr/)
  assert.ok(seen.includes('POST radarr:7878/api/v3/command'))
})
