// Gluetun settings per VPN provider, and what a Usenet server's "502" turns into.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CATALOG, type StackContext } from '../src/stack/catalog.ts'
import { refusal } from '../src/setup/checks.ts'

const ctx = (vpn: StackContext['vpn']): StackContext => ({
  hostRoot: '/srv/finesse', hostData: '/srv/media', puid: 1000, pgid: 1000, timezone: 'Etc/UTC', network: 'finesse',
  exposeJellyfin: true, jellyfinPort: 8096, gpu: false, vpn,
})
const env = (vpn: StackContext['vpn']) => CATALOG.gluetun.env(ctx(vpn))

test('PIA, Windscribe and VyprVPN filter by region; the rest by country; custom not at all', () => {
  const pia = env({ provider: 'private internet access', type: 'openvpn', openvpnUser: 'p1234567', openvpnPassword: 'x', countries: ['Netherlands', 'US East'] })
  assert.equal(pia.SERVER_REGIONS, 'Netherlands,US East')
  assert.equal(pia.SERVER_COUNTRIES, undefined)
  assert.equal(pia.OPENVPN_USER, 'p1234567')
  assert.equal(env({ provider: 'windscribe', type: 'openvpn', countries: ['Canada'] }).SERVER_REGIONS, 'Canada')
  const mullvad = env({ provider: 'mullvad', type: 'wireguard', wireguardPrivateKey: 'k', wireguardAddresses: '10.0.0.2/32', countries: ['Sweden'] })
  assert.equal(mullvad.SERVER_COUNTRIES, 'Sweden')
  assert.equal(mullvad.SERVER_REGIONS, undefined)
  const custom = env({ provider: 'custom', type: 'wireguard', wireguardPrivateKey: 'k', countries: ['Sweden'] })
  assert.equal(custom.SERVER_COUNTRIES, undefined)
  assert.equal(custom.SERVER_REGIONS, undefined)
})

test('a 502 at sign-in says what the server meant', () => {
  assert.match(refusal('Authentication failed'), /refused the sign-in.*Authentication failed.*username and password/)
  assert.match(refusal('Too many connections'), /too many connections/)
  assert.match(refusal('Account expired'), /isn’t active/)
  assert.match(refusal(''), /^The server refused the sign-in\. /)
  assert.doesNotMatch(refusal('Authentication failed'), /Signed in/)
})
