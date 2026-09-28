// A small SMTP client (no dependencies) for invite emails: implicit TLS
// (port 465) or STARTTLS (587), AUTH PLAIN/LOGIN, multipart text + HTML.
// Passwords never cross an unencrypted connection except to this machine.

import { randomBytes } from 'node:crypto'
import { connect as netConnect, type Socket } from 'node:net'
import { hostname } from 'node:os'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'

export interface SmtpConfig {
  host: string
  port: number
  /** true = TLS from the first byte (465); false = upgrade with STARTTLS (587/25). */
  secure?: boolean
  username?: string
  password?: string
  /** "Finesse <media@example.com>" or a bare address. */
  from: string
}

export interface Mail {
  to: string
  subject: string
  text: string
  html?: string
}

export class SmtpError extends Error {}

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1)$/i

/** "Name <a@b.c>" → "a@b.c" */
export function addressOf(s: string): string {
  const m = /<([^>]+)>/.exec(s)
  return (m ? m[1]! : s).trim()
}

const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`)
const b64lines = (s: string) => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n')

function formatFrom(from: string) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from)
  return m && m[1] ? `${encodeWord(m[1].replace(/^"|"$/g, ''))} <${m[2]}>` : addressOf(from)
}

export function buildMessage(cfg: SmtpConfig, mail: Mail): string {
  const boundary = `finesse-${randomBytes(12).toString('hex')}`
  const domain = addressOf(cfg.from).split('@')[1] || 'finesse.local'
  const headers = [
    `From: ${formatFrom(cfg.from)}`,
    `To: ${mail.to}`,
    `Subject: ${encodeWord(mail.subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
  ]
  if (!mail.html) {
    return [...headers, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64lines(mail.text)].join('\r\n')
  }
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64lines(mail.html),
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

class Conversation {
  private socket: Socket | TLSSocket
  private buf = ''
  private waiters: ((line: string) => void)[] = []
  private lines: string[] = []
  private failed: Error | null = null

  constructor(socket: Socket | TLSSocket) {
    this.socket = socket
    this.attach()
  }

  private attach() {
    this.socket.setEncoding('utf8')
    this.socket.on('data', (d: string) => {
      this.buf += d
      let i: number
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, '')
        this.buf = this.buf.slice(i + 1)
        const w = this.waiters.shift()
        if (w) w(line)
        else this.lines.push(line)
      }
    })
    const fail = (e: Error) => {
      this.failed = e
      for (const w of this.waiters.splice(0)) w(`000 ${e.message}`)
    }
    this.socket.on('error', fail)
    this.socket.on('close', () => fail(new SmtpError('The mail server closed the connection')))
  }

  upgrade(socket: TLSSocket) {
    this.socket.removeAllListeners('data')
    this.socket.removeAllListeners('error')
    this.socket.removeAllListeners('close')
    this.socket = socket
    this.buf = ''
    this.failed = null
    this.attach()
  }

  private line(): Promise<string> {
    const l = this.lines.shift()
    if (l !== undefined) return Promise.resolve(l)
    if (this.failed) return Promise.resolve(`000 ${this.failed.message}`)
    return new Promise((r) => this.waiters.push(r))
  }

  /** Reads one (possibly multi-line) reply. */
  async reply(): Promise<{ code: number; text: string[] }> {
    const text: string[] = []
    for (;;) {
      const l = await this.line()
      text.push(l.slice(4))
      if (l[3] !== '-') return { code: Number(l.slice(0, 3)), text }
    }
  }

  async cmd(line: string, expect: number[], what = line.split(' ')[0]!): Promise<string[]> {
    if (line) this.socket.write(line + '\r\n')
    const r = await this.reply()
    if (!expect.includes(r.code)) throw new SmtpError(explain(what, r.code, r.text.join(' ')))
    return r.text
  }

  write(s: string) {
    this.socket.write(s)
  }

  end() {
    this.socket.end()
  }

  get raw() {
    return this.socket
  }
}

function explain(what: string, code: number, text: string): string {
  if (code === 0) return `Couldn’t talk to the mail server (${text})`
  if (what === 'AUTH' || code === 535) return `The mail server rejected the username or password (${code} ${text})`
  if (what === 'RCPT') return `The mail server refused the recipient (${code} ${text})`
  if (what === 'MAIL') return `The mail server refused the sender address — it usually has to be your account’s address (${code} ${text})`
  return `Mail server said ${code} ${text} (after ${what})`
}

function open(cfg: SmtpConfig, timeoutMs: number, ca?: string): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const onErr = (e: NodeJS.ErrnoException) =>
      reject(new SmtpError(e.code === 'ENOTFOUND' ? `Can’t find the mail server ${cfg.host}` : e.code === 'ECONNREFUSED' ? `${cfg.host}:${cfg.port} refused the connection` : `Couldn’t connect to ${cfg.host}:${cfg.port} (${e.message})`))
    const s = cfg.secure ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host, ca }, () => resolve(s)) : netConnect(cfg.port, cfg.host, () => resolve(s))
    s.setTimeout(timeoutMs, () => s.destroy(new Error('timed out')))
    s.once('error', onErr)
  })
}

