// A real certificate for Finesse's Tailscale name. When Tailscale runs in a
// container here with HTTPS certificates turned on for the tailnet, Tailscale
// hands out a Let's Encrypt certificate for the machine's name
// (<machine>.<tailnet>.ts.net). Finesse asks for it with `tailscale cert`
// inside that container, keeps it in <config>/tls/tailscale, and serves it to
// browsers that come by that name: no warning, and nothing to install.
// Renewed when it has less than a month left.

import { X509Certificate } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from './log.ts'
import type { Docker } from './stack/docker.ts'

const log = logger('tailscale')
const IMAGE = /(^|\/)tailscale\/tailscale(:|@|$)/i
const NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/i

export interface TailscaleCert {
  name: string
  key: string
  cert: string
}

/** The PEM blocks in `tailscale cert` output: the certificate chain, and the key. */
export function splitPem(text: string): { cert: string; key: string } | null {
  const blocks = text.match(/-----BEGIN ([A-Z ]+)-----[\s\S]+?-----END \1-----/g) ?? []
  const cert = blocks.filter((b) => b.startsWith('-----BEGIN CERTIFICATE-----')).join('\n')
  const key = blocks.find((b) => /PRIVATE KEY-----$/.test(b))
  return cert && key ? { cert: `${cert}\n`, key: `${key}\n` } : null
}

const fresh = (cert: string, days: number) => {
  try {
    return new Date(new X509Certificate(cert).validTo).getTime() - Date.now() > days * 86400_000
  } catch {
    return false
  }
}

/** The one kept on disk, if it's still good for a week. */
export function savedTailscaleCert(configDir: string): TailscaleCert | null {
  const dir = join(configDir, 'tls', 'tailscale')
  try {
    const name = readFileSync(join(dir, 'name'), 'utf8').trim()
    const cert = readFileSync(join(dir, 'cert.pem'), 'utf8')
    const key = readFileSync(join(dir, 'key.pem'), 'utf8')
    return NAME.test(name) && fresh(cert, 7) ? { name, cert, key } : null
  } catch {
    return null
  }
}

/** The Tailscale certificate: the saved one while it has a month left, else a new one from Tailscale (null without Tailscale or its HTTPS certificates). */
export async function tailscaleCert(docker: Docker, configDir: string): Promise<TailscaleCert | null> {
  if (process.env.FINESSE_TAILSCALE_CERT === 'off') return null
  const saved = savedTailscaleCert(configDir)
  if (saved && fresh(saved.cert, 30)) return saved
  const list = await docker.list({}, false).catch(() => [])
  const ts = list.find((c) => IMAGE.test(c.Image))
  if (!ts) return saved
  const status = await docker.exec(ts.Id, ['tailscale', 'status', '--self', '--json']).catch(() => null)
  let name = ''
  try {
    const j = JSON.parse(status?.output.slice(status.output.indexOf('{')) ?? '') as { CertDomains?: string[] | null }
    name = j.CertDomains?.find((d) => NAME.test(d)) ?? ''
  } catch {
    /* not JSON */
  }
  if (!name) return saved
  const r = await docker.exec(ts.Id, ['tailscale', 'cert', '--cert-file', '-', '--key-file', '-', name]).catch(() => null)
  const got = r ? splitPem(r.output) : null
  if (!got || !fresh(got.cert, 7)) {
    log.warn(`no certificate from Tailscale for ${name}${r ? `: ${r.output.trim().slice(-200)}` : ''}`)
    return saved
  }
  const dir = join(configDir, 'tls', 'tailscale')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'key.pem'), got.key, { mode: 0o600 })
  try {
    chmodSync(join(dir, 'key.pem'), 0o600)
  } catch {
    /* the share decides */
  }
  writeFileSync(join(dir, 'cert.pem'), got.cert)
  writeFileSync(join(dir, 'name'), name)
  log.info(`certificate for ${name} from Tailscale`)
  return { name, ...got }
}

export const hasTailscaleDir = (configDir: string) => existsSync(join(configDir, 'tls', 'tailscale'))
