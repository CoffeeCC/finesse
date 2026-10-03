// The setup document has two definitions: setup.schema.json (for people and
// AI agents) and validateSetup() (what the server enforces). These tests run
// both over the same good and bad documents so they can't drift apart.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { redact, servicesFor, validateSetup } from '../src/setup/doc.ts'
import { CATALOG, orderServices, proxyFor, type StackContext } from '../src/stack/catalog.ts'

const root = join(import.meta.dirname, '..', '..')
type Schema = Record<string, unknown>
const schema = JSON.parse(readFileSync(join(root, 'setup.schema.json'), 'utf8')) as Schema

/** Enough of JSON Schema (2020-12) for this document. Returns error paths. */
function check(s: Schema, v: unknown, at = ''): string[] {
  if (typeof s.$ref === 'string') {
    const name = s.$ref.replace('#/$defs/', '')
    return check((schema.$defs as Record<string, Schema>)[name]!, v, at)
  }
  if (s.oneOf) {
    const ok = (s.oneOf as Schema[]).filter((x) => check(x, v, at).length === 0)
    return ok.length === 1 ? [] : [`${at}: oneOf matched ${ok.length}`]
  }
  if ('const' in s && v !== s.const) return [`${at}: const`]
  if (s.enum && !(s.enum as unknown[]).includes(v)) return [`${at}: enum`]
  const type = s.type as string | undefined
  if (type) {
    const actual = v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v
    const okType = type === actual || (type === 'number' && actual === 'integer')
    if (!okType) return [`${at}: type ${type}`]
  }
  const errs: string[] = []
  if (typeof v === 'string') {
    if (typeof s.minLength === 'number' && v.length < s.minLength) errs.push(`${at}: minLength`)
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(v)) errs.push(`${at}: pattern`)
  }
  if (typeof v === 'number') {
    if (typeof s.minimum === 'number' && v < s.minimum) errs.push(`${at}: minimum`)
    if (typeof s.maximum === 'number' && v > s.maximum) errs.push(`${at}: maximum`)
  }
  if (Array.isArray(v)) {
    if (typeof s.minItems === 'number' && v.length < s.minItems) errs.push(`${at}: minItems`)
    if (s.items) v.forEach((x, i) => errs.push(...check(s.items as Schema, x, `${at}[${i}]`)))
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const props = (s.properties ?? {}) as Record<string, Schema>
    for (const r of (s.required as string[] | undefined) ?? []) if (!(r in o)) errs.push(`${at}.${r}: required`)
    for (const [k, x] of Object.entries(o)) {
      if (props[k]) errs.push(...check(props[k], x, `${at}.${k}`))
      else if (s.additionalProperties === false) errs.push(`${at}.${k}: additional`)
    }
  }
  return errs
}

const examples = readdirSync(join(root, 'examples', 'setup')).map((f) => [f, JSON.parse(readFileSync(join(root, 'examples', 'setup', f), 'utf8'))] as const)
const base = () => structuredClone(examples.find(([f]) => f === 'full.json')![1]) as Record<string, any>

