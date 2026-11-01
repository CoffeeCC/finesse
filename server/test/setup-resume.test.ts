// Leaving setup half-way and coming back (src/pages/setup/resume.ts): the choices and the step
// reached are kept for this server, never a password or key; the steps that had one ask again.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PROGRESS_MAX_AGE_MS, progressFor, readProgress, resumeIndex, withoutSecrets } from '../../src/pages/setup/resume.ts'

const draft = {
  admin: { username: 'alex', password: 'hunter22', confirm: 'hunter22' },
  server: { name: 'Home', timezone: 'Europe/London', country: 'GB', language: 'en' },
  libraries: { movies: true, shows: true, music: false, games: true, samples: false },
  games: { steamGridDbKey: 'abcdefabcdefabcdef12', igdbClientId: 'id1', igdbClientSecret: 'shh' },
  usenet: true,
  torrents: true,
  native: false,
  vpnAdapter: '',
  servers: [{ preset: '', name: 'News', host: 'news.example.com', port: '563', ssl: true, username: 'u', password: 'usenet-pass', connections: '20', priority: 0 }],
  indexers: [{ name: 'Geek', kind: 'newznab', url: 'https://api.example.com', apiKey: 'ix-key', key: 'k1' }],
  builtinOffered: true,
  vpn: { provider: 'mullvad', type: 'wireguard', privateKey: 'wg-private', addresses: '10.0.0.2/32', presharedKey: '', endpointIp: '', endpointPort: '51820', publicKey: '', username: '', password: '', countries: '' },
  quality: '1080p',
  remote: 'tailscale',
  tailscale: { authKey: 'tskey-abc', hostname: 'finesse' },
  cloudflare: { token: '', publicUrl: '' },
  publicUrl: '',
  emailOn: true,
  email: { preset: 'gmail', host: 'smtp.gmail.com', port: '465', secure: true, username: 'me@example.com', password: 'app-pass', from: 'me@example.com' },
}

test('nothing secret is kept, and the steps that had a secret are named', () => {
  const { draft: kept, reenter } = withoutSecrets(draft)
  const text = JSON.stringify(kept)
  for (const secret of ['hunter22', 'abcdefabcdefabcdef12', 'shh', 'usenet-pass', 'ix-key', 'wg-private', 'tskey-abc', 'app-pass']) assert.ok(!text.includes(secret), secret)
  assert.deepEqual(new Set(reenter), new Set(['account', 'libraries', 'usenet', 'indexers', 'vpn', 'remote', 'email']))
  // The choices stay.
  assert.equal(kept.admin.username, 'alex')
  assert.equal(kept.servers[0]!.host, 'news.example.com')
  assert.equal(kept.vpn.addresses, '10.0.0.2/32')
  assert.equal(kept.email.username, 'me@example.com')
  assert.equal(draft.admin.password, 'hunter22', 'the live draft is untouched')
  // Nothing secret to drop: nothing to enter again.
  assert.deepEqual(withoutSecrets(kept).reenter, [])
})

test('a saved setup is only picked up on its own server, and not when it is old', () => {
  const now = 1_800_000_000_000
  const raw = JSON.stringify(progressFor('server-a', 'remote', draft, now))
  assert.equal(readProgress(raw, 'server-a', now + 1000)?.step, 'remote')
  assert.equal(readProgress(raw, 'server-b', now), null)
  assert.equal(readProgress(raw, 'server-a', now + PROGRESS_MAX_AGE_MS + 1), null)
  assert.equal(readProgress('{not json', 'server-a', now), null)
  assert.equal(readProgress(null, 'server-a', now), null)
})

test('resuming lands on the step reached, or the first earlier one that needs something', () => {
  const steps = ['welcome', 'start', 'machine', 'account', 'libraries', 'downloads', 'remote', 'email', 'review'] as const
  const none = () => null
  assert.equal(resumeIndex([...steps], 'remote', none), 6)
  assert.equal(resumeIndex([...steps], 'remote', none, ['account', 'email']), 3, 'the password first')
  assert.equal(resumeIndex([...steps], 'remote', (s) => (s === 'machine' ? 'Fix the problems above' : null)), 2)
  assert.equal(resumeIndex([...steps], 'welcome', none), 1)
  assert.equal(resumeIndex([...steps], null, none), 1)
  // A step that no longer exists (downloads were turned off): start of the wizard.
  assert.equal(resumeIndex([...steps], 'vpn', none), 1)
})
