// Connection health (server/src/connections.ts): "the app answers" isn't "it works".
// Fake answers stand in for Radarr, Prowlarr, SABnzbd, qBittorrent and Gluetun.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Settings } from '../src/config.ts'
import { checkConnections, unreachable, type ConnFetch } from '../src/connections.ts'

const settings = (services: Settings['services']) => ({ services }) as Settings

/** Answers by "METHOD url-without-host"; a function answer may throw (unreachable). */
function fake(routes: Record<string, unknown>, seen: string[] = []): ConnFetch {
  return async (url, init) => {
    const u = new URL(url)
    const key = `${init.method ?? 'GET'} ${u.host}${u.pathname}`
    seen.push(`${key}${u.search}`)
    const r = routes[key]
    if (r === undefined) return { status: 404, json: null }
    if (typeof r === 'function') return (r as () => { status: number; json: unknown })()
    return { status: 200, json: r }
  }
}
const refused = () => {
  throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
}

test('all well: every app working, nothing to do', async () => {
  const r = await checkConnections(
    settings({ radarr: { url: 'http://radarr:7878', apiKey: 'rk' }, sabnzbd: { url: 'http://sab:8080', apiKey: 'sk' } }),
    fake({
      'GET radarr:7878/api/v3/system/status': { version: '5' },
      'GET radarr:7878/api/v3/health': [],
      'GET radarr:7878/api/v3/downloadclient': [{ id: 1, name: 'SABnzbd' }],
      'POST radarr:7878/api/v3/downloadclient/testall': [{ id: 1, isValid: true }],
      'GET sab:8080/api': { queue: { paused: false } },
    }),
  )
  assert.deepEqual(
    r.apps.map((a) => [a.name, a.ok, a.summary]),
    [
      ['Radarr', true, 'Working'],
      ['SABnzbd', true, 'Working'],
    ],
  )
  assert.equal(r.vpn, null)
})

test('Radarr answers, but its indexers and download client fail: that’s reported, in its own words', async () => {
  const r = await checkConnections(
    settings({ radarr: { url: 'http://radarr:7878', apiKey: 'rk' }, prowlarr: { url: 'http://prowlarr:9696', apiKey: 'pk' } }),
    fake({
      'GET radarr:7878/api/v3/system/status': {},
      'GET radarr:7878/api/v3/health': [
        { source: 'IndexerStatusCheck', type: 'error', message: 'All indexers are unavailable due to failures' },
        { source: 'UpdateCheck', type: 'notice', message: 'ignored' },
      ],
      'GET radarr:7878/api/v3/downloadclient': [{ id: 3, name: 'qBittorrent' }],
      'POST radarr:7878/api/v3/downloadclient/testall': [{ id: 3, isValid: false, validationFailures: [{ errorMessage: 'Unable to connect to qBittorrent' }] }],
      'GET prowlarr:9696/api/v1/system/status': {},
      'GET prowlarr:9696/api/v1/health': [{ type: 'warning', message: 'Indexers unavailable due to failures for more than 6 hours: NZBgeek' }],
      'GET prowlarr:9696/api/v1/indexer': [{ id: 7, name: 'NZBgeek' }],
      'POST prowlarr:9696/api/v1/indexer/testall': [{ id: 7, isValid: false, validationFailures: [{ errorMessage: 'Invalid API key' }] }],
      'GET qbit:8080/api/v2/app/version': () => ({ status: 403, json: null }),
    }),
  )
  const radarr = r.apps.find((a) => a.id === 'radarr')!
  assert.equal(radarr.ok, false)
  assert.deepEqual(radarr.problems, ['Radarr: All indexers are unavailable due to failures', 'qBittorrent (in Radarr): Unable to connect to qBittorrent'])
  assert.match(radarr.summary, /2 problems: open Radarr to fix them/)
  const prowlarr = r.apps.find((a) => a.id === 'prowlarr')!
  assert.equal(prowlarr.ok, false)
  assert.ok(prowlarr.problems.includes('NZBgeek (in Prowlarr): Invalid API key'))
  // qBittorrent isn't connected to Finesse here, so no VPN guess.
  assert.equal(r.vpn, null)
})