// Documents both definitions must reject, each for one reason.
const bad: [string, (d: Record<string, any>) => unknown][] = [
  ['empty object', () => ({})],
  ['not an object', () => []],
  ['short password', (d) => ((d.admin.password = 'short'), d)],
  ['bad username', (d) => ((d.admin.username = 'a b'), d)],
  ['misspelt top-level key', (d) => ((d.downlaods = {}), d)],
  ['misspelt nested key', (d) => ((d.downloads.usenet.servers[0].sll = true), d)],
  ['version 2', (d) => ((d.version = 2), d)],
  ['country not ISO', (d) => ((d.server.country = 'usa'), d)],
  ['language not a code', (d) => ((d.server.language = 'English'), d)],
  ['timezone with spaces', (d) => ((d.server.timezone = 'New York'), d)],
  ['library flag not boolean', (d) => ((d.libraries = { movies: 'yes' }), d)],
  ['no usenet servers', (d) => ((d.downloads.usenet.servers = []), d)],
  ['usenet port 0', (d) => ((d.downloads.usenet.servers[0].port = 0), d)],
  ['usenet host with a path', (d) => ((d.downloads.usenet.servers[0].host = 'news.example.com/x'), d)],
  ['usenet 500 connections', (d) => ((d.downloads.usenet.servers[0].connections = 500), d)],
  ['usenet missing password', (d) => (delete d.downloads.usenet.servers[0].password, d)],
  ['torrents without a VPN', (d) => ((d.downloads.torrents = {}), d)],
  ['unknown VPN provider', (d) => ((d.downloads.torrents.vpn.provider = 'bogus'), d)],
  ['VPN type', (d) => ((d.downloads.torrents.vpn.type = 'ipsec'), d)],
  ['short WireGuard key', (d) => ((d.downloads.torrents.vpn.wireguard.privateKey = 'abc'), d)],
  ['countries not a list', (d) => ((d.downloads.torrents.vpn.countries = 'Netherlands'), d)],
  ['indexer kind', (d) => ((d.downloads.indexers[0].kind = 'rss'), d)],
  ['indexer url scheme', (d) => ((d.downloads.indexers[0].url = 'ftp://x.example'), d)],
  ['indexer without a name', (d) => (delete d.downloads.indexers[0].name, d)],
  ['quality preset', (d) => ((d.quality.preset = '8k'), d)],
  ['remote method', (d) => ((d.remoteAccess = { method: 'ngrok' }), d)],
  ['tailscale key format', (d) => ((d.remoteAccess.tailscale.authKey = 'abc'), d)],
  ['tailscale hostname', (d) => ((d.remoteAccess.tailscale.hostname = 'My Server'), d)],
  ['cloudflare over http', (d) => ((d.remoteAccess = { method: 'cloudflare', cloudflare: { token: 'x'.repeat(40), publicUrl: 'http://media.example.com' } }), d)],
  ['publicUrl not a URL', (d) => ((d.publicUrl = 'media.example.com'), d)],
  ['email port as text', (d) => ((d.email.port = '587'), d)],
  ['email from without @', (d) => ((d.email.from = 'Finesse'), d)],
  ['email secure not boolean', (d) => ((d.email.secure = 'yes'), d)],
  ['jellyfin port 80', (d) => ((d.options.jellyfinPort = 80), d)],
  ['exposeJellyfinPort not boolean', (d) => ((d.options.exposeJellyfinPort = 1), d)],
  ['emulator app unknown', (d) => ((d.emulators = { ...{ apps: ['pcsx2', 'switch', 'esde'], paths: { roms: '/srv/media/games', emulators: '/srv/emu', firmware: '/srv/fw', keys: '/srv/keys', saves: '/srv/saves' } }, apps: ['n64'] }), d)],
  ['emulator folder relative', (d) => ((d.emulators = { ...{ apps: ['pcsx2', 'switch', 'esde'], paths: { roms: '/srv/media/games', emulators: '/srv/emu', firmware: '/srv/fw', keys: '/srv/keys', saves: '/srv/saves' } }, paths: { roms: 'games' } }), d)],
  ['emulator folder with ..', (d) => ((d.emulators = { ...{ apps: ['pcsx2', 'switch', 'esde'], paths: { roms: '/srv/media/games', emulators: '/srv/emu', firmware: '/srv/fw', keys: '/srv/keys', saves: '/srv/saves' } }, paths: { ...{ apps: ['pcsx2', 'switch', 'esde'], paths: { roms: '/srv/media/games', emulators: '/srv/emu', firmware: '/srv/fw', keys: '/srv/keys', saves: '/srv/saves' } }.paths, keys: '/srv/../etc' } }), d)],
  ['emulator folder with a colon', (d) => ((d.emulators = { ...{ apps: ['pcsx2', 'switch', 'esde'], paths: { roms: '/srv/media/games', emulators: '/srv/emu', firmware: '/srv/fw', keys: '/srv/keys', saves: '/srv/saves' } }, paths: { ...{ apps: ['pcsx2', 'switch', 'esde'], paths: { roms: '/srv/media/games', emulators: '/srv/emu', firmware: '/srv/fw', keys: '/srv/keys', saves: '/srv/saves' } }.paths, saves: '/srv/a:b' } }), d)],
  ['emulators without paths', (d) => ((d.emulators = { apps: ['pcsx2'] }), d)],
  ['switch emulator unknown', (d) => ((d.emulators = { ...{ apps: ['pcsx2', 'switch', 'esde'], paths: { roms: '/srv/media/games', emulators: '/srv/emu', firmware: '/srv/fw', keys: '/srv/keys', saves: '/srv/saves' } }, switchEmulator: 'yuzu' }), d)],
  ['misspelt emulator setting', (d) => ((d.emulators = { ...{ apps: ['pcsx2', 'switch', 'esde'], paths: { roms: '/srv/media/games', emulators: '/srv/emu', firmware: '/srv/fw', keys: '/srv/keys', saves: '/srv/saves' } }, profile: ['user'] }), d)],
]