export async function sendMail(cfg: SmtpConfig, mail: Mail, opts: { timeoutMs?: number; ca?: string } = {}): Promise<void> {
  const socket = await open(cfg, opts.timeoutMs ?? 20000, opts.ca)
  const c = new Conversation(socket)
  const helo = hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'finesse'
  try {
    await c.cmd('', [220], 'connect')
    let caps = await c.cmd(`EHLO ${helo}`, [250])
    if (!cfg.secure) {
      if (caps.some((x) => /^STARTTLS\b/i.test(x))) {
        await c.cmd('STARTTLS', [220])
        const tls = await new Promise<TLSSocket>((resolve, reject) => {
          const t = tlsConnect({ socket: c.raw as Socket, servername: cfg.host, ca: opts.ca }, () => resolve(t))
          t.once('error', (e) => reject(new SmtpError(`Couldn’t secure the connection (${e.message})`)))
        })
        c.upgrade(tls)
        caps = await c.cmd(`EHLO ${helo}`, [250])
      } else if (cfg.username && !LOCAL.test(cfg.host)) {
        throw new SmtpError('This mail server doesn’t offer encryption on this port — use port 465 with “secure”, or 587')
      }
    }
    if (cfg.username) {
      const auth = caps.find((x) => /^AUTH\b/i.test(x)) ?? ''
      if (/\bPLAIN\b/i.test(auth) || !/\bLOGIN\b/i.test(auth)) {
        await c.cmd(`AUTH PLAIN ${Buffer.from(`\0${cfg.username}\0${cfg.password ?? ''}`).toString('base64')}`, [235], 'AUTH')
      } else {
        await c.cmd('AUTH LOGIN', [334], 'AUTH')
        await c.cmd(Buffer.from(cfg.username).toString('base64'), [334], 'AUTH')
        await c.cmd(Buffer.from(cfg.password ?? '').toString('base64'), [235], 'AUTH')
      }
    }
    await c.cmd(`MAIL FROM:<${addressOf(cfg.from)}>`, [250], 'MAIL')
    await c.cmd(`RCPT TO:<${addressOf(mail.to)}>`, [250, 251], 'RCPT')
    await c.cmd('DATA', [354])
    const body = buildMessage(cfg, mail).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
    c.write(body + '\r\n.\r\n')
    await c.cmd('', [250], 'DATA')
    await c.cmd('QUIT', [221]).catch(() => {})
  } finally {
    c.end()
  }
}

// ---------- invite email ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

export function inviteEmail(o: { serverName: string; link: string; code: string; from?: string; note?: string; expires?: string | null }): { subject: string; text: string; html: string } {
  const who = o.from ? `${o.from} invited you` : 'You’re invited'
  const subject = `${who} to ${o.serverName} on Finesse`
  const exp = o.expires ? `This invite expires ${new Date(o.expires).toUTCString().slice(0, 16)}.` : ''
  const text = [
    `${who} to watch and listen on ${o.serverName}.`,
    o.note ? `\n“${o.note}”\n` : '',
    `Create your account here:\n${o.link}`,
    `\nOr open Finesse and enter the invite code ${o.code}.`,
    exp,
  ]
    .filter(Boolean)
    .join('\n')
  const html = `<!doctype html><html><body style="margin:0;background:#0b0b0f;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ececf1">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0f;padding:40px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#15151c;border-radius:20px;padding:36px 32px">
<tr><td style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#9a9aab">Finesse</td></tr>
<tr><td style="padding-top:14px;font-size:26px;line-height:1.25;font-weight:700;color:#ffffff">${esc(who)} to ${esc(o.serverName)}</td></tr>
<tr><td style="padding-top:12px;font-size:16px;line-height:1.5;color:#c8c8d4">Movies, shows and music — on your phone, computer and TV.</td></tr>
${o.note ? `<tr><td style="padding-top:18px;font-size:15px;line-height:1.5;color:#ececf1;border-left:3px solid #7c5cff;padding-left:12px">${esc(o.note)}</td></tr>` : ''}
<tr><td style="padding-top:28px"><a href="${esc(o.link)}" style="display:inline-block;background:#7c5cff;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 26px;border-radius:999px">Create your account</a></td></tr>
<tr><td style="padding-top:22px;font-size:14px;line-height:1.5;color:#9a9aab">Or open Finesse and enter the code <b style="color:#ececf1;letter-spacing:.08em">${esc(o.code)}</b>.${exp ? `<br>${esc(exp)}` : ''}</td></tr>
</table></td></tr></table></body></html>`
  return { subject, text, html }
}
