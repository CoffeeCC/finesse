// Rank game executables using the store's hint, known engine layouts, and the game's name.

import type { JobFile } from './types.ts'

const NOT_THE_GAME = /^(uninst.*|unins.*|setup.*|install.*|.*redist.*|dxsetup.*|dxwebsetup.*|dotnet.*|ndp\d.*|crash.*|.*report.*|.*helper.*|updat.*|7z.*|elevate.*|python.*|ffmpeg.*|.*test.*|oalinst.*|physx.*|unitycrashhandler.*|ue.*prereq.*|easyanticheat.*|battleye.*|start_protected_game.*|anticheat.*|directx.*|xnafx.*|openal.*)$/
/** Folders that hold what an installer runs, or runtimes, never the game. */
const NOT_GAME_FOLDERS = /(^|\/)(\$pluginsdir|\$temp|tmp|_?redist|_?commonredist|__support|redistributables|directx|vcredist|dotnet)\//
const LINUX_ENDINGS = /\.(x86_64|x86|appimage|sh)$/
const NOT_PROGRAMS = /\.(so(\.\d+)*|dll|txt|md|png|jpg|json|xml|ini|cfg|dat|pak|pck|bin|msi|zip|7z|rar|iso|tar|gz|xz|zst|bz2|\d{3})$/

const normalized = (p: string) => p.replace(/\\/g, '/').toLowerCase()
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

export interface ProgramCandidate extends FoundProgram {
  score: number
  reason: string
}

interface ProgramOptions {
  hint?: string
  names?: string[]
  linux?: boolean
}

const ENGINE = {
  unity: { score: 120, reason: 'Unity game executable' },
  unreal: { score: 100, reason: 'Unreal Engine shipping executable' },
  godot: { score: 100, reason: 'Godot game executable' },
  rpgMaker: { score: 90, reason: 'RPG Maker executable' },
}

export function findPrograms(files: JobFile[], opts: ProgramOptions = {}): ProgramCandidate[] {
  const paths = new Set(files.map((f) => normalized(f.path)))
  const directories = new Set<string>()
  for (const path of paths) {
    for (let slash = path.lastIndexOf('/'); slash >= 0; slash = path.lastIndexOf('/', slash - 1)) {
      directories.add(path.slice(0, slash))
      if (slash === 0) break
    }
  }
  const hint = opts.hint && normalized(opts.hint)
  const names = (opts.names ?? []).map(letters).filter((n) => n.length >= 3)
  const candidates: { candidate: ProgramCandidate; depth: number; size: number }[] = []
  for (const f of files) {
    const path = normalized(f.path)
    const name = stem(path)
    if (NOT_GAME_FOLDERS.test(path) || NOT_THE_GAME.test(name)) continue
    const hinted = Boolean(hint && (path === hint || (!paths.has(hint) && base(path) === base(hint))))
    const linux = !path.endsWith('.exe')
    if (linux && (NOT_PROGRAMS.test(path) || !(hinted || f.executable || /\.(x86_64|x86|appimage)$/.test(path)))) continue

    const beside = path.slice(0, path.lastIndexOf('/') + 1)
    const engine =
      !linux && directories.has(`${beside}${name}_data`) ? ENGINE.unity :
      /(?:^|\/)binaries\/(win64|win32)\/[^/]+-\1-shipping\.exe$/.test(path) ? ENGINE.unreal :
      paths.has(`${beside}${name}.pck`) ? ENGINE.godot :
      base(path) === 'game.exe' && (directories.has(`${beside}www`) || directories.has(`${beside}data`)) ? ENGINE.rpgMaker : null
    const named = names.some((n) => letters(name).includes(n))
    const launcher = linux && LINUX_ENDINGS.test(path)
    const score = (hinted ? 500 : 0) + (linux === (opts.linux === true) ? 200 : 0) +
      (engine?.score ?? 0) + (named ? 60 : 0) + (launcher ? 70 : 0)
    const reason = hinted ? 'Store executable hint' : engine?.reason ??
      (named ? 'Matches the game’s name' : launcher ? 'Linux launcher' : linux ? 'Linux executable' : 'Windows executable')
    candidates.push({ candidate: { path: f.path, linux, score, reason }, depth: depth(path), size: f.size })
  }
  return candidates.sort((a, b) => b.candidate.score - a.candidate.score || a.depth - b.depth || b.size - a.size)
    .map(({ candidate }) => candidate)
}

export function findProgram(files: JobFile[], opts: ProgramOptions = {}): FoundProgram | null {
  const best = findPrograms(files, opts)[0]
  return best ? { path: best.path, linux: best.linux } : null
}

const REDISTS: [RegExp, string][] = [
  [/(?:vcredist|vc_redist).*?(?:2005|v?80)(?!\d)/, 'vcrun2005'],
  [/(?:vcredist|vc_redist).*?(?:2008|v?90)(?!\d)/, 'vcrun2008'],
  [/(?:vcredist|vc_redist).*?(?:2010|v?100)(?!\d)/, 'vcrun2010'],
  [/(?:vcredist|vc_redist).*?(?:2012|v?110)(?!\d)/, 'vcrun2012'],
  [/(?:vcredist|vc_redist).*?(?:2013|v?120)(?!\d)/, 'vcrun2013'],
  [/(?:dxsetup|dxwebsetup|directx.*(?:jun.?2010|d3dx9)|d3dx9[_\d])/, 'd3dx9'],
  [/d3dcompiler[_-]?47/, 'd3dcompiler_47'],
  [/(?:xnafx|xna[/_-]?4)/, 'xna40'],
  [/(?:oalinst|openal)/, 'openal'],
  [/physx/, 'physx'],
  [/(?:ndp|dotnet(?:fx)?)[/_ .-]*4[._-]?8(?!\d)/, 'dotnet48'],
]

/** Dependency hints only. The installer does not run or download these runtimes on that basis. */
export function detectRedistHints(files: JobFile[]): string[] {
  const hints = new Set<string>()
  for (const f of files) {
    const path = normalized(f.path)
    let legacyVc = false
    for (const [pattern, verb] of REDISTS) {
      if (!pattern.test(path)) continue
      hints.add(verb)
      if (verb.startsWith('vcrun')) legacyVc = true
    }
    if (!legacyVc && /(?:^|\/)(?:vc_?redist|visualc)(?:[._/\d-]|$)/.test(path)) hints.add('vcrun2022')
  }
  return [...hints].sort()
}
