// A websocket on Finesse's own side, for carrying a byte stream to the browser (the installer's
// screen for "Needs you": VNC from the sandbox, which noVNC reads as binary messages). Only what
// that needs: the handshake, binary/text messages in and out, ping, close. Node built-ins only.

import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
/** A browser never needs more than this in one message here (keys, pointer moves, clipboard). */
const MAX_MESSAGE = 1 << 20

export interface WebSocketPeer {
  send(data: Buffer): void
  close(code?: number): void
  onMessage(fn: (data: Buffer) => void): void
  onClose(fn: () => void): void
}

/** Answers a websocket upgrade; null (and the connection refused) when it isn't a valid one. */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer, opts: { protocols?: string[] } = {}): WebSocketPeer | null {
  const key = req.headers['sec-websocket-key']
  if (typeof key !== 'string' || !/websocket/i.test(String(req.headers.upgrade ?? '')) || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    return null
  }
  const offered = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim()).filter(Boolean)
  const protocol = offered.find((p) => opts.protocols?.includes(p))
  const accept = createHash('sha1').update(key + GUID).digest('base64')
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : ''}\r\n`,
  )
  if (head.length) socket.unshift(head)

  const messages: ((b: Buffer) => void)[] = []
  const closes: (() => void)[] = []
  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    for (const f of closes) f()
    socket.destroy()
  }
  const frame = (opcode: number, payload: Buffer) => {
    if (closed) return
    const n = payload.length
    const header = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : Buffer.alloc(10)
    if (n >= 65536) {
      header[0] = 0x80 | opcode
      header[1] = 127
      header.writeBigUInt64BE(BigInt(n), 2)
    }
    socket.write(Buffer.concat([header, payload]))
  }

  let pending = Buffer.alloc(0)
  let parts: Buffer[] = []
  socket.on('data', (c: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, c]) : c
    while (pending.length >= 2) {
      const fin = (pending[0]! & 0x80) !== 0
      const opcode = pending[0]! & 0x0f
      const masked = (pending[1]! & 0x80) !== 0
      let len = pending[1]! & 0x7f
      let off = 2
      if (len === 126) {
        if (pending.length < 4) return
        len = pending.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (pending.length < 10) return
        const big = pending.readBigUInt64BE(2)
        if (big > BigInt(MAX_MESSAGE)) return finish()
        len = Number(big)
        off = 10
      }
      // Browsers always mask what they send; anything else isn't a browser.
      if (!masked || len > MAX_MESSAGE) return finish()
      if (pending.length < off + 4 + len) return
      const mask = pending.subarray(off, off + 4)
      const data = Buffer.from(pending.subarray(off + 4, off + 4 + len))
      for (let i = 0; i < data.length; i++) data[i]! ^= mask[i & 3]!
      pending = pending.subarray(off + 4 + len)
      if (opcode === 8) {
        frame(8, Buffer.alloc(0))
        return finish()
      }
      if (opcode === 9) frame(10, data)
      else if (opcode === 0 || opcode === 1 || opcode === 2) {
        parts.push(data)
        if (parts.reduce((n, p) => n + p.length, 0) > MAX_MESSAGE) return finish()
        if (fin) {
          const whole = parts.length === 1 ? parts[0]! : Buffer.concat(parts)
          parts = []
          for (const f of messages) f(whole)
        }
      }
    }
  })
  socket.on('close', finish)
  socket.on('error', finish)

  return {
    send: (data) => frame(2, data),
    close: (code = 1000) => {
      const b = Buffer.alloc(2)
      b.writeUInt16BE(code)
      frame(8, b)
      finish()
    },
    onMessage: (fn) => void messages.push(fn),
    onClose: (fn) => void closes.push(fn),
  }
}
