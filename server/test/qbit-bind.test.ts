// Windows torrents: qBittorrent is locked to the VPN app's adapter, and to an
// adapter that can't exist while that one is missing (so nothing leaks).

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { QBIT_LOCKED } from '../src/stack/seed.ts'
import { bindQbit } from '../src/stack/wire.ts'
import { listen } from './helpers.ts'

function fakeQbit(adapters: { name: string; value: string }[]) {
  const prefs: Record<string, unknown> = { current_network_interface: '' }
  const sets: Record<string, unknown>[] = []
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
    res.statusCode = 404
    res.end('{}')
  })
  return { server, prefs, sets }
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
