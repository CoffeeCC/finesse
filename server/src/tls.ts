// HTTPS for Finesse itself (FINESSE_HTTPS_PORT), without browser warnings:
//
// - Finesse's own certificate authority (kept in its config folder) signs the
//   certificate it serves. Install the authority's certificate once on a device
//   (Settings → Server → Secure connection) and that device trusts Finesse from
//   then on, renewals included. The authority can only vouch for this server's
//   own names and for private network addresses (name constraints), so its key
//   could never be used to pass off someone else's website.
// - With Tailscale's HTTPS certificates on (tailscale.ts), Finesse also serves a
//   real Let's Encrypt certificate for its Tailscale name: nothing to install.
//
// No dependencies: an ECDSA P-256 key from node:crypto and a small DER
// encoder for the certificate.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { hostname } from 'node:os'

const len = (n: number) => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]))
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), len(body.length), body])
const seq = (...parts: Buffer[]) => tlv(0x30, Buffer.concat(parts))
const set = (...parts: Buffer[]) => tlv(0x31, Buffer.concat(parts))
const ctx = (n: number, body: Buffer, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body)

function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number) as [number, number, ...number[]]
  const out = [a * 40 + b]
  for (const n of rest) {
    const bytes = [n & 0x7f]
    for (let v = n >> 7; v > 0; v >>= 7) bytes.unshift((v & 0x7f) | 0x80)
    out.push(...bytes)
  }
  return tlv(0x06, Buffer.from(out))
}

function integer(b: Buffer): Buffer {
  let i = 0
  while (i < b.length - 1 && b[i] === 0) i++
  const v = b.subarray(i)
  return tlv(0x02, v[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v)
}

const utcTime = (d: Date) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'))

function ipBytes(ip: string): Buffer {
  if (isIP(ip) === 4) return Buffer.from(ip.split('.').map(Number))
  // IPv6: expand "::" and write 8 groups.
  const [head, tail] = ip.split('::') as [string, string | undefined]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t]
  return Buffer.concat(groups.map((g) => Buffer.from([parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff])))
}

