// Whole-app updates on Windows: the release's finesse-windows-<v>-x64.zip
// (Node, the server and the web app) unpacked next to the running version in
// <install>\app\<v>, then the Finesse service restarts Finesse on it. The
// version it ran before is noted, so the service can go back to it if the new
// one won't start.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ApiError } from '../http/core.ts'
import { logger } from '../log.ts'
import type { GitHubReleases, ImageUpdater } from '../update.ts'

const log = logger('update')

export const windowsAsset = (version: string) => `finesse-windows-${version}-x64.zip`
/** Finesse exits with this when a new version is in place: the service starts it again on that version. */
export const RESTART_ON_NEW_VERSION = 75
const MAX_BUNDLE = 400 * 1024 * 1024

export interface WindowsUpdateDeps {
  unzip?: (file: string, dest: string) => void
  exit?: (code: number) => void
}

export function windowsUpdater(gh: Pick<GitHubReleases, 'latest' | 'download'>, installDir: string, backup: () => Promise<void>, deps: WindowsUpdateDeps = {}): ImageUpdater {
  const unzip = deps.unzip ?? ((file: string, dest: string) => {
    const r = spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', file, '-C', dest], { windowsHide: true, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`Couldn’t unpack the update (${(r.stderr || '').trim().slice(-200)})`)
  })
  const exit = deps.exit ?? ((code: number) => process.exit(code))
  const find = async (version: string, fresh = false) => (await gh.latest(fresh)).assets.find((a) => a.name === windowsAsset(version)) ?? null
  return {
    plan: async (version) => ((await find(version)) ? version : null),
    run: async (version, onStep) => {
      const asset = await find(version, true)
      if (!asset) throw new ApiError(404, `Release ${version} has no Windows build`)
      onStep('backing up')
      await backup().catch(() => {})
      onStep('downloading')
      const zip = await gh.download(asset, MAX_BUNDLE)
      onStep('installing')
      const apps = join(installDir, 'app')
      mkdirSync(apps, { recursive: true })
      const file = join(apps, `${version}.zip`)
      const tmp = join(apps, `${version}.unpacking`)
      const dest = join(apps, version)
      rmSync(tmp, { recursive: true, force: true })
      mkdirSync(tmp, { recursive: true })
      try {
        writeFileSync(file, zip)
        unzip(file, tmp)
        for (const need of ['node.exe', join('server', 'finesse-server.mjs'), join('web', 'index.html')])
          if (!existsSync(join(tmp, need))) throw new ApiError(502, `The Windows build of ${version} is missing ${need}`)
        rmSync(dest, { recursive: true, force: true })
        renameSync(tmp, dest)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
        rmSync(file, { force: true })
      }
      // The service reads these when it starts Finesse: the new version, and the one to go back to.
      const current = join(installDir, 'current.txt')
      const before = existsSync(current) ? readFileSync(current, 'utf8').trim() : ''
      if (before && before !== version) writeFileSync(join(installDir, 'previous.txt'), before)
      writeFileSync(`${current}.tmp`, version)
      renameSync(`${current}.tmp`, current)
      log.info(`Windows build ${version} installed; restarting on it`)
      onStep('restarting')
      // A moment for the answer to reach the browser first.
      setTimeout(() => exit(RESTART_ON_NEW_VERSION), 1500).unref()
    },
  }
}
