// Windows torrents: qBittorrent is locked to the VPN app's adapter, and to an
// adapter that can't exist while that one is missing (so nothing leaks).

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { QBIT_LOCKED, seedQbit } from '../src/stack/seed.ts'
import { bindQbit, syncQbitTunnel } from '../src/stack/wire.ts'
import { listen, tmp } from './helpers.ts'

function fakeQbit(adapters: { name: string; value: string }[], initialPrefs: Record<string, unknown> = {}) {
  const prefs: Record<string, unknown> = { current_network_interface: '', ...initialPrefs }
  const sets: Record<string, unknown>[] = []
  let reannounces = 0
  const server = createServer(async (req, res) => {
    const body = await new Promise<string>((r) => {
      let b = ''
      req.on('data', (c) => (b += c)).on('end', () => r(b))
    })
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/v2/app/networkInterfaceList') return res.end(JSON.stringify(adapters))
    if (req.url === '/api/v2/app/preferences') return res.end(JSON.stringify(prefs))
    if (req.url === '/api/v2/app/setPreferences') {
      const set = JSON.parse(new URLSearchParams(body).get('json')!) as Record<string, unknown>
      sets.push(set)
      Object.assign(prefs, set)
      return res.end('')
    }
    if (req.url === '/api/v2/torrents/reannounce') {
      reannounces++
      return res.end('')
    }
    res.statusCode = 404
    res.end('{}')
  })
  return { server, prefs, sets, get reannounces() { return reannounces } }
}

test('locks to the VPN adapter by its name, once', async () => {
  const q = fakeQbit([
    { name: 'Ethernet', value: 'ethernet_32769' },
    { name: 'NordLynx', value: 'iftype53_32768' },
  ])
  const url = await listen(q.server)
  try {
    assert.equal(await bindQbit(url, 'nordlynx'), true)
    assert.equal(q.prefs.current_network_interface, 'iftype53_32768')
    assert.equal(await bindQbit(url, 'NordLynx'), true)
    assert.equal(q.sets.length, 1, 'nothing to change the second time')
  } finally {
    q.server.close()
  }
})

test('a missing adapter locks qBittorrent to nothing instead of the normal connection', async () => {
  const q = fakeQbit([{ name: 'Wi-Fi', value: 'wireless_32768' }])
  const url = await listen(q.server)
  try {
    assert.equal(await bindQbit(url, 'Mullvad'), false)
    assert.equal(q.prefs.current_network_interface, QBIT_LOCKED)
  } finally {
    q.server.close()
  }
})

test('the Windows qBittorrent starts with its web UI on, locked, and with no first-run questions', () => {
  const dir = tmp()
  assert.ok(seedQbit(dir, 0, 0, { native: true, port: 8090, data: (rel) => join('C:\\Media', rel) }))
  const ini = readFileSync(join(dir, 'qBittorrent', 'config', 'qBittorrent.ini'), 'utf8')
  for (const line of ['WebUI\\Enabled=true', 'WebUI\\Address=127.0.0.1', 'WebUI\\Port=8090', 'WebUI\\LocalHostAuth=false', `Session\\Interface=${QBIT_LOCKED}`, 'Advanced\\neverCheckFileAssoc=true', 'Advanced\\updateCheck=false'])
    assert.ok(ini.split('\n').includes(line), line)
})

test('Docker qBittorrent seeds IPv4-only binding and announces to all trackers', () => {
  const dir = tmp()
  assert.ok(seedQbit(dir, 0, 0))
  const conf = readFileSync(join(dir, 'qBittorrent', 'qBittorrent.conf'), 'utf8')
  for (const line of ['Session\\InterfaceAddress=0.0.0.0', 'Session\\AnnounceToAllTrackers=true', 'Session\\AnnounceToAllTiers=true'])
    assert.ok(conf.split('\n').includes(line), line)
})

test('syncQbitTunnel binds to tun0/IPv4, syncs forwarded port, reannounces, and is idempotent', async () => {
  const q = fakeQbit(
    [
      { name: 'lo', value: 'lo' },
      { name: 'eth0', value: 'eth0' },
      { name: 'tun0', value: 'tun0' },
    ],
    { current_interface_address: '', listen_port: 6881, announce_to_all_trackers: false, announce_to_all_tiers: false },
  )
  const url = await listen(q.server)
  try {
    const first = await syncQbitTunnel(url, { port: 47023 })
    assert.equal(first.changed, true)
    assert.equal(first.iface, 'tun0')
    assert.equal(q.prefs.current_network_interface, 'tun0')
    assert.equal(q.prefs.current_interface_address, '0.0.0.0')
    assert.equal(q.prefs.listen_port, 47023)
    assert.equal(q.prefs.announce_to_all_trackers, true)
    assert.equal(q.prefs.announce_to_all_tiers, true)
    assert.equal(q.reannounces, 1)

    // Repeat with same port & no reconnect: zero writes, zero reannounces.
    const second = await syncQbitTunnel(url, { port: 47023 })
    assert.equal(second.changed, false)
    assert.equal(q.sets.length, 1)
    assert.equal(q.reannounces, 1)

    // Explicit VPN reconnect still triggers a reannounce without rewriting unchanged prefs.
    const third = await syncQbitTunnel(url, { port: 47023, reannounce: true })
    assert.equal(third.changed, false)
    assert.equal(q.sets.length, 1)
    assert.equal(q.reannounces, 2)
  } finally {
    q.server.close()
  }
})
