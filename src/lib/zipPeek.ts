// Tiny, zero-dependency client-side .zip filename peeker for ROM console detection.
// Reads only the ZIP tail (EOCD + Central Directory) or Local File Header at offset 0,
// so even multi-gigabyte archives are inspected in milliseconds without decompressing.

const EOCD_SIG = 0x06054b50
const CD_SIG = 0x02014b50
const LFH_SIG = 0x04034b50

/** Tail window big enough for maximum ZIP comment (65535) + EOCD record (22). */
const TAIL_BYTES = 65558
/** Cap Central Directory read to 256 KB (plenty for 32+ entries even with long paths). */
const MAX_CD_READ = 256 * 1024

/** Canonical RomM console slugs for unambiguous ROM extensions. */
const UNAMBIGUOUS_EXT: Record<string, string> = {
  nes: 'nes',
  fds: 'fds',
  sfc: 'snes',
  smc: 'snes',
  gba: 'gba',
  gb: 'gb',
  gbc: 'gbc',
  n64: 'n64',
  z64: 'n64',
  v64: 'n64',
  nds: 'nds',
  '3ds': '3ds',
  cia: '3ds',
  pbp: 'psx',
  cso: 'psp',
  rvz: 'gamecube',
  gcm: 'gamecube',
  wbfs: 'wii',
  nsp: 'switch',
  xci: 'switch',
  md: 'genesis',
  gen: 'genesis',
  smd: 'genesis',
  sms: 'sms',
  gg: 'gamegear',
  pce: 'tg16',
  a26: 'atari2600',
}

/** Disc / raw-binary extensions that may belong to several consoles. */
const DISC_EXT = new Set(['iso', 'chd', 'cue', 'bin'])

/** Chromium 68–safe Blob slice reader (Blob.prototype.arrayBuffer landed in Chrome 76). */
function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('Read failed'))
    reader.readAsArrayBuffer(blob)
  })
}

function decodeName(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    } catch {
      /* fall through to ASCII */
    }
  }
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!)
  return out
}

function parseCentralDirectory(buf: ArrayBuffer, startOffset: number, maxLen: number, limit: number): string[] {
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)
  const end = Math.min(buf.byteLength, startOffset + maxLen)
  const names: string[] = []
  let pos = startOffset

  while (pos + 46 <= end && names.length < limit) {
    if (view.getUint32(pos, true) !== CD_SIG) break
    const nameLen = view.getUint16(pos + 28, true)
    const extraLen = view.getUint16(pos + 30, true)
    const commentLen = view.getUint16(pos + 32, true)
    const nameStart = pos + 46
    const nameEnd = nameStart + nameLen
    if (nameEnd > end) break
    const name = decodeName(bytes.subarray(nameStart, nameEnd))
    if (name && !name.endsWith('/') && !name.startsWith('__MACOSX/')) {
      const base = name.slice(name.lastIndexOf('/') + 1)
      if (base && !base.startsWith('.')) names.push(name)
    }
    pos = nameEnd + extraLen + commentLen
  }
  return names
}

function parseLocalFileHeader(buf: ArrayBuffer): string[] {
  if (buf.byteLength < 30) return []
  const view = new DataView(buf)
  if (view.getUint32(0, true) !== LFH_SIG) return []
  const nameLen = view.getUint16(26, true)
  if (nameLen === 0 || 30 + nameLen > buf.byteLength) return []
  const name = decodeName(new Uint8Array(buf, 30, nameLen))
  if (!name || name.endsWith('/') || name.startsWith('__MACOSX/')) return []
  const base = name.slice(name.lastIndexOf('/') + 1)
  return base && !base.startsWith('.') ? [name] : []
}

/**
 * Peeks inside a `.zip` File and returns up to `limit` inner filenames without decompressing.
 * Never throws on non-zip, empty, or corrupted files.
 */
