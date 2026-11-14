// What a downloaded game file is, from its bytes (installerSniff.ts). The Windows programs here
// are built in the test: a DOS header, PE headers, one or two sections, and whatever an
// installer appends after them. Checked by hand against real installers: Inno Setup 6.3.3,
// Notepad++ and OpenTTD (NSIS), 7-Zip's installer (7z self-extractor) and its MSI.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { peLayout, sniffBytes, sniffFile } from '../src/installerSniff.ts'

/** A minimal Windows program: sections of the given names (0x200 bytes each), then `overlay`. */
function fakeExe(opts: { sections?: string[]; overlay?: Buffer; machine?: number; gui?: boolean; signed?: number; text?: string } = {}): Buffer {
  const sections = opts.sections ?? ['.text']
  const pe = 0x80
  const opt = pe + 24
  const optSize = 0xe0 // PE32
  const table = opt + optSize
  const headerEnd = 0x400
  const b = Buffer.alloc(headerEnd + sections.length * 0x200)
  b.write('MZ', 0, 'latin1')
  b.writeUInt32LE(pe, 0x3c)
  b.writeUInt32LE(0x00004550, pe)
  b.writeUInt16LE(opts.machine ?? 0x14c, pe + 4)
  b.writeUInt16LE(sections.length, pe + 6)
  b.writeUInt16LE(optSize, pe + 20)
  b.writeUInt16LE(0x10b, opt)
  b.writeUInt16LE(opts.gui === false ? 3 : 2, opt + 68)
  sections.forEach((name, i) => {
    const s = table + i * 40
    b.write(name, s, 'latin1')
    b.writeUInt32LE(0x200, s + 16)
    b.writeUInt32LE(headerEnd + i * 0x200, s + 20)
  })
  if (opts.text) b.write(opts.text, headerEnd, 'latin1')
  const body = Buffer.concat([b, opts.overlay ?? Buffer.alloc(0)])
  if (opts.signed) {
    // The certificate table entry (data directory 4) points at a signature appended at the end.
    b.writeUInt32LE(body.length, opt + 96 + 32)
    const signed = Buffer.concat([b, opts.overlay ?? Buffer.alloc(0), Buffer.alloc(opts.signed)])
    return signed
  }
  return body
}

const overlayOf = (exe: Buffer) => {
  const pe = peLayout(exe)!
  return exe.subarray(pe.overlayAt)
}
const sniffExe = (exe: Buffer) => sniffBytes(exe, exe.length, overlayOf(exe))

test('reads a Windows program’s headers: sections, end of the last one, machine', () => {
  const exe = fakeExe({ sections: ['.text', '.rsrc'], overlay: Buffer.alloc(100), machine: 0x8664 })
  const pe = peLayout(exe)!
  assert.deepEqual(pe.sections, ['.text', '.rsrc'])
  assert.equal(pe.overlayAt, 0x400 + 2 * 0x200)
  assert.equal(pe.arch, 'x64')
  assert.equal(pe.gui, true)
  assert.equal(peLayout(Buffer.from('MZ not really a program')), null)
})

test('Inno Setup: found by its data block, with the version', () => {
  const s = sniffExe(fakeExe({ overlay: Buffer.from('Inno Setup Setup Data (6.3.0) (u)\0\0\0', 'latin1') }))
  assert.equal(s.kind, 'inno')
  assert.equal(s.version, '6.3.0')
  assert.equal(s.unpack, 'innoextract')
  assert.ok(s.silent?.includes('/VERYSILENT'))
  assert.equal(s.arch, 'x86')
})

test('NSIS: found by its signature at the start of the appended data', () => {
  const sig = Buffer.concat([Buffer.from('00000000efbeadde', 'hex'), Buffer.from('NullsoftInst'), Buffer.alloc(64)])
  const s = sniffExe(fakeExe({ overlay: sig }))
  assert.equal(s.kind, 'nsis')
  assert.equal(s.unpack, '7z')
  assert.deepEqual(s.silent, ['/S', '/D=<dir>'])
})

