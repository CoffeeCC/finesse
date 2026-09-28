// Invite emails: the SMTP client against a fake mail server (plain + STARTTLS),
// and the invite → email endpoint end to end.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { TLSSocket } from 'node:tls'
import { ADMIN_TOKEN, API_KEY, auth, fakeJellyfin, listen, tmp, type FakeJellyfin } from './helpers.ts'

interface Received {
  from: string
  to: string[]
  data: string
  auth: string | null
  authOverTls: boolean
}

function fakeSmtp(opts: { starttls?: { key: string; cert: string }; password?: string } = {}) {
  const got: Received[] = []
  const server = createServer((raw) => {
    let sock: Socket | TLSSocket = raw
    let tls = false
    let cur: Received = { from: '', to: [], data: '', auth: null, authOverTls: false }
    let mode: 'cmd' | 'data' | 'login-user' | 'login-pass' = 'cmd'
    let loginUser = ''
    let buf = ''
    const say = (s: string) => sock.write(s + '\r\n')
    const handle = (line: string) => {
      if (mode === 'data') {
        if (line === '.') {
          got.push(cur)
          cur = { from: '', to: [], data: '', auth: cur.auth, authOverTls: cur.authOverTls }
          mode = 'cmd'
          return say('250 queued')
        }
        cur.data += line.replace(/^\.\./, '.') + '\n'
        return
      }
      const checkPass = (user: string, pass: string) => {
        cur.auth = `${user}:${pass}`
        cur.authOverTls = tls
        say(!opts.password || pass === opts.password ? '235 ok' : '535 5.7.8 bad credentials')
      }
      if (mode === 'login-user') {
        loginUser = Buffer.from(line, 'base64').toString()
        mode = 'login-pass'
        return say('334 UGFzc3dvcmQ6')
      }
      if (mode === 'login-pass') {
        mode = 'cmd'
        return checkPass(loginUser, Buffer.from(line, 'base64').toString())
      }
      const [verb, ...rest] = line.split(' ')
      switch (verb!.toUpperCase()) {
        case 'EHLO':
          return sock.write(`250-fake.smtp\r\n${opts.starttls && !tls ? '250-STARTTLS\r\n' : ''}250-AUTH LOGIN PLAIN\r\n250 OK\r\n`)
        case 'STARTTLS': {
          say('220 go ahead')
          raw.removeAllListeners('data')
          const t = new TLSSocket(raw, { isServer: true, key: opts.starttls!.key, cert: opts.starttls!.cert })
          sock = t
          tls = true
          buf = ''
          t.on('data', onData)
          return
        }
        case 'AUTH': {
          if (rest[0] === 'PLAIN') {
            const [, user, pass] = Buffer.from(rest[1]!, 'base64').toString().split('\0')
            return checkPass(user!, pass!)
          }
          mode = 'login-user'
          return say('334 VXNlcm5hbWU6')
        }
        case 'MAIL':
          cur.from = line.slice(10).replace(/[<>]/g, '')
          return say('250 ok')
        case 'RCPT':
          cur.to.push(line.slice(8).replace(/[<>]/g, ''))
          return say('250 ok')
        case 'DATA':
          mode = 'data'
          return say('354 go')
        case 'QUIT':
          say('221 bye')
          return sock.end()
        default:
          return say('502 what')
      }
    }
    const onData = (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        handle(line)
      }
    }
    raw.on('data', onData)
    raw.on('error', () => {})
    say('220 fake.smtp ESMTP')
  })
  return { server, got }
}

async function listenTcp(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return (server.address() as { port: number }).port
}

/** Decodes the base64 parts of a MIME message. */
function parts(data: string): string[] {
  return [...data.matchAll(/Content-Transfer-Encoding: base64\n\n([\s\S]*?)(?:\n--|\n?$)/g)].map((m) => Buffer.from(m[1]!.replace(/\s/g, ''), 'base64').toString())
}

