// Which file in an installed (or unpacked) game is the game. Pure: it goes by names, sizes and
// where files sit, the way a person would: not the uninstaller, the setup, a runtime, a crash
// reporter or a helper; the one the store named, else one named like the game, else the biggest.

import type { JobFile } from './types.ts'

const NOT_THE_GAME = /^(unins.*|setup.*|install.*|.*redist.*|dxsetup.*|dxwebsetup.*|dotnet.*|ndp\d.*|crash.*|.*report.*|.*helper.*|updat.*|7z.*|elevate.*|python.*|ffmpeg.*|.*test.*|oalinst.*|physx.*)$/
/** Folders that hold what an installer runs, or runtimes, never the game. */
const NOT_GAME_FOLDERS = /(^|\/)(\$pluginsdir|\$temp|tmp|_?redist|_?commonredist|__support|redistributables|directx|vcredist|dotnet)\//
const LINUX_ENDINGS = /\.(x86_64|x86|appimage|sh)$/
const NOT_PROGRAMS = /\.(so(\.\d+)*|dll|txt|md|png|jpg|json|xml|ini|cfg|dat|pak|bin)$/

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const stem = (p: string) => base(p).replace(/\.[a-z0-9_]+$/i, '')
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const depth = (p: string) => p.split('/').length

/** Words a game's program is likely named with: the installer's first word (as the lab did) and the title. */
export function programNames(title: string, installer?: string | null): string[] {
  const first = installer ? letters(stem(installer).split(/[-_ .]/)[0] ?? '') : ''
  return [...new Set([letters(title), first, ...title.toLowerCase().split(/[^a-z0-9]+/)])].filter((n) => n.length >= 3)
}

export interface FoundProgram {
  path: string
  /** A Linux build (it runs without the Windows layer). */
  linux: boolean
}

export function findProgram(files: JobFile[], opts: { hint?: string; names?: string[]; linux?: boolean } = {}): FoundProgram | null {
  const hint = opts.hint?.replace(/\\/g, '/').toLowerCase()
  if (hint) {
    const named = files.find((f) => f.path.toLowerCase() === hint) ?? files.find((f) => base(f.path).toLowerCase() === base(hint))
    if (named) return { path: named.path, linux: !/\.exe$/i.test(named.path) }
  }
  const usable = files.filter((f) => !NOT_GAME_FOLDERS.test(f.path.toLowerCase()) && !NOT_THE_GAME.test(stem(f.path).toLowerCase()))
  const windows = usable.filter((f) => /\.exe$/i.test(f.path))
  const linux = usable.filter((f) => !/\.exe$/i.test(f.path) && !NOT_PROGRAMS.test(f.path.toLowerCase()) && (f.executable === true || /\.(x86_64|x86|appimage)$/i.test(f.path)))
  const names = (opts.names ?? []).map(letters).filter((n) => n.length >= 3)
  const pick = (list: JobFile[], isLinux: boolean): FoundProgram | null => {
    if (!list.length) return null
    const isNamed = (f: JobFile) => names.some((n) => letters(stem(f.path)).includes(n))
    const best = [...list].sort((a, b) => {
      // Linux: a launcher (.sh, .x86_64, .AppImage) nearest the top beats the bare program it
      // starts, which often can't find its own libraries.
      if (isLinux) {
        const e = Number(LINUX_ENDINGS.test(b.path.toLowerCase())) - Number(LINUX_ENDINGS.test(a.path.toLowerCase()))
        if (e) return e
        if (depth(a.path) !== depth(b.path)) return depth(a.path) - depth(b.path)
      }
      // One named like the game beats one that isn't; among those, nearest the top; else the biggest.
      const n = Number(isNamed(b)) - Number(isNamed(a))
      if (n) return n
      return isNamed(a) && depth(a.path) !== depth(b.path) ? depth(a.path) - depth(b.path) : b.size - a.size
    })[0]!
    return { path: best.path, linux: isLinux }
  }
  return opts.linux ? (pick(linux, true) ?? pick(windows, false)) : (pick(windows, false) ?? pick(linux, true))
}
