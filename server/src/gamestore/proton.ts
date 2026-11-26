// A launch plan for a Linux host. A caller supplies the tools, creates the prefix
// parent directory and uses the clone command only when the destination is absent.

import { createHash } from 'node:crypto'
import { posix as path } from 'node:path'

export interface GameManifest {
  gameId: string
  dir: string
  program: string
  linux: boolean
  redistHints: string[]
}

export interface GamescopeOptions {
  width?: number
  height?: number
  fullscreen?: boolean
  hdr?: boolean
  forceGrabCursor?: boolean
}

export interface ProtonLaunchOptions {
  gameId?: string
  dir: string
  /** Path relative to the installed game's directory. */
  program: string
  linux: boolean
  protonPath?: string
  prefixRoot?: string
  goldenPrefix?: string
  redistHints?: readonly string[]
  gamescope?: boolean | GamescopeOptions
}

export interface ProtonLaunch {
  argv: string[]
  env: Record<string, string>
  prefixDir: string | null
  prefixCloneCommand: string[] | null
  gameManifest: GameManifest
}

function validateManifest(manifest: GameManifest): GameManifest {
  if (!manifest || typeof manifest !== 'object' ||
    typeof manifest.gameId !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(manifest.gameId) ||
    typeof manifest.dir !== 'string' || !manifest.dir || manifest.dir.includes('\0') ||
    typeof manifest.program !== 'string' || !manifest.program || /[\\\0]/.test(manifest.program) ||
    path.isAbsolute(manifest.program) || manifest.program.split('/').some((part) => part === '..') ||
    path.normalize(manifest.program) === '.' || typeof manifest.linux !== 'boolean' ||
    !Array.isArray(manifest.redistHints) || !manifest.redistHints.every((hint) => typeof hint === 'string' && /^[a-z0-9][a-z0-9_]*$/.test(hint))) {
    throw new TypeError('Invalid game manifest')
  }
  const { gameId, dir, program, linux, redistHints } = manifest
  return { gameId, dir, program, linux, redistHints: [...new Set(redistHints)].sort() }
}

export function serializeGameManifest(manifest: GameManifest): string {
  return JSON.stringify(validateManifest(manifest), null, 2) + '\n'
}

export function parseGameManifest(json: string): GameManifest {
  return validateManifest(JSON.parse(json) as GameManifest)
}

function gamescopeArgs(opts: GamescopeOptions) {
  const argv = ['gamescope']
  for (const [flag, value] of [['-W', opts.width], ['-H', opts.height]] as const) {
    if (value === undefined) continue
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Gamescope dimensions must be positive integers')
    argv.push(flag, String(value))
  }
  if (opts.fullscreen !== false) argv.push('-f')
  if (opts.hdr) argv.push('--hdr-enabled')
  if (opts.forceGrabCursor) argv.push('--force-grab-cursor')
  return [...argv, '--']
}

export function buildProtonLaunch(opts: ProtonLaunchOptions): ProtonLaunch {
  const gameManifest = validateManifest({
    gameId: opts.gameId ?? 'umu-0',
    dir: opts.dir,
    program: opts.program,
    linux: opts.linux,
    redistHints: [...(opts.redistHints ?? [])],
  })
  const gameDir = path.resolve(gameManifest.dir)
  const program = path.resolve(gameDir, gameManifest.program)
  const wrapper = opts.gamescope ? gamescopeArgs(opts.gamescope === true ? {} : opts.gamescope) : []
  if (opts.linux) return { argv: [...wrapper, program], env: {}, prefixDir: null, prefixCloneCommand: null, gameManifest }

  if (!opts.protonPath || !opts.prefixRoot) throw new TypeError('Windows games need a Proton path and prefix root')
  // Unknown umu IDs share the generic launcher ID, but keep their save data separate.
  const prefixName = gameManifest.gameId === 'umu-0'
    ? `umu-0-${createHash('sha256').update(gameDir).digest('hex').slice(0, 16)}`
    : gameManifest.gameId
  const prefixDir = path.resolve(opts.prefixRoot, prefixName)
  const golden = opts.goldenPrefix ? path.resolve(opts.goldenPrefix) : null
  if (golden === prefixDir || (golden && prefixDir.startsWith(golden + '/'))) throw new TypeError('Golden prefix must be separate from the game prefix')

  return {
    argv: [...wrapper, 'umu-run', program],
    env: {
      GAMEID: gameManifest.gameId,
      PROTONPATH: opts.protonPath,
      WINEPREFIX: prefixDir,
      STORE: 'none',
      WINEDLLOVERRIDES: 'winemenubuilder.exe=d',
    },
    prefixDir,
    prefixCloneCommand: golden ? ['cp', '-aT', '--reflink=auto', '--', golden, prefixDir] : null,
    gameManifest,
  }
}
