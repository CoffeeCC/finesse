// Step 1 of a hands-off install, run with Node beside Finesse's server code: check the download's
// checksums, find the installer, and work out what it is. Writes plan.env for the sandbox step.
// Usage: node plan.ts <download folder> [where to write plan.env]
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeChecks, verifyDownload } from '/w/server/src/downloadCheck.ts'
import { sniffFile } from '/w/server/src/installerSniff.ts'

const dir = process.argv[2]!
const checks = await verifyDownload(dir, { onFile: (f, i, n) => console.log(`   checking ${i + 1}/${n}: ${f}`) })
const verdict = describeChecks(checks)
for (const c of checks) console.log(`   ${c.result === 'ok' ? '✓' : '✗'} ${c.file} (${c.algo}, from ${c.source}): ${c.result}`)
console.log(`   → ${verdict.text}`)

// The installer: the biggest program or package in the top folder.
const candidates = readdirSync(dir)
  .filter((f) => /\.(exe|msi)$/i.test(f))
  .map((f) => ({ f, size: statSync(join(dir, f)).size }))
  .sort((a, b) => b.size - a.size)
const installer = candidates[0]?.f
const s = installer ? await sniffFile(join(dir, installer)) : null
console.log(installer ? `   installer: ${installer} → ${s!.format} (${s!.kind})${s!.unpack ? `, unpack with ${s!.unpack}` : ''}` : '   no installer found')
for (const n of s?.notes ?? []) console.log(`   note: ${n}`)

writeFileSync(
  process.argv[3] ?? join(dir, 'plan.env'),
  [`CHECKS_OK=${verdict.ok ? 1 : 0}`, `INSTALLER='${installer ?? ''}'`, `KIND=${s?.kind ?? none()}`, `UNPACK=${s?.unpack ?? ''}`].join('\n') + '\n',
)
function none() {
  return 'none'
}
