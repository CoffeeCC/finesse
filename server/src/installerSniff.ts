// What a downloaded game file is, read from its bytes. Nothing here runs the file: it reads the
// first few megabytes and, for a Windows program, the data appended after its last section (the
// "overlay", where installers keep their payload). That decides how the game store installs it:
//
//   - unpack it without running anything (innoextract, 7z, msiextract, tar);
//   - or run it in the sandbox with the installer's own silent switches;
//   - or, when nothing is known about it, show its screen to a person ("needs you").
//
// The kinds match InstallerKind in src/api/gameStore.ts.

import { open } from 'node:fs/promises'

export type InstallerKind = 'inno' | 'nsis' | 'msi' | 'archive' | 'portable' | 'linux' | 'unknown'

export interface Sniffed {
  kind: InstallerKind
  /** What exactly, in words: "Inno Setup 6.3.0", "NSIS installer", "zip archive". */
  format: string
  version?: string
  /** For a Windows program: what it was built for. Installers are often 32-bit even for 64-bit games. */
  arch?: 'x86' | 'x64' | 'arm64'
  /** A tool that can unpack it without running it. */
  unpack?: 'innoextract' | '7z' | 'msiextract' | 'tar'
  /** The installer's own switches for a run with no questions. <dir> is the install folder. */
  silent?: string[]
  /** Plain notes on anything that changes how it's handled. */
  notes: string[]
}

/** A Windows program with nothing packed into it: the game itself, not an installer. */
export function looksPortable(s: Sniffed): boolean {
  return s.kind === 'unknown' && /^Windows (console )?program$/.test(s.format) && !s.notes.some((n) => n.startsWith(UNKNOWN_PAYLOAD))
}
const UNKNOWN_PAYLOAD = 'A large block of data is appended'

/** How much of the start of the file, and of the overlay, is read. */
const HEAD = 8 * 1024 * 1024
const OVERLAY = 1024 * 1024

const MAGIC = {
  ole: Buffer.from('d0cf11e0a1b11ae1', 'hex'),
  zip: Buffer.from('504b0304', 'hex'),
  sevenZip: Buffer.from('377abcaf271c', 'hex'),
  rar: Buffer.from('526172211a07', 'hex'),
  gzip: Buffer.from('1f8b', 'hex'),
  xz: Buffer.from('fd377a585a00', 'hex'),
  zstd: Buffer.from('28b52ffd', 'hex'),
  bzip2: Buffer.from('425a68', 'hex'),
  elf: Buffer.from('7f454c46', 'hex'),
  nsis: Buffer.concat([Buffer.from('efbeadde', 'hex'), Buffer.from('NullsoftInst')]),
}

const INNO_DATA = /Inno Setup Setup Data \((\d+\.\d+\.\d+)\)/
const INNO_SILENT = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/DIR=<dir>']

/** Reads what sniffBytes needs from a file on disk. */
export async function sniffFile(path: string): Promise<Sniffed> {
  const f = await open(path, 'r')
  try {
    const { size } = await f.stat()
    const head = Buffer.alloc(Math.min(size, HEAD))
    await f.read(head, 0, head.length, 0)
    const pe = peLayout(head)
    let overlay: Buffer | undefined
    if (pe && pe.overlayAt < size) {
      overlay = Buffer.alloc(Math.min(size - pe.overlayAt, OVERLAY))
      await f.read(overlay, 0, overlay.length, pe.overlayAt)
    }
    return sniffBytes(head, size, overlay)
  } finally {
    await f.close()
  }
}