export async function peekZipFilenames(file: File, limit = 32): Promise<string[]> {
  try {
    if (!file || file.size < 30) return []

    // 1. Read tail to locate the End of Central Directory (EOCD) record.
    const tailStart = Math.max(0, file.size - TAIL_BYTES)
    const tailBuf = await readBlob(file.slice(tailStart, file.size))
    const tailView = new DataView(tailBuf)

    let eocdPos = -1
    for (let i = tailBuf.byteLength - 22; i >= 0; i--) {
      if (tailView.getUint32(i, true) === EOCD_SIG) {
        const commentLen = tailView.getUint16(i + 20, true)
        if (i + 22 + commentLen <= tailBuf.byteLength) {
          eocdPos = i
          break
        }
      }
    }

    if (eocdPos >= 0) {
      const cdSize = tailView.getUint32(eocdPos + 12, true)
      const cdOffset = tailView.getUint32(eocdPos + 16, true)

      // Guard against ZIP64 sentinel (0xffffffff) or out-of-range offsets.
      if (cdOffset !== 0xffffffff && cdSize !== 0xffffffff && cdSize > 0 && cdOffset < file.size) {
        if (cdOffset >= tailStart && cdOffset - tailStart < tailBuf.byteLength) {
          const names = parseCentralDirectory(tailBuf, cdOffset - tailStart, cdSize, limit)
          if (names.length > 0) return names
        } else {
          const readLen = Math.min(cdSize, MAX_CD_READ, file.size - cdOffset)
          if (readLen >= 46) {
            const cdBuf = await readBlob(file.slice(cdOffset, cdOffset + readLen))
            const names = parseCentralDirectory(cdBuf, 0, readLen, limit)
            if (names.length > 0) return names
          }
        }
      }
    }

    // 2. Fallback: read Local File Header at offset 0 (covers single-file ROM zips & ZIP64).
    const headBuf = await readBlob(file.slice(0, Math.min(file.size, 512)))
    return parseLocalFileHeader(headBuf)
  } catch {
    return []
  }
}

/** Look for explicit console hints in an archive or inner filename when only disc formats exist. */
function consoleHintFromText(text: string): string | null {
  const s = text.toLowerCase()
  if (/\b(ps2|playstation\s*2)\b/.test(s)) return 'ps2'
  if (/\b(psp|playstation\s*portable)\b/.test(s)) return 'psp'
  if (/\b(gamecube|ngc|gcn)\b/.test(s)) return 'gamecube'
  if (/\bwii\s*u\b/.test(s)) return 'wiiu'
  if (/\bwii\b/.test(s)) return 'wii'
  if (/\b(saturn|sega\s*saturn)\b/.test(s)) return 'saturn'
  if (/\b(dreamcast)\b/.test(s)) return 'dc'
  if (/\b(sega\s*cd|mega\s*cd)\b/.test(s)) return 'segacd'
  if (/\b(psx|ps1|playstation)\b/.test(s)) return 'psx'
  return null
}

function fileExt(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/**
 * Peeks inside a `.zip` file and matches inner ROM extensions to the canonical RomM console slug.
 * Returns `null` if no recognized ROM extension is found or the file isn't a valid zip.
 * Never throws.
 */
export async function detectConsoleFromZip(file: File): Promise<string | null> {
  try {
    const names = await peekZipFilenames(file, 32)
    if (!names.length) return null

    // Pass 1: unambiguous ROM extension wins immediately.
    for (const name of names) {
      const ext = fileExt(name)
      const hit = UNAMBIGUOUS_EXT[ext]
      if (hit) return hit
    }

    // Pass 2: disc/binary formats (.iso, .chd, .cue, .bin).
    let foundDisc: string | null = null
    for (const name of names) {
      const ext = fileExt(name)
      if (DISC_EXT.has(ext)) {
        const hint = consoleHintFromText(name) ?? consoleHintFromText(file.name)
        if (hint) return hint
        foundDisc = ext
      }
    }

    if (foundDisc) {
      // PS1 CD images top out around 750 MB; multi-GB ISOs are usually PS2 DVDs.
      if (foundDisc === 'iso' && file.size > 1_100_000_000) return 'ps2'
      return 'psx'
    }

    return null
  } catch {
    return null
  }
}
