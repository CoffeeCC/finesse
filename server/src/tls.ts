// HTTPS for Finesse itself (FINESSE_HTTPS_PORT): a certificate Finesse makes
// for itself and keeps in its config folder. Browsers warn once that they
// don't know it; after that the page is a secure context, which browser play
// (WebCodecs) and other modern browser features need. A real certificate
// from your own reverse proxy (or Tailscale) is better when you have one.
//
// No dependencies: an ECDSA P-256 key from node:crypto and a small DER
// encoder for the certificate.

import { createPrivateKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'

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

/** Finesse's certificate: kept in <config>/tls, made again when the names change or it nears its end. */
export function finesseCert(configDir: string, names: string[]): { key: string; cert: string } {
  const dir = join(configDir, 'tls')
  const keyFile = join(dir, 'key.pem')
  const certFile = join(dir, 'cert.pem')
  if (existsSync(keyFile) && existsSync(certFile)) {
    try {
      const cert = readFileSync(certFile, 'utf8')
      const key = readFileSync(keyFile, 'utf8')
      createPrivateKey(key)
      const x = new X509Certificate(cert)
      const has = (n: string) => (isIP(n) ? x.checkIP(n) !== undefined : x.checkHost(n) !== undefined)
      if (new Date(x.validTo).getTime() - Date.now() > 30 * 86400_000 && names.every(has)) return { key, cert }
    } catch {
      /* unreadable: make a new one */
    }
  }
  const made = selfSignedCert(names)
  mkdirSync(dir, { recursive: true })
  writeFileSync(keyFile, made.key, { mode: 0o600 })
  try {
    chmodSync(keyFile, 0o600)
  } catch {
    /* the share decides */
  }
  writeFileSync(certFile, made.cert)
  return made
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