describe('SMTP client', () => {
  test('sends a multipart message with AUTH PLAIN to a local server', async () => {
    const { sendMail } = await import('../src/email.ts')
    const fake = fakeSmtp({ password: 'hunter22' })
    const port = await listenTcp(fake.server)
    await sendMail({ host: '127.0.0.1', port, username: 'me@example.com', password: 'hunter22', from: 'Finesse Café <me@example.com>' }, { to: 'friend@example.org', subject: 'Welcome ✨', text: 'plain body', html: '<p>html body</p>' })
    fake.server.close()
    assert.equal(fake.got.length, 1)
    const m = fake.got[0]!
    assert.equal(m.from, 'me@example.com')
    assert.deepEqual(m.to, ['friend@example.org'])
    assert.equal(m.auth, 'me@example.com:hunter22')
    assert.match(m.data, /^From: =\?UTF-8\?B\?.+\?= <me@example.com>$/m)
    assert.match(m.data, /^Subject: =\?UTF-8\?B\?/m)
    assert.deepEqual(parts(m.data), ['plain body', '<p>html body</p>'])
  })

  test('upgrades with STARTTLS before sending the password', async (t) => {
    const dir = tmp()
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' })
    } catch {
      return t.skip('openssl not available')
    }
    const key = readFileSync(join(dir, 'k.pem'), 'utf8')
    const cert = readFileSync(join(dir, 'c.pem'), 'utf8')
    const { sendMail } = await import('../src/email.ts')
    const fake = fakeSmtp({ starttls: { key, cert } })
    const port = await listenTcp(fake.server)
    await sendMail({ host: 'localhost', port, username: 'u', password: 'p', from: 'me@example.com' }, { to: 'a@b.co', subject: 's', text: 't' }, { ca: cert })
    fake.server.close()
    assert.equal(fake.got.length, 1)
    assert.equal(fake.got[0]!.authOverTls, true)
  })

  test('explains a rejected password', async () => {
    const { sendMail } = await import('../src/email.ts')
    const fake = fakeSmtp({ password: 'right' })
    const port = await listenTcp(fake.server)
    await assert.rejects(sendMail({ host: '127.0.0.1', port, username: 'u', password: 'wrong', from: 'me@example.com' }, { to: 'a@b.co', subject: 's', text: 't' }), /rejected the username or password/)
    fake.server.close()
  })

  test('explains an unreachable server', async () => {
    const { sendMail } = await import('../src/email.ts')
    const s = createServer()
    const port = await listenTcp(s)
    s.close()
    await assert.rejects(sendMail({ host: '127.0.0.1', port, from: 'me@example.com' }, { to: 'a@b.co', subject: 's', text: 't' }), /refused the connection/)
  })
})

describe('emailing an invite', () => {
  let jf: FakeJellyfin
  let app: Server
  let base = ''
  let fake: ReturnType<typeof fakeSmtp>

  before(async () => {
    jf = await fakeJellyfin()
    fake = fakeSmtp()
    const port = await listenTcp(fake.server)
    const work = tmp()
    Object.assign(process.env, { FINESSE_CONFIG_DIR: join(work, 'config'), FINESSE_WEB_DIR: join(work, 'baked'), JELLYFIN_URL: jf.url, JELLYFIN_API_KEY: API_KEY, FINESSE_MAINTENANCE: 'off' })
    const { createApp } = await import('../src/app.ts')
    const { defaultPlugins } = await import('../src/main.ts')
    const built = createApp({ plugins: defaultPlugins() })
    app = built.server
    base = await listen(app)
    built.deps.settings.update((s) => {
      s.email = { host: '127.0.0.1', port, from: 'Media <media@example.com>' }
    })
  })

  after(async () => {
    app.closeAllConnections()
    app.close()
    fake.server.close()
    await jf.close()
  })

  test('sends the invite link, using the public address when set', async () => {
    const created = await fetch(`${base}/invite-api/v1/invites`, { method: 'POST', headers: { ...auth(ADMIN_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'Sam', expires_in_days: 7 }) }).then((r) => r.json() as Promise<{ code: string }>)
    let r = await fetch(`${base}/invite-api/v1/invites/${created.code}/email`, { method: 'POST', headers: { ...auth(ADMIN_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'not-an-email' }) })
    assert.equal(r.status, 400)
    r = await fetch(`${base}/invite-api/v1/invites/${created.code}/email`, { method: 'POST', headers: { ...auth(ADMIN_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'sam@example.org', note: 'Movie night!', origin: 'http://192.168.1.50:8080' }) })
    assert.equal(r.status, 200)
    const out = (await r.json()) as { link: string }
    assert.equal(out.link, `http://192.168.1.50:8080/finesse/invite/${created.code}`)
    const m = fake.got.at(-1)!
    assert.deepEqual(m.to, ['sam@example.org'])
    const [text, html] = parts(m.data)
    assert.match(text!, new RegExp(`/finesse/invite/${created.code}`))
    assert.match(text!, /Movie night!/)
    assert.match(html!, /Create your account/)

    // The public address wins over the admin's current origin.
    await fetch(`${base}/api/system/email`, { method: 'PUT', headers: { ...auth(ADMIN_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify({ publicUrl: 'https://media.example.com/' }) })
    r = await fetch(`${base}/invite-api/v1/invites/${created.code}/email`, { method: 'POST', headers: { ...auth(ADMIN_TOKEN), 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'sam@example.org', origin: 'http://192.168.1.50:8080' }) })
    assert.equal(((await r.json()) as { link: string }).link, `https://media.example.com/finesse/invite/${created.code}`)
  })

  test('only administrators can send invites or read email settings', async () => {
    const r = await fetch(`${base}/api/system/email`)
    assert.equal(r.status, 401)
    const settings = (await fetch(`${base}/api/system/email`, { headers: auth(ADMIN_TOKEN) }).then((x) => x.json())) as { email: { hasPassword: boolean; password?: string } }
    assert.equal(settings.email.password, undefined)
  })
})
