// `finesse` — command-line companion inside the Finesse container.
// Run it with `docker exec -it finesse finesse <command>`.
//
//   finesse setup-code                 show the one-time setup code
//   finesse setup validate <file|->    check a setup document without applying it
//   finesse setup check <file|->       test the document's Usenet servers, indexers and VPN for real
//   finesse setup apply <file|->       build the server from a setup document (waits, shows progress)
//   finesse setup status [--json]      progress of the current/last setup run
//   finesse doctor [--json]            health report: apps, VPN, disk, backups
//   finesse backup                     back up now
//   finesse restore <backup>           put a backup's settings back (then restart Finesse)
//   finesse version                    server version
//   finesse swap <id> <image>          (internal) replace a Finesse container with a new image
//
// The CLI talks to the running server on localhost. Before setup it uses the
// setup code; afterwards Finesse's own Jellyfin key (read from its config).

import { chownSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { VERSION } from '../src/jellyfin.ts'
import { Docker } from '../src/stack/docker.ts'
import { swap } from '../src/stack/selfupdate.ts'
import { readTar, safeRelPath } from '../src/tar.ts'

const configDir = resolve(process.env.FINESSE_CONFIG_DIR || '/config')
const base = process.env.FINESSE_URL || `http://127.0.0.1:${process.env.PORT || 8080}`
const tty = process.stdout.isTTY
const c = (code: string, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const green = (s: string) => c('32', s)
const red = (s: string) => c('31', s)
const yellow = (s: string) => c('33', s)
const dim = (s: string) => c('2', s)
const bold = (s: string) => c('1', s)

function setupCode(): string | null {
  if (process.env.FINESSE_SETUP_CODE) return process.env.FINESSE_SETUP_CODE
  const f = join(configDir, 'setup-code')
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : null
}

function serviceKey(): string | null {
  try {
    const s = JSON.parse(readFileSync(join(configDir, 'finesse.json'), 'utf8')) as { jellyfin?: { apiKey?: string } }
    return s.jellyfin?.apiKey || null
  } catch {
    return null
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = process.env.FINESSE_TOKEN || serviceKey()
  if (token) h.Authorization = `MediaBrowser Client="finesse-cli", Device="cli", DeviceId="finesse-cli", Version="${VERSION}", Token="${token}"`
  const code = setupCode()
  if (code) h['X-Finesse-Setup-Code'] = code
  return h
}

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  let res: Response
  try {
    res = await fetch(base + path, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) })
  } catch (e) {
    throw new Error(`Finesse isn't answering on ${base} (${(e as Error).message}) — is the container running?`)
  }
  const text = await res.text()
  let data: unknown = text
  try {
    data = JSON.parse(text)
  } catch {
    /* text */
  }
  return { status: res.status, data: data as T }
}

async function readDoc(arg: string | undefined): Promise<unknown> {
  if (!arg) throw new Error('Give a setup file, or - to read it from stdin')
  let text: string
  if (arg === '-') {
    const chunks: Buffer[] = []
    for await (const ch of process.stdin) chunks.push(ch as Buffer)
    text = Buffer.concat(chunks).toString('utf8')
  } else text = readFileSync(arg, 'utf8')
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`That isn't valid JSON: ${(e as Error).message}`)
  }
}

interface Problem {
  path: string
  message: string
}
interface RunStatus {
  state: string
  steps: { id: string; title: string; state: string; detail?: string }[]
  log: string[]
  warnings: string[]
  error?: string
}

function printProblems(problems: Problem[]) {
  for (const p of problems) console.log(`  ${red('✖')} ${bold(p.path || '(document)')}: ${p.message}`)
}

const ICON: Record<string, string> = { done: green('✔'), running: yellow('…'), pending: dim('·'), error: red('✖'), skipped: dim('–') }

function printSteps(s: RunStatus) {
  for (const st of s.steps) console.log(`  ${ICON[st.state] ?? '?'} ${st.state === 'pending' || st.state === 'skipped' ? dim(st.title) : st.title}${st.detail && st.state !== 'done' ? dim(`  ${st.detail}`) : ''}`)
}