/** The pure part: the file's first bytes, its size, and its overlay's first bytes if it has one. */
export function sniffBytes(head: Buffer, size: number, overlay?: Buffer): Sniffed {
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return sniffWindows(head, size, overlay)
  if (startsWith(head, MAGIC.ole)) return { kind: 'msi', format: 'Windows Installer package (MSI)', unpack: 'msiextract', silent: ['msiexec', '/i', '<file>', '/qn', '/norestart', 'TARGETDIR=<dir>'], notes: [] }
  if (startsWith(head, MAGIC.elf)) {
    const appImage = head.length > 10 && head[8] === 0x41 && head[9] === 0x49 && head[10] === 0x02
    return { kind: 'linux', format: appImage ? 'AppImage' : 'Linux program', notes: [] }
  }
  if (head.length > 2 && head[0] === 0x23 && head[1] === 0x21) {
    const makeself = head.subarray(0, 64 * 1024).includes('Makeself')
    return {
      kind: 'linux',
      format: makeself ? 'Linux installer script (Makeself)' : 'Linux shell script',
      notes: makeself ? ['A Makeself archive: it can be unpacked with its own --noexec --target <dir> switches.'] : [],
    }
  }
  const archive = archiveFormat(head)
  if (archive) return { kind: 'archive', format: archive.format, unpack: archive.unpack, notes: [] }
  if (head.length > 0x8006 && head.subarray(0x8001, 0x8006).toString('latin1') === 'CD001')
    return { kind: 'archive', format: 'Disc image (ISO)', unpack: '7z', notes: ['Unpack it, then look inside for the installer.'] }
  return { kind: 'unknown', format: size === 0 ? 'Empty file' : 'Unrecognised file', notes: [] }
}

function sniffWindows(head: Buffer, size: number, overlay: Buffer | undefined): Sniffed {
  const pe = peLayout(head)
  if (!pe) return { kind: 'unknown', format: 'DOS program or damaged Windows program', notes: [] }
  const arch = pe.arch
  const tail = overlay ?? Buffer.alloc(0)
  const notes: string[] = []
  // Appended data that is only the code signature is no payload.
  const payloadEnd = pe.signatureAt ?? size
  const payload = Math.max(0, payloadEnd - pe.overlayAt)
  if (!payload) notes.push('Nothing appended after the program: the game may be in files next to it.')

  // Inno Setup: its data block starts with a fixed name and the version that built it.
  const inno = INNO_DATA.exec(tail.subarray(0, 4096).toString('latin1')) ?? INNO_DATA.exec(head.toString('latin1'))
  if (inno || (pe.sections.includes('.itext') && contains(head, 'Inno Setup'))) {
    const version = inno?.[1]
    return {
      kind: 'inno',
      format: version ? `Inno Setup ${version}` : 'Inno Setup',
      version,
      arch,
      unpack: 'innoextract',
      silent: INNO_SILENT,
      notes: [
        ...notes,
        'Installers that run extra steps of their own (unpackers, redistributables) only work fully when run; unpacking skips those steps.',
      ],
    }
  }
  // NSIS: a fixed signature right at the start of the appended data.
  if (tail.subarray(0, 4096).includes(MAGIC.nsis) || head.includes(MAGIC.nsis))
    return { kind: 'nsis', format: 'NSIS installer', arch, unpack: '7z', silent: ['/S', '/D=<dir>'], notes: [...notes, '/D must be the last switch and has no quotes.'] }
  // WiX Burn: a bundle of MSIs and prerequisites, marked by a section of its own.
  if (pe.sections.includes('.wixburn'))
    return { kind: 'msi', format: 'WiX bundle (several MSI packages)', arch, unpack: '7z', silent: ['/quiet', '/norestart', 'InstallFolder=<dir>'], notes: [...notes, 'Prerequisites inside a bundle may want the internet.'] }
  if (contains(head, 'InstallShield') || contains(tail, 'InstallShield'))
    return { kind: 'unknown', format: 'InstallShield installer', arch, silent: ['/s', '/v"/qn INSTALLDIR=<dir>"'], notes: [...notes, 'InstallShield needs a recorded answer file to run silently, so expect to click through it.'] }
  // Self-extracting archives: the payload is an ordinary archive appended to a small program.
  const sfx = payload ? (archiveFormat(tail) ?? archiveFormat(tail.subarray(0, 4096), true)) : null
  if (sfx) return { kind: 'archive', format: `Self-extracting ${sfx.format}`, arch, unpack: '7z', notes }
  if (payload > 1024 * 1024)
    notes.push(`${UNKNOWN_PAYLOAD} that Finesse doesn’t recognise: probably an installer it doesn’t know.`)
  return { kind: 'unknown', format: pe.gui ? 'Windows program' : 'Windows console program', arch, notes }
}

