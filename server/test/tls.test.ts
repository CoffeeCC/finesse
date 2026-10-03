// Finesse's own HTTPS certificate: valid, for the names asked, kept between
// starts, made again when the names change. Built with node:crypto only.

import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { createServer, get } from 'node:https'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { finesseCert, selfSignedCert } from '../src/tls.ts'
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
  assert.equal(readFileSync(join(dir, 'tls', 'cert.pem'), 'utf8'), b.cert)
})
