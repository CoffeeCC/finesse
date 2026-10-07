// Samples for a new server: something to play the moment setup finishes (the Lo-Finessa album in
// Music). Copied once, when setup asks for them (libraries.samples): never again after that, so an
// album someone deleted stays deleted, whatever setup re-runs.

import { chownSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the image keeps them (/app/samples), or the repository's samples/ when run from source. */
export function samplesDir(): string | null {
  const candidates = [process.env.FINESSE_SAMPLES_DIR, '/app/samples', resolve(dirname(fileURLToPath(import.meta.url)), '../../../samples')]
  return candidates.find((d): d is string => Boolean(d) && existsSync(join(d!, 'music'))) ?? null
}

/** Copies the samples for the libraries that are on into the media folder; returns what was added. */
export function addSamples(hostData: string, libs: { music?: boolean }, owner: { uid: number; gid: number }): string[] {
  const src = samplesDir()
  if (!src) return []
  const added: string[] = []
  if (libs.music !== false && existsSync(join(src, 'music'))) {
    const dest = join(hostData, 'media', 'music')
    for (const artist of readdirSync(join(src, 'music'))) {
      const to = join(dest, artist)
      if (existsSync(to)) continue // someone's own music by that name: leave it be
      cpSync(join(src, 'music', artist), to, { recursive: true })
      own(to, owner)
      added.push(`music/${artist}`)
    }
  }
  return added
}

function own(p: string, o: { uid: number; gid: number }) {
  try {
    chownSync(p, o.uid, o.gid)
  } catch {
    return
  }
  if (statSync(p).isDirectory()) for (const n of readdirSync(p)) own(join(p, n), o)
}