test('a dead address, a wrong key, a paused SABnzbd: each says what to do', async () => {
  const r = await checkConnections(
    settings({ sonarr: { url: 'http://sonarr:8989', apiKey: 'x' }, lidarr: { url: 'http://lidarr:8686', apiKey: 'bad' }, sabnzbd: { url: 'http://sab:8080', apiKey: 'sk' } }),
    fake({
      'GET sonarr:8989/api/v3/system/status': refused,
      'GET lidarr:8686/api/v1/system/status': () => ({ status: 401, json: null }),
      'GET sab:8080/api': { queue: { paused: true } },
    }),
  )
  const by = Object.fromEntries(r.apps.map((a) => [a.id, a]))
  assert.equal(by.sonarr!.ok, false)
  assert.match(by.sonarr!.summary, /Sonarr isn’t answering at its address: it may be stopped, or on another port/)
  assert.equal(by.lidarr!.ok, false)
  assert.match(by.lidarr!.summary, /turned down Finesse’s API key. Copy the key from Lidarr/)
  assert.equal(by.sabnzbd!.ok, null)
  assert.match(by.sabnzbd!.problems[0]!, /SABnzbd is paused/)
  // Keys never show up in what's reported.
  assert.doesNotMatch(JSON.stringify(r), /"sk"|"bad"|apikey=/)
})

test('VPN: Gluetun asked when it’s there; otherwise guessed from torrent failures', async () => {
  const down = await checkConnections(
    settings({ gluetun: { url: 'http://gluetun:8000', apiKey: 'g' } }),
    fake({ 'GET gluetun:8000/v1/vpn/status': { status: 'stopped' } }),
  )
  assert.equal(down.vpn?.ok, false)
  assert.match(down.vpn!.summary, /The VPN is stopped. Torrents wait until it’s back/)
  const up = await checkConnections(
    settings({ gluetun: { url: 'http://gluetun:8000' } }),
    fake({ 'GET gluetun:8000/v1/vpn/status': { status: 'running' }, 'GET gluetun:8000/v1/publicip/ip': { public_ip: '203.0.113.5', country: 'Netherlands' } }),
  )
  assert.deepEqual(up.vpn, { ok: true, summary: 'Connected (Netherlands)', source: 'gluetun' })
  // No Gluetun: qBittorrent can't be reached → the VPN may be down (said as a guess).
  const guess = await checkConnections(settings({ qbittorrent: { url: 'http://10.0.0.5:8080' } }), fake({ 'GET 10.0.0.5:8080/api/v2/app/version': refused }))
  assert.equal(guess.vpn?.source, 'inferred')
  assert.equal(guess.vpn?.ok, null)
  assert.match(guess.vpn!.summary, /the VPN may be down/)
})

test('network failures in plain words', () => {
  assert.match(unreachable('Radarr', Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })), /Can’t find Radarr at its address/)
  assert.match(unreachable('Radarr', new Error('The operation was aborted due to timeout')), /didn’t answer in time/)
})

test('/api/system/connections is for administrators only', async () => {
  const { call, fakeJellyfin, finesse } = await import('./peers.ts')
  const jf = await fakeJellyfin('Home', [{ name: 'alex', token: 'a-admin', admin: true }, { name: 'robin', token: 'a-robin', admin: false }], 'a-service')
  const f = await finesse('c', jf, 'a-service')
  try {
    assert.equal((await call(f.url, 'GET', '/api/system/connections', 'a-robin')).status, 403)
    const r = await call(f.url, 'GET', '/api/system/connections', 'a-admin')
    assert.equal(r.status, 200)
    assert.deepEqual(r.data.apps, [])
  } finally {
    for (const s of [f.app, jf.server]) {
      s.closeAllConnections()
      s.close()
    }
  }
})
