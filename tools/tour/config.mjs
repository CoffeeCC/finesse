// Where the tour tooling keeps things and how it reaches the demo server.
// Everything can be overridden with environment variables (see README.md).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
export const REPO = join(HERE, '..', '..')

/** Takes, films, episodes and the voice cache. Big (a desktop take is ~5 GB of frames). */
export const WORK = process.env.TOUR_WORK || join(homedir(), '.cache', 'finesse-tour')
/** The demo servers' folders: <DEMO>/{root,data} for the demo, <DEMO>/wizard/{root,data} for the fresh one. */
export const DEMO = process.env.TOUR_DEMO || join(WORK, 'demo')
export const VO_DIR = join(WORK, 'vo')
export const IDS_FILE = join(WORK, 'ids.json')

export const APP = process.env.TOUR_APP || 'http://localhost:8080/finesse'
export const WIZ = process.env.TOUR_WIZ || 'http://localhost:8091/finesse'
/** The demo household's password. A throwaway: the demo server is local and full of free films. */
export const PASSWORD = 'FinesseDemo2026'

/** Google Chrome plays H.264/AAC like people's browsers do; Playwright's own Chromium can't. */
export const CHROME = process.env.TOUR_CHROME || ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((p) => existsSync(p))

/** ffmpeg is Jellyfin's build, from the image the stack already pins (so nothing else to install). */
export const FFMPEG_IMAGE = (() => {
  const m = /image: '(jellyfin\/jellyfin:[^']+)'/.exec(readFileSync(join(REPO, 'server/src/stack/catalog.ts'), 'utf8'))
  return m?.[1] ?? 'jellyfin/jellyfin:latest'
})()
const docker = (bin, args, cwd) =>
  ['run', '--rm', '--entrypoint', `/usr/lib/jellyfin-ffmpeg/${bin}`, '-v', `${WORK}:${WORK}`, '-v', `${REPO}:${REPO}`, ...(cwd ? ['-w', cwd] : []), FFMPEG_IMAGE, ...args]
export const ff = (args, cwd) => execFileSync('docker', docker('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], cwd), { stdio: 'inherit' })
export const probe = (file) => Number(execFileSync('docker', docker('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).toString().trim())

/** Item ids on the demo server (written by demo/ids.mjs). */
export const ids = () => {
  if (!existsSync(IDS_FILE)) throw new Error(`No ${IDS_FILE} yet — run demo/build.sh (or node demo/ids.mjs) first`)
  return JSON.parse(readFileSync(IDS_FILE, 'utf8'))
}
/** Narration, effects and music made by vo.mjs: { "vo:<caption>": { file, dur }, … }. */
export const voIndex = () => (existsSync(join(VO_DIR, 'index.json')) ? JSON.parse(readFileSync(join(VO_DIR, 'index.json'), 'utf8')) : {})
