// QR codes without a library (the server has no dependencies): byte mode, error correction level M,
// versions 1–10 (up to 213 bytes, plenty for an address with a setup code). For the installer's
// "scan this with your phone" (`finesse qr`), drawn in the terminal with half blocks.

const EC_M: [number, number, number, number, number][] = [
  // version: [ec codewords per block, blocks in group 1, data codewords each, blocks in group 2, data codewords each]
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
]
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

// ---------- Reed–Solomon over GF(256), polynomial 0x11D ----------
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!
}
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a]! + LOG[b]!]! : 0)

function rsRemainder(data: number[], degree: number): number[] {
  // Generator: (x - α^0)(x - α^1)…(x - α^(degree-1)), highest power first, leading 1 dropped.
  let gen = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j]!
      next[j + 1] ^= mul(gen[j]!, EXP[i]!)
    }
    gen = next
  }
  const rem = new Array<number>(degree).fill(0)
  for (const b of data) {
    const factor = b ^ rem.shift()!
    rem.push(0)
    for (let j = 0; j < degree; j++) rem[j] ^= mul(gen[j + 1]!, factor)
  }
  return rem
}

/** The QR code for `text` as rows of booleans (true = dark), without the quiet zone. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...Buffer.from(text, 'utf8')]
  let version = 0
  for (let v = 1; v <= 10; v++) {
    const [, b1, d1, b2, d2] = EC_M[v - 1]!
    const capacityBits = (b1 * d1 + b2 * d2) * 8
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= capacityBits) {
      version = v
      break
    }
  }
  if (!version) throw new Error('Too long for a QR code here')
  const [ecLen, b1, d1, b2, d2] = EC_M[version - 1]!
  const dataLen = b1 * d1 + b2 * d2

  // Data bits: mode 0100 (bytes), length, the bytes, terminator, padding.
  const bits: number[] = []
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(4, 4)
  put(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, dataLen * 8 - bits.length))
  while (bits.length % 8) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  for (let pad = 0xec; data.length < dataLen; pad ^= 0xec ^ 0x11) data.push(pad)

  // Blocks, their error correction, interleaved.
  const blocks: number[][] = []
  let at = 0
  for (const [n, len] of [[b1, d1], [b2, d2]] as const)
    for (let i = 0; i < n; i++) {
      blocks.push(data.slice(at, at + len))
      at += len
    }
  const ecs = blocks.map((b) => rsRemainder(b, ecLen))
  const stream: number[] = []
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) stream.push(b[i]!)
  for (let i = 0; i < ecLen; i++) for (const e of ecs) stream.push(e[i]!)

  // ---------- the grid ----------
  const size = version * 4 + 17
  const dark: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fixed: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, on: boolean) => {
    dark[y]![x] = on
    fixed[y]![x] = true
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, d !== 2 && d !== 4)
      }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0)
    set(6, i, i % 2 === 0)
  }
  const al = ALIGN[version - 1]!
  for (const ay of al)
    for (const ax of al) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === al.at(-1)) || (ax === al.at(-1) && ay === 6)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  // Reserve format areas (filled per mask below) and the dark module.
  for (let i = 0; i < 9; i++) {
    fixed[8]![i] = fixed[i]![8] = true
  }
  for (let i = 0; i < 8; i++) {
    fixed[8]![size - 1 - i] = true
    fixed[size - 1 - i]![8] = true
  }
  set(8, size - 8, true)
  // Version information (7 and up).
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const vbits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const on = ((vbits >>> i) & 1) === 1
      const a = size - 11 + (i % 3), b = Math.floor(i / 3)
      set(a, b, on)
      set(b, a, on)
    }
  }

  // Data, zigzagging up and down two columns at a time from the bottom right.
  const allBits: number[] = []
  for (const b of stream) for (let i = 7; i >= 0; i--) allBits.push((b >>> i) & 1)
  let k = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (fixed[y]![x]) continue
        dark[y]![x] = k < allBits.length ? allBits[k++] === 1 : false
      }
  }

  // Try each mask; keep the one with the lowest penalty.
  const MASKS: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const withMask = (m: number): boolean[][] => {
    const g = dark.map((row, y) => row.map((v, x) => (fixed[y]![x] ? v : v !== MASKS[m]!(x, y))))
    // Format bits: level M (00) and the mask, BCH-coded, XORed with 101010000010010.
    const fmt = m
    let rem = fmt
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const f = ((fmt << 10) | rem) ^ 0x5412
    const bit = (i: number) => ((f >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) g[i]![8] = bit(i)
    g[7]![8] = bit(6)
    g[8]![8] = bit(7)
    g[8]![7] = bit(8)
    for (let i = 9; i < 15; i++) g[8]![14 - i] = bit(i)
    for (let i = 0; i < 8; i++) g[8]![size - 1 - i] = bit(i)
    for (let i = 8; i < 15; i++) g[size - 15 + i]![8] = bit(i)
    g[size - 8]![8] = true
    return g
  }
  let best: boolean[][] = []
  let bestScore = Infinity
  for (let m = 0; m < 8; m++) {
    const g = withMask(m)
    const score = penalty(g)
    if (score < bestScore) {
      bestScore = score
      best = g
    }
  }
  return best
}

function penalty(g: boolean[][]): number {
  const n = g.length
  let score = 0
  const line = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < n; i++) {
      let run = 1
      for (let j = 1; j < n; j++) {
        if (get(i, j) === get(i, j - 1)) {
          run++
          if (run === 5) score += 3
          else if (run > 5) score++
        } else run = 1
      }
      // Finder-like 1:1:3:1:1 patterns with four light modules on a side.
      for (let j = 0; j + 10 < n; j++) {
        const p = Array.from({ length: 11 }, (_, k) => get(i, j + k))
        const a = [true, false, true, true, true, false, true, false, false, false, false]
        if (p.every((v, k) => v === a[k]) || p.every((v, k) => v === a[10 - k])) score += 40
      }
    }
  }
  line((i, j) => g[i]![j]!)
  line((i, j) => g[j]![i]!)
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (g[y]![x] === g[y]![x + 1] && g[y]![x] === g[y + 1]![x] && g[y]![x] === g[y + 1]![x + 1]) score += 3
  const darkCount = g.flat().filter(Boolean).length
  score += Math.floor(Math.abs((darkCount * 20) / (n * n) - 10)) * 10
  return score
}

/** For a terminal: two rows per line with half blocks, a light quiet zone around it (phones read
 *  dark-on-light, so the code is drawn that way whatever the terminal's colours). */
export function qrTerminal(text: string): string {
  const m = qrMatrix(text)
  const q = 2
  const n = m.length + q * 2
  const at = (x: number, y: number) => x >= q && y >= q && x < n - q && y < n - q && m[y - q]![x - q]!
  const lines: string[] = []
  for (let y = 0; y < n; y += 2) {
    let line = '\u001b[38;5;16;48;5;231m'
    for (let x = 0; x < n; x++) {
      const top = at(x, y), bottom = y + 1 < n && at(x, y + 1)
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
    }
    lines.push(line + '\u001b[0m')
  }
  return lines.join('\n')
}
