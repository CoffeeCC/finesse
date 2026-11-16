// The installer lab through the real sandbox: each case goes through the same code a request
// does (server/src/gamestore/sandbox.ts DockerInstaller + install.ts), in the installer image,
// with no network. Prints what happened against what the lab expects, and exits 1 on a change.
//
//   node tools/installer-lab/run-sandbox.ts <folder>... [--image finesse-installer:dev] [--data <dir>] [--only 01,06]
//
// Each <folder> holds one case per subfolder: the built test installers (out/01-plain …) or free
// games downloaded with their official checksums (real/supertux …). Needs Docker. <dir> is where
// installs go (it must be the same path for Docker as here); it's emptied first.

import { mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { StoredRequest } from '../../server/src/gamestore/db.ts'
import { DockerInstaller } from '../../server/src/gamestore/sandbox.ts'
import { Docker } from '../../server/src/stack/docker.ts'

type Expect = { state: 'ready' | 'needs-you' | 'failed'; by?: string; why?: RegExp }

/** What the lab found for each case (results-*.txt, real-results.txt), as the engine decides it. */
const EXPECTED: Record<string, Expect> = {
  '01-plain': { state: 'ready', by: 'unpack' },
  '02-spanned': { state: 'ready', by: 'unpack' },
  '03-ultra': { state: 'ready', by: 'unpack' },
  // Unpacking takes every part and skips the required page.
  '04-pages': { state: 'ready', by: 'unpack' },
  '05-refuses-silent': { state: 'ready', by: 'unpack' },
  // It runs a runtime installer of its own (tmp/), so the installer is run, not unpacked.
  '06-runtime': { state: 'ready', by: 'silent' },
  '07-needs-internet': { state: 'ready', by: 'unpack' },
  // It installs fine and crashes at start: installed, with a warning that it couldn’t be test-started.
  '08-broken-game': { state: 'ready', by: 'unpack' },
  // Free games: SuperTux's MSI unpacks; Warzone 2100's Inno 6.7 is too new to unpack, so it's run.
  supertux: { state: 'ready', by: 'unpack' },
  warzone2100: { state: 'ready', by: 'silent' },
}
const TITLES: Record<string, string> = { supertux: 'SuperTux', warzone2100: 'Warzone 2100', '0ad': '0 A.D.', openttd: 'OpenTTD' }

const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const image = opt('--image') ?? 'finesse-installer:dev'
const data = resolve(opt('--data') ?? '/tmp/finesse-installer-lab')
const only = opt('--only')?.split(',')
if (!args.length) {
  console.error('usage: run-sandbox.ts <folder>... [--image <image>] [--data <dir>] [--only 01,06]')
  process.exit(64)
}

await rm(join(data, 'media'), { recursive: true, force: true })
await mkdir(data, { recursive: true })
const installer = new DockerInstaller({
  docker: new Docker(),
  image,
  where: () => ({ hostData: data, puid: Number(process.env.LAB_UID ?? 1000), pgid: Number(process.env.LAB_GID ?? 1000) }),
  instance: 'installer-lab',
})
await installer.sweep()

const rows: string[][] = []
let changed = 0
for (const folder of args) {
  for (const name of (await readdir(folder)).sort()) {
    if (only && !only.some((o) => name.startsWith(o))) continue
    const dir = join(resolve(folder), name)
    const files = await readdir(dir).catch(() => [])
    if (!files.some((f) => /\.(exe|msi|zip|7z)$/i.test(f))) continue
    const id = `lab-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    const r = { id, gameId: id, title: TITLES[name] ?? 'Finesse Test Game', sourceId: id, platform: 'windows', installer: 'unknown', state: 'installing', sizeBytes: 0, requestedBy: 'lab', userId: 'lab', createdAt: '', updatedAt: '' } as StoredRequest
    const started = Date.now()
    console.log(`\n== ${name}`)
    const out = await installer.install(r, dir, (t) => console.log(`   ${t}`))
    const secs = Math.round((Date.now() - started) / 1000)
    const got = out.state === 'ready' ? `ready, by ${out.by}: ${out.program}` : out.state === 'needs-you' ? `needs you: ${out.why}` : `failed: ${out.reason}`
    const want = EXPECTED[name]
    const same = !want || (want.state === out.state && (!want.by || (out.state === 'ready' && out.by === want.by)) && (!want.why || (out.state === 'failed' && want.why.test(out.reason))))
    if (!same) changed++
    rows.push([name, `${secs}s`, got, want ? (same ? 'as expected' : `EXPECTED ${want.state}${want.by ? ` by ${want.by}` : ''}`) : '(no expectation)'])
    // A case waiting on a person isn't left running.
    if (out.state === 'needs-you') await installer.remove(r)
  }
}

console.log('\n' + rows.map((r) => r.join('  |  ')).join('\n'))
console.log(changed ? `\n${changed} outcome(s) changed.` : '\nEvery outcome as expected.')
process.exit(changed ? 1 : 0)
