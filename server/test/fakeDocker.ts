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
  close: () => Promise<void>
}

export async function fakeDocker(containers: FakeContainer[]): Promise<FakeDocker> {
  const joined: { network: string; container: string }[] = []
  const find = (ref: string) => containers.find((c) => c.id === ref || c.name === ref)
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://docker')
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    if (url.pathname === '/_ping') return void res.end('OK')
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
        Config: { Image: c.image, Env: [], Labels: c.labels ?? {} },
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
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}