async function setup(argv: string[]): Promise<number> {
  const [sub, arg] = argv
  const json = argv.includes('--json')
  if (sub === 'validate') {
    const r = await api<{ ok: boolean; problems: Problem[]; error?: string }>('POST', '/api/setup/validate', await readDoc(arg))
    if (r.status >= 400) throw new Error((r.data as { error?: string }).error ?? `HTTP ${r.status}`)
    if (json) console.log(JSON.stringify(r.data, null, 2))
    else if (r.data.ok) console.log(`${green('✔')} The setup document is valid.`)
    else {
      console.log(`${red('The setup document has problems:')}`)
      printProblems(r.data.problems)
    }
    return r.data.ok ? 0 : 1
  }
  if (sub === 'check') {
    type Doc = { downloads?: { usenet?: { servers?: Record<string, unknown>[] } | null; torrents?: { vpn?: unknown } | null; indexers?: Record<string, unknown>[] } }
    const doc = (await readDoc(arg)) as Doc
    const checks: [string, string, unknown][] = []
    for (const srv of doc.downloads?.usenet?.servers ?? []) checks.push([`Usenet ${String(srv.name ?? srv.host)}`, '/api/setup/check/usenet', srv])
    for (const ix of doc.downloads?.indexers ?? []) checks.push([`Indexer ${String(ix.name)}`, '/api/setup/check/indexer', ix])
    if (doc.downloads?.torrents?.vpn) checks.push(['VPN', '/api/setup/check/vpn', doc.downloads.torrents.vpn])
    if (!checks.length) {
      console.log('Nothing to check (no Usenet servers, indexers or VPN in the document).')
      return 0
    }
    const results: { name: string; ok: boolean; message: string }[] = []
    for (const [name, path, body] of checks) {
      if (!json && tty) process.stdout.write(`  ${dim('…')} ${name}${name === 'VPN' ? dim(' (up to 90 s)') : ''}\r`)
      const r = await api<{ ok?: boolean; message?: string; error?: string }>('POST', path, body)
      const ok = r.status < 400 && r.data.ok === true
      const message = r.data.message ?? r.data.error ?? `HTTP ${r.status}`
      results.push({ name, ok, message })
      if (!json) console.log(`  ${ok ? green('✔') : red('✖')} ${name}: ${message}`)
    }
    if (json) console.log(JSON.stringify({ ok: results.every((x) => x.ok), results }, null, 2))
    return results.every((x) => x.ok) ? 0 : 1
  }
  if (sub === 'apply') {
    const r = await api<RunStatus & { error?: string; details?: Problem[] }>('POST', '/api/setup/apply', await readDoc(arg))
    if (r.status === 422) {
      console.log(red('The setup document has problems:'))
      printProblems(r.data.details ?? [])
      return 1
    }
    if (r.status >= 400) throw new Error(r.data.error ?? `HTTP ${r.status}`)
    if (argv.includes('--no-wait')) {
      console.log('Setup started. Follow it with: finesse setup status')
      return 0
    }
    let seen = 0
    for (;;) {
      await new Promise((res) => setTimeout(res, 2000))
      const s = await api<RunStatus>('GET', '/api/setup/status').catch(() => null)
      if (!s || s.status >= 400) continue // Jellyfin may be restarting under us
      for (const line of s.data.log.slice(seen)) console.log(dim(line))
      seen = s.data.log.length
      if (s.data.state !== 'running') {
        console.log('')
        printSteps(s.data)
        for (const w of s.data.warnings) console.log(`  ${yellow('!')} ${w}`)
        if (s.data.state === 'done') {
          console.log(`\n${green('✔ Your server is ready.')} Open Finesse in a browser and sign in as your admin.`)
          return 0
        }
        console.log(`\n${red('✖ Setup stopped:')} ${s.data.error ?? 'unknown error'}\n  Fix the problem and run the same command again — finished steps are skipped.`)
        return 1
      }
    }
  }
  if (sub === 'status') {
    const r = await api<RunStatus & { setup: string; error?: string }>('GET', '/api/setup/status')
    if (r.status >= 400) throw new Error(r.data.error ?? `HTTP ${r.status}`)
    if (json) console.log(JSON.stringify(r.data, null, 2))
    else {
      console.log(`Setup: ${bold(r.data.setup)}  (this run: ${r.data.state})`)
      printSteps(r.data)
      for (const w of r.data.warnings) console.log(`  ${yellow('!')} ${w}`)
      if (r.data.error) console.log(`  ${red('✖')} ${r.data.error}`)
    }
    return r.data.state === 'error' ? 1 : 0
  }
  console.log('Usage: finesse setup validate|check|apply|status <file|->')
  return 2
}