test('WiX bundles and InstallShield', () => {
  assert.equal(sniffExe(fakeExe({ sections: ['.text', '.wixburn'], overlay: Buffer.alloc(10) })).format, 'WiX bundle (several MSI packages)')
  const is = sniffExe(fakeExe({ text: 'InstallShield Setup Launcher' }))
  assert.equal(is.kind, 'unknown')
  assert.equal(is.format, 'InstallShield installer')
})

test('self-extracting archives: an archive appended to a small program', () => {
  const s7 = sniffExe(fakeExe({ overlay: Buffer.concat([Buffer.from('377abcaf271c0004', 'hex'), Buffer.alloc(32)]) }))
  assert.deepEqual([s7.kind, s7.format, s7.unpack], ['archive', 'Self-extracting 7z archive', '7z'])
  const zip = sniffExe(fakeExe({ overlay: Buffer.concat([Buffer.alloc(40), Buffer.from('504b0304', 'hex'), Buffer.alloc(32)]) }))
  assert.equal(zip.format, 'Self-extracting zip archive')
})

test('a plain program is unknown, and says whether anything big is appended', () => {
  const plain = sniffExe(fakeExe())
  assert.equal(plain.kind, 'unknown')
  assert.equal(plain.format, 'Windows program')
  assert.match(plain.notes.join(' '), /Nothing appended/)
  const mystery = sniffExe(fakeExe({ overlay: Buffer.alloc(2 * 1024 * 1024, 7) }))
  assert.match(mystery.notes.join(' '), /doesn’t recognise/)
  assert.equal(sniffExe(fakeExe({ gui: false })).format, 'Windows console program')
})

test('a code signature after the sections is not a payload', () => {
  const s = sniffExe(fakeExe({ signed: 4096 }))
  assert.equal(s.kind, 'unknown')
  assert.match(s.notes.join(' '), /Nothing appended/)
})

test('MSI, Linux programs, AppImages and Makeself scripts', () => {
  const msi = sniffBytes(Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504)]), 512)
  assert.deepEqual([msi.kind, msi.unpack], ['msi', 'msiextract'])
  const elf = Buffer.concat([Buffer.from('7f454c46020101', 'hex'), Buffer.alloc(57)])
  assert.deepEqual([sniffBytes(elf, 64).kind, sniffBytes(elf, 64).format], ['linux', 'Linux program'])
  const appImage = Buffer.from(elf)
  appImage.write('AI\x02', 8, 'latin1')
  assert.equal(sniffBytes(appImage, 64).format, 'AppImage')
  const sh = Buffer.from('#!/bin/sh\n# This script was generated using Makeself 2.4.0\n')
  assert.equal(sniffBytes(sh, sh.length).format, 'Linux installer script (Makeself)')
})

test('archives by their first bytes', () => {
  const fmt = (hex: string) => sniffBytes(Buffer.concat([Buffer.from(hex, 'hex'), Buffer.alloc(300)]), 300).format
  assert.equal(fmt('504b0304'), 'zip archive')
  assert.equal(fmt('377abcaf271c'), '7z archive')
  assert.equal(fmt('526172211a0700'), 'RAR archive')
  assert.equal(fmt('1f8b08'), 'gzip archive (often .tar.gz)')
  assert.equal(fmt('fd377a585a00'), 'xz archive (often .tar.xz)')
  const iso = Buffer.alloc(0x9000)
  iso.write('CD001', 0x8001, 'latin1')
  assert.equal(sniffBytes(iso, iso.length).format, 'Disc image (ISO)')
})

test('garbage and empty files are unknown, never a crash', () => {
  assert.equal(sniffBytes(Buffer.alloc(0), 0).format, 'Empty file')
  assert.equal(sniffBytes(Buffer.from('hello'), 5).kind, 'unknown')
  const broken = fakeExe()
  broken.writeUInt32LE(0xffffff, 0x3c) // PE header pointer off the end
  assert.equal(sniffBytes(broken, broken.length).format, 'DOS program or damaged Windows program')
})

test('sniffFile reads the overlay from disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sniff-'))
  try {
    const f = join(dir, 'setup.exe')
    writeFileSync(f, fakeExe({ overlay: Buffer.from('Inno Setup Setup Data (6.4.2)', 'latin1') }))
    const s = await sniffFile(f)
    assert.equal(s.format, 'Inno Setup 6.4.2')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