/** A self-signed certificate for these host names and addresses (PEM key + certificate). */
export function selfSignedCert(names: string[], days = 3650): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'))
  const name = seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from('Finesse')))))
  const now = new Date(Date.now() - 3600_000)
  const san = seq(...[...new Set(['localhost', ...names])].map((n) => (isIP(n) ? ctx(7, ipBytes(n), false) : ctx(2, Buffer.from(n), false))))
  const extensions = ctx(
    3,
    seq(
      seq(oid('2.5.29.17'), tlv(0x04, san)), // subjectAltName
      seq(oid('2.5.29.37'), tlv(0x04, seq(oid('1.3.6.1.5.5.7.3.1')))), // extKeyUsage: serverAuth
      seq(oid('2.5.29.19'), tlv(0x01, Buffer.from([0xff])), tlv(0x04, seq())), // basicConstraints: not a CA (critical)
    ),
  )
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))),
    integer(Buffer.concat([Buffer.from([0x01]), randomBytes(15)])),
    ecdsaSha256,
    name,
    seq(utcTime(now), utcTime(new Date(now.getTime() + days * 86400_000))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  )
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' })
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])))
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n?$/, '\n')}-----END CERTIFICATE-----\n`
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, cert }
}

const pem = (der: Buffer, label = 'CERTIFICATE') => `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n?$/, '\n')}-----END ${label}-----\n`
const ECDSA_SHA256 = () => seq(oid('1.2.840.10045.4.3.2'))
const cn = (text: string) => seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(text)))))
const keyId = (pub: KeyObject) => createHash('sha1').update(pub.export({ type: 'spki', format: 'der' }).subarray(-65)).digest()
const ext = (id: string, critical: boolean, value: Buffer) => seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, value))
const serial = () => integer(Buffer.concat([Buffer.from([0x01]), randomBytes(15)]))
const altName = (n: string) => (isIP(n) ? ctx(7, ipBytes(n), false) : ctx(2, Buffer.from(n), false))

function signCert(tbs: Buffer, key: KeyObject): string {
  const signature = sign('sha256', tbs, { key, dsaEncoding: 'der' })
  return pem(seq(tbs, ECDSA_SHA256(), tlv(0x03, Buffer.concat([Buffer.from([0]), signature]))))
}

/** Private, loopback and Tailscale (CGNAT) IPv4 ranges: addresses only a home network has. */
const PRIVATE_V4: [string, string][] = [
  ['10.0.0.0', '255.0.0.0'],
  ['172.16.0.0', '255.240.0.0'],
  ['192.168.0.0', '255.255.0.0'],
  ['127.0.0.0', '255.0.0.0'],
  ['100.64.0.0', '255.192.0.0'],
]
const inRange = (ip: string, [net, mask]: [string, string]) => {
  const n = (x: string) => x.split('.').reduce((v, o) => (v << 8) + Number(o), 0) >>> 0
  return (n(ip) & n(mask)) >>> 0 === (n(net) & n(mask)) >>> 0
}

/** What the authority may vouch for: private addresses, these host names (and below them), "localhost" and ".local". */
export function caScope(names: string[]): { ips: [string, string][]; hosts: string[] } {
  const hosts = new Set(['localhost', 'local'])
  const ips: [string, string][] = [...PRIVATE_V4]
  for (const n of names) {
    if (isIP(n) === 4) {
      if (!PRIVATE_V4.some((r) => inRange(n, r))) ips.push([n, '255.255.255.255'])
    } else if (!isIP(n)) hosts.add(n.toLowerCase())
  }
  return { ips, hosts: [...hosts].sort() }
}

/** A certificate authority for this server alone (name-constrained to its scope), valid ten years. */
export function makeCA(scope: { ips: [string, string][]; hosts: string[] }, label: string): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const now = new Date(Date.now() - 3600_000)
  const permitted = ctx(0, Buffer.concat([...scope.hosts.map((h) => seq(ctx(2, Buffer.from(h), false))), ...scope.ips.map(([ip, mask]) => seq(ctx(7, Buffer.concat([ipBytes(ip), ipBytes(mask)]), false)))]))
  const name = cn(`Finesse ${label}`.slice(0, 64))
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))),
    serial(),
    ECDSA_SHA256(),
    name,
    seq(utcTime(now), utcTime(new Date(now.getTime() + 3650 * 86400_000))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    ctx(
      3,
      seq(
        ext('2.5.29.19', true, seq(tlv(0x01, Buffer.from([0xff])), integer(Buffer.from([0])))), // basicConstraints: a CA, no CAs below it
        ext('2.5.29.15', true, tlv(0x03, Buffer.from([0x01, 0x06]))), // keyUsage: keyCertSign, cRLSign
        ext('2.5.29.30', true, seq(permitted)), // nameConstraints: only this server's names and private addresses
        ext('2.5.29.14', false, tlv(0x04, keyId(publicKey))), // subjectKeyIdentifier
      ),
    ),
  )
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, cert: signCert(tbs, privateKey) }
}

/** A server certificate for these names, signed by the authority; 397 days (what Apple's devices accept). */
export function issueCert(names: string[], ca: { key: string; cert: string }, days = 397): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const caKey = createPrivateKey(ca.key)
  const caCert = new X509Certificate(ca.cert)
  const now = new Date(Date.now() - 3600_000)
  // The issuer is the authority's own subject, byte for byte.
  const caSubject = subjectDer(caCert)
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))),
    serial(),
    ECDSA_SHA256(),
    caSubject,
    seq(utcTime(now), utcTime(new Date(now.getTime() + days * 86400_000))),
    cn('Finesse'),
    publicKey.export({ type: 'spki', format: 'der' }),
    ctx(
      3,
      seq(
        ext('2.5.29.17', false, seq(...[...new Set(['localhost', ...names])].map(altName))), // subjectAltName
        ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))), // extKeyUsage: serverAuth
        ext('2.5.29.15', true, tlv(0x03, Buffer.from([0x07, 0x80]))), // keyUsage: digitalSignature
        ext('2.5.29.19', true, seq()), // basicConstraints: not a CA
        ext('2.5.29.35', false, seq(ctx(0, keyId(createPublicKey(caKey)), false))), // authorityKeyIdentifier
      ),
    ),
  )
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, cert: signCert(tbs, caKey) }
}

/** A certificate's subject, as the DER bytes it was written with (an issuer must match them exactly). */
function subjectDer(c: X509Certificate): Buffer {
  // tbsCertificate → [version], serial, signature algorithm, issuer, validity, subject.
  const der = c.raw
  const read = (at: number) => {
    let n = der[at + 1]!
    let head = 2
    if (n & 0x80) {
      const bytes = n & 0x7f
      n = 0
      for (let i = 0; i < bytes; i++) n = (n << 8) | der[at + 2 + i]!
      head = 2 + bytes
    }
    return { start: at, body: at + head, end: at + head + n }
  }
  const cert = read(0)
  const tbs = read(cert.body)
  let at = tbs.body
  if (der[at] === 0xa0) at = read(at).end // version
  for (let i = 0; i < 4; i++) at = read(at).end // serial, signature, issuer, validity
  const subject = read(at)
  return der.subarray(subject.start, subject.end)
}

const writeKey = (file: string, key: string) => {
  writeFileSync(file, key, { mode: 0o600 })
  try {
    chmodSync(file, 0o600)
  } catch {
    /* the share decides */
  }
}

/** Finesse's authority: kept in <config>/tls, made again only when a name falls outside what it may vouch for. */
export function finesseCA(configDir: string, names: string[]): { key: string; cert: string; made: boolean } {
  const dir = join(configDir, 'tls')
  const keyFile = join(dir, 'ca-key.pem')
  const certFile = join(dir, 'ca.pem')
  const scope = caScope(names)
  if (existsSync(keyFile) && existsSync(certFile)) {
    try {
      const cert = readFileSync(certFile, 'utf8')
      const key = readFileSync(keyFile, 'utf8')
      const x = new X509Certificate(cert)
      createPrivateKey(key)
      const saved = readFileSync(join(dir, 'ca-scope.json'), 'utf8')
      const was = JSON.parse(saved) as { ips: [string, string][]; hosts: string[] }
      const covered = scope.hosts.every((h) => was.hosts.includes(h)) && scope.ips.every(([ip, m]) => was.ips.some((r) => r[0] === ip && r[1] === m))
      if (covered && new Date(x.validTo).getTime() - Date.now() > 400 * 86400_000) return { key, cert, made: false }
    } catch {
      /* unreadable: make a new one */
    }
  }
  const ca = makeCA(scope, `(${hostname().slice(0, 40) || 'this server'})`)
  mkdirSync(dir, { recursive: true })
  writeKey(keyFile, ca.key)
  writeFileSync(certFile, ca.cert)
  writeFileSync(join(dir, 'ca-scope.json'), JSON.stringify(scope))
  return { ...ca, made: true }
}

/** Finesse's certificate: signed by its authority, kept in <config>/tls, made again when the names change, the authority changed, or it nears its end. */
export function finesseCert(configDir: string, names: string[]): { key: string; cert: string } {
  const dir = join(configDir, 'tls')
  const keyFile = join(dir, 'key.pem')
  const certFile = join(dir, 'cert.pem')
  const ca = finesseCA(configDir, names)
  if (!ca.made && existsSync(keyFile) && existsSync(certFile)) {
    try {
      const cert = readFileSync(certFile, 'utf8')
      const key = readFileSync(keyFile, 'utf8')
      createPrivateKey(key)
      const x = new X509Certificate(cert)
      const has = (n: string) => (isIP(n) ? x.checkIP(n) !== undefined : x.checkHost(n) !== undefined)
      const signed = x.checkIssued(new X509Certificate(ca.cert)) && x.verify(new X509Certificate(ca.cert).publicKey)
      if (signed && new Date(x.validTo).getTime() - Date.now() > 30 * 86400_000 && names.every(has)) return { key, cert: cert + ca.cert }
    } catch {
      /* unreadable: make a new one */
    }
  }
  const made = issueCert(names, ca)
  mkdirSync(dir, { recursive: true })
  writeKey(keyFile, made.key)
  writeFileSync(certFile, made.cert)
  // The chain: the server's certificate, then the authority's.
  return { key: made.key, cert: made.cert + ca.cert }
}

/** The authority's certificate (PEM), to install on devices; null before Finesse made one. */
export function caPem(configDir: string): string | null {
  const f = join(configDir, 'tls', 'ca.pem')
  return existsSync(f) ? readFileSync(f, 'utf8') : null
}

/** Names for the certificate: FINESSE_HTTPS_NAMES (comma separated) and the public URL's host. */
export function certNames(publicUrl?: string): string[] {
  const names = (process.env.FINESSE_HTTPS_NAMES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (publicUrl) {
    try {
      names.push(new URL(publicUrl).hostname)
    } catch {
      /* not a URL */
    }
  }
  return [...new Set(names)]
}
