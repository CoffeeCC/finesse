// Generates the webOS launcher icons (icon.png 80x80, largeIcon.png 130x130)
// as a diagonal brand gradient with a serif "F", with zero dependencies.
// Run once: `node webos/gen-icons.mjs`. Re-run only to change the look.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('./bootstrap/', import.meta.url))

// Brand colors from index.html's favicon gradient.
const C0 = [0x62, 0x79, 0xcd] // #6279cd
const C1 = [0xa8, 0x6a, 0xd1] // #a86ad1

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// A blocky serif-ish "F" rendered into a coverage mask, so it has soft-ish edges.
function fCoverage(x, y, n) {
  // Normalize to a 0..1 glyph box with padding.
  const pad = n * 0.26
  const gx = (x - pad) / (n - 2 * pad)
  const gy = (y - pad) / (n - 2 * pad)
  if (gx < 0 || gx > 1 || gy < 0 || gy > 1) return 0
  const stem = gx >= 0.12 && gx <= 0.34
  const top = gy >= 0.0 && gy <= 0.2
  const mid = gy >= 0.42 && gy <= 0.6 && gx <= 0.78
  const topBar = top && gx <= 0.86
  return stem || topBar || mid ? 1 : 0
}

function makePng(n, path) {
  const raw = Buffer.alloc(n * (n * 4 + 1))
  let p = 0
  for (let y = 0; y < n; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < n; x++) {
      const t = (x + y) / (2 * n) // diagonal gradient
      let r = Math.round(C0[0] + (C1[0] - C0[0]) * t)
      let g = Math.round(C0[1] + (C1[1] - C0[1]) * t)
      let b = Math.round(C0[2] + (C1[2] - C0[2]) * t)
      if (fCoverage(x, y, n)) {
        r = g = b = 255
      }
      raw[p++] = r
      raw[p++] = g
      raw[p++] = b
      raw[p++] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(n, 0)
  ihdr.writeUInt32BE(n, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(path, png)
  console.log(`wrote ${path} (${png.length} bytes)`)
}

makePng(80, DIR + 'icon.png')
makePng(130, DIR + 'largeIcon.png')
