// Checks a finished game download against the checksum lists that came with it (.md5, .sha1,
// .sha256 and their *sum spellings), or one the store gave. A list in a subfolder (an "MD5"
// folder) may name files beside it or in the download's top folder; both are tried.
//
// A list that ships inside the download proves the files arrived whole, not that they're genuine:
// whoever changed the files could change the list too. Only a checksum from somewhere else (the
// game's own site, the store) says that, which is why results say where each hash came from.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'

export type HashAlgo = 'md5' | 'sha1' | 'sha256'

export interface ChecksumEntry {
  /** The file as the list names it, with forward slashes. */
  file: string
  algo: HashAlgo
  expected: string
}

export interface FileCheck {
  file: string
  algo: HashAlgo
  /** Where the expected hash came from: a list in the download (its path), or "store". */
  source: string
  result: 'ok' | 'mismatch' | 'missing'
  /** The path that was checked, relative to the download folder. */
  path?: string
}

const LIST = /\.(md5|sha1|sha256)(sum)?$|\.(md5|sha1|sha256)sums?$/i
const ALGO_BY_LENGTH: Record<number, HashAlgo> = { 32: 'md5', 40: 'sha1', 64: 'sha256' }

/** The entries of one checksum list. Understands the md5sum style ("<hash>  name",
 *  "<hash> *name"), the BSD style ("MD5 (name) = <hash>"), and skips comments (; and #). */
export function parseChecksumList(text: string): ChecksumEntry[] {
  const out: ChecksumEntry[] = []
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    let hash: string | undefined
    let file: string | undefined
    const bsd = /^(MD5|SHA1|SHA256)\s*\((.+)\)\s*=\s*([0-9a-fA-F]+)$/.exec(line)
    const gnu = /^([0-9a-fA-F]{32,64})\s+\*?(.+)$/.exec(line)
    if (bsd) [hash, file] = [bsd[3], bsd[2]]
    else if (gnu) [hash, file] = [gnu[1], gnu[2]]
    const algo = hash ? ALGO_BY_LENGTH[hash.length] : undefined
    if (!hash || !file || !algo) continue
    file = file.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    out.push({ file, algo, expected: hash.toLowerCase() })
  }
  return out
}

/** Checksum lists in the folder and one level of subfolders. */
export async function findChecksumLists(dir: string): Promise<string[]> {
  const found: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isFile() && LIST.test(e.name)) found.push(join(dir, e.name))
    else if (e.isDirectory())
      for (const f of await readdir(join(dir, e.name), { withFileTypes: true }))
        if (f.isFile() && LIST.test(f.name)) found.push(join(dir, e.name, f.name))
  }
  return found.sort()
}

export function hashFile(path: string, algo: HashAlgo): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash(algo)
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

/** Where a listed file is: beside the list, then from the download's top folder. Never outside it. */
async function locate(root: string, listDir: string, name: string): Promise<string | null> {
  for (const base of [listDir, root]) {
    const p = join(base, ...name.split('/'))
    const rel = relative(root, p)
    if (rel.startsWith('..') || rel.split(sep).includes('..')) continue
    if (await isFile(p)) return p
  }
  return null
}

/**
 * Checks every file the download's own lists name, plus any `store` entries (hashes the store
 * gave, which are the only ones that say the files are genuine). `onFile` reports progress.
 */
export async function verifyDownload(
  root: string,
  opts: { store?: ChecksumEntry[]; onFile?: (file: string, done: number, total: number) => void } = {},
): Promise<FileCheck[]> {
  const jobs: { entry: ChecksumEntry; source: string; listDir: string }[] = []
  for (const list of await findChecksumLists(root)) {
    const entries = parseChecksumList(await readFile(list, 'utf8'))
    for (const entry of entries) jobs.push({ entry, source: relative(root, list).split(sep).join('/'), listDir: dirname(list) })
  }
  for (const entry of opts.store ?? []) jobs.push({ entry, source: 'store', listDir: root })
  const out: FileCheck[] = []
  for (const [i, { entry, source, listDir }] of jobs.entries()) {
    opts.onFile?.(entry.file, i, jobs.length)
    const path = await locate(root, listDir, entry.file)
    if (!path) {
      out.push({ file: entry.file, algo: entry.algo, source, result: 'missing' })
      continue
    }
    const actual = await hashFile(path, entry.algo)
    out.push({ file: entry.file, algo: entry.algo, source, result: actual === entry.expected ? 'ok' : 'mismatch', path: relative(root, path).split(sep).join('/') })
  }
  return out
}

/** One line for the request page. */
export function describeChecks(checks: FileCheck[]): { ok: boolean; genuine: boolean; text: string } {
  if (!checks.length) return { ok: true, genuine: false, text: 'No checksums came with this download, so it couldn’t be checked.' }
  const bad = checks.filter((c) => c.result !== 'ok')
  const genuine = checks.some((c) => c.source === 'store' && c.result === 'ok')
  if (!bad.length)
    return { ok: true, genuine, text: checks.length === 1 ? `Its checksum matches${genuine ? ' the store’s' : ''}.` : `All ${checks.length} checksums match${genuine ? ', including the store’s' : ''}.` }
  const first = bad[0]!
  const what = first.result === 'missing' ? `${basename(first.file)} is missing` : `${basename(first.file)} doesn’t match its checksum`
  return { ok: false, genuine: false, text: `${what}${bad.length > 1 ? ` (and ${bad.length - 1} more)` : ''}. It may be damaged or incomplete: re-check the download, or try again.` }
}