// Documents both must accept.
const good: [string, (d: Record<string, any>) => unknown][] = [
  ['usenet null, torrents only', (d) => ((d.downloads.usenet = null), (d.downloads.indexers = []), d)],
  ['torrents null, usenet only', (d) => ((d.downloads.torrents = null), d)],
  ['no downloads at all', (d) => (delete d.downloads, d)],
  ['email null', (d) => ((d.email = null), d)],
  ['OpenVPN provider', (d) => ((d.downloads.torrents.vpn = { provider: 'private internet access', type: 'openvpn', openvpn: { username: 'p1234567', password: 'x' } }), d)],
  ['custom WireGuard', (d) => ((d.downloads.torrents.vpn = { provider: 'custom', type: 'wireguard', wireguard: { privateKey: d.downloads.torrents.vpn.wireguard.privateKey, addresses: '10.2.0.2/32', endpointIp: '203.0.113.9', endpointPort: 51820, publicKey: 'k' } }), d)],
  ['cloudflare', (d) => ((d.remoteAccess = { method: 'cloudflare', cloudflare: { token: 'x'.repeat(40), publicUrl: 'https://media.example.com' } }), d)],
  ['own reverse proxy', (d) => ((d.remoteAccess = { method: 'none' }), (d.publicUrl = 'https://media.example.com/'), d)],
  ['Etc time zone', (d) => ((d.server.timezone = 'Etc/GMT+5'), d)],
  ['emulators', (d) => ((d.emulators = { apps: ['pcsx2', 'switch', 'esde'], paths: { roms: '/srv/media/games', emulators: '/srv/emu', firmware: '/srv/fw', keys: '/srv/keys', saves: '/srv/saves' } }), d)],
  ['emulators: Eden, one profile, own keys folder', (d) => ((d.emulators = { ...{ apps: ['pcsx2', 'switch', 'esde'], paths: { roms: '/srv/media/games', emulators: '/srv/emu', firmware: '/srv/fw', keys: '/srv/keys', saves: '/srv/saves' } }, switchEmulator: 'eden', profiles: ['user'], folders: { switch: { keys: '/srv/switch-keys' } } }), d)],
  ['emulators: none', (d) => ((d.emulators = { apps: [], paths: {} }), d)],
]

