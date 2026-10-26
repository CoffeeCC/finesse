// A stand-in for the Docker Engine API on a unix socket: just what finding someone's existing apps
// uses (list, inspect, read a file out of a container, join a network). Each container's files come
// from a map, or from a real file on disk.

import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { writeTar } from '../src/tar.ts'
import { tmp } from './helpers.ts'

export interface FakeContainer {
  id: string
  name: string
  image: string
  running?: boolean
  labels?: Record<string, string>
  env?: string[]
  networks?: Record<string, { IPAddress: string; Gateway?: string }>
  networkMode?: string
  /** "8989/tcp" → host port */
  ports?: Record<string, string>
  /** Path inside the container → text, or { file } to read a real file. */
  files?: Record<string, string | { file: string }>
  mounts?: { Source: string; Destination: string }[]
}

export interface FakeDocker {
  socket: string
  server: Server
  joined: { network: string; container: string }[]
  /** What Finesse did to containers: "create finesse-sonarr", "stop …", "remove …", "start …". */
  calls: string[]
  /** Create bodies, by container name. */
  created: Record<string, any>
  close: () => Promise<void>
}

/** `run` answers one-off containers (Docker's runOnce): what the command prints, given its create body. */
export async function fakeDocker(containers: FakeContainer[], opts: { run?: (body: any) => string; exec?: (container: string, cmd: string[]) => string } = {}): Promise<FakeDocker> {
  const execs = new Map<string, { container: string; cmd: string[] }>()
  const created: Record<string, any> = {}
  const joined: { network: string; container: string }[] = []
  const calls: string[] = []
  const find = (ref: string) => containers.find((c) => c.id === ref || c.name === ref)
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://docker')
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    if (url.pathname === '/_ping') return void res.end('OK')
    if (url.pathname.endsWith('/version')) return send(200, { Version: '27.3.1', Os: 'linux', Arch: 'amd64', ApiVersion: '1.47' })
    if (url.pathname.endsWith('/info')) return send(200, { NCPU: 4, MemTotal: 8e9, OperatingSystem: 'Fake OS' })
    if (/^\/images\/.+\/json$/.test(url.pathname)) return send(200, { Id: 'sha256:fake' })
    let a = /^\/containers\/([^/]+)\/(start|stop|restart)$/.exec(url.pathname)
    if (a && req.method === 'POST') {
      calls.push(`${a[2]} ${decodeURIComponent(a[1]!)}`)
      res.writeHead(204)
      return void res.end()
    }
    if (url.pathname === '/containers/create' && req.method === 'POST') {
      const name = url.searchParams.get('name') ?? 'new'
      calls.push(`create ${name}`)
      let body = ''
      req.on('data', (d) => (body += d))
      return void req.on('end', () => {
        created[name] = JSON.parse(body || '{}')
        send(201, { Id: name })
      })
    }
    let x = /^\/containers\/([^/]+)\/exec$/.exec(url.pathname)
    if (x && req.method === 'POST') {
      let body = ''
      req.on('data', (d) => (body += d))
      return void req.on('end', () => {
        const id = `exec${execs.size + 1}`
        execs.set(id, { container: decodeURIComponent(x![1]!), cmd: JSON.parse(body || '{}').Cmd ?? [] })
        calls.push(`exec ${decodeURIComponent(x![1]!)} ${(JSON.parse(body || '{}').Cmd ?? []).join(' ')}`)
        send(201, { Id: id })
      })
    }
    x = /^\/exec\/([^/]+)\/start$/.exec(url.pathname)
    if (x && req.method === 'POST') {
      const e = execs.get(x[1]!)
      const out = Buffer.from(e ? (opts.exec?.(e.container, e.cmd) ?? '') : '')
      const head = Buffer.alloc(8)
      head[0] = 1
      head.writeUInt32BE(out.length, 4)
      res.writeHead(200, { 'Content-Type': 'application/vnd.docker.raw-stream' })
      return void res.end(Buffer.concat([head, out]))
    }
    x = /^\/exec\/([^/]+)\/json$/.exec(url.pathname)
    if (x) return send(200, { ExitCode: 0 })
    let w = /^\/containers\/([^/]+)\/wait$/.exec(url.pathname)
    if (w && req.method === 'POST') return send(200, { StatusCode: 0 })
    w = /^\/containers\/([^/]+)\/logs$/.exec(url.pathname)
    if (w && created[decodeURIComponent(w[1]!)]) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      return void res.end(opts.run?.(created[decodeURIComponent(w[1]!)]) ?? '')
    }
    a = /^\/containers\/([^/]+)$/.exec(url.pathname)
    if (a && req.method === 'DELETE') {
      calls.push(`remove ${decodeURIComponent(a[1]!)}`)
      res.writeHead(204)
      return void res.end()
    }
    if (url.pathname === '/containers/json') {
      return send(200, containers.map((c) => ({ Id: c.id, Names: [`/${c.name}`], Image: c.image, State: c.running === false ? 'exited' : 'running', Status: '', Labels: c.labels ?? {} })))
    }
    let m = /^\/containers\/([^/]+)\/json$/.exec(url.pathname)
    if (m) {
      const c = find(decodeURIComponent(m[1]!))
      if (!c) return send(404, { message: 'No such container' })
      return send(200, {
        Id: c.id,
        Name: `/${c.name}`,
        Image: c.image,
        Config: { Image: c.image, Env: c.env ?? [], Labels: c.labels ?? {} },
        State: { Status: c.running === false ? 'exited' : 'running', Running: c.running !== false, Restarting: false, ExitCode: 0, StartedAt: '' },
        HostConfig: { NetworkMode: c.networkMode ?? Object.keys(c.networks ?? {})[0] ?? 'bridge' },
        NetworkSettings: {
          Networks: c.networks ?? {},
          Ports: Object.fromEntries(Object.entries(c.ports ?? {}).map(([k, v]) => [k, [{ HostIp: '0.0.0.0', HostPort: v }]])),
        },
        Mounts: c.mounts ?? [{ Source: `/mnt/apps/${c.name}`, Destination: '/config' }],
      })
    }
    m = /^\/containers\/([^/]+)\/archive$/.exec(url.pathname)
    if (m && req.method === 'GET') {
      const c = find(decodeURIComponent(m[1]!))
      const path = url.searchParams.get('path') ?? ''
      const f = c?.files?.[path]
      if (!c || f === undefined) return send(404, { message: `Could not find the file ${path} in container` })
      let data: Buffer
      try {
        data = typeof f === 'string' ? Buffer.from(f) : readFileSync(f.file)
      } catch {
        return send(404, { message: 'gone' })
      }
      res.writeHead(200, { 'Content-Type': 'application/x-tar' })
      return void res.end(writeTar([{ path: path.split('/').pop()!, data }]))
    }
    m = /^\/networks\/([^/]+)\/connect$/.exec(url.pathname)
    if (m && req.method === 'POST') {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        joined.push({ network: decodeURIComponent(m![1]!), container: (JSON.parse(body || '{}') as { Container?: string }).Container ?? '' })
        send(200, '')
      })
      return
    }
    send(404, { message: `fake docker: ${req.method} ${url.pathname}` })
  })
  const socket = join(tmp('fake-docker-'), 'docker.sock')
  await new Promise<void>((r) => server.listen(socket, r))
  return {
    socket,
    server,
    joined,
    calls,
    created,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}
