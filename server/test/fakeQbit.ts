// A pretend qBittorrent: a real HTTP server speaking as much of its API as Finesse uses.

import { createServer } from 'node:http'
import { join } from 'node:path'
import { listen } from './helpers.ts'

interface FakeTorrent {
  hash: string
  tags: string
  category: string
  state: string
  progress: number
  dlspeed: number
  eta: number
  ratio: number
  content_path: string
}

/** qBittorrent's API, as much as Finesse uses: sign-in with a cookie, add, info by tag, stop/start, delete. */
export async function fakeQbit(downloads: string) {
  const torrents: FakeTorrent[] = []
  const q = { torrents, connection: 'connected', up: true, logins: 0, v5: true, url: '' }
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (!q.up) return void req.socket.destroy()
      const url = new URL(req.url!, 'http://x')
      const form = new URLSearchParams(body)
      const path = url.pathname.replace('/api/v2', '')
      if (path === '/auth/login') {
        const ok = form.get('username') === 'admin' && form.get('password') === 'pw'
        q.logins++
        return void res.writeHead(200, ok ? { 'Set-Cookie': 'SID=abc; HttpOnly; path=/' } : {}).end(ok ? 'Ok.' : 'Fails.')
      }
      if (req.headers.cookie !== 'SID=abc') return void res.writeHead(403).end('Forbidden')
      const json = (v: unknown) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(v))
      if (path === '/transfer/info') return void json({ connection_status: q.connection })
      if (path === '/torrents/info') return void json(torrents.filter((t) => t.tags.split(',').includes(url.searchParams.get('tag') ?? '')))
      if (path === '/torrents/add') {
        const hash = /btih:([0-9a-f]+)/.exec(form.get('urls') ?? '')![1]!
        torrents.push({ hash, tags: form.get('tags') ?? '', category: form.get('category') ?? '', state: 'metaDL', progress: 0, dlspeed: 0, eta: 8640000, ratio: 0, content_path: join(downloads, 'Stand-in Game') })
        return void res.writeHead(200).end('Ok.')
      }
      const mine = torrents.filter((t) => (form.get('hashes') ?? '').split('|').includes(t.hash))
      if (path === '/torrents/stop' || path === '/torrents/start') {
        if (!q.v5) return void res.writeHead(404).end()
        for (const t of mine) t.state = path.endsWith('stop') ? 'stoppedDL' : 'downloading'
        return void res.writeHead(200).end()
      }
      if (path === '/torrents/pause' || path === '/torrents/resume') {
        for (const t of mine) t.state = path.endsWith('pause') ? 'pausedDL' : 'downloading'
        return void res.writeHead(200).end()
      }
      if (path === '/torrents/delete') {
        for (const t of mine) torrents.splice(torrents.indexOf(t), 1)
        return void res.writeHead(200).end()
      }
      res.writeHead(404).end()
    })
  })
  q.url = await listen(server)
  return Object.assign(q, { server })
}