describe('setup document', () => {
  for (const [name, doc] of examples) {
    test(`example ${name} is valid in both`, () => {
      assert.deepEqual(check(schema, doc), [])
      assert.deepEqual(validateSetup(doc).problems, [])
    })
  }
  for (const [name, make] of good) {
    test(`accepts: ${name}`, () => {
      const d = make(base())
      assert.deepEqual(check(schema, d), [], 'schema')
      assert.deepEqual(validateSetup(d).problems, [], 'server')
    })
  }
  for (const [name, make] of bad) {
    test(`rejects: ${name}`, () => {
      const d = make(base())
      assert.notDeepEqual(check(schema, d), [], 'schema accepted it')
      const { doc, problems } = validateSetup(d)
      assert.equal(doc, null, 'server accepted it')
      assert.ok(problems.every((p) => p.message.length > 5), 'every problem explains itself')
    })
  }

  test('rules only the server can check (they span fields)', () => {
    let d = base()
    d.downloads.torrents = null
    d.downloads.indexers.push({ name: 'TL', kind: 'torznab', url: 'https://tl.example' })
    assert.match(validateSetup(d).problems[0]!.message, /need the torrent downloader/)
    d = base()
    d.downloads.usenet = null
    assert.match(validateSetup(d).problems[0]!.message, /need a Usenet server/)
    d = base()
    d.downloads.torrents.vpn = { provider: 'custom', type: 'wireguard', wireguard: { privateKey: d.downloads.torrents.vpn.wireguard.privateKey, addresses: '10.0.0.2/32' } }
    assert.match(validateSetup(d).problems[0]!.message, /custom WireGuard server needs/)
    d = base()
    d.downloads.torrents.vpn.type = 'openvpn'
    d.downloads.torrents.vpn.openvpn = { username: 'u', password: 'p' }
    delete d.downloads.torrents.vpn.wireguard
    assert.match(validateSetup(d).problems[0]!.message, /Mullvad works with WireGuard/)
  })

  test('services follow the document', () => {
    assert.deepEqual(servicesFor({ admin: { username: 'a', password: 'x' } }), ['jellyfin'])
    const full = base()
    assert.deepEqual(servicesFor(full as never), ['jellyfin', 'prowlarr', 'sonarr', 'radarr', 'lidarr', 'sabnzbd', 'gluetun', 'qbittorrent', 'tailscale'])
    full.libraries = { music: false }
    full.downloads.torrents = null
    full.remoteAccess = { method: 'none' }
    assert.deepEqual(servicesFor(full as never), ['jellyfin', 'prowlarr', 'sonarr', 'radarr', 'sabnzbd'])
  })

  test('games: RomM + its database, with optional artwork keys', () => {
    const d = base() as Record<string, any>
    d.libraries = { games: true }
    d.games = { igdb: { clientId: 'abc', clientSecret: 'IGDB_SECRET' }, steamGridDbKey: 'a1b2c3d4e5f6a7b8c9d0', screenscraper: { username: 'me', password: 'SS_PASSWORD' } }
    assert.deepEqual(validateSetup(d).problems, [])
    const ids = servicesFor(d as never)
    assert.ok(ids.includes('romm') && ids.includes('romm-db'))
    const order = orderServices(ids)
    assert.ok(order.indexOf('romm-db') < order.indexOf('romm'), 'the database starts first')
    const text = JSON.stringify(redact(d as never))
    for (const secret of ['IGDB_SECRET', 'a1b2c3d4e5f6a7b8c9d0', 'SS_PASSWORD']) assert.ok(!text.includes(secret), `leaked ${secret}`)

    const off = base() as Record<string, any>
    assert.ok(!servicesFor(off as never).includes('romm'), 'games is opt-in')
    off.games = { steamGridDbKey: 'short' }
    const problems = validateSetup(off).problems.map((p) => p.path)
    assert.ok(problems.includes('games'), 'keys need libraries.games')
    assert.ok(problems.includes('games.steamGridDbKey'))
  })

  test('RomM runs IPv4-only with its secrets and the games folder', () => {
    const ctx = { hostRoot: '/opt/finesse', hostData: '/srv/media', puid: 1000, pgid: 1000, timezone: 'UTC', network: 'finesse', exposeJellyfin: true, jellyfinPort: 8096, gpu: false, games: { dbPassword: 'DBP', dbRootPassword: 'ROOT', secretKey: 'SECRET', steamGridDbKey: 'SGDB' } } satisfies StackContext
    const env = CATALOG.romm.env(ctx)
    assert.equal(env.IPV4_ONLY, 'true')
    assert.equal(env.DB_PASSWD, 'DBP')
    assert.equal(env.ROMM_AUTH_SECRET_KEY, 'SECRET')
    assert.equal(env.STEAMGRIDDB_API_KEY, 'SGDB')
    assert.equal(env.IGDB_CLIENT_ID, undefined)
    assert.ok(CATALOG.romm.binds(ctx).includes('/srv/media/media/games:/romm/library'))
    assert.equal(CATALOG['romm-db'].env(ctx).MARIADB_PASSWORD, 'DBP')
    // No *_FILE variables for RomM (its entrypoint would inline the file).
    const px = proxyFor('romm', { ...ctx, proxy: { https: 'http://proxy:3128', caBundle: '/etc/ca.pem' } })
    assert.ok(!Object.keys(px.env).some((k) => k.endsWith('_FILE')))
    assert.ok(px.binds.includes('/etc/ca.pem:/etc/ssl/cert.pem:ro'))
    assert.equal(proxyFor('sonarr', { ...ctx, proxy: { https: 'http://proxy:3128', caBundle: '/etc/ca.pem' } }).env.SSL_CERT_FILE, '/etc/finesse-ca.pem')
  })

  test('redact hides every secret', () => {
    const d = base()
    const text = JSON.stringify(redact(d as never))
    for (const secret of ['change-me-please', 'USENET_PASSWORD', 'BLOCK_PASSWORD', 'INDEXER_API_KEY', d.downloads.torrents.vpn.wireguard.privateKey, 'tskey-auth-EXAMPLE', 'APP_PASSWORD']) {
      assert.ok(!text.includes(secret), `leaked ${secret}`)
    }
    assert.equal(d.admin.password, 'change-me-please', 'the original is untouched')
  })
})