interface PeLayout {
  arch?: 'x86' | 'x64' | 'arm64'
  sections: string[]
  /** Where the data after the last section starts (the file size when there's none). */
  overlayAt: number
  /** Where the code signature starts, when it's appended after the sections. */
  signatureAt?: number
  gui: boolean
}

/** The bits of a Windows program's headers this needs. null when they don't add up. */
export function peLayout(b: Buffer): PeLayout | null {
  if (b.length < 0x40 || b[0] !== 0x4d || b[1] !== 0x5a) return null
  const pe = b.readUInt32LE(0x3c)
  if (pe + 24 > b.length || b.readUInt32LE(pe) !== 0x00004550) return null
  const machine = b.readUInt16LE(pe + 4)
  const count = b.readUInt16LE(pe + 6)
  const optSize = b.readUInt16LE(pe + 20)
  const opt = pe + 24
  const table = opt + optSize
  if (count === 0 || count > 96 || table + count * 40 > b.length) return null
  let subsystem = 0
  let certAt = 0
  if (opt + 70 <= b.length) {
    subsystem = b.readUInt16LE(opt + 68)
    // The signature (certificate table) is appended at the very end and isn't part of the payload.
    const magic = b.readUInt16LE(opt)
    const dirs = opt + (magic === 0x20b ? 112 : 96)
    if (dirs + 40 <= b.length) certAt = b.readUInt32LE(dirs + 32)
  }
  const sections: string[] = []
  let end = 0
  for (let i = 0; i < count; i++) {
    const s = table + i * 40
    sections.push(b.subarray(s, s + 8).toString('latin1').replace(/\0+$/, ''))
    const rawSize = b.readUInt32LE(s + 16)
    const rawAt = b.readUInt32LE(s + 20)
    if (rawSize && rawAt + rawSize > end) end = rawAt + rawSize
  }
  return {
    arch: machine === 0x14c ? 'x86' : machine === 0x8664 ? 'x64' : machine === 0xaa64 ? 'arm64' : undefined,
    sections,
    overlayAt: end,
    signatureAt: certAt >= end ? certAt : undefined,
    gui: subsystem === 2,
  }
}

function archiveFormat(b: Buffer, anywhere = false): { format: string; unpack: '7z' | 'tar' } | null {
  const at = (m: Buffer) => (anywhere ? b.includes(m) : startsWith(b, m))
  if (at(MAGIC.zip)) return { format: 'zip archive', unpack: '7z' }
  if (at(MAGIC.sevenZip)) return { format: '7z archive', unpack: '7z' }
  if (at(MAGIC.rar)) return { format: 'RAR archive', unpack: '7z' }
  if (anywhere) return null
  if (startsWith(b, MAGIC.gzip)) return { format: 'gzip archive (often .tar.gz)', unpack: 'tar' }
  if (startsWith(b, MAGIC.xz)) return { format: 'xz archive (often .tar.xz)', unpack: 'tar' }
  if (startsWith(b, MAGIC.zstd)) return { format: 'zstd archive (often .tar.zst)', unpack: 'tar' }
  if (startsWith(b, MAGIC.bzip2)) return { format: 'bzip2 archive (often .tar.bz2)', unpack: 'tar' }
  if (b.length > 262 && b.subarray(257, 262).toString('latin1') === 'ustar') return { format: 'tar archive', unpack: 'tar' }
  return null
}

function startsWith(b: Buffer, m: Buffer): boolean {
  return b.length >= m.length && b.subarray(0, m.length).equals(m)
}

function contains(b: Buffer, s: string): boolean {
  return b.includes(s, 0, 'latin1')
}
