// The data folder as the apps name it, and back. In Docker every app sees it at
// /data while Finesse finds it at the real folder (FINESSE_DATA); on Windows the
// apps run on the PC itself, so both name the same real folder.

import { join, normalize, sep } from 'node:path'
import { isNative } from './host.ts'

/** "media/movies" as the apps name it. */
export function toApp(hostData: string, rel: string): string {
  return isNative() ? join(hostData, ...rel.split('/')) : `/data/${rel}`
}

/** A real path under the data folder → how the apps name it. */
export function hostToApp(hostData: string, hostPath: string): string {
  return isNative() ? hostPath : `/data/${hostPath.slice(hostData.length + 1)}`
}

/** A path as the apps name it → where Finesse finds it; null when it isn't inside the data folder. */
export function fromApp(hostData: string, appPath: string | undefined): string | null {
  if (!appPath) return null
  if (isNative()) {
    const p = normalize(appPath)
    const root = normalize(hostData)
    return p.toLowerCase().startsWith(root.toLowerCase() + sep) && !p.split(sep).includes('..') ? p : null
  }
  if (!appPath.startsWith('/data/') || appPath.split('/').includes('..')) return null
  return join(hostData, appPath.slice('/data/'.length))
}
