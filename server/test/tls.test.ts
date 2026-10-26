// Finesse's own HTTPS certificate: signed by Finesse's own certificate
// authority (installed once on a device, it ends the browser warnings), which
// may only vouch for this server's names and private addresses; kept between
// starts, made again when the names change. Tailscale's real certificate for
// the Tailscale name. Built with node:crypto only.

import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createServer, get } from 'node:https'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { caPem, caScope, finesseCert, issueCert, selfSignedCert } from '../src/tls.ts'
import { splitPem, tailscaleCert } from '../src/tailscale.ts'
import { Docker } from '../src/stack/docker.ts'
import { fakeDocker } from './fakeDocker.ts'
import { tmp } from './helpers.ts'

test('a self-signed certificate for the names asked, that TLS serves', async () => {
  const { key, cert } = selfSignedCert(['192.168.1.20', 'nas.local', 'fd00::1'])
  const x = new X509Certificate(cert)
  assert.equal(x.subject, 'CN=Finesse')
  assert.ok(x.verify(x.publicKey), 'self-signed')
  assert.equal(x.ca, false)
  assert.ok(x.checkIP('192.168.1.20') && x.checkHost('nas.local') && x.checkHost('localhost') && x.checkIP('fd00::1'))
  assert.ok(new Date(x.validTo).getTime() - Date.now() > 3000 * 86400_000)
  const srv = createServer({ key, cert }, (_q, r) => r.end('secure')).listen(0, '127.0.0.1')
  await new Promise((r) => srv.once('listening', r))
  const body = await new Promise<string>((resolve, reject) =>
    get({ host: '127.0.0.1', port: (srv.address() as AddressInfo).port, ca: cert, servername: 'localhost' }, (r) => {
      let b = ''
      r.on('data', (d) => (b += d))
      r.on('end', () => resolve(b))
    }).on('error', reject),
  )
  srv.close()
  assert.equal(body, 'secure', 'trusted when its own certificate is the CA')
})

test('kept in <config>/tls between starts, made again when the names change', () => {
  const dir = tmp('finesse-tls-')
  const a = finesseCert(dir, ['nas.local'])
  assert.equal(finesseCert(dir, ['nas.local']).cert, a.cert)
  assert.equal(statSync(join(dir, 'tls', 'key.pem')).mode & 0o777, 0o600)
  const b = finesseCert(dir, ['nas.local', '10.0.0.5'])
  assert.notEqual(b.cert, a.cert)
  // On disk the server's own certificate; served with the authority's after it (the chain).
  assert.equal(readFileSync(join(dir, 'tls', 'cert.pem'), 'utf8') + caPem(dir), b.cert)
  // A private address already lies within the authority's scope: the authority stays (no reinstall).
  assert.equal(caPem(dir), readFileSync(join(dir, 'tls', 'ca.pem'), 'utf8'))
})

test('the authority signs Finesse’s certificate, and a device that trusts it trusts Finesse', async () => {
  const dir = tmp('finesse-ca-')
  const { key, cert } = finesseCert(dir, ['192.168.8.120', 'truenas-scale'])
  const ca = new X509Certificate(caPem(dir)!)
  const leaf = new X509Certificate(cert)
  assert.equal(ca.ca, true)
  assert.equal(leaf.ca, false)
  assert.ok(leaf.checkIssued(ca) && leaf.verify(ca.publicKey), 'signed by the authority')
  assert.ok(leaf.checkIP('192.168.8.120') && leaf.checkHost('truenas-scale'))
  // At most 397 days: what Apple's devices accept from an installed authority.
  assert.ok(new Date(leaf.validTo).getTime() - Date.now() < 398 * 86400_000)
  assert.equal(statSync(join(dir, 'tls', 'ca-key.pem')).mode & 0o777, 0o600)
  const srv = createServer({ key, cert }, (_q, r) => r.end('secure')).listen(0, '127.0.0.1')
  await new Promise((r) => srv.once('listening', r))
  const body = await new Promise<string>((resolve, reject) =>
    get({ host: '127.0.0.1', port: (srv.address() as AddressInfo).port, ca: caPem(dir)!, servername: 'localhost' }, (r) => {
      let b = ''
      r.on('data', (d) => (b += d))
      r.on('end', () => resolve(b))
    }).on('error', reject),
  )
  srv.close()
  assert.equal(body, 'secure', 'only the authority installed: Finesse is trusted')
})

test('the authority may only vouch for this server: its names, private addresses (name constraints)', () => {
  assert.deepEqual(caScope(['192.168.8.120', '100.80.175.94', 'truenas-scale', '8.8.4.4']), {
    hosts: ['local', 'localhost', 'truenas-scale'],
    ips: [
      ['10.0.0.0', '255.0.0.0'],
      ['172.16.0.0', '255.240.0.0'],
      ['192.168.0.0', '255.255.0.0'],
      ['127.0.0.0', '255.0.0.0'],
      ['100.64.0.0', '255.192.0.0'],
      ['8.8.4.4', '255.255.255.255'],
    ],
  })
  const dir = tmp('finesse-ca-scope-')
  finesseCert(dir, ['192.168.8.120'])
  // nameConstraints (2.5.29.30), critical: a verifier refuses anything outside them.
  assert.ok(new X509Certificate(caPem(dir)!).raw.includes(Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x1e, 0x01, 0x01, 0xff])))
  // A name outside the scope makes a new authority (devices install it again), never a wider old one.
  const before = caPem(dir)
  finesseCert(dir, ['192.168.8.120', 'finesse.example.com'])
  assert.notEqual(caPem(dir), before)
  // Even signed by the authority, a public name still isn't vouched for: a verifier checks the constraints.
  const forged = new X509Certificate(issueCert(['example.org'], { key: readFileSync(join(dir, 'tls', 'ca-key.pem'), 'utf8'), cert: caPem(dir)! }).cert)
  assert.ok(forged.checkHost('example.org'), 'the certificate says example.org…')
  assert.ok(!new X509Certificate(caPem(dir)!).raw.includes(Buffer.from('example.org')), '…but the authority’s scope never does')
})

test('Tailscale’s certificate for the Tailscale name: fetched, kept, renewed only when due', async () => {
  const real = selfSignedCert(['nas.tail1234.ts.net'], 89)
  const docker = await fakeDocker([{ id: 't', name: 'tailscale', image: 'ghcr.io/tailscale/tailscale:v1.98.4' }], {
    exec: (_c, cmd) =>
      cmd[1] === 'status'
        ? JSON.stringify({ Self: { DNSName: 'nas.tail1234.ts.net.' }, CertDomains: ['nas.tail1234.ts.net'] })
        : cmd[1] === 'cert'
          ? `${real.cert}${real.key}`
          : '',
  })
  process.env.DOCKER_SOCKET = docker.socket
  const dir = tmp('finesse-ts-')
  const got = await tailscaleCert(new Docker(), dir)
  assert.equal(got?.name, 'nas.tail1234.ts.net')
  assert.equal(got?.cert.trim(), real.cert.trim())
  assert.equal(statSync(join(dir, 'tls', 'tailscale', 'key.pem')).mode & 0o777, 0o600)
  const asked = docker.calls.filter((c) => c.startsWith('exec t tailscale cert')).length
  await tailscaleCert(new Docker(), dir)
  assert.equal(docker.calls.filter((c) => c.startsWith('exec t tailscale cert')).length, asked, 'still good for a month: not asked again')
  assert.deepEqual(splitPem('junk'), null)
  await docker.close()
})