interface Health {
  version: string
  web: string | null
  mode: string
  setup: { state: string; completedAt: string | null }
  health: {
    docker: boolean
    network: boolean
    services: { id: string; name: string; state: string; detail?: string; updatePending: boolean }[]
    vpn: { connected: boolean; publicIp?: string; country?: string; error?: string } | null
    disks: { label: string; path: string; total: number; free: number }[]
    backups: { last: string | null; error?: string }
    events: { at: string; level: string; message: string }[]
  }
}

const gb = (n: number) => `${(n / 1e9).toFixed(n > 100e9 ? 0 : 1)} GB`

async function doctor(argv: string[]): Promise<number> {
  const info = await api<{ version: string; mode: string; setup: { state: string } }>('GET', '/api/finesse')
  if (info.data.setup.state !== 'ready') {
    console.log(`Finesse ${info.data.version} is running but not set up yet (${info.data.setup.state}).`)
    const code = setupCode()
    if (code) console.log(`Open it in a browser and enter the setup code ${bold(code)}, or run: finesse setup apply <file>`)
    return 1
  }
  const r = await api<Health & { error?: string }>('GET', '/api/system/status?refresh')
  if (r.status >= 400) throw new Error(r.data.error ?? `HTTP ${r.status}`)
  if (argv.includes('--json')) {
    console.log(JSON.stringify(r.data, null, 2))
  }
  const h = r.data.health
  let problems = 0
  const line = (ok: boolean | null, label: string, detail = '') => {
    if (ok === false) problems++
    if (!argv.includes('--json')) console.log(`  ${ok === null ? yellow('!') : ok ? green('✔') : red('✖')} ${label}${detail ? dim(`  ${detail}`) : ''}`)
  }
  if (!argv.includes('--json')) console.log(`${bold('Finesse')} ${r.data.version} · ${r.data.mode} mode · set up ${r.data.setup.completedAt?.slice(0, 10) ?? ''}\n`)
  if (r.data.mode === 'bundle') {
    line(h.docker, 'Docker', h.docker ? '' : 'not reachable — is /var/run/docker.sock mounted?')
    line(h.network, 'Stack network')
    for (const s of h.services) {
      const ok = s.state === 'running' ? true : s.state === 'starting' || s.state === 'paused' ? null : false
      line(ok, s.name, [s.state !== 'running' ? s.state : '', s.detail ?? '', s.updatePending ? 'update ready' : ''].filter(Boolean).join(' · '))
    }
    if (h.vpn) line(h.vpn.connected ? true : null, 'VPN', h.vpn.connected ? `${h.vpn.publicIp ?? ''} ${h.vpn.country ?? ''}`.trim() : (h.vpn.error ?? 'not connected'))
    for (const d of h.disks) line(d.free / d.total > 0.05 ? true : false, `Disk — ${d.label}`, `${gb(d.free)} free of ${gb(d.total)}`)
    const age = h.backups.last ? (Date.now() - Date.parse(h.backups.last)) / 3600e3 : Infinity
    line(age < 48 ? true : null, 'Backups', h.backups.last ? `last ${h.backups.last.slice(0, 16).replace('T', ' ')}` : 'none yet')
    const recent = h.events.filter((e) => e.level !== 'info').slice(0, 5)
    if (recent.length && !argv.includes('--json')) {
      console.log(`\n  Recent problems:`)
      for (const e of recent) console.log(`    ${dim(e.at.slice(0, 16).replace('T', ' '))} ${e.message}`)
    }
  }
  if (!argv.includes('--json')) console.log(problems ? `\n${red(`${problems} problem${problems > 1 ? 's' : ''} found.`)}` : `\n${green('Everything looks healthy.')}`)
  return problems ? 1 : 0
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'version':
    case '--version':
    case '-v':
      console.log(VERSION)
      return 0
    case 'setup-code': {
      const code = setupCode()
      if (!code) {
        console.error('No setup code — Finesse is already set up (or has not started yet).')
        return 1
      }
      console.log(code)
      return 0
    }
    case 'setup':
      return setup(rest)
    case 'doctor':
      return doctor(rest)
    case 'backup': {
      const r = await api<{ name: string; size: number; error?: string }>('POST', '/api/system/backups')
      if (r.status >= 400) throw new Error(r.data.error ?? `HTTP ${r.status}`)
      console.log(`${green('✔')} Backed up to ${join(configDir, 'backups', r.data.name)} (${Math.round(r.data.size / 1024)} KB)`)
      return 0
    }
    case 'restore': {
      const [name] = rest
      if (!name) {
        console.error('usage: finesse restore <finesse-backup-….tar.gz>   (a path, or a file name in the backups folder)')
        return 2
      }
      const file = isAbsolute(name) || existsSync(name) ? resolve(name) : join(configDir, 'backups', name)
      if (!existsSync(file)) throw new Error(`No backup at ${file}`)
      const files = readTar(readFileSync(file), { maxUnpacked: 512 << 20 })
      const root = (process.env.FINESSE_ROOT || '').replace(/\/+$/, '')
      const uid = Number(process.env.PUID ?? 1000)
      const gid = Number(process.env.PGID ?? 1000)
      let n = 0
      for (const f of files) {
        const rel = safeRelPath(f.path)
        if (!rel) continue
        let dest: string | null = null
        if (rel.startsWith('finesse/')) dest = join(configDir, rel.slice('finesse/'.length))
        else if (rel.startsWith('apps/') && root) dest = join(root, 'config', rel.slice('apps/'.length))
        if (!dest) continue
        mkdirSync(dirname(dest), { recursive: true })
        writeFileSync(dest, f.data, { mode: 0o600 })
        if (rel.startsWith('apps/')) {
          try {
            chownSync(dest, uid, gid)
          } catch {
            /* not root */
          }
        }
        n++
      }
      console.log(`${green('✔')} Restored ${n} files from ${file}.`)
      console.log(`  Now restart Finesse so it picks them up: ${bold('sudo docker restart finesse')}`)
      console.log(dim('  (It recreates any missing apps with the restored settings within a minute.)'))
      return 0
    }
    case 'swap': {
      const [id, image] = rest
      if (!id || !image) {
        console.error('usage: finesse swap <container-id> <image>')
        return 2
      }
      // Give the old Finesse a moment to answer the request that started this.
      await new Promise((r) => setTimeout(r, 1500))
      return (await swap(new Docker(), id, image, (m) => console.log(m))) ? 0 : 1
    }
    default:
      console.log(`finesse ${VERSION}

Usage:
  finesse setup-code                 show the one-time setup code
  finesse setup validate <file|->    check a setup document without applying it
  finesse setup check <file|->       test its Usenet servers, indexers and VPN for real
  finesse setup apply <file|->       build the server from a setup document
  finesse setup status [--json]      progress of the current/last setup run
  finesse doctor [--json]            health report: apps, VPN, disk, backups
  finesse backup                     back up now
  finesse restore <backup>           put a backup's settings back
  finesse version                    print the version

Setup documents: https://github.com/CoffeeCC/finesse/blob/master/setup.schema.json`)
      return cmd ? 1 : 0
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(red(`✖ ${(e as Error).message}`))
    process.exit(1)
  },
)
